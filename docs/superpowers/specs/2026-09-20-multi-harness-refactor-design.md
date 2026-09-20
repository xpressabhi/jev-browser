# Multi-harness refactor — design

Date: 2026-09-20
Status: approved (design), pending spec review

## Goal

Make jev-browser usable from OpenCode, Claude Code, and Codex from one codebase,
with a single required secret (`TYPESAFE_API_KEY`). Core stays harness-agnostic;
each harness gets a thin shim.

## Architecture

```
src/core/           unchanged contract + small additions
  elements.ts       snapshot → actions, cap            (exists)
  jev.ts            choose(operation + target)         (exists)
  step.ts           planStep                           (exists)
  text.ts           OpenAI-compatible text client      (generalized profile)
  auth.ts           secret resolution                  (extends)
  loop.ts           Loop class                         (exists)

src/cli.ts          new — cross-harness entry point
src/harness/
  opencode.ts       thin OpenCode plugin adapter
  opencode-text.ts  session-model text (kept)
  targets.ts        browser target resolution (kept)
adapters/
  claude/           SKILL.md + install.sh
  codex/            SKILL.md + install.sh
```

Flow: harness shim → CLI (or direct core import for OpenCode) → core → TypeSafe /
text model. The CLI never touches a browser; the harness's browser MCP executes
returned operations.

## Text model resolution

First hit wins, every harness:

1. `TEXT_MODEL_API_KEY` (+ `TEXT_MODEL_BASE_URL`, `TEXT_MODEL`) — explicit
   override; any OpenAI-compatible endpoint, including local servers.
2. OpenCode only: active session's selected model via `session.generate` in the
   managed helper session (`src/harness/opencode-text.ts`).
3. `ANTHROPIC_API_KEY` → Haiku-class model through the Messages API
   (`src/harness/anthropic.ts` — new; core stays OpenAI-shaped).
4. `OPENAI_API_KEY` → `gpt-4o-mini`-class through the core client.
5. `auth.json` openrouter / deepseek / opencode-go (existing fallback).
6. Throw. Never guesses.

`TYPESAFE_API_KEY` (or `auth.json` `typesafe`) remains the only mandatory secret.

## CLI contract

`bin: { jev: "src/cli.ts" }`, Node >= 22 with native TS (`--experimental-strip-types`
is default-on in Node 23+; keep it in the shebang for 22).

Commands (all read `-` = stdin; all write one compact JSON line to stdout,
`{error}` plus exit 2 on failure):

```
jev observe --snapshot - [--url U] [--title T] [--text -]
  → {page:{url,title,text,fingerprint}, actions[], counts{}}

jev decide --goal G --page - [--history -]
  → {choice, operation, target, confidence, probabilities, latency_ms}

jev step --goal G --page - [--history -]
  → decide output + {text, text_model, action:{node,kind,label,role,value}}

jev text --goal G --context -
  → {text, model}
```

`--page -` accepts either an observe result or a raw browser snapshot; raw
snapshots are parsed first (harness convenience, same code path).

## Kernel changes

- `src/core/text.ts`: `resolveTextProfile` gains an Anthropic branch that returns
  a provider-tagged profile; the request path dispatches on `provider`
  (`"openai" | "anthropic"`). `fieldText` signature unchanged.
- New `src/harness/anthropic.ts`: builds a Messages API request
  (`max_tokens`, `system`, one user message), parses `content[0].text` through
  `parseFieldValue` so the strict `{text}` contract still holds.
- `src/cli.ts`: argument parsing (no dependency), stdin helpers, calls core only.
- `src/harness/opencode.ts`: thin plugin — registers `jev_observe`, `jev_decide`,
  `jev_text`, `jev_step`, the skill, the `/jev-browse` command, and the browser
  policy hook, all importing core. `index.ts` re-exports it so existing
  `opencode.jsonc` plugin paths keep working.
- Text tier for OpenCode: prefer `TEXT_MODEL_API_KEY` when set, else
  `nativeFieldText` with the calling `sessionID`, else core resolution.

## Harness installs

| Harness | Entry point | Install |
|---|---|---|
| OpenCode | plugin path in `opencode.jsonc` | unchanged |
| Claude Code | `~/.claude/skills/jev-browser/SKILL.md` + rule fragment | `adapters/claude/install.sh` |
| Codex | `~/.codex/skills/jev-browser/SKILL.md` + `AGENTS.md` fragment | `adapters/codex/install.sh` |

Both install scripts: copy/refresh the skill directory, append an idempotent
browser-policy fragment to the harness rules file (`~/.claude/CLAUDE.md`,
`~/.codex/AGENTS.md`), and ensure `jev` resolves (repo-relative symlink into
`~/.local/bin`, or PATH instructions). Both SKILL.md files share one source in
`skill/`, since the frontmatter format is identical.

Skill loop (Claude/Codex), snapshots stay in files:

```bash
SNAP=$(mktemp); $BROWSER take_snapshot > "$SNAP"
PAGE=$(jev observe --snapshot "$SNAP" --url "$URL" --title "$TITLE")
DEC=$(echo "$PAGE" | jev step --goal "$GOAL" --page -)
# execute DEC.action via the harness browser MCP, append to history, repeat
```

The skill states: never echo snapshots or action arrays into context; act only on
the returned `action.node`; one decision per snapshot; re-observe after any
harness action.

## Testing

- Existing core tests unchanged.
- New `test/cli.test.ts`: stdin/stdout contract, raw-snapshot convenience path,
  error exit code 2, no partial output on failure.
- New `test/anthropic.test.ts`: request shape, `content[0].text` extraction,
  strict `{text}` parse.
- New `test/text-profile.test.ts` cases for resolution order (3–5, 6).
- `npm test` + `npm run typecheck` green before the refactor is called done.

## Out of scope

- CDP-driven browsing inside the CLI.
- npm publishing.
- Changes to the OpenCode tool surface (names, schemas, namespaces unchanged).
