/**
 * Block assembly shared by the Anthropic, Responses and Chat Completions
 * stream translators.
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '../compat.js'

/** One open harness block under assembly. */
export interface OpenBlock {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  text: string
  callId: string
  name?: string
}

/** Assemble the final ContentBlock for one open block. */
export function closeBlock(block: OpenBlock): ContentBlock {
  switch (block.kind) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'reasoning':
      return { type: 'reasoning', text: block.text }
    case 'tool-call':
      return {
        type: 'tool-call',
        id: ToolCallId(block.callId),
        name: block.name ?? '',
        arguments: block.text,
      }
  }
}
