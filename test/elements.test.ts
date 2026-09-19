import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { a11yToActions, buildElementTable, capActions, snapshotToActions } from "../src/core/elements.ts";

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

describe("capActions", () => {
  it("keeps the first N per kind and every control", () => {
    const clicks = Array.from({ length: 150 }, (_, i) => ({
      id: `click-${i}`,
      kind: "click",
      node: `n${i}`,
      label: `l${i}`,
    }));
    const fills = Array.from({ length: 120 }, (_, i) => ({
      id: `fill-${i}`,
      kind: "fill",
      node: `f${i}`,
      label: `f${i}`,
    }));
    const capped = capActions([
      ...clicks,
      ...fills,
      { id: "WAIT", kind: "control", node: "", label: "WAIT" },
    ]);
    assert.equal(capped.filter((a) => a.kind === "click").length, 100);
    assert.equal(capped.filter((a) => a.kind === "fill").length, 100);
    assert.equal(capped[capped.length - 1].id, "WAIT");
  });
});

describe("snapshotToActions", () => {
  it("parses a chrome-devtools-mcp snapshot", () => {
    const snapshot = [
      'uid=1_0 RootWebArea "Example Domain" url="https://example.com/"',
      '  uid=1_1 heading "Example Domain" level="1"',
      '  uid=1_2 link "More information..." url="https://www.iana.org/domains/example"',
      '  uid=1_3 textbox "Search" value=""',
      '  uid=1_4 button "Disabled" disabled',
    ].join("\n");
    const actions = snapshotToActions(snapshot);
    assert.ok(actions.some((a) => a.id === "click-1_2" && a.label === "More information..."));
    const fill = actions.find((a) => a.id === "fill-1_3");
    assert.ok(fill);
    assert.equal(fill.role, "textbox");
    assert.ok(!actions.some((a) => a.node === "1_4"));
    assert.ok(actions.some((a) => a.id === "SCROLL_DOWN" && a.kind === "control"));
  });

  it("parses a Playwright aria snapshot and skips /url property lines", () => {
    const snapshot = [
      "- generic [active] [ref=f2e1]:",
      '  - link "Skip to content" [ref=f2e2] [cursor=pointer]:',
      '    - /url: "#main"',
      '  - textbox "Search" [ref=f2e3]: hello',
      '  - button "Off" [disabled] [ref=f2e4]',
      '  - button "Go" [ref=f2e5] [cursor=pointer]',
    ].join("\n");
    const actions = snapshotToActions(snapshot);
    assert.ok(actions.some((a) => a.id === "click-f2e2" && a.label === "Skip to content"));
    const fill = actions.find((a) => a.id === "fill-f2e3");
    assert.ok(fill);
    assert.equal(fill.value, "hello");
    assert.ok(!actions.some((a) => a.node === "f2e4"));
    assert.ok(actions.some((a) => a.id === "click-f2e5"));
  });
});
