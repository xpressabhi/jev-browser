import { MAX_STEPS } from "./questions.ts";
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

function isStale(err: unknown): boolean {
  return err instanceof Error && /stale|fresh|changed|fingerprint/i.test(err.message);
}

/** Harness-agnostic tick/predict/act loop. Mirrors jev-ultrafast agent.py semantics. */
export class Loop {
  goal: string;
  harness: Harness;
  page!: PageState;
  decision: JevChoice | null = null;
  history: HistoryEntry[] = [];
  status: LoopSnapshot["status"] = "ready";
  startedAt: number | null = null;
  decisions: number = 0;
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

  async act(fingerprint?: string): Promise<LoopSnapshot> {
    const decision = this.decision;
    const page = this.page;
    if (!decision || (fingerprint !== undefined && fingerprint !== page.fingerprint)) {
      throw new Error("Observe and choose before acting");
    }
    this.decision = null; // consume once — a retry cannot double-click
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
    const action = page.actions.find((a) => a.id === selected);
    if (!action) throw new Error(`Unknown action ${selected}; no action executed.`);
    if (this.history.length >= MAX_STEPS) {
      this.status = "blocked";
      throw new Error(`Stopped at the ${MAX_STEPS}-action budget`);
    }
    let text: string | null = null;
    if (action.kind === "fill") {
      if (!(await this.harness.fresh(page))) throw new Error("Page changed before text generation. Choose again.");
      const { fieldContext } = await import("./text.ts");
      const context = fieldContext(this.goal, action, page, this.history) as Record<string, unknown>;
      const key = JSON.stringify(context);
      if (this.pendingText && this.pendingText.key === key) {
        text = this.pendingText.text;
      } else {
        text = await this.harness.helperText(context);
        this.pendingText = { key, text };
        this.textCalls.push({ field: action.label, value: text });
      }
    }
    await this.harness.act(action, page, text);
    this.pendingText = null;
    const prevFingerprint = page.fingerprint;
    this.history.push({
      action: action.label,
      kind: action.kind,
      text,
      page_changed: null,
    });
    this.page = await this.harness.observe();
    const changed = prevFingerprint !== undefined ? this.page.fingerprint !== prevFingerprint : null;
    this.history[this.history.length - 1].page_changed = changed;
    const tail = this.history.slice(-3);
    this.status =
      tail.length === 3 && tail.every((h) => h.page_changed === false && h.kind !== "wait")
        ? "blocked"
        : "ready";
    this.elapsed_ms = this.elapsed();
    return this.snapshot();
  }

  async tick(): Promise<LoopSnapshot> {
    try {
      await this.predict();
      return await this.act(this.page.fingerprint);
    } catch (err) {
      if (isStale(err)) {
        this.decision = null;
        this.status = "ready";
        this.page = await this.harness.observe();
        this.elapsed_ms = this.elapsed();
        return this.snapshot();
      }
      throw err;
    }
  }

  async run(maxTicks = MAX_STEPS): Promise<LoopSnapshot> {
    for (let i = 0; i < maxTicks; i++) {
      if (this.status === "done" || this.status === "blocked") break;
      await this.tick();
    }
    return this.snapshot();
  }
}
