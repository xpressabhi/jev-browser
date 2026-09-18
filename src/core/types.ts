// Shared types. No runtime imports — safe for any harness.

export type Operation = "CLICK" | "TYPE_TEXT" | "SELECT" | "DONE" | "BLOCKED" | string;

export interface ObservedAction {
  id: string;
  kind: "click" | "fill" | "select" | string;
  node: string;
  label: string;
  role?: string;
  value?: string;
  current_value?: string;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
}

export interface ElementEntry {
  index: string;
  label: string;
  role?: string;
  value?: string;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  operations: string[];
  options?: Array<{ index: string; label: string; value: string }>;
}

export interface PageState {
  url: string;
  title: string;
  text: string;
  actions: ObservedAction[];
  fingerprint?: string;
}

export interface HistoryEntry {
  action?: string;
  kind?: string;
  text?: string | null;
  page_changed?: boolean | null;
}

export interface JevChoice {
  choice: string;
  operation: string;
  target: string | null;
  confidence: number;
  probabilities: Record<string, number>;
  operation_probabilities: Record<string, number>;
  target_probabilities: Record<string, number>;
  target_confidence: number | null;
  raw_answers?: unknown;
  model?: unknown;
  usage?: unknown;
  latency_ms: number;
  degraded?: boolean;
}
