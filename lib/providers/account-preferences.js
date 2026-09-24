import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import { DISCOVERY_TIMEOUT_MS, withTimeout } from './common.js';
/** Reserved namespace, recognized even when malformed or no longer enabled. */
export const ACCOUNT_MODEL_PREFIX = '~account:';
export function accountModelId(account, model) {
    return `${ACCOUNT_MODEL_PREFIX}${encodeURIComponent(account)}:${encodeURIComponent(model)}`;
}
export function parseAccountModelId(id) {
    if (!id.startsWith(ACCOUNT_MODEL_PREFIX))
        return undefined;
    const parts = id.slice(ACCOUNT_MODEL_PREFIX.length).split(':');
    try {
        if (parts.length !== 2)
            throw new Error();
        const account = decodeURIComponent(parts[0]);
        const model = decodeURIComponent(parts[1]);
        if (!account || !model || accountModelId(account, model) !== id)
            throw new Error();
        return { account, model };
    }
    catch {
        throw new LlmError('Invalid independent account model id', 'NO_ADAPTER');
    }
}
export function accountAllowsPool(preferences, model) {
    return preferences?.poolEnabled !== false && (preferences?.poolModels?.includes(model) ?? true);
}
/** Keeps the registered route separate from raw adapters and pool member seams. */
export class AccountPreferencesAdapter extends LlmAdapter {
    options;
    constructor(options) {
        super();
        this.options = options;
    }
    preference(account) {
        return this.options.settings.account(this.options.provider, account);
    }
    async models(account) {
        return await withTimeout(signal => this.options.adapter.listOwnModels(this.options.provider, account, signal), DISCOVERY_TIMEOUT_MS) ?? [];
    }
    /** @param known - the account list, when the caller already loaded it. */
    async requireAccount(account, model, independent, known) {
        if (!(known ?? await this.options.accounts()).some(entry => entry.key === account)
            || (independent ? this.preference(account)?.independentEntry !== true : !accountAllowsPool(this.preference(account), model))
            || !(await this.models(account)).some(entry => entry.id === model)) {
            throw new LlmError(`Account route unavailable: ${this.options.provider}/${account}/${model}`, 'NO_ADAPTER');
        }
    }
    async fallback(model) {
        const accounts = await this.options.accounts();
        for (const { key } of accounts) {
            if (!accountAllowsPool(this.preference(key), model))
                continue;
            try {
                await this.requireAccount(key, model, false, accounts);
                return key;
            }
            catch { /* unavailable catalog */ }
        }
        throw new LlmError(`No eligible account for ${this.options.provider}/${model}`, 'NO_ADAPTER');
    }
    /** Pool-only facade: explicit families/tiers must obey the same policy as auto pools. */
    poolMember() {
        const raw = this.options.adapter;
        const keyFor = async (account, model) => {
            if (model.startsWith(ACCOUNT_MODEL_PREFIX))
                throw new LlmError('Independent entries cannot be pool members', 'NO_ADAPTER');
            const accounts = await this.options.accounts();
            const key = account ?? accounts[0]?.key;
            if (!key)
                throw new LlmError('No account available', 'NO_ADAPTER');
            await this.requireAccount(key, model, false, accounts);
            return key;
        };
        return new Proxy(raw, { get: (target, property) => {
                if (property === 'streamAccount')
                    return async function* (options, account) {
                        let key;
                        try {
                            key = await keyFor(account, options.model);
                        }
                        catch (cause) {
                            // Skip policy-excluded members without poisoning account health. The
                            // pool treats TRANSPORT as switch-without-cooldown; raw is never called.
                            throw new LlmError('Pool member unavailable under account preferences', 'TRANSPORT', { cause });
                        }
                        yield* raw.streamAccount(options, key);
                    };
                if (property === 'resolveOwnModel')
                    return async (provider, model, account) => raw.resolveOwnModel(provider, model, await keyFor(account, model));
                const value = Reflect.get(target, property);
                return typeof value === 'function' ? value.bind(target) : value;
            } });
    }
    async listModels(provider) {
        const result = new Map();
        const catalogs = await Promise.all((await this.options.accounts()).map(async (account) => ({ ...account, models: await this.models(account.key).catch(() => []) })));
        for (const { key, label, models } of catalogs) {
            const preferences = this.preference(key);
            for (const model of models) {
                if (model.id.startsWith(ACCOUNT_MODEL_PREFIX))
                    continue;
                if (accountAllowsPool(preferences, model.id) && this.options.settings.visible(this.options.provider, model.id) && !result.has(model.id))
                    result.set(model.id, model);
                if (preferences?.independentEntry === true && this.options.settings.visible(this.options.provider, model.id)) {
                    const id = accountModelId(key, model.id);
                    result.set(id, { ...model, id, name: `${preferences.alias || label} · ${model.name}` });
                }
            }
        }
        for (const model of await this.options.pool()?.modelsForProvider(this.options.provider) ?? []) {
            if (model.id.startsWith(ACCOUNT_MODEL_PREFIX) || !this.options.settings.visible(this.options.provider, model.id))
                continue;
            try {
                await this.options.pool().resolveModel(provider, model.id);
                result.set(model.id, model);
            }
            catch { /* excluded tier */ }
        }
        const priority = (model) => model.priority ?? Number.MAX_SAFE_INTEGER;
        return [...result.values()].sort((left, right) => priority(left) - priority(right));
    }
    async resolveModel(provider, id) {
        const independent = parseAccountModelId(id);
        if (independent) {
            const accounts = await this.options.accounts();
            await this.requireAccount(independent.account, independent.model, true, accounts);
            const info = await this.options.adapter.resolveOwnModel(provider, independent.model, independent.account);
            const label = accounts.find(entry => entry.key === independent.account)?.label ?? independent.account;
            return { ...info, id, name: `${this.preference(independent.account)?.alias || label} · ${info.name}` };
        }
        const pool = this.options.pool();
        if (pool && await pool.owns(this.options.provider, id))
            return pool.resolveModel(provider, id);
        return this.options.adapter.resolveOwnModel(provider, id, await this.fallback(id));
    }
    async *stream(options) {
        const independent = parseAccountModelId(options.model);
        if (independent) {
            await this.requireAccount(independent.account, independent.model, true);
            yield* this.options.adapter.streamAccount({ ...options, model: independent.model }, independent.account);
            return;
        }
        const pool = this.options.pool();
        if (pool && await pool.owns(this.options.provider, options.model)) {
            yield* pool.stream(options);
            return;
        }
        yield* this.options.adapter.streamAccount(options, await this.fallback(options.model));
    }
}
