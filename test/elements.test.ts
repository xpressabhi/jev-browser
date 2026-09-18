import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { a11yToActions, buildElementTable } from "../src/core/elements.ts";

describe("buildElementTable", () => {
  it("indexes one element per node with per-operation targets", () => {
    const { elements, targets, controls } = buildElementTable([
      { id: "c1", kind: "click", node: "n1", label: "Search" },
      { id: "f1", kind: "fill", node: "n2", label: "Where from? · empty", role: "combobox", value: "" },
      { id: "WAIT", kind: "control", node: "", label: "WAIT" },
    ]);
    assert.equal(elements.length, 2);
    assert.deepEqual(elements[0].operations, ["CLICK"]);
    assert.deepEqual(elements[1].operations, ["TYPE_TEXT"]);
    assert.ok(targets.CLICK["1"]);
    assert.ok(targets.TYPE_TEXT["2"]);
    assert.ok(controls.WAIT);
  });

  it("splits select options into indexed targets", () => {
    const { elements, targets } = buildElementTable([
      { id: "s1", kind: "select", node: "n9", label: "1 adult", value: "1", current_value: "1" },
      { id: "s2", kind: "select", node: "n9", label: "2 adults", value: "2", current_value: "1" },
    ]);
    assert.equal(elements.length, 1);
    assert.deepEqual(Object.keys(targets.SELECT), ["1:1", "1:2"]);
    assert.equal(elements[0].options?.length, 2);
  });
});

describe("a11yToActions", () => {
  it("maps roles, skips disabled/empty, appends controls", () => {
    const actions = a11yToActions([
      { ref: "a", role: "button", name: "Search" },
      { ref: "b", role: "textbox", name: "Where to?", value: "" },
      { ref: "c", role: "button", name: "Hidden", disabled: true },
      { ref: "d", role: "button", name: "  " },
    ]);
    const kinds = actions.map((a) => a.kind);
    assert.ok(kinds.includes("click"));
    assert.ok(kinds.includes("fill"));
    assert.ok(actions.some((a) => a.id === "WAIT"));
    assert.ok(!actions.some((a) => a.node === "c" || a.node === "d"));
  });
});
