import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { registerHooks } from 'node:module'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'

const css = registerHooks({ load(url, context, nextLoad) {
  return url.endsWith('.css')
    ? { format: 'module', source: 'export default {}', shortCircuit: true }
    : nextLoad(url, context)
} })
const { ImageGenerateToolview } = await import('../src/client/ImageGenerateToolview.js')
const { VideoGenerateToolview } = await import('../src/client/VideoGenerateToolview.js')
css.deregister()

for (const [name, Component] of [
  ['image_generate', ImageGenerateToolview],
  ['video_generate', VideoGenerateToolview],
] as const) {
  test(`${name} renders preparation without arguments and shows the prompt after dispatch`, () => {
    const block: ToolCallBlock = {
      phase: 'preparing', callId: 'call', name, turn: 1, step: 1, time: 1, subCalls: [],
    }
    const preparing = renderToStaticMarkup(createElement(Component, { block }))
    assert.ok(preparing.includes(name))
    assert.ok(!preparing.includes('undefined'))
    const started = renderToStaticMarkup(createElement(Component, {
      block: { ...block, phase: 'start', argsRaw: JSON.stringify({ prompt: 'A lighthouse at dusk' }) },
    }))
    assert.ok(started.includes('A lighthouse at dusk'))
  })
}
