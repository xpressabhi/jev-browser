import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEXT_VALUE } from "../core/questions.ts";
import { parseFieldValue } from "../core/text.ts";

/**
 * Text generation through a harness session.
 *
 * Harnesses that expose a programmatic session (OpenCode does) can reuse the
 * model already selected for the conversation instead of configuring a second
 * key. The client is a structural subset of the harness plugin context, so this
 * module stays testable without any harness runtime.
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

/** The model a session currently uses, when the harness reports one. */
export function sessionModel(info: unknown): ModelChoice | undefined {
  const model = (info as { model?: ModelRow } | null)?.model;
  if (!model || typeof model !== "object") return undefined;
  const id = rowID(model);
  if (typeof model.providerID !== "string" || typeof id !== "string") return undefined;
  return { providerID: model.providerID, id };
}

function helperDirectory(): string {
  return join(tmpdir(), "jev-browser");
}

/**
 * Return the managed helper session for one model, creating it on first use.
 * The id is cached in harness storage and revalidated, so restarts and model
 * changes recreate it cleanly instead of accumulating sessions.
 */
export async function helperSession(client: NativeClient, model: ModelChoice): Promise<string> {
  const stored = await client.storage.get(HELPER_STORAGE_KEY).catch(() => undefined);
  const cached =
    stored && typeof stored === "object" ? (stored as { id?: unknown }).id : undefined;
  if (typeof cached === "string" && cached) {
    try {
      const info = await client.session.get({ sessionID: cached });
      const current = sessionModel(info);
      if (current?.providerID === model.providerID && current.id === model.id) return cached;
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
 * Generate one field value through a harness session model. Throws when the
 * reply is unusable, so the caller can fall back to another text tier.
 */
export async function generateTextInSession(
  client: NativeClient,
  model: ModelChoice,
  context: Record<string, unknown>,
): Promise<NativeTextResult> {
  const sessionID = await helperSession(client, model);
  const prompt = `${TEXT_VALUE}\n\nContext:\n${JSON.stringify(context)}`;
  const reply = await client.session.generate({ sessionID, prompt });
  return { text: parseFieldValue(reply?.text), model: `${model.providerID}/${model.id}` };
}
