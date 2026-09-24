import type { FetchFn } from './common.js';
/** Public metadata only: never send subscription credentials to this endpoint. */
export declare const CODEX_VERSION_URL = "https://registry.npmjs.org/@openai%2fcodex/latest";
/** Lazy, shared-per-plugin lookup of the official CLI's stable version. */
export declare class CodexClientVersionCache {
    private readonly fetchFn;
    private readonly now;
    private readonly timeoutMs;
    private version;
    private expiresAt;
    private pending;
    constructor(fetchFn?: FetchFn, now?: () => number, timeoutMs?: number);
    /** A manual catalog refresh also checks for a newly released CLI. */
    invalidate(): void;
    resolve(): Promise<string>;
    private refresh;
}
