import { readFileSync } from "node:fs";

/**
 * Last-resort credential resolution: OpenCode stores provider credentials in
 * $XDG_DATA_HOME/opencode/auth.json (default ~/.local/share/opencode/auth.json).
 * The background service often lacks the user shell env, so read it there.
 */
export function authFilePaths(): string[] {
  const home = process.env.HOME ?? "";
  const xdg = process.env.XDG_DATA_HOME;
  const roots = xdg ? [xdg] : [];
  roots.push(`${home}/.local/share`);
  return roots.map((r) => `${r}/opencode/auth.json`);
}

export function readAuthFile(path: string): Record<string, unknown> | undefined {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return typeof data === "object" && data ? data : undefined;
  } catch {
    return undefined;
  }
}

/** Try provider ids in order; returns the first string key found. */
export function readProviderKey(providerIDs: string[], paths?: string[]): string | undefined {
  for (const path of paths ?? authFilePaths()) {
    const data = readAuthFile(path);
    if (!data) continue;
    for (const id of providerIDs) {
      const entry = (data as Record<string, { key?: unknown }>)[id];
      const key = entry?.key;
      if (typeof key === "string" && key) return key;
    }
  }
  return undefined;
}
