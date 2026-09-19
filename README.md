# jev-browser

Jev as the decision step, any browser harness as the hands. Zero runtime dependencies.

A harness-agnostic TypeScript core with a thin OpenCode adapter. Jev
(`TypeSafe System One`) picks one operation and one observed target per cycle;
a small model writes text only for `TYPE_TEXT`. No screenshots in the loop,
visible text only.

## Install (local path)

```jsonc
// opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/Users/amaurya/Documents/GitHub/jev-browser"]
}
```

`skill/SKILL.md` documents the agent loop. `/jev-browse` seeds it in-session.

## Tools

- `jev_observe` — raw MCP snapshot → `{page, actions, counts}`. Parses
  chrome-devtools-mcp (`uid=`) and Playwright (`[ref=]`) snapshots and caps each
  action kind at 100 (the endpoint rejects questions over 255 choices).
- `jev_step` — `{goal, page, history}` → validated decision with `text` resolved
  in the same call. One round trip instead of decide + text.
- `jev_decide` — `{goal, page {url,title,text,actions[]}, history[]}` → Jev decision.
  Key resolution: `TYPESAFE_API_KEY` env → OpenCode `auth.json` (`typesafe`). Optional
  `TYPESAFE_MODEL` (default `jev-latest`).
- `jev_text` — `fieldContext` → `{text}` via small model. Resolution, in order:
  1. `TEXT_MODEL_API_KEY` env (+ `TEXT_MODEL_BASE_URL`, `TEXT_MODEL`, `TEXT_MODEL_REASONING`)
  2. Free OpenCode Zen models, generated inside OpenCode: jev_text keeps one managed helper session
     in a temp location and prefers `muse-spark-1.3-contributor-free`, then the other free models.
     Direct API calls to free models are rejected (Console answers HTTP 403 `FreeTierError`, the Go
     endpoint answers `ModelError`), so this session route is the only way to use them. Free models
     are contributor models: during the free period, submitted data may be used to improve them.
  3. `auth.json` `openrouter` or `deepseek`
  4. `auth.json` `opencode-go` (OpenAI-compatible; sends `x-opencode-session`; defaults to the
     cheap `deepseek-v4-flash`, overridable with `TEXT_MODEL`)
  Throws when none available — never guesses. Set `TEXT_MODEL_API_KEY` to force tier 1; a local
  server also works there with any placeholder key
  (`TEXT_MODEL_BASE_URL=http://localhost:11434/v1`, `TEXT_MODEL=<model>`).

Upstream OpenRouter example: `TEXT_MODEL_BASE_URL=https://openrouter.ai/api/v1`,
`TEXT_MODEL=inception/mercury-2.5`, `TEXT_MODEL_REASONING=none`.

## Loop

```
fast path: snapshot → jev_observe → jev_step → verify → act → repeat   (one code-mode script)
steps:     snapshot (chrome MCP → fallback brave) → jev_step / jev_decide → verify → act → wait
until DONE / BLOCKED / 60 steps
```

Run the fast path inside a single code-mode script so raw snapshots and action
arrays stay in the script, not the model context. See `skill/SKILL.md`.
Core (`src/core/`) has no OpenCode imports and is reusable from any harness or
plain CLI.

## Dev

```
node --test test/
```

No runtime dependencies (Node >= 18, native `fetch`).
