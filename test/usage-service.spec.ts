import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { registerUsageService } from '../src/usage-service.js'

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
