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
  "plugins": ["/path/to/jev-browser"]
}
```

Registers in the `jev` namespace: `jev_observe`, `jev_step`, `jev_decide`,
`jev_text`. Also loads the `jev-browser` skill (`skill/SKILL.md`, auto-invoked),
a browser policy in the system prompt, and the `/jev-browse` command. Run
`/jev-browse` to seed the loop, or just ask for browser work.

## Loop

### Fast path (recommended)

One code-mode script per task; raw snapshots and action arrays stay in the
script, not the model context.

```js
const goal = "Search Wikipedia for OpenAI and open the article";
const history = [];
let step;
for (let i = 0; i < 20; i++) {
  const snapshot = await tools.chrome.take_snapshot();          // fallback: brave
  const observed = JSON.parse(await tools.jev.observe({ snapshot }));
  step = JSON.parse(await tools.jev.step({ goal, page: observed.page, history }));
  if (step.operation === "DONE" || step.operation === "BLOCKED") break;
  // verify freshness + target visible, then act via the MCP:
  //   TYPE_TEXT → fill with step.text, wait <=200ms for suggestions
  //   CLICK / SELECT → act, wait <=50ms
  history.push({ action: step.operation, kind: step.kind, text: step.text, page_changed: null });
}
```

### Step by step

1. Snapshot with the `chrome` MCP; fallback `brave`.
2. `jev_step` (preferred) or `jev_decide` + `jev_text`.
3. Verify freshness and that the target ref is still visible; act; wait.
4. Exit on `DONE` (visible evidence of every requirement) or `BLOCKED`; hard
   stop at 60 steps. Each decision is consumed once — a retry must not
   double-click. Three no-change non-wait actions in a row stop the run.

## Tools

- `jev_observe` — `{snapshot, url?, title?, text?}` → `{page, actions, counts}`.
  Parses chrome-devtools-mcp (`uid=`) and Playwright (`[ref=]`) snapshots, caps
  each action kind at 100, and always adds `SCROLL_UP/SCROLL_DOWN/WAIT`.
- `jev_step` — `{goal, page {url,title,text,actions[]}, history?}` → validated
  decision with `text` resolved in the same call for `TYPE_TEXT`. One round trip
  instead of decide + text.
- `jev_decide` — `{goal, page, history?}` →
  `{choice, operation, target, probabilities, latency_ms}`. Key resolution:
  `TYPESAFE_API_KEY` env → OpenCode `auth.json` (`typesafe`). Optional
  `TYPESAFE_MODEL` (default `jev-latest`).
- `jev_text` — `fieldContext {goal, field, page, recent_actions}` →
  `{text, model}`.

### Text model resolution

`jev_text` and the text half of `jev_step` resolve, in order:

1. `TEXT_MODEL_API_KEY` env (+ `TEXT_MODEL_BASE_URL`, `TEXT_MODEL`, `TEXT_MODEL_REASONING`)
2. Free OpenCode Zen models, generated inside OpenCode: jev_text keeps one managed helper session
   in a temp location and prefers `muse-spark-1.3-contributor-free`, then the other free models.
   Direct API calls to free models are rejected (Console answers HTTP 403 `FreeTierError`, the Go
   endpoint answers `ModelError`), so this session route is the only way to use them. Free models
   are contributor models: during the free period, submitted data may be used to improve them.
3. `auth.json` `openrouter` or `deepseek`
4. `auth.json` `opencode-go` (OpenAI-compatible; sends `x-opencode-session`; defaults to the
   cheap `deepseek-v4-flash`, overridable with `TEXT_MODEL`)

Throws when none available — never guesses. Set `TEXT_MODEL_API_KEY` to force
tier 1; a local server also works there with any placeholder key
(`TEXT_MODEL_BASE_URL=http://localhost:11434/v1`, `TEXT_MODEL=<model>`).

Upstream OpenRouter example: `TEXT_MODEL_BASE_URL=https://openrouter.ai/api/v1`,
`TEXT_MODEL=inception/mercury-2.5`, `TEXT_MODEL_REASONING=none`.

## Limits

- **255 choices per question** — the core caps each action kind at 100 candidates
  deterministically. Scroll and re-observe to reach elements beyond the cap.
- **Text needs a model** — `jev_text` and `jev_step` throw when nothing resolves;
  values are never hardcoded or guessed.
- **One decision per snapshot** — a decision is tied to the refs it was chosen
  from. If the page changed, re-observe and decide again.
- **Visible text only** — no screenshots; page text is capped near 6,000
  characters and treated as untrusted data, never as instructions.

## Dev

```
node --test test/
```

No runtime dependencies (Node >= 18, native `fetch`). Core (`src/core/`) has no
OpenCode imports and is reusable from any harness or plain CLI.
