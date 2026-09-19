import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEXT_VALUE } from "../core/questions.ts";
import { parseFieldValue } from "../core/text.ts";

/**
 * Text generation through OpenCode itself.
 *
 * Free Zen models reject direct API calls (Console answers HTTP 403
 * FreeTierError; the Go endpoint answers ModelError). They do work from
 * inside OpenCode, so this module keeps one managed helper session — created
 * in a temp location so it stays out of the user's session list — and runs
 * `session.generate` against a free model there.
 *
 * The client is a structural subset of the OpenCode plugin context; keeping
 * it structural lets this module be tested without the plugin runtime.
 */
export interface NativeClient {
  model: {
    list(): Promise<unknown>;
  };
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  session: {
    get(input: { sessionID: string }): Promise<unknown>;
    create(input: {
      title?: string | null;
      model?: { providerID: string; id: string } | null;
      location?: { directory: string } | null;
    }): Promise<unknown>;
    generate(input: { sessionID: string; prompt: string }): Promise<{ text: string }>;
  };
}

export interface ModelChoice {
  providerID: string;
  id: string;
}

export interface NativeTextResult {
  text: string;
  model: string;
}

export const HELPER_STORAGE_KEY = "text.helper-session";
export const HELPER_TITLE = "jev-text helper (managed by jev-browser)";

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

function helperDirectory(): string {
  return join(tmpdir(), "jev-browser");
}

/**
 * Return the managed helper session, creating it on first use. The id is
 * cached in plugin storage and revalidated, so restarts and model changes
 * recreate it cleanly instead of accumulating sessions.
 */
async function helperSession(client: NativeClient, model: ModelChoice): Promise<string> {
  const stored = await client.storage.get(HELPER_STORAGE_KEY).catch(() => undefined);
  const cached =
    stored && typeof stored === "object" ? (stored as { id?: unknown }).id : undefined;
  if (typeof cached === "string" && cached) {
    try {
      const info = (await client.session.get({ sessionID: cached })) as {
        model?: { providerID?: string; id?: string; modelID?: string };
      } | null;
      const current = info?.model;
      const currentID = current?.id ?? current?.modelID;
      if (current?.providerID === model.providerID && currentID === model.id) return cached;
    } catch {
      // Session no longer exists; fall through and create a fresh one.
    }
  }

  const directory = helperDirectory();
  mkdirSync(directory, { recursive: true });
  const created = (await client.session.create({
    title: HELPER_TITLE,
    model: { providerID: model.providerID, id: model.id },
    location: { directory },
  })) as { id?: unknown } | null;
  const id = created?.id;
  if (typeof id !== "string" || !id) throw new Error("Could not create the text helper session");
  await client.storage.set(HELPER_STORAGE_KEY, { id, model: `${model.providerID}/${model.id}` }).catch(() => undefined);
  return id;
}

/**
 * Generate one field value through a free model inside OpenCode. Throws when
 * no free model is available or the reply is unusable, so the caller can fall
 * back to the configured OpenAI-compatible provider.
 */
export async function nativeFieldText(
  client: NativeClient,
  context: Record<string, unknown>,
): Promise<NativeTextResult> {
  const model = pickFreeModel(normalizeModels(await client.model.list()));
  if (!model) throw new Error("No free OpenCode Zen model available");

  const sessionID = await helperSession(client, model);
  const prompt = `${TEXT_VALUE}\n\nContext:\n${JSON.stringify(context)}`;
  const reply = await client.session.generate({ sessionID, prompt });
  return { text: parseFieldValue(reply?.text), model: `${model.providerID}/${model.id}` };
}
