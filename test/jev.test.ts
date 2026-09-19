import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRequest, choose, validateChoice } from "../src/core/jev.ts";

const page = {
  url: "https://example.com",
  title: "T",
  text: "hello",
  actions: [
    { id: "click-n1", kind: "click", node: "n1", label: "Search" },
    { id: "fill-n2", kind: "fill", node: "n2", label: "Where to? · empty", role: "textbox", value: "" },
  ],
};

describe("validateChoice", () => {
  it("accepts a well-formed distribution", () => {
    const ans = { choice: "a", probabilities: { a: 0.7, b: 0.3 }, confidence: 0.7 };
    assert.equal(validateChoice(ans, { a: 1, b: 1 }).choice, "a");
  });
  it("rejects mismatched keys and non-argmax choice", () => {
    assert.throws(() => validateChoice({ choice: "a", probabilities: { a: 0.2, b: 0.8 }, confidence: 0.5 }, { a: 1, b: 1 }));
    assert.throws(() => validateChoice({ choice: "z", probabilities: { a: 0.5, b: 0.5 }, confidence: 0.5 }, { a: 1, b: 1 }));
  });
});

describe("buildRequest", () => {
  it("asks operation + per-operation targets with DONE/BLOCKED", () => {
    const { body } = buildRequest(page, "goal", []);
    const q: any = body.questions;
    assert.ok(q.operation);
    assert.ok(q.click_target);
    assert.ok(q.type_text_target);
    assert.equal(q.operation.criteria.DONE, "Every requirement is visibly satisfied.");
    assert.ok(q.operation.criteria.BLOCKED);
  });

  it("caps each action kind so heavy pages stay inside the choice limit", () => {
    const heavy = {
      ...page,
      actions: Array.from({ length: 150 }, (_, i) => ({
        id: `click-${i}`,
        kind: "click",
        node: `n${i}`,
        label: `Link ${i}`,
      })),
    };
    const { body } = buildRequest(heavy, "goal", []);
    const criteria: any = (body.questions as any).click_target.criteria;
    assert.equal(Object.keys(criteria).length, 100);
  });
});

describe("choose", () => {
  it("resolves the matching target id in one round trip", async () => {
    let calls = 0;
    const fetchFn: any = async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: "jev-latest",
          answers: {
            operation: { choice: "TYPE_TEXT", probabilities: { CLICK: 0.2, TYPE_TEXT: 0.8, DONE: 0, BLOCKED: 0 }, confidence: 0.8 },
            type_text_target: { choice: "2", probabilities: { "2": 1 }, confidence: 0.9 },
            click_target: { choice: "1", probabilities: { "1": 1 }, confidence: 0.9 },
          },
        }),
      };
    };
    const d = await choose(page, "goal", [], { env: { TYPESAFE_API_KEY: "k" }, fetchFn });
    assert.equal(calls, 1);
    assert.equal(d.choice, "fill-n2");
    assert.equal(d.operation, "TYPE_TEXT");
    assert.equal(d.target, "2");
  });

  it("throws without key and on provider HTTP error", async () => {
    await assert.rejects(() => choose(page, "g", [], { env: { AUTH_PATHS: ["/nonexistent/auth.json"] } }));
    const bad: any = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await assert.rejects(() =>
      choose(page, "g", [], { env: { TYPESAFE_API_KEY: "k" }, fetchFn: bad }),
    );
  });
});
