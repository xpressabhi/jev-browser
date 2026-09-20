import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TEXT_VALUE } from "../src/core/questions.ts";
import {
  HELPER_STORAGE_KEY,
  nativeFieldText,
  pickFreeModel,
} from "../src/harness/opencode-text.ts";

const MUSE = "muse-spark-1.3-contributor-free";

const row = (providerID: string, id: string, extra: Record<string, unknown> = {}) => ({
  providerID,
  id,
  modelID: id,
  enabled: true,
  status: "active",
  ...extra,
});

function fakeClient() {
  const calls = { create: 0, generate: 0 };
  const prompts: string[] = [];
  const store = new Map<string, unknown>();
  const client = {
    model: {
      list: async () => ({
        location: { directory: "/tmp" },
        data: [row("opencode", MUSE), row("opencode-go", "deepseek-v4-flash")],
      }),
    },
    storage: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => {
        store.set(key, value);
      },
    },
    session: {
      get: async (_input: { sessionID: string }): Promise<unknown> => {
        throw new Error("session is gone");
      },
      create: async (input: { model?: unknown }) => {
        calls.create += 1;
        return { id: `ses_test${calls.create}`, model: input.model };
      },
      generate: async (input: { sessionID: string; prompt: string }) => {
        calls.generate += 1;
        prompts.push(input.prompt);
        return { text: '{"text":"OpenAI"}' };
      },
    },
  };
  return { client, calls, prompts, store };
}

describe("pickFreeModel", () => {
  it("prefers muse over the other free models", () => {
    const picked = pickFreeModel([row("opencode", "nemotron-3-ultra-free"), row("opencode", MUSE)]);
    assert.deepEqual(picked, { providerID: "opencode", id: MUSE });
  });

  it("skips disabled and deprecated rows", () => {
    const picked = pickFreeModel([
      row("opencode", MUSE, { enabled: false }),
      row("opencode", "muse-spark-1.2-contributor-free", { status: "deprecated" }),
      row("opencode", "nemotron-3.5-lightning-free"),
    ]);
    assert.deepEqual(picked, { providerID: "opencode", id: "nemotron-3.5-lightning-free" });
  });

  it("falls back to any free zen model, then undefined", () => {
    assert.deepEqual(pickFreeModel([row("opencode", "ling-3.0-flash-fin-free")]), {
      providerID: "opencode",
      id: "ling-3.0-flash-fin-free",
    });
    assert.equal(pickFreeModel([row("opencode-go", "deepseek-v4-flash")]), undefined);
  });
});

describe("nativeFieldText", () => {
  it("reuses the calling session's model when it has one", async () => {
    const { client, calls } = fakeClient();
    client.session.get = async (input: { sessionID: string }) =>
      input.sessionID === "ses_live"
        ? { model: { providerID: "anthropic", id: "claude-sonnet-4-5" } }
        : { model: { providerID: "opencode", id: MUSE } };
    const out = await nativeFieldText(client, { goal: "g" }, { sessionID: "ses_live" });

    assert.equal(out.model, "anthropic/claude-sonnet-4-5");
    assert.equal(calls.create, 1);
    assert.equal(calls.generate, 1);
  });

  it("falls back to a free model when the calling session is gone", async () => {
    const { client } = fakeClient();
    const out = await nativeFieldText(client, { goal: "g" }, { sessionID: "ses_gone" });
    assert.equal(out.model, `opencode/${MUSE}`);
  });

  it("creates one helper session, sends the goal, and parses the reply", async () => {
    const { client, calls, prompts, store } = fakeClient();
    const out = await nativeFieldText(client, { goal: "search Wikipedia", field: { label: "Search" } });

    assert.deepEqual(out, { text: "OpenAI", model: `opencode/${MUSE}` });
    assert.equal(calls.create, 1);
    assert.equal(calls.generate, 1);
    assert.ok(prompts[0].includes(TEXT_VALUE));
    assert.ok(prompts[0].includes('"goal":"search Wikipedia"'));
    assert.deepEqual(store.get(HELPER_STORAGE_KEY), { id: "ses_test1", model: `opencode/${MUSE}` });
  });

  it("reuses the cached session while it matches the model", async () => {
    const { client, calls } = fakeClient();
    await nativeFieldText(client, { goal: "g" });

    client.session.get = async () => ({ model: { providerID: "opencode", id: MUSE } });
    await nativeFieldText(client, { goal: "g" });

    assert.equal(calls.create, 1);
    assert.equal(calls.generate, 2);
  });

  it("recreates the helper when the cached session is gone", async () => {
    const { client, calls } = fakeClient();
    await nativeFieldText(client, { goal: "g" });
    await nativeFieldText(client, { goal: "g" });

    assert.equal(calls.create, 2);
    assert.equal(calls.generate, 2);
  });

  it("throws when no free model is offered", async () => {
    const { client } = fakeClient();
    client.model.list = async () => ({ data: [row("opencode-go", "deepseek-v4-flash")] });
    await assert.rejects(() => nativeFieldText(client, {}));
  });

  it("throws on an unusable reply so the caller can fall back", async () => {
    const { client } = fakeClient();
    client.session.generate = async () => ({ text: "not json" });
    await assert.rejects(() => nativeFieldText(client, {}));
  });
});
