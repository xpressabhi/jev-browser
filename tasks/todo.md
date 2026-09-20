# TODO — multi-harness refactor

Plan: `tasks/plan.md` · Spec: `docs/superpowers/specs/2026-09-20-multi-harness-refactor-design.md`

## Phase 1: Text provider seam

- [x] Task 1: Provider-tagged text profiles + `src/harness/anthropic.ts`
- [x] Task 2: Resolution-order tests

**Checkpoint:** `npm test` + `npm run typecheck` green. ✅ (52 tests)

## Phase 2: CLI

- [x] Task 3: `src/cli.ts`
- [x] Task 4: `test/cli.test.ts`

**Checkpoint:** CLI round trip works with a real recorded snapshot. ✅ (live TypeSafe decision + text verified)

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

- [x] Task 7: CLI-flavored `skill/SKILL.md`
- [x] Task 8: installers
- [x] Task 9: docs + spec delta

**Checkpoint:** `npm test` + `npm run typecheck` green; both install scripts idempotent.
