import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Loop } from "../src/core/loop.ts";

function fakeHarness(script: any[]) {
  let i = 0;
  const acted: any[] = [];
  return {
    acted,
    harness: {
      now: () => Date.now(),
      observe: async () => ({ url: "u", title: "t", text: "x", fingerprint: "fp" + i, actions: script[Math.min(i, script.length - 1)] ?? [] }),
      fresh: async () => true,
      act: async (action: any, _page: any, text: string | null) => {
        acted.push({ id: action.id, text });
        i++;
      },
      decide: async () => script_decide(),
      helperText: async () => "Zurich",
    },
  };
  function script_decide() {
    const step = (globalThis as any).__decisions?.shift();
    if (!step) throw new Error("no scripted decision");
    return step;
  }
}

describe("Loop", () => {
  it("completes on DONE", async () => {
    (globalThis as any).__decisions = [{ choice: "DONE", operation: "DONE", target: null, confidence: 1, probabilities: { DONE: 1 }, operation_probabilities: {}, target_probabilities: {}, target_confidence: null, latency_ms: 1 }];
    const { harness } = fakeHarness([[]]);
    const loop = new Loop("goal", harness as any);
    await loop.init();
    const end = await loop.run(5);
    assert.equal(end.status, "done");
  });

  it("types fill text exactly once and observes after act", async () => {
    (globalThis as any).__decisions = [
      { choice: "fill-n1", operation: "TYPE_TEXT", target: "1", confidence: 0.9, probabilities: { "fill-n1": 0.9 }, operation_probabilities: {}, target_probabilities: {}, target_confidence: 0.9, latency_ms: 1 },
      { choice: "DONE", operation: "DONE", target: null, confidence: 1, probabilities: { DONE: 1 }, operation_probabilities: {}, target_probabilities: {}, target_confidence: null, latency_ms: 1 },
    ];
    const actions = [[{ id: "fill-n1", kind: "fill", node: "n1", label: "Where to?", role: "textbox", value: "" }], []];
    const f = fakeHarness(actions);
    const loop = new Loop("go zurich", f.harness as any);
    await loop.init();
    const end = await loop.run(5);
    assert.equal(end.status, "done");
    assert.equal(f.acted[0].text, "Zurich");
    assert.equal(loop.textCalls.length, 1);
  });

  it("blocks after three no-change non-wait actions", async () => {
    const d = () => ({ choice: "click-n1", operation: "CLICK", target: "1", confidence: 0.6, probabilities: { "click-n1": 0.6 }, operation_probabilities: {}, target_probabilities: {}, target_confidence: 0.6, latency_ms: 1 });
    (globalThis as any).__decisions = [d(), d(), d(), d()];
    let fp = "same";
    const harness: any = {
      now: () => Date.now(),
      observe: async () => ({ url: "u", title: "t", text: "x", fingerprint: fp, actions: [{ id: "click-n1", kind: "click", node: "n1", label: "X" }] }),
      fresh: async () => true,
      act: async () => {},
      decide: async () => (globalThis as any).__decisions.shift(),
      helperText: async () => "t",
    };
    const loop = new Loop("goal", harness);
    await loop.init();
    const end = await loop.run(5);
    assert.equal(end.status, "blocked");
  });
});
