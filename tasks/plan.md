# Implementation Plan: Multi-harness refactor (OpenCode + Claude Code + Codex)

## Overview

Split jev-browser into a harness-agnostic core, a cross-harness CLI (`bin: jev`),
a thin OpenCode plugin, and installable skill shims for Claude Code and Codex.
Add Anthropic/OpenAI host-key text tiers so `TYPESAFE_API_KEY` stays the only
mandatory secret, and make OpenCode reuse the selected session model for
`TYPE_TEXT` by default. See `docs/superpowers/specs/2026-09-20-multi-harness-refactor-design.md`.

## Architecture Decisions

- Core (`src/core/`) stays dependency-free and harness-free; the CLI is the
  second entry point to the same functions the plugin uses.
- Text profiles gain `provider: "openai" | "anthropic"`; the Anthropic request
  builder lives in `src/anthropic.ts` so core stays OpenAI-shaped.
- Text resolution order: `TEXT_MODEL_*` → OpenCode session model (adapter) →
  `ANTHROPIC_API_KEY` → `OPENAI_API_KEY` → `auth.json` → throw.
- No build step: Node 22+ runs `.ts` via `--experimental-strip-types`.
- OpenCode tool surface is unchanged (names, schemas, namespaces).

## Task List

### Phase 1: Text provider seam
- [ ] Task 1: Provider-tagged text profiles + Anthropic adapter
- [ ] Task 2: Resolution-order tests (host keys, auth.json, throw)

### Checkpoint: Text seam
- [ ] `npm test` + `npm run typecheck` green

### Phase 2: CLI
- [ ] Task 3: `src/cli.ts` with observe/decide/step/text, JSON contract, exit 2
- [ ] Task 4: CLI contract tests (`test/cli.test.ts`)

### Checkpoint: CLI
- [ ] `echo '<snapshot>' | node src/cli.ts observe --snapshot -` works
- [ ] manual: `jev step` round trip against a recorded snapshot

### Phase 3: OpenCode adapter
- [ ] Task 5: Move plugin to `src/harness/opencode.ts`, reuse session model
- [ ] Task 6: `index.ts` re-export shim; existing config path keeps working

### Checkpoint: OpenCode
- [ ] plugin loads in the user's config; `jev_step` uses the session model

### Phase 4: Claude + Codex adapters and docs
- [ ] Task 7: CLI-flavored `skill/SKILL.md` (frontmatter added)
- [ ] Task 8: `adapters/claude/install.sh`, `adapters/codex/install.sh`,
      shared policy fragment, `bin`/shebang in package.json
- [ ] Task 9: README harness matrix; spec delta (`src/anthropic.ts`)

### Checkpoint: Complete
- [ ] `npm test` + `npm run typecheck` green
- [ ] both install scripts are idempotent
- [ ] OpenCode plugin still loads (manual)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Node 22 needs the strip-types flag | Med | shebang includes `--experimental-strip-types`; README notes Node 22+ |
| Host-key tier silently spends credits | Med | resolution logs `text_model` in every response; README documents order |
| OpenCode behavior drift while moving code | High | tool schemas copied verbatim; typecheck + existing tests |
| Install scripts stomp user rules files | Med | append-only, marker-guarded (`# >>> jev-browser`) |

## Open Questions

- None blocking.
