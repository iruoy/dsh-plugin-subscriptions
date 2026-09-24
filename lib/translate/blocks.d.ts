/**
 * Block assembly shared by the Anthropic, Responses and Chat Completions
 * stream translators.
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
/** One open harness block under assembly. */
export interface OpenBlock {
    index: number;
    kind: 'text' | 'reasoning' | 'tool-call';
    text: string;
    callId: string;
    name?: string;
}
/** Assemble the final ContentBlock for one open block. */
export declare function closeBlock(block: OpenBlock): ContentBlock;
