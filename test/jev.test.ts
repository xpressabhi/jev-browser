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

describe("visual mode requests", () => {
  const shot = { format: "png" as const, width: 800, height: 600, data_base64: "aGk=" };

  function capturingFetch(answerBody: unknown) {
    const calls: Array<{ body: any; headers: Record<string, string> }> = [];
    const fetchFn: any = async (_url: string, init: any) => {
      calls.push({ body: JSON.parse(init.body), headers: init.headers });
      return { ok: true, status: 200, json: async () => answerBody };
    };
    return { calls, fetchFn };
  }

  const clickAnswers = {
    model: "jev-latest",
    answers: {
      operation: { choice: "CLICK", probabilities: { CLICK: 1, TYPE_TEXT: 0, DONE: 0, BLOCKED: 0 }, confidence: 1 },
      click_target: { choice: "1", probabilities: { "1": 1 }, confidence: 1 },
    },
  };

  it("image-less requests carry no assets and keep the default model", async () => {
    const { calls, fetchFn } = capturingFetch(clickAnswers);
    await choose(page, "g", [], { env: { TYPESAFE_API_KEY: "k" }, fetchFn });
    const { body, headers } = calls[0];
    assert.equal("assets" in body, false);
    assert.equal(body.state.screenshot, undefined);
    assert.equal(headers["TypeSafe-Danger-Zone-Images"], undefined);
    assert.equal(body.model, "jev-latest");
    assert.equal(buildRequest(page, "goal", []).visualClick, false);
  });

  it("image requests carry one asset, the state reference, the header, and jev-preview", async () => {
    const { body, visualClick } = buildRequest(page, "goal", [], shot);
    const ref = Object.keys((body as any).assets)[0];
    assert.equal((body.state as any).screenshot, ref);
    assert.deepEqual((body as any).assets[ref], { type: "image", format: "png", data_base64: "aGk=" });
    assert.equal(visualClick, false);

    const { calls, fetchFn } = capturingFetch({ ...clickAnswers, model: "jev-preview" });
    await choose(page, "goal", [], { env: { TYPESAFE_API_KEY: "k" }, fetchFn, image: shot });
    assert.equal(calls[0].headers["TypeSafe-Danger-Zone-Images"], "true");
    assert.equal(calls[0].body.model, "jev-preview");
    assert.equal(calls[0].body.state.screenshot, Object.keys(calls[0].body.assets)[0]);
  });

  it("offers a visual CLICK only when zero click candidates and an image", () => {
    const canvasPage = { ...page, actions: [] };
    const withImage = buildRequest(canvasPage, "goal", [], shot);
    assert.equal(withImage.visualClick, true);
    assert.equal(typeof (withImage.body.questions as any).operation.criteria.CLICK, "string");
    const withoutImage = buildRequest(canvasPage, "goal", []);
    assert.equal(withoutImage.visualClick, false);
    assert.equal((withoutImage.body.questions as any).operation.criteria.CLICK, undefined);
  });

  it("resolves a visual target without a target question", async () => {
    const canvasPage = { ...page, actions: [] };
    const calls: any[] = [];
    const fetchFn: any = async (_url: string, init: any) => {
      calls.push(JSON.parse(init.body));
      const body =
        calls.length === 1
          ? {
              model: "jev-preview",
              answers: {
                operation: { choice: "CLICK", probabilities: { CLICK: 1, DONE: 0, BLOCKED: 0 }, confidence: 1 },
              },
            }
          : {
              model: "jev-1.14.0",
              answers: {
                target_box: {
                  type: "box",
                  box: { top: 0.1, bottom: 0.2, left: 0.3, right: 0.4 },
                  confidence: 0.9,
                },
                target_present: { type: "noul", noul: 0.9 },
              },
            };
      return { ok: true, status: 200, json: async () => body };
    };
    const decision = await choose(canvasPage, "goal", [], { env: { TYPESAFE_API_KEY: "k" }, fetchFn, image: shot });
    assert.equal(calls.length, 2);
    assert.equal(decision.choice, "VISUAL_CLICK");
    assert.equal(decision.operation, "CLICK");
    assert.equal(decision.target, "visual");
    assert.equal(decision.probabilities.VISUAL_CLICK, 1);
    assert.equal(calls[0].questions.click_target, undefined);
  });

  it("TYPESAFE_MODEL still wins in image mode", async () => {
    const { calls, fetchFn } = capturingFetch({
      model: "x",
      answers: {
        operation: { choice: "DONE", probabilities: { CLICK: 0, TYPE_TEXT: 0, DONE: 1, BLOCKED: 0 }, confidence: 1 },
      },
    });
    await choose(page, "goal", [], {
      env: { TYPESAFE_API_KEY: "k", TYPESAFE_MODEL: "jev-1.14.0" },
      fetchFn,
      image: shot,
    });
    assert.equal(calls[0].body.model, "jev-1.14.0");
  });
});

describe("box phase", () => {
  const shot = { format: "png" as const, width: 800, height: 600, data_base64: "aGk=" };
  const canvasPage = { url: "u", title: "t", text: "", actions: [] as any[] };

  const canvasAnswers = {
    model: "jev-preview",
    answers: {
      operation: { choice: "CLICK", probabilities: { CLICK: 1, DONE: 0, BLOCKED: 0 }, confidence: 1 },
    },
  };
  const nodeAnswers = {
    model: "jev-preview",
    answers: {
      operation: { choice: "CLICK", probabilities: { CLICK: 1, TYPE_TEXT: 0, DONE: 0, BLOCKED: 0 }, confidence: 1 },
      click_target: { choice: "1", probabilities: { "1": 1 }, confidence: 1 },
    },
  };
  const boxAnswers = {
    model: "jev-1.14.0",
    answers: {
      target_box: {
        type: "box",
        box: { top: 0.25, bottom: 0.82, left: 0.44, right: 0.84 },
        confidence: 0.92,
      },
      target_present: { type: "noul", noul: 0.93 },
    },
    usage: { input_tokens: 3900 },
  };

  function scriptedFetch(script: Array<unknown | { fail: number }>) {
    const calls: Array<{ body: any; headers: Record<string, string> }> = [];
    let i = 0;
    const fetchFn: any = async (_url: string, init: any) => {
      const step = script[Math.min(i, script.length - 1)];
      calls.push({ body: JSON.parse(init.body), headers: init.headers });
      i += 1;
      if (step && typeof step === "object" && "fail" in (step as any)) {
        return { ok: false, status: (step as any).fail, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => step };
    };
    return { calls, fetchFn };
  }

  const env = { TYPESAFE_API_KEY: "k" };

  it("visual target runs phase 2 and returns coordinates", async () => {
    const { calls, fetchFn } = scriptedFetch([canvasAnswers, boxAnswers]);
    const d = await choose(canvasPage, "goal", [], { env, fetchFn, image: shot });
    assert.equal(calls.length, 2);
    assert.equal(d.choice, "VISUAL_CLICK");
    assert.deepEqual(d.image!.pixel, {
      x: 352,
      y: 150,
      width: 320,
      height: 342,
      center: { x: 512, y: 321 },
    });
    assert.equal(d.image!.present, 0.93);
    assert.equal(d.image!.confidence, 0.92);
    assert.equal(calls[1].body.questions.target_box.type, "box");
    assert.equal(calls[1].headers["TypeSafe-Danger-Zone-Images"], "true");
    assert.notEqual(calls[0].body.state.screenshot, calls[1].body.state.screenshot);
  });

  it("imageScale adds viewport coordinates", async () => {
    const { fetchFn } = scriptedFetch([canvasAnswers, boxAnswers]);
    const d = await choose(canvasPage, "goal", [], { env, fetchFn, image: shot, imageScale: 2 });
    assert.deepEqual(d.image!.viewport, { x: 256, y: 161 });
  });

  it("node targets skip phase 2 in auto mode", async () => {
    const { calls, fetchFn } = scriptedFetch([nodeAnswers, boxAnswers]);
    const d = await choose(page, "goal", [], { env, fetchFn, image: shot });
    assert.equal(calls.length, 1);
    assert.equal(d.choice, "click-n1");
    assert.equal(d.image, undefined);
  });

  it("box always also boxes node targets", async () => {
    const { calls, fetchFn } = scriptedFetch([nodeAnswers, boxAnswers]);
    const d = await choose(page, "goal", [], { env, fetchFn, image: shot, box: "always" });
    assert.equal(calls.length, 2);
    assert.equal(d.choice, "click-n1");
    assert.ok(d.image!.box);
    assert.ok(String(calls[1].body.questions.target_box.instructions).includes("Search"));
  });

  it("visual target fails the step when phase 2 fails", async () => {
    const { fetchFn } = scriptedFetch([canvasAnswers, { fail: 500 }]);
    await assert.rejects(
      () => choose(canvasPage, "goal", [], { env, fetchFn, image: shot }),
      /Box request failed for the visual target; no action executed/,
    );
  });

  it("box always degrades to image.error for node targets", async () => {
    const { fetchFn } = scriptedFetch([nodeAnswers, { fail: 500 }]);
    const d = await choose(page, "goal", [], { env, fetchFn, image: shot, box: "always" });
    assert.equal(d.choice, "click-n1");
    assert.ok(d.image!.error);
    assert.equal(d.image!.box, undefined);
  });

  it("malformed box answers follow the same split", async () => {
    const malformed = {
      model: "jev-1.14.0",
      answers: {
        target_box: {
          type: "box",
          box: { top: 0.25, bottom: 0.82, left: 0.6, right: 0.6 },
          confidence: 0.9,
        },
        target_present: { type: "noul", noul: 0.9 },
      },
    };
    await assert.rejects(
      () => choose(canvasPage, "goal", [], { env, fetchFn: scriptedFetch([canvasAnswers, malformed]).fetchFn, image: shot }),
      /malformed box/,
    );
    const d = await choose(page, "goal", [], {
      env,
      fetchFn: scriptedFetch([nodeAnswers, malformed]).fetchFn,
      image: shot,
      box: "always",
    });
    assert.match(d.image!.error!, /malformed box/);
  });

  it("a known 1.13 pin pre-empts the box phase", async () => {
    const { calls, fetchFn } = scriptedFetch([canvasAnswers, boxAnswers]);
    await assert.rejects(
      () => choose(canvasPage, "goal", [], { env: { TYPESAFE_API_KEY: "k", TYPESAFE_MODEL: "jev-latest" }, fetchFn, image: shot }),
      /Jev 1.14/,
    );
    assert.equal(calls.length, 1);
  });

  it("top-level latency measures phase 1 only", async () => {
    let call = 0;
    const fetchFn: any = async (_url: string, init: any) => {
      call += 1;
      const body =
        call === 1
          ? canvasAnswers
          : await new Promise((resolve) => setTimeout(() => resolve(boxAnswers), 40));
      return { ok: true, status: 200, json: async () => body };
    };
    const d = await choose(canvasPage, "goal", [], { env, fetchFn, image: shot });
    assert.ok(d.image!.latency_ms >= 40, "phase-2 latency includes the delay");
    assert.ok(d.latency_ms < 40, "top-level latency excludes phase 2");
  });
});
