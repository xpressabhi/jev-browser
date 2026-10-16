import { randomUUID } from "node:crypto";
import { readProviderKey } from "./auth.ts";
import { buildElementTable, capActions } from "./elements.ts";
import { boxToPixels, pixelToViewport, validateBox } from "./image.ts";
import { NEXT_ACTION, TARGET } from "./questions.ts";
import type { HistoryEntry, ImageResult, JevChoice, ObservedAction, PageState, Screenshot } from "./types.ts";

export const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";

const DEFAULT_MODEL = "jev-latest";
/** Box questions need Jev 1.14; image requests default to the preview alias. */
export const IMAGE_MODEL = "jev-preview";
/** Resolved choice for a click that has no observed element (coordinates come from the box). */
export const VISUAL_CHOICE = "VISUAL_CLICK";
// Models that accept images but not Box questions; a box phase with one of
// these is rejected before the call with a fix instead of the API's raw 400.
const KNOWN_1_13 = new Set(["jev-latest", "jev-1.13.0"]);
const BOX_MODEL_ERROR = "Box questions need Jev 1.14; unset TYPESAFE_MODEL or set it to jev-preview.";
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

export interface ChooseOptions {
  env?: JevEnv;
  fetchFn?: typeof fetch;
  image?: Screenshot;
  box?: "auto" | "always";
  imageScale?: number;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(
  key: string,
  body: unknown,
  fetchFn: typeof fetch,
  extraHeaders: Record<string, string> = {},
): Promise<any> {
  let failure: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetchFn(TYPESAFE_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
          ...extraHeaders,
        },
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

export function buildRequest(state: PageState, goal: string, history: HistoryEntry[], image?: Screenshot) {
  // Cap each action kind deterministically so a heavy page cannot push a
  // question over the endpoint's 255-choice limit, and so decisions stay small.
  const { elements, targets, controls } = buildElementTable(capActions(state.actions));

  const operations: Record<string, string> = {};
  for (const name of Object.keys(targets)) operations[name] = OPERATION_HELP[name] ?? `Perform ${name}.`;
  // With an image and no clickable elements, CLICK stays on the menu as a
  // visual target; its coordinates come from the box phase.
  const visualClick = Boolean(image) && !targets.CLICK;
  if (visualClick) operations.CLICK = "Click a spot on the screenshot when no observed element fits.";
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

  const body: Record<string, any> = {
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

  if (image) {
    // A fresh reference per request (docs advice: unguessable, cannot occur in
    // page text by accident), referenced once from state so one copy is sent.
    const ref = randomUUID();
    body.state.screenshot = ref;
    body.assets = { [ref]: { type: "image", format: image.format, data_base64: image.data_base64 } };
  }

  return { body, elements, targets, controls, operations, visualClick };
}

// Phase 2: locate the chosen target on the screenshot with a Box question and
// check its presence with a Noul in the same request (docs: a Box answer is
// always a box, so presence is how it is trusted). Throws on any failure; the
// caller applies the degradation rules.
interface LocateInput {
  image: Screenshot;
  model: string;
  url: string;
  title: string;
  goal: string;
  action?: ObservedAction;
  imageScale?: number;
}

async function locate(key: string, input: LocateInput, fetchFn: typeof fetch): Promise<ImageResult> {
  const { image, model, url, title, goal, action, imageScale } = input;
  const started = Date.now();
  const ref = randomUUID();
  const boxInstructions = action
    ? `the element labeled "${action.label}"${action.role ? ` (role: ${action.role})` : ""} on the page`
    : `the element to click to advance this goal: ${goal}`;
  const presenceInstructions = action
    ? `Is the element labeled "${action.label}" visible in \`screenshot\`?`
    : "Is the element to click to advance this goal visible in `screenshot`?";
  const body = {
    model,
    state: { page: { url, title }, screenshot: ref },
    assets: { [ref]: { type: "image", format: image.format, data_base64: image.data_base64 } },
    questions: {
      target_box: { type: "box", instructions: boxInstructions },
      target_present: { type: "noul", instructions: presenceInstructions },
    },
  };
  const result = await request(key, body, fetchFn, { "TypeSafe-Danger-Zone-Images": "true" });
  const { box, confidence } = validateBox(result.answers?.target_box);
  const present = result.answers?.target_present?.noul;
  if (typeof present !== "number" || !Number.isFinite(present) || present < 0 || present > 1) {
    throw new Error("TypeSafe returned a malformed noul.");
  }
  const pixel = boxToPixels(box, image.width, image.height);
  const out: ImageResult = {
    width: image.width,
    height: image.height,
    box,
    pixel,
    present,
    confidence,
    model: result.model,
    usage: result.usage,
    latency_ms: Date.now() - started,
  };
  if (imageScale !== undefined) {
    if (!Number.isFinite(imageScale) || imageScale <= 0) throw new Error("imageScale must be a positive number.");
    out.viewport = pixelToViewport(pixel.center, imageScale);
  }
  return out;
}

export async function choose(
  state: PageState,
  goal: string,
  history: HistoryEntry[],
  opts: ChooseOptions = {},
): Promise<JevChoice> {
  const env: JevEnv = opts.env ?? {
    TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
    TYPESAFE_MODEL: process.env.TYPESAFE_MODEL,
  };
  const key = env.TYPESAFE_API_KEY ?? readProviderKey(["typesafe"], env.AUTH_PATHS);
  if (!key) throw new Error("No TypeSafe key available; no action executed.");

  const image = opts.image;
  const { body, targets, controls, operations, visualClick } = buildRequest(state, goal, history, image);
  body.model = env.TYPESAFE_MODEL || (image ? IMAGE_MODEL : DEFAULT_MODEL);

  const started = Date.now();
  const result = await request(
    key,
    body,
    opts.fetchFn ?? fetch,
    image ? { "TypeSafe-Danger-Zone-Images": "true" } : {},
  );
  // Phase 1 latency only: the spec's accounting contract keeps the top-level
  // latency_ms as today's meaning, with phase 2 reported under image.
  const phase1Latency = Date.now() - started;
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
  } else if (operation === "CLICK" && visualClick) {
    // The visual CLICK has no candidates to choose from: it resolves directly,
    // and no target question was asked.
    choice = VISUAL_CHOICE;
    target = "visual";
    probabilities[VISUAL_CHOICE] = operationAnswer.probabilities[operation] ?? 0;
  } else {
    choice = operation in controls ? controls[operation].id : operation;
    probabilities[choice] = operationAnswer.probabilities[operation];
  }

  const chosenAction = candidates && target ? candidates[target] : undefined;
  let imageResult: ImageResult | undefined;
  if (image && (choice === VISUAL_CHOICE || (opts.box === "always" && chosenAction !== undefined))) {
    if (KNOWN_1_13.has(body.model)) throw new Error(BOX_MODEL_ERROR);
    const boxStarted = Date.now();
    try {
      imageResult = await locate(
        key,
        {
          image,
          model: body.model,
          url: state.url,
          title: state.title,
          goal,
          action: chosenAction,
          imageScale: opts.imageScale,
        },
        opts.fetchFn ?? fetch,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (choice === VISUAL_CHOICE) {
        throw new Error(`Box request failed for the visual target; no action executed. (${message})`);
      }
      // The node action is intact: keep the decision, report the box failure.
      imageResult = {
        width: image.width,
        height: image.height,
        latency_ms: Date.now() - boxStarted,
        error: message,
      };
    }
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
    latency_ms: phase1Latency,
    ...(imageResult ? { image: imageResult } : {}),
  };
}
