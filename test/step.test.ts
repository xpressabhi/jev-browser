import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planStep } from "../src/core/step.ts";

const state = {
  url: "https://example.com",
  title: "T",
  text: "hello",
  actions: [
    { id: "click-n1", kind: "click", node: "n1", label: "Search" },
    { id: "fill-n2", kind: "fill", node: "n2", label: "Where to? · empty", role: "textbox", value: "" },
  ],
};

const decision = (operation: string, selected: string, target: string | null) => ({
  choice: selected,
  operation,
  target,
  confidence: 0.9,
  probabilities: { [selected]: 1 },
  operation_probabilities: { [operation]: 1 },
  target_probabilities: {},
  target_confidence: 1,
  latency_ms: 10,
});

describe("planStep", () => {
  it("returns the decision without text for non-fill operations", async () => {
    const result = await planStep(state, "goal", [], {
      decide: async () => decision("CLICK", "click-n1", "1") as any,
    });
    assert.equal(result.operation, "CLICK");
    assert.equal(result.choice, "click-n1");
    assert.equal(result.text, null);
  });

  it("resolves text for TYPE_TEXT and passes the field context", async () => {
    let seen: any = null;
    const result = await planStep(state, "Book a flight to Zurich", [], {
      decide: async () => decision("TYPE_TEXT", "fill-n2", "2") as any,
      textFor: async (context) => {
        seen = context;
        return "Zurich";
      },
    });
    assert.equal(result.text, "Zurich");
    assert.equal(result.choice, "fill-n2");
    assert.equal(seen.field.label, "Where to? · empty");
    assert.equal(seen.goal, "Book a flight to Zurich");
  });

  it("throws when the chosen action is not in the observed list", async () => {
    await assert.rejects(() =>
      planStep(state, "goal", [], {
        decide: async () => decision("TYPE_TEXT", "fill-missing", "9") as any,
        textFor: async () => "x",
      }),
    );
  });
});
