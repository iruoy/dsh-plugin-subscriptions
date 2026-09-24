/**
 * Resolved-image plumbing for the wire translators. ImageBlocks carry only an
 * attachment reference; the bytes live in the attachment service, which is
 * async I/O. Adapters resolve images BEFORE calling the (pure, synchronous)
 * translators, so the translators see {@link ResolvedImagePart}s with inline
 * base64 data.
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, ImageBlock, Message, RequestMessage } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { ToolCallId } from '../compat.js'

/** Legacy tool-result block retained for imported histories and translator input. */
export interface ToolResultBlock {
  type: 'tool-result'
  toolCallId: ToolCallId
  content: readonly InputBlock[]
  isError?: boolean
}

export type InputBlock = ContentBlock | ToolResultBlock
export type InputMessage = Omit<RequestMessage, 'content'> & { content: readonly InputBlock[] }

/** An image block with its bytes resolved to inline base64 for the wire. */
export interface ResolvedImagePart {
  type: 'image'
  /** MIME type verified by the attachment service (e.g. `image/png`). */
  mediaType: string
  /** Base64-encoded image bytes. */
  dataBase64: string
}

/** Translator input block: a harness block, with images pre-resolved. */
export type TranslatableBlock =
  | Exclude<ContentBlock, ImageBlock | ToolResultBlock>
  | ResolvedImagePart
  | ResolvedToolResultBlock

/** Tool results may themselves carry attachment-backed images. */
export interface ResolvedToolResultBlock extends Omit<ToolResultBlock, 'content'> {
  content: readonly TranslatableBlock[]
}

/**
 * Flatten a tool result's content to plain text for wires with text-only tool
 * outputs. Blocks are separate paragraphs (resolveImages appends an image
 * reference after each image), so they join on newlines instead of running
 * together.
 */
export function toolResultText(block: ResolvedToolResultBlock): string {
  return block.content.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('\n')
}

/** A resolved message before the tool-role fold: DSH 0.1.7 first-class tool results included. */
export interface ToolRoleMessage extends Omit<TranslatableMessage, 'role'> {
  role: TranslatableMessage['role'] | 'tool'
  /** First-class tool result correlation in current harness messages. */
  toolCallId?: string
  /** Chat Completions correlation in imported histories. */
  tool_call_id?: string
  isError?: boolean
}

/**
 * Fold first-class `role: 'tool'` messages (DSH 0.1.7) into the user-role
 * `tool-result` block every translator already speaks, so each wire handles
 * one tool-result shape and keeps its correlation id and error flag.
 * {@link resolveImages} applies it, so translators never see a tool role.
 * @param messages - ordered conversation messages.
 * @returns the same messages, with tool-role ones rewritten as user tool results.
 */
export function withToolResultBlocks(messages: readonly ToolRoleMessage[]): readonly TranslatableMessage[] {
  if (!messages.some(message => message.role === 'tool')) return messages as readonly TranslatableMessage[]
  return messages.map((message): TranslatableMessage => {
    if (message.role !== 'tool') return message as TranslatableMessage
    const callId = [
      message.toolCallId,
      message.tool_call_id,
      message.source?.kind === 'tool' ? String(message.source.callId) : undefined,
    ].find(id => id !== undefined && id.length > 0)
    if (callId === undefined) throw new LlmError('tool result has no call id', 'INVALID_REQUEST')
    return {
      role: 'user',
      ...message.source === undefined ? {} : { source: message.source },
      content: [{
        type: 'tool-result',
        toolCallId: ToolCallId(callId),
        content: message.content,
        ...message.isError === undefined ? {} : { isError: message.isError },
      }],
    }
  })
}

/**
 * Wires with text-only tool outputs receive images in a following user turn.
 * Defer that turn until all consecutive user messages have been processed:
 * parallel tool results can arrive in separate harness messages, and a user
 * image message must not interrupt their tool-call/output pairing.
 */
export function withToolResultImages(messages: readonly TranslatableMessage[]): TranslatableMessage[] {
  const out: TranslatableMessage[] = []
  let images: TranslatableBlock[] = []
  const flush = (): void => {
    if (images.length > 0) out.push({ role: 'user', content: images })
    images = []
  }
  for (const message of messages) {
    if (message.role === 'assistant') flush()
    out.push(message)
    for (const block of message.content) {
      if (block.type !== 'tool-result') continue
      const parts = block.content.filter((part): part is ResolvedImagePart => part.type === 'image')
      if (parts.length > 0) {
        images.push({ type: 'text', text: `Images from tool result ${String(block.toolCallId)}:` }, ...parts)
      }
    }
  }
  flush()
  return out
}

/** Translator input message: role plus resolved blocks, tool results folded into user turns. */
export interface TranslatableMessage {
  role: 'system' | 'developer' | 'user' | 'assistant'
  content: readonly TranslatableBlock[]
  /** Preserved for adapters whose provider-private replay metadata is required. */
  source?: Message['source']
}

const hasImage = (block: InputBlock | TranslatableBlock): boolean => block.type === 'image'
  || (block.type === 'tool-result' && block.content.some(hasImage))

/**
 * Whether any message carries an image, including one nested in a tool result
 * (withToolResultImages moves those onto the wire too).
 * @param messages - conversation messages, resolved or not.
 * @returns true when at least one image block is present.
 */
export function hasImages(messages: readonly { content: readonly (InputBlock | TranslatableBlock)[] }[]): boolean {
  return messages.some(message => message.content.some(hasImage))
}

/**
 * Resolve every ImageBlock's attachment reference to inline base64 bytes and
 * fold tool-role messages ({@link withToolResultBlocks}): the one step between
 * harness messages and the translators. Messages without images or tool roles
 * pass through unchanged. A request carrying an image
 * with no attachment service available fails loudly rather than silently
 * dropping the image.
 * @param messages - the request's conversation messages.
 * @param attachments - the deployment's attachment service, when mounted.
 * @param signal - cancellation for the storage reads.
 * @returns the same messages, resolved and folded for the translators.
 */
export async function resolveImages(
  messages: readonly InputMessage[],
  attachments: AttachmentStore | undefined,
  signal?: AbortSignal,
): Promise<readonly TranslatableMessage[]> {
  // No image anywhere means no unresolved ImageBlock for the translators.
  if (!hasImages(messages)) return withToolResultBlocks(messages as readonly ToolRoleMessage[])
  if (attachments === undefined) {
    throw new LlmError(
      'dsh-plugin-subscriptions: the request carries an image but no attachments service is mounted; '
      + 'image input requires the harness attachment store',
      'UNSUPPORTED',
    )
  }
  const resolveBlock = async (block: InputBlock): Promise<TranslatableBlock[]> => {
    if (block.type === 'tool-result') {
      return [{ ...block, content: (await Promise.all(block.content.map(resolveBlock))).flat() }]
    }
    if (block.type !== 'image') return [block]
    const stored = await attachments.readImage(block.attachment, signal)
    const { attachmentId, mediaType, bytes, width, height, name } = stored.ref
    return [{
      type: 'image',
      mediaType: stored.ref.mediaType,
      dataBase64: Buffer.from(stored.data).toString('base64'),
    }, {
      type: 'text',
      text: `Image reference (for image_generate.referenceImages): ${JSON.stringify({
        attachmentId, mediaType, bytes, width, height, ...name === undefined ? {} : { name },
      })}`,
    }]
  }
  return withToolResultBlocks(await Promise.all(messages.map(async (message): Promise<ToolRoleMessage> => ({
    ...message,
    content: (await Promise.all(message.content.map(resolveBlock))).flat(),
  }))))
}
