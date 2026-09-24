import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
/** Tool names owned by this plugin and their collision fallbacks. */
export declare const TOOL_ALIASES: {
    readonly x_search: "dsh_subscriptions_x_search";
    readonly video_generate: "dsh_subscriptions_video_generate";
    readonly image_generate: "dsh_subscriptions_image_generate";
};
/** Shorten a tool-call card title to `max` characters, ending in an ellipsis. */
export declare function truncate(text: string, max?: number): string;
export interface ToolRegistry {
    register(definition: ToolDefinition): () => void;
}
/** Register a tool under its canonical name, then a plugin-scoped alias. */
export declare function registerWithAlias(registry: ToolRegistry, definition: ToolDefinition, warn?: (message: string) => void): {
    name: string;
    dispose: () => void;
} | undefined;
