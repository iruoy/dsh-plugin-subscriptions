import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
const PRIMARY_SERVICE = 'Claude Code-credentials';
const execFileAsync = promisify(execFile);
const DEFAULT_SCOPES = 'user:profile user:inference user:sessions:claude_code user:mcp_servers';
function toSession(data) {
    // Empty-string tokens (seen from a corrupted Keychain item left by a Claude
    // Code logout) pass the typeof gate but are useless and would poison the
    // auth store — a single such entry fails every provider's status read.
    if (typeof data.accessToken !== 'string' || data.accessToken.length === 0
        || typeof data.refreshToken !== 'string' || data.refreshToken.length === 0
        || typeof data.expiresAt !== 'number' || !Number.isFinite(data.expiresAt)) {
        return undefined;
    }
    const scopes = Array.isArray(data.scopes) ? data.scopes.join(' ') : typeof data.scopes === 'string' ? data.scopes : DEFAULT_SCOPES;
    return {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: Math.trunc(data.expiresAt),
        scopes,
        ...typeof data.emailAddress === 'string' ? { emailAddress: data.emailAddress } : {},
        ...typeof data.subscriptionType === 'string' ? { subscriptionType: data.subscriptionType } : {},
    };
}
function parseBlob(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    return toSession(parsed.claudeAiOauth ?? parsed);
}
function credentialsFilePath() {
    return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), '.credentials.json');
}
function readKeychainRaw() {
    try {
        return execFileSync('/usr/bin/security', ['find-generic-password', '-s', PRIMARY_SERVICE, '-w'], {
            timeout: 3000,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    }
    catch {
        return undefined;
    }
}
/** Non-blocking {@link readKeychainRaw} for the refresh path. */
async function readKeychainRawAsync() {
    try {
        const { stdout } = await execFileAsync('/usr/bin/security', ['find-generic-password', '-s', PRIMARY_SERVICE, '-w'], {
            timeout: 3000,
            encoding: 'utf8',
        });
        return stdout.trim();
    }
    catch {
        return undefined;
    }
}
function readFileRaw() {
    try {
        return readFileSync(credentialsFilePath(), 'utf8');
    }
    catch {
        return undefined;
    }
}
/** Read the current Claude Code session from its source of truth: macOS Keychain, falling back to the credentials file. */
export function readClaudeCodeCredentials() {
    if (process.platform === 'darwin') {
        const raw = readKeychainRaw();
        const session = raw !== undefined ? parseBlob(raw) : undefined;
        if (session)
            return session;
    }
    const raw = readFileRaw();
    return raw !== undefined ? parseBlob(raw) : undefined;
}
/** Non-blocking {@link readClaudeCodeCredentials} for the refresh path. */
async function readClaudeCodeCredentialsAsync() {
    if (process.platform === 'darwin') {
        const raw = await readKeychainRawAsync();
        const session = raw !== undefined ? parseBlob(raw) : undefined;
        if (session)
            return session;
    }
    const raw = await readFile(credentialsFilePath(), 'utf8').catch(() => undefined);
    return raw !== undefined ? parseBlob(raw) : undefined;
}
function blobMatches(raw, expectedAccessToken) {
    return parseBlob(raw)?.accessToken === expectedAccessToken;
}
async function getKeychainAccountName() {
    try {
        const { stdout: output } = await execFileAsync('/usr/bin/security', ['find-generic-password', '-s', PRIMARY_SERVICE], {
            timeout: 2000,
            encoding: 'utf8',
        });
        return /"acct"<blob>="([^"]*)"/.exec(output)?.[1];
    }
    catch {
        return undefined;
    }
}
/** Merge fresh tokens into an existing raw blob, preserving unrelated fields. */
function mergeIntoBlob(existingRaw, next) {
    let parsed;
    try {
        parsed = JSON.parse(existingRaw);
    }
    catch {
        return undefined;
    }
    const target = (parsed.claudeAiOauth ?? parsed);
    target.accessToken = next.accessToken;
    target.refreshToken = next.refreshToken;
    target.expiresAt = next.expiresAt;
    return JSON.stringify(parsed);
}
/**
 * Write a refreshed session back to Claude Code's own credential store, so
 * the `claude` CLI and any other consumer of the same account see the token
 * we just rotated. A stale-blob mismatch (something else rotated it first)
 * is a no-op — the caller already has that other rotation via readClaudeCodeCredentials.
 * @param next - the freshly refreshed session to persist.
 * @param expectedPriorAccessToken - the access token this refresh started from.
 * @returns whether the write-back succeeded.
 */
export async function writeBackClaudeCodeCredentials(next, expectedPriorAccessToken) {
    if (process.platform === 'darwin') {
        const raw = await readKeychainRawAsync();
        if (raw === undefined || !blobMatches(raw, expectedPriorAccessToken))
            return false;
        const updated = mergeIntoBlob(raw, next);
        if (updated === undefined)
            return false;
        const account = await getKeychainAccountName() ?? PRIMARY_SERVICE;
        try {
            await execFileAsync('/usr/bin/security', ['add-generic-password', '-s', PRIMARY_SERVICE, '-a', account, '-w', updated, '-U'], {
                timeout: 2000,
            });
            return true;
        }
        catch {
            return false;
        }
    }
    const path = credentialsFilePath();
    let raw;
    try {
        raw = await readFile(path, 'utf8');
    }
    catch {
        return false;
    }
    if (!blobMatches(raw, expectedPriorAccessToken))
        return false;
    const updated = mergeIntoBlob(raw, next);
    if (updated === undefined)
        return false;
    try {
        // recursive mkdir is a no-op for an existing directory.
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, updated, { encoding: 'utf8', mode: 0o600 });
        await chmod(path, 0o600);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Refresh a Claude session, first checking whether Claude Code's own store
 * already holds a fresher token (rotated by the `claude` CLI or another
 * consumer) before hitting the OAuth endpoint ourselves — and writing our own
 * refresh back to that store so every consumer of the account stays synced.
 * @param session - the session TokenManager wants refreshed.
 * @param doRefresh - the actual OAuth refresh-token grant (network call).
 * @returns the freshest available session.
 */
export async function refreshClaudeSynced(session, doRefresh) {
    const fromSource = await readClaudeCodeCredentialsAsync();
    const base = fromSource !== undefined && fromSource.accessToken !== session.accessToken ? fromSource : session;
    if (base.expiresAt > Date.now() + 60_000)
        return base;
    const next = await doRefresh(base);
    await writeBackClaudeCodeCredentials(next, base.accessToken);
    return next;
}
