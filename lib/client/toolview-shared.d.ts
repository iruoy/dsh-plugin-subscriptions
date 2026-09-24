/**
 * Helpers shared by the image_generate and video_generate tool views: the
 * call-card title prompt and the settled result's text body.
 */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client';
/** Extract the prompt from the call's raw args JSON; falls back to the first string value, then the raw line. */
export declare function derivePrompt(argsRaw: string): string;
/** Flatten a settled result's text blocks (the text-only fallback body and the error line). */
export declare function resultText(block: ToolCallBlock): string;
