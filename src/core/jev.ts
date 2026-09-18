import { readProviderKey } from "./auth.ts";
import { buildElementTable } from "./elements.ts";
import { NEXT_ACTION, TARGET } from "./questions.ts";
import type { HistoryEntry, JevChoice, PageState } from "./types.ts";

export const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";

export interface JevEnv {
  TYPESAFE_API_KEY?: string;
  TYPESAFE_MODEL?: string;
  AUTH_PATHS?: string[];
}

async function postJson(url: string, key: string, body: unknown, fetchFn: typeof fetch = fetch): Promise<any> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error("Model connection failed; no action executed.");
    }
    if ((res.status === 429 || res.status === 529 || res.status === 503) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    if (!res.ok) {
      lastErr = new Error(`Model provider returned HTTP ${res.status}; no action executed.`);
      break;
    }
    return res.json();
  }
  throw lastErr;
}

export function validateChoice(answer: any, ids: Record<string, unknown> | string[]): any {
  const keys = Array.isArray(ids) ? ids : Object.keys(ids);
  const idSet = new Set(keys);
  try {
    const probs = answer.probabilities;
    const nums = [...Object.values(probs) as number[], answer.confidence];
    const valid =
      idSet.has(answer.choice) &&
      new Set(Object.keys(probs)).size === idSet.size &&
      [...Object.keys(probs)].every((k) => idSet.has(k)) &&
      nums.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1) &&
      Math.abs((Object.values(probs) as number[]).reduce((a, b) => a + b, 0) - 1) < 0.02 &&
      (probs[answer.choice] as number) >= Math.max(...(Object.values(probs) as number[])) - 1e-6;
    if (!valid) throw new Error("invalid");
  } catch {
    throw new Error("Invalid TypeSafe response; no action executed.");
  }
  return answer;
}

export function buildRequest(state: PageState, goal: string, history: HistoryEntry[]) {
  const { elements, targets, controls } = buildElementTable(state.actions);
  const labels: Record<string, string> = {
    CLICK: "Click an element, button, menu option, autocomplete suggestion, or calendar day.",
    TYPE_TEXT: "Enter or replace text in an editable field. A small LLM will supply the value from the goal.",
    SELECT: "Select an observed dropdown value.",
  };
  const operations: Record<string, string> = {};
  for (const key of Object.keys(targets)) operations[key] = labels[key];
  for (const [key, value] of Object.entries(controls)) operations[key] = value.label;
  operations.DONE = "Every requirement is visibly satisfied.";
  operations.BLOCKED = "No supported operation can progress.";

  const questions: Record<string, unknown> = {
    operation: { type: "choice", criteria: operations, instructions: { goal, rules: NEXT_ACTION } },
  };
  for (const [operation, candidates] of Object.entries(targets)) {
    const criteria: Record<string, unknown> = {};
    for (const [index, a] of Object.entries(candidates)) {
      criteria[index] = {
        element: `[${index}] ${a.label}`,
        current_value: a.current_value ?? a.value ?? "",
        ...(["role", "checked", "selected", "expanded"].reduce((acc: Record<string, unknown>, k) => {
          if (k in a) acc[k] = (a as unknown as Record<string, unknown>)[k];
          return acc;
        }, {})),
      };
    }
    questions[operation.toLowerCase() + "_target"] = {
      type: "choice",
      criteria,
      instructions: { goal, operation, rules: [NEXT_ACTION, TARGET] },
    };
  }
  return {
    body: {
      model: "jev-latest",
      state: {
        page: { url: state.url, title: state.title, text: state.text },
        elements,
        recent_actions: history
          .slice(-10)
          .map((h) => ({ action: h.action, kind: h.kind, text: h.text, page_changed: h.page_changed })),
      },
      questions,
    },
    elements,
    targets,
    controls,
    operations,
  };
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
  if (!key) throw new Error("TYPESAFE_API_KEY is missing; no action executed.");
  const { body, targets, controls, operations } = buildRequest(state, goal, history);
  (body as Record<string, unknown>).model = env.TYPESAFE_MODEL || "jev-latest";
  const started = Date.now();
  const result = await postJson(TYPESAFE_URL, key, body, opts.fetchFn);
  const operationAnswer = validateChoice(result.answers?.operation, operations);
  const operation: string = operationAnswer.choice;
  let target: string | null = null;
  let targetAnswer: any = null;
  let probabilities: Record<string, number> = {};
  let choice: string;
  if (operation in targets) {
    targetAnswer = validateChoice(result.answers?.[operation.toLowerCase() + "_target"], targets[operation]);
    target = targetAnswer.choice as string;
    choice = targets[operation][target as string].id;
    probabilities = Object.fromEntries(
      Object.entries(targets[operation]).map(([index, a]) => [a.id, targetAnswer.probabilities[index]]),
    );
  } else {
    choice = operation in controls ? controls[operation].id : operation;
    probabilities = { [choice]: operationAnswer.probabilities[operation] };
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
