import type { ElementEntry, ObservedAction } from "./types.ts";

// Port of jev_ultrafast/model.py action_space (MIT).
// One index per observed node; each operation gets its own valid target choices.
export function buildElementTable(actions: ObservedAction[]): {
  elements: ElementEntry[];
  targets: Record<string, Record<string, ObservedAction>>;
  controls: Record<string, ObservedAction>;
} {
  const elements: ElementEntry[] = [];
  const indices = new Map<string, string>();
  const targets: Record<string, Record<string, ObservedAction>> = {};
  const controls: Record<string, ObservedAction> = {};
  const operations: Record<string, string> = { click: "CLICK", fill: "TYPE_TEXT", select: "SELECT" };

  for (const action of actions) {
    const kind = action.kind;
    if (!(kind in operations)) {
      controls[action.id.toUpperCase()] = action;
      continue;
    }
    const node = action.node;
    if (!indices.has(node)) {
      const index = String(elements.length + 1);
      indices.set(node, index);
      const element: ElementEntry = {
        index,
        label: action.label.split(" → ")[0],
        operations: [],
      };
      for (const k of ["role", "value", "checked", "selected", "expanded"] as const) {
        if (k in action && (action as unknown as Record<string, unknown>)[k] !== undefined) {
          (element as unknown as Record<string, unknown>)[k] = (action as unknown as Record<string, unknown>)[k];
        }
      }
      if (kind === "select") {
        element.value = action.current_value ?? "";
        element.options = [];
      }
      elements.push(element);
    }
    const index = indices.get(node)!;
    const operation = operations[kind];
    const group = (targets[operation] ??= {});
    const element = elements[Number(index) - 1];
    if (!element.operations.includes(operation)) element.operations.push(operation);
    let target = index;
    if (kind === "select") {
      target = `${index}:${(element.options?.length ?? 0) + 1}`;
      element.options!.push({ index: target, label: action.label, value: action.value ?? "" });
    }
    group[target] = action;
  }
  return { elements, targets, controls };
}

// Map a generic accessibility snapshot (chrome-devtools-mcp style) to ObservedAction[].
// Input nodes: { ref, role, name, value?, checked?, selected?, expanded?, disabled? }.
// Pure function — no MCP imports, fully unit-testable.
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

const CLICK_ROLES = new Set([
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

const FILL_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

const SELECT_ROLES = new Set(["combobox", "listbox"]);

export function a11yToActions(nodes: A11yNode[]): ObservedAction[] {
  const actions: ObservedAction[] = [];
  for (const n of nodes) {
    if (n.disabled) continue;
    const label = (n.name || n.role || n.ref).trim();
    if (!label) continue;
    const role = n.role.toLowerCase();
    if (FILL_ROLES.has(role) && role !== "combobox") {
      actions.push({
        id: `fill-${n.ref}`,
        kind: "fill",
        node: n.ref,
        label: `${label} · ${n.value ?? "empty"}`,
        role: n.role,
        value: n.value ?? "",
      });
    } else if (role === "combobox") {
      // Combobox is both fillable and (when options observed) selectable.
      actions.push({
        id: `fill-${n.ref}`,
        kind: "fill",
        node: n.ref,
        label: `${label} · ${n.value ?? "empty"}`,
        role: n.role,
        value: n.value ?? "",
      });
      void SELECT_ROLES;
    } else if (CLICK_ROLES.has(role) || role === "generic") {
      if (role === "generic" && !/button|link|tab/i.test(n.role)) continue;
      actions.push({ id: `click-${n.ref}`, kind: "click", node: n.ref, label, role: n.role });
    } else if (role === "option") {
      actions.push({ id: `click-${n.ref}`, kind: "click", node: n.ref, label, role: n.role });
    }
  }
  // Pseudo-controls always offered (match jev-ultrafast control space).
  for (const c of ["SCROLL_UP", "SCROLL_DOWN", "WAIT"]) {
    actions.push({ id: c, kind: "control", node: "", label: c });
  }
  return actions;
}
