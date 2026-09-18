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

/** Fallback profile: OpenCode Go is OpenAI-compatible and already in auth.json. */
export interface TextProfile {
  base: string;
  model: string;
  key: string;
  headers: Record<string, string>;
  reasoning: Record<string, unknown>;
}

export const OPENCODE_GO_BASE = "https://opencode.ai/zen/go/v1";
export const OPENCODE_GO_MODEL = "glm-5.3-flash";

/**
 * Go requires an identifying user agent and a stable `x-opencode-session`
 * per conversation (see https://opencode.ai/docs/go/#where-can-i-use-it).
 * Callers may override per call; the session id stays stable per process.
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

export function resolveTextProfile(env: TextEnv, sessionID: string): TextProfile | undefined {
  if (env.TEXT_MODEL_API_KEY) {
    const base = (env.TEXT_MODEL_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
    return {
      base,
      model: env.TEXT_MODEL || "deepseek-chat",
      key: env.TEXT_MODEL_API_KEY,
      headers: {},
      reasoning: reasoningBody(base, env),
    };
  }
  const compat = readProviderKey(["openrouter", "deepseek"], env.AUTH_PATHS);
  if (compat) {
    const base = "https://openrouter.ai/api/v1";
    return { base, model: "inception/mercury-2.5", key: compat, headers: {}, reasoning: { reasoning: { enabled: false } } };
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

function reasoningBody(base: string, env: TextEnv): Record<string, unknown> {
  if (env.TEXT_MODEL_REASONING === "none") return { reasoning: { enabled: false } };
  if (base.includes("api.deepseek.com/")) return { thinking: { type: "disabled" } };
  return { reasoning: { effort: "low" } };
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
  if (!profile) {
    throw new Error("TYPE_TEXT needs TEXT_MODEL_API_KEY; no text is hardcoded or guessed by the executor.");
  }
  const { base, model, key, headers, reasoning } = profile;
  const started = Date.now();
  const res = await (opts.fetchFn ?? fetch)(base + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...headers },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      ...reasoning,
      messages: [
        { role: "system", content: TEXT_VALUE },
        { role: "user", content: JSON.stringify(context) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Text helper returned HTTP ${res.status}; nothing typed.`);
  const result: any = await res.json();
  try {
    const output = JSON.parse(result.choices[0].message.content);
    const value = output.text;
    if (Object.keys(output).length !== 1 || typeof value !== "string" || !value.trim() || value.length > 2000) {
      throw new Error("bad");
    }
    return { text: value, meta: { model, latency_ms: Date.now() - started, usage: result.usage } };
  } catch {
    throw new Error("Text helper returned no valid field value; nothing typed.");
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
