import {
  generateTextInSession,
  helperSession,
  sessionModel,
  type ModelChoice,
  type NativeClient,
  type NativeTextResult,
} from "./session-text.ts";

export type { ModelChoice, NativeClient, NativeTextResult } from "./session-text.ts";
export { HELPER_STORAGE_KEY, HELPER_TITLE, generateTextInSession, helperSession, sessionModel } from "./session-text.ts";

/** Free models in preference order. muse-spark is the default pick. */
export const PREFERRED_FREE_MODELS = [
  "muse-spark-1.3-contributor-free",
  "muse-spark-1.2-contributor-free",
  "nemotron-3.5-lightning-free",
  "nemotron-3-ultra-free",
  "jev-1.13-free",
  "mimo-v2.5-free",
  "big-pickle",
];

interface ModelRow {
  providerID?: string;
  id?: string;
  modelID?: string;
  enabled?: boolean;
  status?: string;
}

function normalizeModels(raw: unknown): ModelRow[] {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown })?.data)
      ? ((raw as { data: unknown[] }).data)
      : [];
  return rows.filter((row): row is ModelRow => typeof row === "object" && row !== null);
}

function rowID(row: ModelRow): string | undefined {
  return typeof row.id === "string" ? row.id : typeof row.modelID === "string" ? row.modelID : undefined;
}

/** Pick the best available free Zen model; undefined when none is offered. */
export function pickFreeModel(rawModels: readonly ModelRow[]): ModelChoice | undefined {
  const usable = rawModels
    .filter((row) => row.enabled !== false && row.status !== "deprecated")
    .map((row) => ({ providerID: row.providerID, id: rowID(row) }))
    .filter((row): row is ModelChoice => typeof row.providerID === "string" && typeof row.id === "string");

  const byKey = new Map(usable.map((row) => [`${row.providerID}/${row.id}`, row]));
  for (const id of PREFERRED_FREE_MODELS) {
    const hit = byKey.get(`opencode/${id}`);
    if (hit) return hit;
  }
  return usable.find(
    (row) => row.providerID === "opencode" && (row.id.includes("free") || row.id === "big-pickle"),
  );
}

/**
 * Text through the model the calling session already uses. Falls back to a free
 * Zen model when the harness reports no session model, so `TYPESAFE_API_KEY`
 * alone still works out of the box.
 */
export async function nativeFieldText(
  client: NativeClient,
  context: Record<string, unknown>,
  opts: { sessionID?: string; model?: ModelChoice } = {},
): Promise<NativeTextResult> {
  let model = opts.model;
  if (!model && opts.sessionID) {
    try {
      model = sessionModel(await client.session.get({ sessionID: opts.sessionID }));
    } catch {
      // Session is gone; fall through to a free model.
    }
  }
  model ??= pickFreeModel(normalizeModels(await client.model.list()));
  if (!model) throw new Error("No session or free OpenCode Zen model available");
  return generateTextInSession(client, model, context);
}
