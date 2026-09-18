import { MAX_STEPS } from "./questions.ts";
import { fieldContext } from "./text.ts";
import type { HistoryEntry, JevChoice, ObservedAction, PageState } from "./types.ts";

export interface LoopSnapshot {
  goal: string;
  page: PageState;
  decision: JevChoice | null;
  history: HistoryEntry[];
  status: "ready" | "predicted" | "done" | "blocked";
  elapsed_ms: number;
  elements: unknown[];
}

export interface Harness {
  observe(): Promise<PageState>;
  fresh(page: PageState): boolean | Promise<boolean>;
  act(action: ObservedAction, page: PageState, text: string | null): Promise<void>;
  decide(state: PageState, goal: string, history: HistoryEntry[]): Promise<JevChoice>;
  helperText(context: Record<string, unknown>): Promise<string>;
  now(): number;
}

// Harness implementations signal a stale page through their error message
// (for example "stale", "not fresh", or "fingerprint changed").
const STALE_HINTS = ["stale", "fresh", "changed", "fingerprint"];

function looksStale(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return STALE_HINTS.some((hint) => message.includes(hint));
}

/**
 * Harness-agnostic decision loop: observe, decide once, act once, observe
 * again. Page freshness is checked at each boundary through the harness.
 */
export class Loop {
  goal: string;
  harness: Harness;
  page!: PageState;
  decision: JevChoice | null = null;
  history: HistoryEntry[] = [];
  status: LoopSnapshot["status"] = "ready";
  startedAt: number | null = null;
  decisions = 0;
  textCalls: unknown[] = [];
  elapsed_ms = 0;
  pendingText: { key: string; text: string } | null = null;

  constructor(goal: string, harness: Harness) {
    const task = goal.trim();
    if (!task) throw new Error("Supply a task");
    this.goal = task;
    this.harness = harness;
  }

  async init(): Promise<void> {
    this.page = await this.harness.observe();
  }

  private elapsed(): number {
    return this.startedAt == null ? 0 : Math.round(this.harness.now() - this.startedAt);
  }

  snapshot(): LoopSnapshot {
    return {
      goal: this.goal,
      page: this.page,
      decision: this.decision,
      history: this.history,
      status: this.status,
      elapsed_ms: this.elapsed(),
      elements: [],
    };
  }

  /** Ask for one decision. Refreshes the page first when it is not fresh. */
  async predict(): Promise<LoopSnapshot> {
    if (this.status === "done" || this.status === "blocked") {
      throw new Error("This run has stopped. Start a fresh run.");
    }
    if (this.startedAt == null) this.startedAt = this.harness.now();
    if (!(await this.harness.fresh(this.page))) this.page = await this.harness.observe();
    if (this.decisions >= MAX_STEPS * 2) throw new Error("Reached the model-call budget");
    this.decision = await this.harness.decide(this.page, this.goal, this.history);
    this.decisions += 1;
    this.status = "predicted";
    this.elapsed_ms = this.elapsed();
    return this.snapshot();
  }

  /** Execute the current decision when the page still matches it. */
  async act(fingerprint?: string): Promise<LoopSnapshot> {
    const decision = this.decision;
    const page = this.page;
    if (!decision || (fingerprint !== undefined && fingerprint !== page.fingerprint)) {
      throw new Error("Observe and choose before acting");
    }
    // The decision is consumed before any side effect, so retries cannot replay it.
    this.decision = null;
    const selected = decision.choice;

    if (selected === "DONE" || selected === "BLOCKED") {
      if (!(await this.harness.fresh(page))) {
        this.status = "ready";
        throw new Error("Page changed since the decision. Choose again.");
      }
      this.status = selected === "DONE" ? "done" : "blocked";
      this.elapsed_ms = this.elapsed();
      return this.snapshot();
    }

    const action = page.actions.find((candidate) => candidate.id === selected);
    if (!action) throw new Error(`Unknown action ${selected}; no action executed.`);
    if (this.history.length >= MAX_STEPS) {
      this.status = "blocked";
      throw new Error(`Stopped at the ${MAX_STEPS}-action budget`);
    }

    const text = await this.textFor(action, page);
    await this.harness.act(action, page, text);
    this.pendingText = null;

    const previousFingerprint = page.fingerprint;
    this.history.push({ action: action.label, kind: action.kind, text, page_changed: null });
    this.page = await this.harness.observe();
    this.history[this.history.length - 1].page_changed =
      previousFingerprint !== undefined ? this.page.fingerprint !== previousFingerprint : null;

    const tail = this.history.slice(-3);
    const stuck = tail.length === 3 && tail.every((entry) => entry.page_changed === false && entry.kind !== "wait");
    this.status = stuck ? "blocked" : "ready";
    this.elapsed_ms = this.elapsed();
    return this.snapshot();
  }

  /** Resolve TYPE_TEXT values, reusing the previous call for an identical field context. */
  private async textFor(action: ObservedAction, page: PageState): Promise<string | null> {
    if (action.kind !== "fill") return null;
    if (!(await this.harness.fresh(page))) {
      throw new Error("Page changed before text generation. Choose again.");
    }
    const context = fieldContext(this.goal, action, page, this.history);
    const key = JSON.stringify(context);
    if (this.pendingText && this.pendingText.key === key) return this.pendingText.text;
    const text = await this.harness.helperText(context);
    this.pendingText = { key, text };
    this.textCalls.push({ field: action.label, value: text });
    return text;
  }

  /** One full cycle: predict then act. A stale page resets to ready instead of failing. */
  async tick(): Promise<LoopSnapshot> {
    try {
      await this.predict();
      return await this.act(this.page.fingerprint);
    } catch (err) {
      if (!looksStale(err)) throw err;
      this.decision = null;
      this.status = "ready";
      this.page = await this.harness.observe();
      this.elapsed_ms = this.elapsed();
      return this.snapshot();
    }
  }

  async run(maxTicks = MAX_STEPS): Promise<LoopSnapshot> {
    for (let step = 0; step < maxTicks; step += 1) {
      if (this.status === "done" || this.status === "blocked") break;
      await this.tick();
    }
    return this.snapshot();
  }
}
