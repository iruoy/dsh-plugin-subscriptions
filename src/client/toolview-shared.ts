/**
 * Helpers shared by the image_generate and video_generate tool views: the
 * call-card title prompt and the settled result's text body.
 */

import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Title prompt truncation budget (characters). */
const PROMPT_MAX_LENGTH = 60

/** Extract the prompt from the call's raw args JSON; falls back to the first string value, then the raw line. */
export function derivePrompt(argsRaw: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(argsRaw)
  } catch {
    // Non-JSON args (mid-stream truncation): fall back to the raw string below.
    parsed = undefined
  }
  let prompt: string | undefined
  if (typeof parsed === 'object' && parsed !== null) {
    const args = parsed as Record<string, unknown>
    if (typeof args.prompt === 'string' && args.prompt !== '') prompt = args.prompt
    else {
      for (const value of Object.values(args)) {
        if (typeof value === 'string' && value !== '') { prompt = value; break }
      }
    }
  }
  const line = (prompt ?? argsRaw).split('\n', 1)[0] ?? ''
  return line.length > PROMPT_MAX_LENGTH ? `${line.slice(0, PROMPT_MAX_LENGTH)}…` : line
}

/** Flatten a settled result's text blocks (the text-only fallback body and the error line). */
export function resultText(block: ToolCallBlock): string {
  if (!('kind' in block)) return ''
  const parts: string[] = []
  for (const part of block.content) {
    if (part.type === 'text') parts.push(part.text)
  }
  if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`)
  return parts.join('\n')
}
