/**
 * Persist a JSON value atomically with owner-only permissions: write a
 * sibling temp file, then rename it over the destination.
 * @param path - destination file; its directory is created when missing.
 * @param value - the value to serialize.
 */
export declare function writePrivateJson(path: string, value: unknown): Promise<void>;
