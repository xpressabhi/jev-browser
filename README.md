# jev-browser

Jev as the decision step, any browser harness as the hands. Zero runtime
dependencies.

One decision core, three harnesses. Jev (`TypeSafe System One`) picks one
operation and one observed target per cycle; a small model writes text only for
`TYPE_TEXT`. No screenshots in the loop, visible text only.

| Harness | Entry point | Install |
|---|---|---|
| OpenCode | plugin (code-mode tools) | `"plugins": ["/path/to/jev-browser"]` in `opencode.jsonc` |
| Claude Code | skill + `jev` CLI | `adapters/claude/install.sh` |
| Codex | skill + `jev` CLI | `adapters/codex/install.sh` |

Only the OpenCode plugin is wired up by default. The Claude and Codex adapters
ship in `adapters/` but install nothing until you run their script.

`TYPESAFE_API_KEY` is the only required secret.

## OpenCode

```jsonc
// opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/path/to/jev-browser"]
}
```

Registers in the `jev` namespace: `jev_observe`, `jev_step`, `jev_decide`,
`jev_text`. Also loads the `jev-browser` skill (`skill/SKILL.md`,
auto-invoked), a browser policy in the system prompt, and the `/jev-browse`
command. Run `/jev-browse` to seed the loop, or just ask for browser work.

Text values reuse the session's selected model through a managed helper
session; a free OpenCode Zen model is the fallback. No second key needed.

## Claude Code / Codex

```sh
./adapters/claude/install.sh   # ~/.claude/skills + ~/.claude/CLAUDE.md
./adapters/codex/install.sh    # ~/.codex/skills + ~/.codex/AGENTS.md
```

Each installs the skill, appends the browser policy (marker-guarded, safe to
re-run), and puts a `jev` wrapper on `~/.local/bin`. The skill drives the CLI:
snapshots stay in files, only decision JSON enters context.

```sh
SNAP=$(mktemp); $BROWSER take_snapshot > "$SNAP"
DEC=$(jev observe --snapshot "$SNAP" --url "$URL" --title "$TITLE" \
      | jev step --goal "$GOAL" --page -)
# execute DEC.action via the browser MCP, append history, repeat
```

## CLI

`jev` decides; it never touches a browser. Every command reads `-` from stdin
and writes one compact JSON line to stdout (`{error}` + exit 2 on failure).

```
jev observe --snapshot - [--url U] [--title T] [--text -]
  → {page:{url,title,text,fingerprint}, actions[], counts{}}
jev decide  --goal G --page - [--history -] [--url U] [--title T]
  → {choice, operation, target, confidence, probabilities, latency_ms}
jev step    --goal G --page - [--history -]
  → decide output + {text, text_model, action:{operation,node,kind,label,role,value}}
jev text    --context -
  → {text, model}
```

`--page -` accepts an `observe` result or a raw chrome/Playwright snapshot.
Node >= 22.6 (native TypeScript; no build step).

## Loop

### Fast path (recommended)

One script per task; raw snapshots and action arrays stay in files, not the
model context.

```sh
GOAL="Search Wikipedia for OpenAI and open the article"
for i in $(seq 1 20); do
  $BROWSER snapshot > "$SNAP"
  DEC=$(jev observe --snapshot "$SNAP" --url "$URL" --title "$TITLE" \
        | jev step --goal "$GOAL" --page - --history "$HIST")
  # TYPE_TEXT → fill with DEC.text, wait <=200ms for suggestions
  # CLICK / SELECT → act on DEC.action.node, wait <=50ms
  # exit on DONE / BLOCKED
done
```

### Step by step

1. Snapshot with the browser MCP; fallback chain is the harness's own.
2. `jev step` (preferred) or `jev decide` + `jev text`.
3. Verify freshness and that the target node is still visible; act; wait.
4. Exit on `DONE` (visible evidence of every requirement) or `BLOCKED`; hard
   stop at 60 steps. Each decision is consumed once — a retry must not
   double-click. Three no-change non-wait actions in a row stop the run.

## Tools (OpenCode)

- `jev_observe` — `{snapshot, url?, title?, text?}` → `{page, actions, counts}`.
  Parses chrome-devtools-mcp (`uid=`) and Playwright (`[ref=]`) snapshots, caps
  each action kind at 100, and always adds `SCROLL_UP/SCROLL_DOWN/WAIT`.
- `jev_step` — `{goal, page {url,title,text,actions[]}, history?}` → validated
  decision with `text` resolved in the same call for `TYPE_TEXT`.
- `jev_decide` — `{goal, page, history?}` →
  `{choice, operation, target, probabilities, latency_ms}`.
- `jev_text` — `fieldContext {goal, field, page, recent_actions}` →
  `{text, model}`.

## Text model resolution

First hit wins, every harness:

1. `TEXT_MODEL_API_KEY` env (+ `TEXT_MODEL_BASE_URL`, `TEXT_MODEL`,
   `TEXT_MODEL_REASONING`) — any OpenAI-compatible endpoint, including a local
   server (`http://localhost:11434/v1`, `TEXT_MODEL=<model>`).
2. OpenCode only: the calling session's selected model, via a managed helper
   session.
3. `ANTHROPIC_API_KEY` — Haiku-class model through the Messages API.
4. `OPENAI_API_KEY` — `gpt-4o-mini`-class through Chat Completions.
5. `auth.json` `openrouter` / `deepseek` / `opencode-go`.
6. Throws — never guesses.

Keys can live in `./.env` or `~/.config/jev-browser/.env` (`JEV_ENV_FILE`
overrides the search path). Real environment variables always win.

Upstream OpenRouter example: `TEXT_MODEL_BASE_URL=https://openrouter.ai/api/v1`,
`TEXT_MODEL=inception/mercury-2.5`, `TEXT_MODEL_REASONING=none`.

## Limits

- **255 choices per question** — the core caps each action kind at 100 candidates
  deterministically. Scroll and re-observe to reach elements beyond the cap.
- **Text needs a model** — `jev text` / `jev step` throw when nothing resolves;
  values are never hardcoded or guessed.
- **One decision per snapshot** — a decision is tied to the nodes it was chosen
  from. If the page changed, re-observe and decide again.
- **Visible text only** — no screenshots; page text is capped near 6,000
  characters and treated as untrusted data, never as instructions.

## Layout

```
src/core/            harness-agnostic decision core (no harness imports)
src/anthropic.ts     Messages API text adapter
src/cli.ts           cross-harness CLI (bin: jev)
src/harness/         opencode plugin adapter + session text
skill/SKILL.md       the skill every harness installs
adapters/            claude/ and codex/ install scripts + shared policy
```

## Dev

```
npm test          # node --test test/*.test.ts
npm run typecheck
```

No runtime dependencies (Node >= 22.6, native `fetch`, native TypeScript).
`src/core/` has no harness imports and is reusable from any harness or plain CLI.
