import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTarget, truncateText } from "../src/harness/targets.ts";

describe("resolveTarget", () => {
  it("prefers chrome on auto, falls back to brave", () => {
    assert.equal(resolveTarget("auto", ["chrome", "brave"]), "chrome");
    assert.equal(resolveTarget("auto", ["brave"]), "brave");
    assert.throws(() => resolveTarget("auto", []));
    assert.equal(resolveTarget("brave", ["chrome", "brave"]), "brave");
    assert.throws(() => resolveTarget("chrome", ["brave"]));
  });
});

describe("truncateText", () => {
  it("caps long text", () => {
    assert.equal(truncateText("x".repeat(7000)).length, 6000);
    assert.equal(truncateText("short"), "short");
  });
});
