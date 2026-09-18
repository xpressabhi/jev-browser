# jev-browser

Jev as the decision step, any browser harness as the hands. Zero runtime dependencies.

Port of the `browser-use/jev-ultrafast` policy (MIT) to a harness-agnostic
TypeScript core + thin OpenCode adapter. Jev (`TypeSafe System One`) picks one
operation and one observed target per cycle; a small model writes text only for
`TYPE_TEXT`. No screenshots in the loop, visible text only.

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
- `jev_text` — `fieldContext` → `{text}` via small OpenAI-compatible model.
  Key resolution, in order:
  1. `TEXT_MODEL_API_KEY` env (+ `TEXT_MODEL_BASE_URL`, `TEXT_MODEL`, `TEXT_MODEL_REASONING`)
  2. `auth.json` `openrouter` or `deepseek`
  3. `auth.json` `opencode-go` (OpenAI-compatible; sends `x-opencode-session`, defaults `glm-5.3-flash`)
  Throws when none available — never guesses.

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
