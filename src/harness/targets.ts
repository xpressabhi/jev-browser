// Resolve which browser MCP to use. Pure function — easy to test.
export type BrowserTarget = "chrome" | "brave" | "auto";

export function resolveTarget(preferred: BrowserTarget, available: string[]): string {
  if (preferred !== "auto") {
    if (available.includes(preferred)) return preferred;
    throw new Error(`Browser "${preferred}" unavailable (have: ${available.join(", ") || "none"}).`);
  }
  for (const t of ["chrome", "brave"]) {
    if (available.includes(t)) return t;
  }
  throw new Error("No browser MCP available (need chrome and/or brave).");
}

// Truncate page text the way the agent loop does: visible text only.
export function truncateText(text: string, limit = 6000): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit);
}
