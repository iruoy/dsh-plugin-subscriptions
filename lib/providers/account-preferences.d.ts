import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ProviderId } from '../auth/store.js';
import type { ProviderSettingsStore, ReadonlyAccountPreferences } from '../provider-settings.js';
import type { AccountAwareAdapter } from './accounts.js';
import type { PoolAdapter } from './pool.js';
/** Reserved namespace, recognized even when malformed or no longer enabled. */
export declare const ACCOUNT_MODEL_PREFIX = "~account:";
export declare function accountModelId(account: string, model: string): string;
export declare function parseAccountModelId(id: string): {
    account: string;
    model: string;
} | undefined;
export declare function accountAllowsPool(preferences: ReadonlyAccountPreferences | undefined, model: string): boolean;
interface Options {
    provider: ProviderId;
    adapter: AccountAwareAdapter;
    settings: ProviderSettingsStore;
    accounts: () => Promise<readonly {
        key: string;
        label: string;
    }[]>;
    pool: () => PoolAdapter | undefined;
}
/** Keeps the registered route separate from raw adapters and pool member seams. */
export declare class AccountPreferencesAdapter extends LlmAdapter {
    private readonly options;
    constructor(options: Options);
    private preference;
    private models;
    /** @param known - the account list, when the caller already loaded it. */
    private requireAccount;
    private fallback;
    /** Pool-only facade: explicit families/tiers must obey the same policy as auto pools. */
    poolMember(): AccountAwareAdapter;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, id: string): Promise<LlmResolvedModelInfo>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
export {};
