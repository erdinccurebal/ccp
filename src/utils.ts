import type { OAIContentPart } from "./types.ts";

/**
 * Extract text content from an OAI message content field.
 * Handles both plain string and structured content-part arrays.
 */
export function getTextContent(content: string | OAIContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("\n");
}
