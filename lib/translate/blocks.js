/**
 * Block assembly shared by the Anthropic, Responses and Chat Completions
 * stream translators.
 */
import { ToolCallId } from '../compat.js';
/** Assemble the final ContentBlock for one open block. */
export function closeBlock(block) {
    switch (block.kind) {
        case 'text':
            return { type: 'text', text: block.text };
        case 'reasoning':
            return { type: 'reasoning', text: block.text };
        case 'tool-call':
            return {
                type: 'tool-call',
                id: ToolCallId(block.callId),
                name: block.name ?? '',
                arguments: block.text,
            };
    }
}
