/**
 * Resolved-image plumbing for the wire translators. ImageBlocks carry only an
 * attachment reference; the bytes live in the attachment service, which is
 * async I/O. Adapters resolve images BEFORE calling the (pure, synchronous)
 * translators, so the translators see {@link ResolvedImagePart}s with inline
 * base64 data.
 */
import { LlmError } from '@deepseek-ai/dsh-llm';
import { ToolCallId } from '../compat.js';
/**
 * Flatten a tool result's content to plain text for wires with text-only tool
 * outputs. Blocks are separate paragraphs (resolveImages appends an image
 * reference after each image), so they join on newlines instead of running
 * together.
 */
export function toolResultText(block) {
    return block.content.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('\n');
}
/**
 * Fold first-class `role: 'tool'` messages (DSH 0.1.7) into the user-role
 * `tool-result` block every translator already speaks, so each wire handles
 * one tool-result shape and keeps its correlation id and error flag.
 * @param messages - ordered conversation messages.
 * @returns the same messages, with tool-role ones rewritten as user tool results.
 */
export function withToolResultBlocks(messages) {
    if (!messages.some(message => message.role === 'tool'))
        return messages;
    return messages.map((message) => {
        if (message.role !== 'tool')
            return message;
        const callId = [
            message.toolCallId,
            message.tool_call_id,
            message.source?.kind === 'tool' ? String(message.source.callId) : undefined,
        ].find(id => id !== undefined && id.length > 0);
        if (callId === undefined)
            throw new LlmError('tool result has no call id', 'INVALID_REQUEST');
        return {
            role: 'user',
            ...message.source === undefined ? {} : { source: message.source },
            content: [{
                    type: 'tool-result',
                    toolCallId: ToolCallId(callId),
                    content: message.content,
                    ...message.isError === undefined ? {} : { isError: message.isError },
                }],
        };
    });
}
/**
 * Wires with text-only tool outputs receive images in a following user turn.
 * Defer that turn until all consecutive user messages have been processed:
 * parallel tool results can arrive in separate harness messages, and a user
 * image message must not interrupt their tool-call/output pairing.
 */
export function withToolResultImages(messages) {
    const out = [];
    let images = [];
    const flush = () => {
        if (images.length > 0)
            out.push({ role: 'user', content: images });
        images = [];
    };
    for (const message of withToolResultBlocks(messages)) {
        if (message.role === 'assistant')
            flush();
        out.push(message);
        for (const block of message.content) {
            if (block.type !== 'tool-result')
                continue;
            const parts = block.content.filter((part) => part.type === 'image' && 'dataBase64' in part);
            if (parts.length > 0) {
                images.push({ type: 'text', text: `Images from tool result ${String(block.toolCallId)}:` }, ...parts);
            }
        }
    }
    flush();
    return out;
}
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
export async function resolveImages(messages, attachments, signal) {
    const hasImage = (block) => block.type === 'image'
        || (block.type === 'tool-result' && block.content.some(hasImage));
    if (!messages.some(message => message.content.some(hasImage))) {
        return messages;
    }
    if (attachments === undefined) {
        throw new LlmError('dsh-plugin-subscriptions: the request carries an image but no attachments service is mounted; '
            + 'image input requires the harness attachment store', 'UNSUPPORTED');
    }
    const resolveBlock = async (block) => {
        if (block.type === 'tool-result') {
            return [{ ...block, content: (await Promise.all(block.content.map(resolveBlock))).flat() }];
        }
        if (block.type !== 'image')
            return [block];
        const stored = await attachments.readImage(block.attachment, signal);
        const { attachmentId, mediaType, bytes, width, height, name } = stored.ref;
        return [{
                type: 'image',
                mediaType: stored.ref.mediaType,
                dataBase64: Buffer.from(stored.data).toString('base64'),
            }, {
                type: 'text',
                text: `Image reference (for image_generate.referenceImages): ${JSON.stringify({
                    attachmentId, mediaType, bytes, width, height, ...name === undefined ? {} : { name },
                })}`,
            }];
    };
    return Promise.all(messages.map(async (message) => ({
        ...message,
        content: (await Promise.all(message.content.map(resolveBlock))).flat(),
    })));
}
