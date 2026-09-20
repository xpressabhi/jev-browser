import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fieldContext, fieldText, parseDegradedDecision, parseFieldValue, resolveTextProfile } from "../src/core/text.ts";

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
    await assert.rejects(() =>
      fieldText(
        {},
        {
          env: {
            AUTH_PATHS: ["/nonexistent/auth.json"],
            ANTHROPIC_API_KEY: undefined,
            OPENAI_API_KEY: undefined,
          },
        },
      ),
    );
    const bad: any = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"nope":1}' } }] }) });
    await assert.rejects(() => fieldText({}, { env, fetchFn: bad }));
  });
});

describe("resolveTextProfile", () => {
  function authPaths(content: Record<string, unknown>): string[] {
    const dir = mkdtempSync(join(tmpdir(), "jev-"));
    const file = join(dir, "auth.json");
    writeFileSync(file, JSON.stringify(content));
    return [file];
  }

  it("prefers TEXT_MODEL_API_KEY over every host key", () => {
    const profile = resolveTextProfile(
      {
        TEXT_MODEL_API_KEY: "explicit",
        TEXT_MODEL_BASE_URL: "http://localhost:11434/v1",
        TEXT_MODEL: "llama3",
        ANTHROPIC_API_KEY: "sk-ant",
        OPENAI_API_KEY: "sk-openai",
      },
      "session-1",
    );
    assert.equal(profile?.provider, "openai");
    assert.equal(profile?.key, "explicit");
    assert.equal(profile?.model, "llama3");
  });

  it("uses ANTHROPIC_API_KEY before OPENAI_API_KEY", () => {
    const profile = resolveTextProfile(
      { ANTHROPIC_API_KEY: "sk-ant", OPENAI_API_KEY: "sk-openai", AUTH_PATHS: ["/nonexistent"] },
      "session-1",
    );
    assert.equal(profile?.provider, "anthropic");
    assert.equal(profile?.key, "sk-ant");
  });

  it("falls back to OPENAI_API_KEY with a small default model", () => {
    const profile = resolveTextProfile(
      { OPENAI_API_KEY: "sk-openai", AUTH_PATHS: ["/nonexistent"] },
      "session-1",
    );
    assert.equal(profile?.provider, "openai");
    assert.equal(profile?.base, "https://api.openai.com/v1");
    assert.equal(profile?.model, "gpt-4o-mini");
  });

  it("prefers host keys over auth.json providers", () => {
    const profile = resolveTextProfile(
      {
        ANTHROPIC_API_KEY: "sk-ant",
        AUTH_PATHS: authPaths({ "opencode-go": { type: "api", key: "go-key" } }),
      },
      "session-1",
    );
    assert.equal(profile?.key, "sk-ant");
  });

  it("reads an anthropic entry from auth.json", () => {
    const profile = resolveTextProfile(
      { AUTH_PATHS: authPaths({ anthropic: { type: "api", key: "sk-ant" } }) },
      "session-1",
    );
    assert.equal(profile?.provider, "anthropic");
    assert.equal(profile?.key, "sk-ant");
  });

  it("defaults to the cheap opencode-go model", () => {
    const profile = resolveTextProfile(
      { AUTH_PATHS: authPaths({ "opencode-go": { type: "api", key: "go-key" } }) },
      "session-1",
    );
    assert.equal(profile?.provider, "openai");
    assert.equal(profile?.base, "https://opencode.ai/zen/go/v1");
    assert.equal(profile?.model, "deepseek-v4-flash");
    assert.equal(profile?.key, "go-key");
    assert.equal(profile?.headers["x-opencode-session"], "session-1");
  });

  it("honors TEXT_MODEL on the opencode-go tier", () => {
    const profile = resolveTextProfile(
      {
        AUTH_PATHS: authPaths({ "opencode-go": { type: "api", key: "go-key" } }),
        TEXT_MODEL: "mimo-v2.5",
      },
      "session-1",
    );
    assert.equal(profile?.model, "mimo-v2.5");
  });

  it("ignores a google-only auth file", () => {
    assert.equal(
      resolveTextProfile({ AUTH_PATHS: authPaths({ google: { type: "api", key: "g-key" } }) }, "session-1"),
      undefined,
    );
  });

  it("returns undefined when no provider resolves", () => {
    assert.equal(resolveTextProfile({ AUTH_PATHS: ["/nonexistent/auth.json"] }, "session-1"), undefined);
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
