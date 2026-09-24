/**
 * Resolved-image plumbing for the wire translators. ImageBlocks carry only an
 * attachment reference; the bytes live in the attachment service, which is
 * async I/O. Adapters resolve images BEFORE calling the (pure, synchronous)
 * translators, so the translators see {@link ResolvedImagePart}s with inline
 * base64 data.
 */
import type { ContentBlock, Message, ToolResultBlock } from '@deepseek-ai/dsh-llm';
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';
/** An image block with its bytes resolved to inline base64 for the wire. */
export interface ResolvedImagePart {
    type: 'image';
    /** MIME type verified by the attachment service (e.g. `image/png`). */
    mediaType: string;
    /** Base64-encoded image bytes. */
    dataBase64: string;
}
/** Translator input block: a harness block, with images pre-resolved. */
export type TranslatableBlock = Exclude<ContentBlock, ToolResultBlock> | ResolvedImagePart | ResolvedToolResultBlock;
/** Tool results may themselves carry attachment-backed images. */
export interface ResolvedToolResultBlock extends Omit<ToolResultBlock, 'content'> {
    content: readonly TranslatableBlock[];
}
/**
 * Flatten a tool result's content to plain text for wires with text-only tool
 * outputs. Blocks are separate paragraphs (resolveImages appends an image
 * reference after each image), so they join on newlines instead of running
 * together.
 */
export declare function toolResultText(block: ResolvedToolResultBlock): string;
/**
 * Fold first-class `role: 'tool'` messages (DSH 0.1.7) into the user-role
 * `tool-result` block every translator already speaks, so each wire handles
 * one tool-result shape and keeps its correlation id and error flag.
 * @param messages - ordered conversation messages.
 * @returns the same messages, with tool-role ones rewritten as user tool results.
 */
export declare function withToolResultBlocks(messages: readonly TranslatableMessage[]): readonly TranslatableMessage[];
/**
 * Wires with text-only tool outputs receive images in a following user turn.
 * Defer that turn until all consecutive user messages have been processed:
 * parallel tool results can arrive in separate harness messages, and a user
 * image message must not interrupt their tool-call/output pairing.
 */
export declare function withToolResultImages(messages: readonly TranslatableMessage[]): TranslatableMessage[];
/** Translator input message: role plus resolved blocks. */
export interface TranslatableMessage {
    role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
    content: readonly TranslatableBlock[];
    /** First-class tool result correlation in current harness messages. */
    toolCallId?: string;
    /** Chat Completions correlation in imported histories. */
    tool_call_id?: string;
    isError?: boolean;
    /** Preserved for adapters whose provider-private replay metadata is required. */
    source?: Message['source'];
}
/**
 * Whether any message carries an image, including one nested in a tool result
 * (withToolResultImages moves those onto the wire too).
 * @param messages - conversation messages, resolved or not.
 * @returns true when at least one image block is present.
 */
export declare function hasImages(messages: readonly TranslatableMessage[]): boolean;
/**
 * Resolve every ImageBlock's attachment reference to inline base64 bytes.
 * Messages without images pass through unchanged. A request carrying an image
 * with no attachment service available fails loudly rather than silently
 * dropping the image.
 * @param messages - the request's conversation messages.
 * @param attachments - the deployment's attachment service, when mounted.
 * @param signal - cancellation for the storage reads.
 * @returns the same messages with image blocks resolved for the translators.
 */
export declare function resolveImages(messages: readonly Message[], attachments: AttachmentStore | undefined, signal?: AbortSignal): Promise<readonly TranslatableMessage[]>;
