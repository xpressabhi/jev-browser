import { choose } from "./jev.ts";
import { fieldContext, fieldText } from "./text.ts";
import type { HistoryEntry, JevChoice, PageState } from "./types.ts";

export interface StepDeps {
  /** Override the decision call (tests, alternate harness). */
  decide?: (state: PageState, goal: string, history: HistoryEntry[]) => Promise<JevChoice>;
  /** Resolve the string for a TYPE_TEXT choice. */
  textFor?: (context: Record<string, unknown>) => Promise<string>;
}

export interface StepResult extends JevChoice {
  text: string | null;
}

/**
 * One cycle in a single call: choose the operation and target, then resolve
 * the exact value when the choice is a field fill. The action itself is never
 * executed here — the harness still verifies freshness and acts on `choice`.
 *
 * Collapsing decide + text into one call removes a round trip per typed field
 * without changing any guarantee: the same choice validation runs, and the
 * same strict field-value contract applies.
 */
export async function planStep(
  state: PageState,
  goal: string,
  history: HistoryEntry[] = [],
  deps: StepDeps = {},
): Promise<StepResult> {
  const decide = deps.decide ?? ((page, task, recent) => choose(page, task, recent));
  const decision = await decide(state, goal, history);
  if (decision.operation !== "TYPE_TEXT") return { ...decision, text: null };

  const action = state.actions.find((candidate) => candidate.id === decision.choice);
  if (!action) throw new Error(`Unknown action ${decision.choice}; no action executed.`);

  const resolve = deps.textFor ?? ((context) => fieldText(context).then((result) => result.text));
  const text = await resolve(fieldContext(goal, action, state, history));
  return { ...decision, text };
}
