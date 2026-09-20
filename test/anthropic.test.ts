import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fieldText } from "../src/core/text.ts";
import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_URL,
  anthropicProfile,
  anthropicReplyText,
  buildAnthropicRequest,
} from "../src/anthropic.ts";
import { replyText, textRequest } from "../src/core/text.ts";

describe("anthropicProfile", () => {
  it("uses the Messages API with a Haiku-class default", () => {
    const profile = anthropicProfile("sk-ant-test");
    assert.equal(profile.provider, "anthropic");
    assert.equal(profile.base, ANTHROPIC_URL);
    assert.equal(profile.model, ANTHROPIC_DEFAULT_MODEL);
    assert.equal(profile.headers["anthropic-version"], ANTHROPIC_API_VERSION);
  });

  it("honors an explicit model", () => {
    assert.equal(anthropicProfile("k", "claude-3-7-sonnet-latest").model, "claude-3-7-sonnet-latest");
  });
});

describe("buildAnthropicRequest", () => {
  it("sends the policy as system and the context as one user message", () => {
    const body = buildAnthropicRequest(anthropicProfile("k"), "POLICY", { goal: "book a flight" });
    assert.equal(body.model, ANTHROPIC_DEFAULT_MODEL);
    assert.equal(body.max_tokens, 1024);
    assert.equal(body.system, "POLICY");
    assert.deepEqual(body.messages, [{ role: "user", content: '{"goal":"book a flight"}' }]);
  });
});

describe("anthropicReplyText", () => {
  it("joins text blocks and rejects empty replies", () => {
    assert.equal(anthropicReplyText({ content: [{ type: "text", text: '{"text":"Zurich"}' }] }), '{"text":"Zurich"}');
    assert.equal(anthropicReplyText({ content: [{ type: "text", text: "{" }, { type: "text", text: "}" }] }), "{}");
    assert.equal(anthropicReplyText({ content: [] }), null);
    assert.equal(anthropicReplyText({}), null);
  });
});

describe("replyText", () => {
  it("accepts openai, anthropic, bare-message, and text bodies", () => {
    assert.equal(replyText({ choices: [{ message: { content: '{"text":"a"}' } }] }), '{"text":"a"}');
    assert.equal(replyText({ content: [{ text: '{"text":"b"}' }] }), '{"text":"b"}');
    assert.equal(replyText({ role: "assistant", content: '{"text":"c"}' }), '{"text":"c"}');
    assert.equal(replyText({ message: { content: '{"text":"d"}' } }), '{"text":"d"}');
    assert.equal(replyText({ text: '{"text":"e"}' }), '{"text":"e"}');
    assert.equal(replyText({}), null);
  });
});

describe("textRequest", () => {
  it("builds an x-api-key Messages call for anthropic profiles", () => {
    const request = textRequest(anthropicProfile("sk-ant"), { goal: "g" });
    assert.equal(request.url, ANTHROPIC_URL);
    assert.equal(request.headers["x-api-key"], "sk-ant");
    assert.equal(request.headers["anthropic-version"], ANTHROPIC_API_VERSION);
    assert.equal(request.headers.authorization, undefined);
  });

  it("builds a bearer Chat Completions call for openai profiles", () => {
    const request = textRequest(
      {
        provider: "openai",
        base: "https://example.test/v1",
        model: "m",
        key: "k",
        headers: {},
        reasoning: {},
      },
      { goal: "g" },
    );
    assert.equal(request.url, "https://example.test/v1/chat/completions");
    assert.equal(request.headers.authorization, "Bearer k");
  });
});

describe("fieldText on the anthropic tier", () => {
  it("fetches and parses a Messages reply", async () => {
    let seen: { url?: string; headers?: Record<string, string> } = {};
    const fetchFn: any = async (url: string, init: any) => {
      seen = { url, headers: init.headers };
      return { ok: true, json: async () => ({ content: [{ type: "text", text: '{"text":"Zurich"}' }] }) };
    };
    const out = await fieldText(
      { goal: "g" },
      { env: { ANTHROPIC_API_KEY: "sk-ant" }, fetchFn, sessionID: "s" },
    );
    assert.equal(out.text, "Zurich");
    assert.equal(out.meta.model, ANTHROPIC_DEFAULT_MODEL);
    assert.equal(seen.url, ANTHROPIC_URL);
    assert.equal(seen.headers?.["x-api-key"], "sk-ant");
  });

  it("throws when the reply breaks the strict contract", async () => {
    const fetchFn: any = async () => ({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: '{"value":"Zurich"}' }] }),
    });
    await assert.rejects(() =>
      fieldText({ goal: "g" }, { env: { ANTHROPIC_API_KEY: "sk-ant" }, fetchFn, sessionID: "s" }),
    );
  });
});
