import type { Context } from '@deepseek-ai/cordis'
import type { AuthController } from './auth/rpc.js'
import { PROVIDER_IDS } from './auth/store.js'

/** Share quota metadata with host integrations without exposing OAuth credentials. */
export function registerUsageService(ctx: Context, controller: Pick<AuthController, 'status' | 'usage'>): void {
  ctx.reflect.provide('subscriptionUsage', {
    snapshot(signal: AbortSignal) {
      return withCancellation(signal, async () => {
        const providers = await Promise.all(PROVIDER_IDS.map(async provider => {
          try {
            const status = await controller.status(provider)
            signal.throwIfAborted()
            return await Promise.all(status.accounts.map(async account => {
              const identity = { provider, account: account.account ?? account.key }
              try {
                const usage = await controller.usage(provider, account.key, signal)
                return { ...identity, available: true, supported: usage.supported, plan: usage.plan ?? null,
                  windows: (usage.windows ?? []).map(window => ({ kind: window.kind, scope: window.scope ?? null,
                    usedPercent: window.usedPercent, resetsAt: window.resetsAt ?? null })) }
              } catch {
                signal.throwIfAborted()
                return { ...identity, available: false, supported: true, plan: null, windows: [] }
              }
            }))
          } catch {
            signal.throwIfAborted()
            return [{ provider, account: '', available: false, supported: true, plan: null, windows: [] }]
          }
        }))
        return { fetchedAt: Date.now(), accounts: providers.flat() }
      })
    },
  })
}

/** Cancel this reader without interrupting a pooled fetch shared by other readers. */
async function withCancellation<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  let onAbort!: () => void
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([cancelled, operation()])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
