#!/usr/bin/env -S node --experimental-strip-types
/**
 * jev CLI — the cross-harness entry point.
 *
 * Decides, never touches a browser. Each command reads JSON from stdin (`-`)
 * and writes exactly one compact JSON line to stdout. Failures write
 * `{"error": "..."}` to stderr and exit 2, so a harness never acts on a
 * partial answer.
 *
 *   jev observe --snapshot - [--url U] [--title T] [--text -]
 *   jev decide  --goal G --page - [--history -]
 *   jev step    --goal G --page - [--history -]
 *   jev text    --context -
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { capActions, snapshotToActions } from "./core/elements.ts";
import { choose } from "./core/jev.ts";
import { planStep } from "./core/step.ts";
import { fieldText } from "./core/text.ts";
import type { HistoryEntry, JevChoice, ObservedAction, PageState } from "./core/types.ts";

type Flags = Record<string, string>;
interface Parsed {
  command: string;
  flags: Flags;
}

const ENV_KEYS = [
  "TYPESAFE_API_KEY",
  "TYPESAFE_MODEL",
  "TEXT_MODEL_API_KEY",
  "TEXT_MODEL_BASE_URL",
  "TEXT_MODEL",
  "TEXT_MODEL_REASONING",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
];

/**
 * Minimal .env loader: `KEY=value` lines, `#` comments, optional quotes.
 * Real environment variables always win. Checked in order: $JEV_ENV_FILE,
 * ./.env, ~/.config/jev-browser/.env.
 */
export function loadEnvFiles(paths: string[]): void {
  for (const path of paths) {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || line.trim().startsWith("#")) continue;
      const key = match[1];
      if (process.env[key]) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function envPaths(): string[] {
  const explicit = process.env.JEV_ENV_FILE;
  return [
    ...(explicit ? [explicit] : []),
    join(process.cwd(), ".env"),
    join(homedir(), ".config", "jev-browser", ".env"),
  ];
}

export function parseArgs(argv: string[]): Parsed {
  const command = argv[0] ?? "help";
  const flags: Flags = {};
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
    } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) {
      flags[body] = argv[i + 1];
      i += 1;
    } else {
      flags[body] = "true";
    }
  }
  return { command, flags };
}

function readSource(source: string | undefined, name: string): string {
  if (source === undefined) throw new Error(`Missing --${name}`);
  if (source === "-") return readFileSync(0, "utf8");
  return readFileSync(source, "utf8");
}

function readJSON(source: string, name: string): unknown {
  const raw = readSource(source, name).trim();
  if (!raw) throw new Error(`Empty input for --${name}`);
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function fingerprint(page: { url: string; title: string; actions: ObservedAction[] }): string {
  const body = `${page.url}\u0000${page.title}\u0000${page.actions.map((a) => a.node).join(",")}`;
  let hash = 5381;
  for (let i = 0; i < body.length; i += 1) hash = ((hash * 33) ^ body.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

function asPage(value: unknown): PageState {
  // Accept the observe envelope, a bare page object, or a raw snapshot string.
  const record = (
    value && typeof value === "object" && (value as { page?: unknown }).page !== undefined
      ? (value as { page: unknown }).page
      : value
  ) as Partial<PageState> | null;
  if (
    record &&
    typeof record === "object" &&
    typeof record.url === "string" &&
    typeof record.title === "string" &&
    typeof record.text === "string" &&
    Array.isArray(record.actions)
  ) {
    return {
      url: record.url,
      title: record.title,
      text: record.text,
      actions: record.actions as ObservedAction[],
      fingerprint: record.fingerprint,
    };
  }
  throw new Error("--page must be an observe result or a raw snapshot string");
}

/**
 * Accept an `observe` result (or its envelope), a bare page object, or a raw
 * browser snapshot. Raw snapshots get parsed with the same code path, so a
 * harness can pipe a snapshot straight into `step`.
 */
export function pageFromSource(value: unknown, url?: string, title?: string): PageState {
  if (typeof value === "string") {
    const actions = capActions(snapshotToActions(value));
    const page: PageState = { url: url ?? "", title: title ?? "", text: "", actions };
    page.fingerprint = fingerprint(page);
    return page;
  }
  return asPage(value);
}

function operationKind(operation: string): string {
  return operation === "TYPE_TEXT" ? "fill" : operation.toLowerCase();
}

function describeAction(operation: string, action: ObservedAction | undefined) {
  if (!action) return undefined;
  return {
    operation,
    node: action.node,
    kind: operationKind(operation),
    label: action.label,
    role: action.role ?? null,
    value: action.value ?? action.current_value ?? null,
  };
}

export function observeCommand(flags: Flags) {
  const snapshot = readSource(flags.snapshot, "snapshot");
  const url = flags.url ?? "";
  const title = flags.title ?? "";
  const text = flags.text !== undefined ? readSource(flags.text, "text") : "";
  const actions = capActions(snapshotToActions(snapshot));
  const counts: Record<string, number> = {};
  for (const action of actions) counts[action.kind] = (counts[action.kind] ?? 0) + 1;
  const page: PageState = { url, title, text, actions };
  page.fingerprint = fingerprint(page);
  return { page, actions, counts };
}

/** Strip provider echo from a decision before it crosses the harness boundary. */
function publicDecision<T extends { raw_answers?: unknown }>(decision: T): Omit<T, "raw_answers"> {
  const { raw_answers: _drop, ...rest } = decision;
  return rest;
}

export async function decideCommand(flags: Flags) {
  const goal = flags.goal;
  if (!goal) throw new Error("Missing --goal");
  const page = pageFromSource(readJSON(flags.page, "page"), flags.url, flags.title);
  const history = flags.history ? (readJSON(flags.history, "history") as HistoryEntry[]) : [];
  return publicDecision(await choose(page, goal, history));
}

export async function stepCommand(flags: Flags) {
  const goal = flags.goal;
  if (!goal) throw new Error("Missing --goal");
  const page = pageFromSource(readJSON(flags.page, "page"), flags.url, flags.title);
  const history = flags.history ? (readJSON(flags.history, "history") as HistoryEntry[]) : [];
  let textModel: string | null = null;
  const result = await planStep(page, goal, history, {
    textFor: async (context) => {
      const resolved = await fieldText(context, { sessionID: process.env.JEV_SESSION_ID });
      textModel = resolved.meta.model;
      return resolved.text;
    },
  });
  const action = result.operation === "TYPE_TEXT" ? result.choice : null;
  const target = action ? page.actions.find((candidate) => candidate.id === action) : undefined;
  return {
    ...publicDecision(result),
    text_model: textModel,
    action: describeAction(result.operation, target),
  };
}

export async function textCommand(flags: Flags) {
  const context = readJSON(flags.context, "context") as Record<string, unknown>;
  const resolved = await fieldText(context, { sessionID: process.env.JEV_SESSION_ID });
  return { text: resolved.text, model: resolved.meta.model };
}

const HELP = `jev — Jev decisions for any browser harness

  jev observe --snapshot - [--url U] [--title T] [--text -]
  jev decide  --goal G --page - [--history -] [--url U] [--title T]
  jev step    --goal G --page - [--history -] [--url U] [--title T]
  jev text    --context -

Reads "-" from stdin, writes one JSON line to stdout.
Keys: TYPESAFE_API_KEY (required), TEXT_MODEL_API_KEY / ANTHROPIC_API_KEY /
OPENAI_API_KEY (optional text model), or a .env file.`;

export async function main(argv: string[]): Promise<number> {
  loadEnvFiles(envPaths());
  const { command, flags } = parseArgs(argv);
  try {
    let output: unknown;
    switch (command) {
      case "observe":
        output = observeCommand(flags);
        break;
      case "decide":
        output = await decideCommand(flags);
        break;
      case "step":
        output = await stepCommand(flags);
        break;
      case "text":
        output = await textCommand(flags);
        break;
      case "help":
      case "--help":
      case "-h":
        process.stdout.write(`${HELP}\n`);
        return 0;
      default:
        throw new Error(`Unknown command "${command}"`);
    }
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${JSON.stringify({ error: message })}\n`);
    return 2;
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("cli.ts") || entry.endsWith("jev")) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
