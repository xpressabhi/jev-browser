import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fieldContext, fieldText, parseDegradedDecision } from "../src/core/text.ts";

describe("fieldContext", () => {
  it("truncates page text to 6000 chars", () => {
    const ctx: any = fieldContext("g", { label: "F", role: "textbox", value: "" } as any, {
      url: "u",
      title: "t",
      text: "x".repeat(9000),
      actions: [],
    }, []);
    assert.equal((ctx.page as any).text.length, 6000);
  });
});

describe("fieldText", () => {
  const env = { TEXT_MODEL_API_KEY: "k", TEXT_MODEL_BASE_URL: "https://openrouter.ai/api/v1", TEXT_MODEL: "m" };
  it("returns exact text on valid JSON", async () => {
    const fetchFn: any = async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"text":"Zurich"}' } }] }),
    });
    const { text } = await fieldText({ goal: "g" }, { env, fetchFn });
    assert.equal(text, "Zurich");
  });
  it("throws without key and on invalid JSON", async () => {
    await assert.rejects(() => fieldText({}, { env: {} }));
    const bad: any = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"nope":1}' } }] }) });
    await assert.rejects(() => fieldText({}, { env, fetchFn: bad }));
  });
});

describe("parseDegradedDecision", () => {
  it("accepts valid JSON fallback, rejects unknown ops", () => {
    assert.deepEqual(parseDegradedDecision('{"operation":"CLICK","target":"1"}', ["CLICK", "DONE"]), {
      operation: "CLICK",
      target: "1",
    });
    assert.throws(() => parseDegradedDecision('{"operation":"FLY"}', ["CLICK"]));
  });
});
