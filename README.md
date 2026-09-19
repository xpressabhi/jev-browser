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
snapshot (chrome MCP → fallback brave) → jev_decide → [jev_text] → verify → act → wait → repeat
until DONE / BLOCKED / 60 steps
```

See `skill/SKILL.md`. Core (`src/core/`) has no OpenCode imports and is reusable
from any harness or plain CLI.

## Dev

```
node --test test/
```

No runtime dependencies (Node >= 18, native `fetch`).
