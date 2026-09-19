import { readProviderKey } from "./auth.ts";
import { TEXT_VALUE } from "./questions.ts";
import type { HistoryEntry, ObservedAction, PageState } from "./types.ts";

export interface TextEnv {
  TEXT_MODEL_API_KEY?: string;
  TEXT_MODEL_BASE_URL?: string;
  TEXT_MODEL?: string;
  TEXT_MODEL_REASONING?: string;
  AUTH_PATHS?: string[];
}

export interface TextProfile {
  base: string;
  model: string;
  key: string;
  headers: Record<string, string>;
  reasoning: Record<string, unknown>;
}

/**
 * Fallback profile: OpenCode Go is OpenAI compatible and already in auth.json.
 * The default is the cheapest documented Go model; request allowances are
 * tracked in the Go docs (see https://opencode.ai/v2/docs/console/go).
 *
 * Free Zen models are not reachable over these direct endpoints: the Go
 * endpoint answers ModelError and Console answers HTTP 403 FreeTierError for
 * calls made outside the OpenCode client. The adapter reaches them through a
 * managed OpenCode session instead; see src/harness/opencode-text.ts.
 */
export const OPENCODE_GO_BASE = "https://opencode.ai/zen/go/v1";
export const OPENCODE_GO_MODEL = "deepseek-v4-flash";

/**
 * Go expects an identifying user agent and a stable session header per
 * conversation (see https://opencode.ai/v2/docs/console/go).
 */
export function opencodeGoProfile(key: string, sessionID: string, model?: string): TextProfile {
  return {
    base: OPENCODE_GO_BASE,
    model: model || OPENCODE_GO_MODEL,
    key,
    headers: { "user-agent": "jev-browser/0.1 (coding-agent)", "x-opencode-session": sessionID },
    reasoning: {},
  };
}

function reasoningFor(base: string, env: TextEnv): Record<string, unknown> {
  if (env.TEXT_MODEL_REASONING === "none") return { reasoning: { enabled: false } };
  if (base.includes("api.deepseek.com/")) return { thinking: { type: "disabled" } };
  return { reasoning: { effort: "low" } };
}

function fromEnvironment(env: TextEnv): TextProfile {
  const base = (env.TEXT_MODEL_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
  return {
    base,
    model: env.TEXT_MODEL || "deepseek-chat",
    key: env.TEXT_MODEL_API_KEY as string,
    headers: {},
    reasoning: reasoningFor(base, env),
  };
}

/**
 * Credential and model resolution, in order:
 * 1. TEXT_MODEL_API_KEY env — any OpenAI-compatible endpoint, including a
 *    local server such as Ollama or LM Studio.
 * 2. auth.json openrouter / deepseek.
 * 3. auth.json opencode-go — subscription models, default deepseek-v4-flash.
 */
export function resolveTextProfile(env: TextEnv, sessionID: string): TextProfile | undefined {
  if (env.TEXT_MODEL_API_KEY) return fromEnvironment(env);
  const shared = readProviderKey(["openrouter", "deepseek"], env.AUTH_PATHS);
  if (shared) {
    return {
      base: "https://openrouter.ai/api/v1",
      model: "inception/mercury-2.5",
      key: shared,
      headers: {},
      reasoning: { reasoning: { enabled: false } },
    };
  }
  const go = readProviderKey(["opencode-go"], env.AUTH_PATHS);
  if (go) return opencodeGoProfile(go, sessionID, env.TEXT_MODEL);
  return undefined;
}

export function fieldContext(
  goal: string,
  action: ObservedAction,
  page: PageState,
  history: HistoryEntry[],
): Record<string, unknown> {
  return {
    goal,
    field: { label: action.label, role: action.role, value: action.value },
    page: { title: page.title, text: page.text.slice(0, 6000) },
    recent_actions: history.slice(-6).map((h) => ({ action: h.action, text: h.text })),
  };
}

/**
 * Strict field-value contract shared by every text backend: exactly one key,
 * named `text`, holding a non-empty string of at most 2000 characters. A
 * single fenced code block around the JSON is tolerated; anything else is
 * rejected so the caller can fall back instead of typing a guess.
 */
export function parseFieldValue(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("shape");
  const trimmed = raw.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```[a-zA-Z0-9]*[ \t]*\r?\n?/, "").replace(/```\s*$/, "").trim()
    : trimmed;
  const output = JSON.parse(unfenced);
  if (typeof output !== "object" || output === null) throw new Error("shape");
  const keys = Object.keys(output);
  const value = (output as Record<string, unknown>).text;
  if (keys.length !== 1 || keys[0] !== "text") throw new Error("keys");
  if (typeof value !== "string" || !value.trim() || value.length > 2000) throw new Error("value");
  return value;
}

function readReply(result: any): string {
  return parseFieldValue(result?.choices?.[0]?.message?.content);
}

/** Small-model text helper. Never guesses: throws when no key or bad JSON. */
export async function fieldText(
  context: Record<string, unknown>,
  opts: { env?: TextEnv; fetchFn?: typeof fetch; sessionID?: string } = {},
): Promise<{ text: string; meta: { model: string; latency_ms: number; usage?: unknown } }> {
  const env: TextEnv = opts.env ?? {
    TEXT_MODEL_API_KEY: process.env.TEXT_MODEL_API_KEY,
    TEXT_MODEL_BASE_URL: process.env.TEXT_MODEL_BASE_URL,
    TEXT_MODEL: process.env.TEXT_MODEL,
    TEXT_MODEL_REASONING: process.env.TEXT_MODEL_REASONING,
  };
  const sessionID = opts.sessionID ?? `jev-${process.pid}`;
  const profile = resolveTextProfile(env, sessionID);
  if (!profile) throw new Error("No text-model key available; nothing was typed.");

  const started = Date.now();
  const response = await (opts.fetchFn ?? fetch)(profile.base + "/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${profile.key}`,
      ...profile.headers,
    },
    body: JSON.stringify({
      model: profile.model,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      ...profile.reasoning,
      messages: [
        { role: "system", content: TEXT_VALUE },
        { role: "user", content: JSON.stringify(context) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Text model answered HTTP ${response.status}; nothing was typed.`);

  const result: any = await response.json();
  try {
    return {
      text: readReply(result),
      meta: { model: profile.model, latency_ms: Date.now() - started, usage: result.usage },
    };
  } catch {
    throw new Error("Text model returned no usable field value; nothing was typed.");
  }
}

/** Fallback used when Jev is unreachable: session LLM picks operation+target as JSON. */
export function parseDegradedDecision(
  raw: string,
  validChoices: string[],
): { operation: string; target: string | null } {
  const parsed = JSON.parse(raw) as { operation?: string; target?: string | null };
  if (!parsed.operation || !validChoices.includes(parsed.operation)) {
    throw new Error("Degraded decision invalid; no action executed.");
  }
  return { operation: parsed.operation, target: parsed.target ?? null };
}
