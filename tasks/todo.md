# TODO — multi-harness refactor

Plan: `tasks/plan.md` · Spec: `docs/superpowers/specs/2026-09-20-multi-harness-refactor-design.md`

## Phase 1: Text provider seam

- [x] Task 1: Provider-tagged text profiles + `src/harness/anthropic.ts`
- [x] Task 2: Resolution-order tests

**Checkpoint:** `npm test` + `npm run typecheck` green. ✅ (52 tests)

## Phase 2: CLI

- [ ] Task 3: `src/cli.ts`
  - Acceptance: `observe|decide|step|text`; `-` = stdin; one JSON line on stdout; `{error}` + exit 2 on failure; `--page` accepts raw snapshot or observe output.
  - Verify: manual pipe against `examples/wiki.ts`-style snapshot
  - Files: `src/cli.ts`, `package.json` (`bin`, shebang)

- [ ] Task 4: `test/cli.test.ts`
  - Acceptance: observe parses chrome + playwright snapshots; malformed input exits 2 with no stdout JSON; step/decide injectable via env (`TEXT_MODEL_*` not needed for observe test).
  - Verify: `node --test test/cli.test.ts`
  - Files: `test/cli.test.ts`

**Checkpoint:** CLI round trip works with a real recorded snapshot.

## Phase 3: OpenCode adapter

- [ ] Task 5: `src/harness/opencode.ts`
  - Acceptance: same four tools, same schemas; text tier: `TEXT_MODEL_API_KEY` → active session model → free Zen helper → core resolution; `sessionID` threaded from tool context.
  - Verify: `npm run typecheck`, plugin loads in user config (manual)
  - Files: `src/harness/opencode.ts`, `src/harness/opencode-text.ts`

- [ ] Task 6: `index.ts` shim
  - Acceptance: existing `opencode.jsonc` plugin path still resolves; no behavior change.
  - Verify: restart OpenCode, tools present (manual)
  - Files: `index.ts`

**Checkpoint:** OpenCode tools work end-to-end on a live page.

## Phase 4: Claude + Codex adapters, docs

- [ ] Task 7: CLI-flavored `skill/SKILL.md`
  - Acceptance: frontmatter (`name`, `description`) + CLI loop with shell pipes; snapshot never echoed into context.
  - Verify: frontmatter parses, mirrors Codex/Claude formats
  - Files: `skill/SKILL.md`

- [ ] Task 8: installers
  - Acceptance: idempotent (marker-guarded appends), copies skill to `~/.claude/skills/` and `~/.codex/skills/`, ensures `jev` on PATH.
  - Verify: run twice, `git diff` clean on second run
  - Files: `adapters/policy.md`, `adapters/claude/install.sh`, `adapters/codex/install.sh`

- [ ] Task 9: docs + spec delta
  - Acceptance: README has one quickstart per harness; spec mentions `src/harness/anthropic.ts` (not `src/adapters/`).
  - Verify: read-through
  - Files: `README.md`, `docs/superpowers/specs/2026-09-20-multi-harness-refactor-design.md`

**Checkpoint:** `npm test` + `npm run typecheck` green; both install scripts idempotent.
