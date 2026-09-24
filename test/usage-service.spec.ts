import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { registerUsageService } from '../src/usage-service.js'
import { getEventListeners } from 'node:events'
import { PoolUsageTracker } from '../src/providers/pool-usage.js'
import type { ProviderUsage } from '../src/providers/common.js'
import type { ProviderStatus } from '../src/auth/rpc.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const accountStatus: ProviderStatus = { busy: false, accounts: [{ key: 'id', isDefault: true }] }

test('quota snapshots isolate provider failures and never return credential fields', async () => {
  const ctx = new Context()
  registerUsageService(ctx, {
    async status(provider) {
      if (provider === 'claude') throw new Error('private failure details')
      return { busy: false, accounts: provider === 'codex' ? [{ key: 'id', account: 'runner', isDefault: true, accessToken: 'secret' }] : [] }
    },
    async usage() { return { supported: true, windows: [{ kind: 'session', usedPercent: 25, resetsAt: 123 }] } },
  })
  const snapshot = await ctx.get('subscriptionUsage').snapshot(AbortSignal.timeout(1000))
  assert.deepEqual(snapshot.accounts, [
    { provider: 'codex', account: 'runner', available: true, supported: true, plan: null, windows: [{ kind: 'session', scope: null, usedPercent: 25, resetsAt: 123 }] },
    { provider: 'claude', account: '', available: false, supported: true, plan: null, windows: [] },
  ])
  assert.ok(!JSON.stringify(snapshot).includes('secret'))
  await ctx.fiber.dispose()
})

test('an already cancelled snapshot starts no provider work', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  let calls = 0
  registerUsageService(ctx, {
    async status() { calls++; return accountStatus },
    async usage() { calls++; return { supported: true } },
  })
  const reason = new Error('request cancelled')
  await assert.rejects(ctx.get('subscriptionUsage').snapshot(AbortSignal.abort(reason)), error => error === reason)
  assert.equal(calls, 0)
})

test('cancelling while status is pending rejects promptly and starts no usage fetch', { timeout: 1000 }, async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const status = deferred<ProviderStatus>()
  let usageCalls = 0
  registerUsageService(ctx, {
    status: () => status.promise,
    async usage() { usageCalls++; return { supported: true } },
  })
  const controller = new AbortController()
  const snapshot = ctx.get('subscriptionUsage').snapshot(controller.signal)
  const reason = new Error('status cancelled')
  controller.abort(reason)
  await assert.rejects(snapshot, error => error === reason)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  status.resolve(accountStatus)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(usageCalls, 0)
})

test('non-pooled cancellation reaches the fetcher and rejects instead of returning unavailable', { timeout: 1000 }, async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const started = deferred<AbortSignal>()
  registerUsageService(ctx, {
    async status(provider) { return provider === 'codex' ? accountStatus : { busy: false, accounts: [] } },
    usage(_provider, _account, signal) {
      started.resolve(signal)
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    },
  })
  const controller = new AbortController()
  const snapshot = ctx.get('subscriptionUsage').snapshot(controller.signal)
  assert.equal(await started.promise, controller.signal)
  const reason = new Error('fetch cancelled')
  controller.abort(reason)
  await assert.rejects(snapshot, error => error === reason)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
})

test('cancelling a pooled snapshot preserves the shared fetch and cache for other readers', { timeout: 1000 }, async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const fetched = deferred<ProviderUsage>()
  const started = deferred<void>()
  let calls = 0
  const pool = new PoolUsageTracker(() => () => {
    calls++
    started.resolve()
    return fetched.promise
  })
  registerUsageService(ctx, {
    async status(provider) { return provider === 'codex' ? accountStatus : { busy: false, accounts: [] } },
    usage: (provider, account) => pool.snapshotFor(provider, account),
  })
  const cancelled = new AbortController()
  const active = new AbortController()
  const service = ctx.get('subscriptionUsage')
  const first = service.snapshot(cancelled.signal)
  const second = service.snapshot(active.signal)
  await started.promise
  const reason = new Error('reader cancelled')
  cancelled.abort(reason)
  await assert.rejects(first, error => error === reason)
  assert.equal(getEventListeners(cancelled.signal, 'abort').length, 0)
  fetched.resolve({ supported: true, windows: [{ kind: 'session', usedPercent: 25 }] })
  const result = await second
  assert.equal(result.accounts[0].available, true)
  assert.equal(result.accounts[0].windows[0].usedPercent, 25)
  assert.equal(getEventListeners(active.signal, 'abort').length, 0)
  assert.deepEqual((await service.snapshot(active.signal)).accounts, result.accounts)
  assert.equal(calls, 1)
})

test('ordinary usage failures still return unavailable rows and clean up cancellation listeners', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  registerUsageService(ctx, {
    async status(provider) { return provider === 'codex' ? accountStatus : { busy: false, accounts: [] } },
    async usage() { throw new Error('provider unavailable') },
  })
  const controller = new AbortController()
  const result = await ctx.get('subscriptionUsage').snapshot(controller.signal)
  assert.deepEqual(result.accounts, [
    { provider: 'codex', account: 'id', available: false, supported: true, plan: null, windows: [] },
  ])
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
})
