import type { TextProfile } from "../core/text.ts";

/**
 * Anthropic Messages API adapter.
 *
 * The core text client is OpenAI-shaped, so Anthropic gets its own profile and
 * request builder here. The reply is extracted to a plain string and parsed by
 * the same strict `{text}` contract every other provider goes through.
 */

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_API_VERSION = "2023-06-01";
/** Small Haiku-class default: cheap enough for one field value per call. */
export const ANTHROPIC_DEFAULT_MODEL = "claude-3-5-haiku-latest";

export function anthropicProfile(key: string, model?: string): TextProfile {
  return {
    provider: "anthropic",
    base: ANTHROPIC_URL,
    model: model || ANTHROPIC_DEFAULT_MODEL,
    key,
    headers: { "anthropic-version": ANTHROPIC_API_VERSION },
    reasoning: {},
  };
}

/** Build the Messages API request for one field value. */
export function buildAnthropicRequest(
  profile: TextProfile,
  system: string,
  context: unknown,
): Record<string, unknown> {
  return {
    model: profile.model,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: JSON.stringify(context) }],
  };
}

/** Join the text blocks of a Messages API reply; null when there are none. */
export function anthropicReplyText(result: unknown): string | null {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((block) =>
      block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
        ? ((block as { text: string }).text)
        : "",
    )
    .join("")
    .trim();
  return text || null;
}
