import type { ElementEntry, ObservedAction } from "./types.ts";

// Builds the element table for one page observation: one indexed element per
// DOM node, a target list per operation, and the pseudo-controls that are
// offered on every cycle.
export function buildElementTable(actions: ObservedAction[]): {
  elements: ElementEntry[];
  targets: Record<string, Record<string, ObservedAction>>;
  controls: Record<string, ObservedAction>;
} {
  const OPERATION_BY_KIND: Record<string, string> = { click: "CLICK", fill: "TYPE_TEXT", select: "SELECT" };
  const elements: ElementEntry[] = [];
  const slots = new Map<string, ElementEntry>();
  const targets: Record<string, Record<string, ObservedAction>> = {};
  const controls: Record<string, ObservedAction> = {};

  const slotFor = (action: ObservedAction): ElementEntry => {
    const known = slots.get(action.node);
    if (known) return known;
    const slot: ElementEntry = {
      index: String(elements.length + 1),
      label: action.label.split(" → ")[0],
      operations: [],
    };
    for (const key of ["role", "value", "checked", "selected", "expanded"] as const) {
      const value = action[key];
      if (value !== undefined) (slot as unknown as Record<string, unknown>)[key] = value;
    }
    if (action.kind === "select") {
      slot.value = action.current_value ?? "";
      slot.options = [];
    }
    slots.set(action.node, slot);
    elements.push(slot);
    return slot;
  };

  for (const action of actions) {
    const operation = OPERATION_BY_KIND[action.kind];
    if (!operation) {
      controls[action.id.toUpperCase()] = action;
      continue;
    }
    const slot = slotFor(action);
    if (!slot.operations.includes(operation)) slot.operations.push(operation);
    let targetKey = slot.index;
    if (action.kind === "select") {
      targetKey = `${slot.index}:${(slot.options?.length ?? 0) + 1}`;
      slot.options!.push({ index: targetKey, label: action.label, value: action.value ?? "" });
    }
    const group = (targets[operation] ??= {});
    group[targetKey] = action;
  }

  return { elements, targets, controls };
}

// Maps a generic accessibility snapshot (chrome-devtools-mcp style) to the
// observed action list Jev expects. Pure function, easy to test.
export interface A11yNode {
  ref: string;
  role: string;
  name: string;
  value?: string;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  disabled?: boolean;
}

const CLICKABLE_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "checkbox",
  "radio",
  "switch",
  "option",
]);

const EDITABLE_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

export function a11yToActions(nodes: A11yNode[]): ObservedAction[] {
  const actions: ObservedAction[] = [];
  for (const node of nodes) {
    if (node.disabled) continue;
    const label = (node.name || node.role || node.ref).trim();
    if (!label) continue;
    const role = node.role.toLowerCase();
    if (EDITABLE_ROLES.has(role)) {
      actions.push({
        id: `fill-${node.ref}`,
        kind: "fill",
        node: node.ref,
        label: `${label} · ${node.value ?? "empty"}`,
        role: node.role,
        value: node.value ?? "",
      });
    } else if (CLICKABLE_ROLES.has(role)) {
      actions.push({ id: `click-${node.ref}`, kind: "click", node: node.ref, label, role: node.role });
    }
  }
  for (const control of ["SCROLL_UP", "SCROLL_DOWN", "WAIT"]) {
    actions.push({ id: control, kind: "control", node: "", label: control });
  }
  return actions;
}

/**
 * Parse a raw accessibility snapshot into a11y nodes. Supports both formats
 * the browser MCPs emit:
 * - chrome-devtools-mcp: `uid=1_2 button "Search" value="" disabled`
 * - Playwright aria:     `- button "Search" [ref=e23] [disabled]: value`
 * Container lines without a ref and `/url` property lines are skipped.
 */
export function snapshotToNodes(snapshot: string): A11yNode[] {
  const nodes: A11yNode[] = [];
  for (const raw of snapshot.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const chrome = line.match(/^uid=(\S+)\s+(\S+)([\s\S]*)$/);
    const playwright = line.match(/^-\s+(\S+)([\s\S]*)$/);

    let ref: string | undefined;
    let role: string | undefined;
    let rest = "";
    if (chrome) {
      ref = chrome[1];
      role = chrome[2];
      rest = chrome[3] ?? "";
    } else if (playwright && !playwright[1].startsWith("/")) {
      role = playwright[1];
      rest = playwright[2] ?? "";
      ref = rest.match(/\bref=([^\]\s]+)/)?.[1];
    }
    if (!ref || !role) continue;

    const quoted = rest.match(/"((?:[^"\\]|\\.)*)"/);
    const withoutAttrs = rest.replace(/"[^"]*"/g, '""').replace(/\[[^\]]*\]/g, "");
    const value =
      rest.match(/\bvalue="([^"]*)"/)?.[1] ??
      rest.match(/\bvalue=(\S+)/)?.[1] ??
      (playwright ? withoutAttrs.match(/:\s+(.+)$/)?.[1]?.trim() : undefined);

    nodes.push({
      ref,
      role,
      name: quoted ? quoted[1].replace(/\\"/g, '"') : "",
      value,
      disabled: /\[disabled\]/.test(rest) || /(?:^|\s)disabled(?:=true)?(?:\s|$)/.test(rest),
      checked: /\[checked\]/.test(rest) || /\bchecked=true/.test(rest),
      selected: /\[selected\]/.test(rest) || /\bselected=true/.test(rest),
      expanded: /\[expanded\]/.test(rest) || /\bexpanded=true/.test(rest),
    });
  }
  return nodes;
}

/** Parse a raw snapshot straight into the observed action list. */
export function snapshotToActions(snapshot: string): ObservedAction[] {
  return a11yToActions(snapshotToNodes(snapshot));
}

/** Per-kind cap. The TypeSafe endpoint rejects questions with over 255 choices. */
export const ACTION_CAP_PER_KIND = 100;

/**
 * Keep the first N actions of each kind in document order and every control.
 * Deterministic on purpose: the harness can scroll and re-observe to reach
 * elements beyond the cap, while a wider action space risks HTTP 400.
 */
export function capActions(actions: ObservedAction[], perKind = ACTION_CAP_PER_KIND): ObservedAction[] {
  const counts: Record<string, number> = {};
  return actions.filter((action) => {
    if (action.kind === "control") return true;
    counts[action.kind] = (counts[action.kind] ?? 0) + 1;
    return counts[action.kind] <= perKind;
  });
}
