# jev-browser

Jev as the decision step, any browser harness as the hands. Zero runtime
dependencies.

One decision core, any harness. Jev (`TypeSafe System One`) picks one operation
and one observed target per cycle; a small model writes text only for
`TYPE_TEXT`. No screenshots in the loop by default — opt-in visual mode passes
one screenshot per cycle so Box questions can return pixel coordinates when a
page has no clickable DOM nodes. The decision core
and the `jev` CLI carry no harness imports — OpenCode, Claude Code, and Codex
are just ways to wire it up.

`TYPESAFE_API_KEY` is the only required secret.

## Zero-touch setup

Paste this one line into any coding agent that can run shell commands:

```text
Set up jev-browser from https://xpressabhi.github.io/jev-browser/install.md and follow those instructions.
```

The agent fetches [install.md](https://xpressabhi.github.io/jev-browser/install.md),
detects the harness, installs the matching adapter, asks for the TypeSafe API
key, and verifies the setup. Prefer to do it by hand? The steps below are the
manual equivalent.

## Try it in 60 seconds

After install:

```sh
./src/cli.ts observe --snapshot snapshot.txt --url "$URL" --title "$TITLE" \
  | ./src/cli.ts step --goal "Search Wikipedia for OpenAI" --page -
```

`observe` parses a chrome-devtools-mcp (`uid=`) or Playwright (`[ref=]`)
accessibility snapshot; `step` returns the next operation, the observed node to
act on, and the exact text for `TYPE_TEXT`. Nothing touches a browser — you (or
your harness) execute the decision. Node >= 22.6, no build step.

## Install

Prerequisites: Node >= 22.6, `TYPESAFE_API_KEY`, and a browser MCP (or any
browser tool the harness can drive). The CLI is what every harness uses; the
OpenCode plugin additionally exposes code-mode tools.

```sh
git clone https://github.com/xpressabhi/jev-browser && cd jev-browser
npm link                 # optional: puts `bin: jev` on PATH (./src/cli.ts works too)
```

Make the key available once: `export TYPESAFE_API_KEY=...`, or write
`./.env` / `~/.config/jev-browser/.env` (real environment variables win).

### OpenCode

1. Point the config at the checkout (an absolute path is safest; `.` works when
   OpenCode runs in this directory):
   ```jsonc
   // opencode.jsonc
   { "$schema": "https://opencode.ai/config.json",
     "plugins": ["/path/to/jev-browser"] }
   ```
2. Restart OpenCode and check the `jev` namespace: `jev_observe`, `jev_step`,
   `jev_decide`, `jev_text`.
3. Run `/jev-browse` or just ask for browser work. The plugin also installs the
   `jev-browser` skill, a browser policy in the system prompt, and registers the
   skill in code mode so raw snapshots stay out of context.

### Claude Code

1. `./adapters/claude/install.sh`
2. That writes the skill to `~/.claude/skills/jev-browser/SKILL.md`, appends the
   browser policy to `~/.claude/CLAUDE.md` (marker-guarded, safe to re-run), and
   puts a `jev` wrapper in `~/.local/bin`.
3. Ensure `~/.local/bin` is on PATH, then restart Claude Code. The skill
   auto-invokes on browser work; snapshots are piped through files.

### Codex

1. `./adapters/codex/install.sh`
2. That writes the skill to `~/.codex/skills/jev-browser/SKILL.md`, appends the
   browser policy to `~/.codex/AGENTS.md` (marker-guarded, safe to re-run), and
   puts a `jev` wrapper in `~/.local/bin`.
3. Restart Codex. Verify the CLI with `jev help`.

### Any other harness (Cursor, Windsurf, Gemini CLI, Cline, …)

1. Make `jev` reachable — `npm link`, the wrapper from an adapter script, or a
   shell function: `jev() { node /path/to/jev-browser/src/cli.ts "$@"; }`.
2. Copy `skill/SKILL.md` into wherever that harness keeps skills or rules
   (`~/.cursor/rules/`, `~/.gemini/skills/`, an `AGENTS.md`, …), or paste the
   fragment from `adapters/policy.md` into its system rules.
3. Use the CLI loop: snapshot with the harness browser tool, pipe through
   `jev observe` → `jev step`, act on `DEC.action.node`, repeat until `DONE` or
   `BLOCKED`.

## Harness matrix

| Harness | What to add | How |
|---|---|---|
| Any harness with a shell | `jev` CLI | `./src/cli.ts`, `npm link`, or a shell function |
| OpenCode | plugin: code-mode tools, skill, browser policy, `/jev-browse` | `"plugins": ["/path/to/jev-browser"]` in `opencode.jsonc` |
| Claude Code | skill + policy + `jev` CLI | `./adapters/claude/install.sh` |
| Codex | skill + policy + `jev` CLI | `./adapters/codex/install.sh` |

The Claude and Codex adapters ship in `adapters/` but install nothing until you
run their script. The OpenCode plugin registers `jev_observe`, `jev_step`,
`jev_decide`, and `jev_text` in code mode so raw snapshots never enter the
model context.

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

## Visual mode (images + Box)

Pass a screenshot and Jev can see the page and return pixel coordinates for
elements a snapshot describes poorly. Opt-in per call; text-only cycles are
unchanged.

```sh
# save a viewport screenshot with the browser MCP, then:
jev step --goal G --page - --image shot.png [--box always] [--image-scale 2]
```

- **Phase 1** asks the usual operation/target questions with the screenshot in
  the request state, so choices are grounded in what is rendered. When the page
  offers no clickable DOM candidates, `CLICK` stays on the menu as a visual
  target.
- **Phase 2** runs only for that visual target (or for node targets with
  `--box always`): one Box question locates the chosen element and one Noul
  reports whether it is visible. The decision gains `image.box` (fractions),
  `image.pixel` (image-space rect + center), `image.present`, and
  `image.confidence`. `--image-scale 2` adds `image.viewport` (CSS px for the
  box center; for full-page screenshots add the scroll offset yourself).

How to act: **node present → act on the node**; `action.visual` → click
`image.pixel.center` (or `image.viewport`), gated on `image.present`. There is
no official presence threshold; start at 0.5 and tune on your pages.

Limits: PNG/JPEG, 280–1568 px per side, ≤16 MiB — resize or use a viewport
screenshot. Box questions need Jev 1.14, so image mode defaults the model to
`jev-preview` unless `TYPESAFE_MODEL` is set; a pinned 1.13 name fails fast
with the fix. Cost: one extra model call per visual cycle; the second
request's `usage` / `latency_ms` are reported under `image`. If the box call
fails, a node-target decision survives with `image.error`; a visual target
fails outright rather than guess a click point.

## CLI

`jev` decides; it never touches a browser. Every command reads `-` from stdin
and writes one compact JSON line to stdout (`{error}` + exit 2 on failure).

```
jev observe --snapshot - [--url U] [--title T] [--text -]
  → {page:{url,title,text,fingerprint}, actions[], counts{}}
jev decide  --goal G --page - [--history -] [--url U] [--title T]
            [--image shot.png] [--box auto|always] [--image-scale S]
  → {choice, operation, target, confidence, probabilities, latency_ms}
jev step    --goal G --page - [--history -]
            [--image shot.png] [--box auto|always] [--image-scale S]
  → decide output + {text, text_model, action:{operation,node,kind,label,role,value,visual}}
jev text    --context -
  → {text, model}
```

--image passes a PNG/JPEG screenshot into the decision (visual mode).
--box always also asks for the chosen node element's box, not just visual targets.

`--page -` accepts an `observe` result or a raw chrome/Playwright snapshot.
`observe` caps each action kind at 100 (the endpoint rejects questions with over
255 choices) and always adds `SCROLL_UP/SCROLL_DOWN/WAIT`; scroll and re-observe
to reach elements beyond the cap.

### Plugin tools (OpenCode)

- `jev_observe` — `{snapshot, url?, title?, text?}` → `{page, actions, counts}`.
- `jev_step` — `{goal, page {url,title,text,actions[]}, history?, imagePath?, box?, imageScale?}` →
  validated decision with `text` resolved in the same call for `TYPE_TEXT` and
  `visual` set for coordinate targets.
- `jev_decide` — `{goal, page, history?, imagePath?, box?}` →
  `{choice, operation, target, probabilities, latency_ms, image?}`.
- `jev_text` — `fieldContext {goal, field, page, recent_actions}` →
  `{text, model}`.

## Text model resolution

You normally configure nothing. In OpenCode the text value for `TYPE_TEXT`
comes from the session's selected model — no second key. Every other tier is a
fallback for harnesses without a session model, or an explicit override:

1. `TEXT_MODEL_API_KEY` env (+ `TEXT_MODEL_BASE_URL`, `TEXT_MODEL`,
   `TEXT_MODEL_REASONING`) — opt-in override; any OpenAI-compatible endpoint,
   including a local server (`http://localhost:11434/v1`, `TEXT_MODEL=<model>`).
2. OpenCode only: the calling session's selected model, via a managed helper
   session. This is the default; set nothing.
3. `ANTHROPIC_API_KEY` — Haiku-class model through the Messages API (Claude Code
   sessions usually already carry this).
4. `OPENAI_API_KEY` — `gpt-4o-mini`-class through Chat Completions (Codex
   sessions usually already carry this).
5. `auth.json` `openrouter` / `deepseek` / `opencode-go`.
6. Throws — never guesses.

So the only key you must supply is `TYPESAFE_API_KEY`. Tiers 3–4 reuse a host
key that is already in the environment; tier 1 exists to pin a specific or
cheap model, and tiers 1–5 can also live in `./.env` or
`~/.config/jev-browser/.env` (`JEV_ENV_FILE` overrides the search path — real
environment variables always win).

Local-model example: `TEXT_MODEL_BASE_URL=http://localhost:11434/v1`,
`TEXT_MODEL=llama3`, `TEXT_MODEL_API_KEY=unused`.
Upstream OpenRouter example: `TEXT_MODEL_BASE_URL=https://openrouter.ai/api/v1`,
`TEXT_MODEL=inception/mercury-2.5`, `TEXT_MODEL_REASONING=none`.

## Limits

- **255 choices per question** — the core caps each action kind at 100 candidates
  deterministically. Scroll and re-observe to reach elements beyond the cap.
- **Text needs a model** — `jev text` / `jev step` throw when nothing resolves;
  values are never hardcoded or guessed.
- **One decision per snapshot** — a decision is tied to the nodes it was chosen
  from. If the page changed, re-observe and decide again.
- **Visible text only by default** — screenshots ride along only when `--image`
  is passed; page text is capped near 6,000 characters and treated as
  untrusted data, never as instructions.
- **Images are bounded** — one screenshot per request, PNG/JPEG, 280–1568 px
  per side, ≤16 MiB; Box questions need Jev 1.14 (`jev-preview`).

## Layout

```
src/core/            harness-agnostic decision core (no harness imports)
src/core/image.ts    screenshot prep + box/pixel geometry (visual mode)
src/anthropic.ts     Messages API text adapter
src/cli.ts           cross-harness CLI (bin: jev)
src/harness/         opencode plugin adapter + session text
skill/SKILL.md       the skill Claude Code and Codex install
adapters/            claude/ and codex/ install scripts + shared policy
```

## Dev

```
npm test          # node --test test/*.test.ts
npm run typecheck
```

No runtime dependencies (Node >= 22.6, native `fetch`, native TypeScript).
`src/core/` has no harness imports and is reusable from any harness or plain CLI.
