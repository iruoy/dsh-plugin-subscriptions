import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
/**
 * Persist a JSON value atomically with owner-only permissions: write a
 * sibling temp file, then rename it over the destination.
 * @param path - destination file; its directory is created when missing.
 * @param value - the value to serialize.
 */
export async function writePrivateJson(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    try {
        await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
        // An existing destination keeps its old mode through rename on some
        // filesystems; enforce 0600 on the source before the swap.
        await chmod(tmp, 0o600);
        await rename(tmp, path);
    }
    catch (error) {
        await rm(tmp, { force: true });
        throw error;
    }
}
