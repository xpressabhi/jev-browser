import { readProviderKey } from "./auth.ts";
import { buildElementTable, capActions } from "./elements.ts";
import { NEXT_ACTION, TARGET } from "./questions.ts";
import type { HistoryEntry, JevChoice, PageState } from "./types.ts";

export const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";

const DEFAULT_MODEL = "jev-latest";
const RETRYABLE_STATUSES = new Set([429, 503, 529]);
const OPERATION_HELP: Record<string, string> = {
  CLICK: "Click an observed element: button, link, menu item, autocomplete suggestion, or calendar day.",
  TYPE_TEXT: "Type into or replace the value of an editable field. A small model supplies the text from the goal.",
  SELECT: "Choose one of the observed dropdown values.",
};
const DONE_CRITERION = "Every requirement is visibly satisfied.";
const BLOCKED_CRITERION = "No supported operation can progress.";

export interface JevEnv {
  TYPESAFE_API_KEY?: string;
  TYPESAFE_MODEL?: string;
  AUTH_PATHS?: string[];
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(key: string, body: unknown, fetchFn: typeof fetch): Promise<any> {
  let failure: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetchFn(TYPESAFE_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error("Could not reach the model provider; no action executed.");
    }
    if (RETRYABLE_STATUSES.has(response.status) && attempt < 2) {
      await pause(500 * 2 ** attempt);
      continue;
    }
    if (!response.ok) {
      failure = new Error(`Model provider answered HTTP ${response.status}; no action executed.`);
      break;
    }
    return response.json();
  }
  throw failure ?? new Error("Model provider unavailable; no action executed.");
}

// A choice is only accepted when every offered index has a probability, the
// distribution sums to one, and the named choice is an argmax of it.
export function validateChoice(answer: any, ids: Record<string, unknown> | string[]): any {
  const allowed = new Set(Array.isArray(ids) ? ids : Object.keys(ids));
  try {
    const distribution = answer?.probabilities as Record<string, number>;
    const named = Object.keys(distribution);
    const numbers = [...Object.values(distribution), answer?.confidence as number];
    const isProbability = (n: number) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
    if (named.length !== allowed.size || !named.every((name) => allowed.has(name))) throw new Error("keys");
    if (!allowed.has(answer?.choice)) throw new Error("choice");
    if (!numbers.every(isProbability)) throw new Error("numbers");
    const total = (Object.values(distribution) as number[]).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 1) >= 0.02) throw new Error("sum");
    const highest = Math.max(...(Object.values(distribution) as number[]));
    if ((distribution[answer.choice] as number) < highest - 1e-6) throw new Error("argmax");
    return answer;
  } catch {
    throw new Error("TypeSafe returned a malformed choice; no action executed.");
  }
}

export function buildRequest(state: PageState, goal: string, history: HistoryEntry[]) {
  // Cap each action kind deterministically so a heavy page cannot push a
  // question over the endpoint's 255-choice limit, and so decisions stay small.
  const { elements, targets, controls } = buildElementTable(capActions(state.actions));

  const operations: Record<string, string> = {};
  for (const name of Object.keys(targets)) operations[name] = OPERATION_HELP[name] ?? `Perform ${name}.`;
  for (const [name, control] of Object.entries(controls)) operations[name] = control.label;
  operations.DONE = DONE_CRITERION;
  operations.BLOCKED = BLOCKED_CRITERION;

  const questions: Record<string, unknown> = {
    operation: { type: "choice", criteria: operations, instructions: { goal, rules: NEXT_ACTION } },
  };
  for (const [operation, candidates] of Object.entries(targets)) {
    const criteria: Record<string, unknown> = {};
    for (const [index, action] of Object.entries(candidates)) {
      const entry: Record<string, unknown> = {
        element: `[${index}] ${action.label}`,
        current_value: action.current_value ?? action.value ?? "",
      };
      for (const key of ["role", "checked", "selected", "expanded"] as const) {
        if (action[key] !== undefined) entry[key] = action[key];
      }
      criteria[index] = entry;
    }
    questions[`${operation.toLowerCase()}_target`] = {
      type: "choice",
      criteria,
      instructions: { goal, operation, rules: [NEXT_ACTION, TARGET] },
    };
  }

  const body = {
    model: DEFAULT_MODEL,
    state: {
      page: { url: state.url, title: state.title, text: state.text },
      elements,
      recent_actions: history
        .slice(-10)
        .map((h) => ({ action: h.action, kind: h.kind, text: h.text, page_changed: h.page_changed })),
    },
    questions,
  };

  return { body, elements, targets, controls, operations };
}

export async function choose(
  state: PageState,
  goal: string,
  history: HistoryEntry[],
  opts: { env?: JevEnv; fetchFn?: typeof fetch } = {},
): Promise<JevChoice> {
  const env: JevEnv = opts.env ?? {
    TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
    TYPESAFE_MODEL: process.env.TYPESAFE_MODEL,
  };
  const key = env.TYPESAFE_API_KEY ?? readProviderKey(["typesafe"], env.AUTH_PATHS);
  if (!key) throw new Error("No TypeSafe key available; no action executed.");

  const { body, targets, controls, operations } = buildRequest(state, goal, history);
  (body as Record<string, unknown>).model = env.TYPESAFE_MODEL || DEFAULT_MODEL;

  const started = Date.now();
  const result = await request(key, body, opts.fetchFn ?? fetch);
  const operationAnswer = validateChoice(result.answers?.operation, operations);
  const operation = operationAnswer.choice as string;

  const candidates = targets[operation];
  let target: string | null = null;
  let targetAnswer: any = null;
  let probabilities: Record<string, number> = {};
  let choice: string;

  if (candidates) {
    targetAnswer = validateChoice(result.answers?.[`${operation.toLowerCase()}_target`], candidates);
    target = targetAnswer.choice as string;
    choice = candidates[target].id;
    for (const [index, action] of Object.entries(candidates)) {
      probabilities[action.id] = targetAnswer.probabilities[index];
    }
  } else {
    choice = operation in controls ? controls[operation].id : operation;
    probabilities[choice] = operationAnswer.probabilities[operation];
  }

  return {
    choice,
    operation,
    target,
    confidence: operationAnswer.confidence,
    probabilities,
    operation_probabilities: operationAnswer.probabilities,
    target_probabilities: targetAnswer ? targetAnswer.probabilities : {},
    target_confidence: targetAnswer ? targetAnswer.confidence : null,
    raw_answers: result.answers,
    model: result.model,
    usage: result.usage,
    latency_ms: Date.now() - started,
  };
}
