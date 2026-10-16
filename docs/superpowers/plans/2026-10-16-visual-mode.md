# Visual mode (images + Box) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in visual mode to jev-browser: a screenshot joins the TypeSafe request, and Box questions return pixel coordinates for targets that have no DOM node.

**Architecture:** A new pure module `src/core/image.ts` handles PNG/JPEG detection, limit validation, base64, and box→pixel math. `src/core/jev.ts` gains an optional image: it rides in `state` (one asset copy) during the phase-1 choice request, and a phase-2 Box + Noul request runs only for visual targets (or `box: "always"`). Surfaces (CLI, OpenCode plugin) pass the image through; the text-only path stays byte-identical.

**Tech Stack:** Node >= 22.6 native TypeScript (`--experimental-strip-types`), `node:test`, zero runtime dependencies. TypeSafe System One HTTP API.

**Spec:** `docs/superpowers/specs/2026-10-16-visual-mode-design.md`

## Global Constraints

- Zero runtime dependencies; Node >= 22.6 with native TypeScript; no build step.
- Image-less requests must stay **byte-identical** to today (model `jev-latest`, no `assets`, no image header).
- Image requests: `TypeSafe-Danger-Zone-Images: true` header; model `TYPESAFE_MODEL` if set else `jev-preview`; one image per request.
- Limits (reject locally with actionable messages): PNG/JPEG only, 280–1568 px per side, ≤16 MiB file, total pixels 78,400–2,458,624.
- CLI contract: one compact JSON line on stdout; `{error}` on stderr + exit 2; no partial output.
- Box conversions use `Math.round`; fractions are never converted without the image dimensions.
- Box answers are validated strictly (four finite edges 0–1, `left<right`, `top<bottom`, finite confidence 0–1); Noul is `{type:"noul", noul: number 0–1}`.
- Phase-2 failure: visual target → whole step fails (`Box request failed for the visual target; no action executed. (…)`); `box=always` node target → decision stands with `image.error`.
- Known 1.13 pins (`jev-latest`, `jev-1.13.0`) + box needed → fail before the call: `Box questions need Jev 1.14; unset TYPESAFE_MODEL or set it to jev-preview.`
- Error-message style: end actionable errors with the fix; existing flows keep their current messages.

## Review Focus

1. **Truncated/corrupt image bytes that half-match a header** — must throw the clear "not a PNG or JPEG" (or limit) error, never produce 0×0 or negative dimensions. Test in Task 1.
2. **A legal box that rounds to a zero-width pixel rect** (e.g. left 0.5, right 0.502 on a 280 px image) — must not crash; center still lands inside the rect. Test in Task 1.
3. **`--image` pointing at a missing file** — must exit 2 with one JSON error line and no stdout, consistent with other missing-input flags. Test in Task 4.
4. **PNG header present but IHDR dimensions are 0** — must fail the 280 px side check with the actionable message. Test in Task 1.
5. **Asset reference collisions** — the reference is a fresh `randomUUID()` per request, so untrusted page text cannot pre-embed it; phase 1 and phase 2 use different refs. Assert two requests use different refs in Task 3.

---

## File Structure

- Create: `src/core/image.ts` — pure image prep + geometry (no fs, no fetch).
- Create: `test/image.test.ts`.
- Modify: `src/core/types.ts` — `Screenshot`, `BoxEdges`, `PixelRect`, `ImageResult`; `JevChoice.image?`.
- Modify: `src/core/jev.ts` — `ChooseOptions`, image in request, visual CLICK offer, phase-2 `locate()`, `VISUAL_CHOICE`.
- Modify: `src/core/step.ts` — `planStep` forwards `ChooseOptions`.
- Modify: `src/core/index.ts` — export `image.ts` (covered by `export *`; add the line).
- Modify: `src/cli.ts` — flags `--image`, `--box`, `--image-scale`; `imageOptions`; visual action envelope; HELP.
- Modify: `src/harness/opencode.ts` — `imagePath`/`box`/`imageScale` tool params; `visual` flag on step output; descriptions.
- Modify: `test/jev.test.ts`, `test/cli.test.ts`.
- Modify: `README.md`, `skill/SKILL.md`, `docs/index.html`.

---

### Task 1: Image prep and box geometry (`src/core/image.ts`)

**Files:**
- Create: `src/core/image.ts`
- Modify: `src/core/types.ts` (add `ImageFormat`, `Screenshot`, `BoxEdges`, `PixelRect`, `ImageResult`; `JevChoice` gains `image?: ImageResult`)
- Modify: `src/core/index.ts` (add `export * from "./image.ts";`)
- Test: `test/image.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces (all from `src/core/image.ts`):
  - `detectImage(bytes: Uint8Array): { format: ImageFormat; width: number; height: number }` — throws `Screenshot is not a PNG or JPEG. Re-export it as PNG or JPEG.` when neither signature matches or dimensions cannot be read.
  - `validateImage(info: { width: number; height: number; byteLength: number }): void`
  - `prepareImage(bytes: Uint8Array): Screenshot`
  - `validateBox(answer: any): { box: BoxEdges; confidence: number }` — throws `TypeSafe returned a malformed box.`
  - `boxToPixels(box: BoxEdges, width: number, height: number): PixelRect`
  - `pixelToViewport(center: { x: number; y: number }, scale: number): { x: number; y: number }`

- [ ] **Step 1: Write the failing tests**

`test/image.test.ts` — helpers build synthetic images:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { boxToPixels, detectImage, pixelToViewport, prepareImage, validateBox, validateImage } from "../src/core/image.ts";

function pngBytes(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b;
}

function jpegBytes(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0); // SOI + SOF0 segment
  const view = new DataView(b.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  return b;
}
```

Cases (name → assertion):
- `"detects PNG dimensions"` → `detectImage(pngBytes(800, 600))` deep-equals `{ format: "png", width: 800, height: 600 }`.
- `"detects JPEG dimensions"` → `detectImage(jpegBytes(1512, 941))` deep-equals `{ format: "jpg", width: 1512, height: 941 }`.
- `"rejects non-images and corrupt headers"` → `assert.throws(() => detectImage(new TextEncoder().encode("GIF89a0123456789abcdefghijklmnop")), /not a PNG or JPEG/)`; `assert.throws(() => detectImage(new TextEncoder().encode("just text")), /not a PNG or JPEG/)`; `assert.throws(() => detectImage(pngBytes(800, 600).slice(0, 16)), /not a PNG or JPEG/)` (PNG signature only, truncated before IHDR); `assert.throws(() => prepareImage(pngBytes(0, 0)), /280/)` (zero IHDR dimensions fail the side check).
- `"rejects images outside the limits"` → `validateImage` throws `/280–1568/` for `{ width: 200, height: 600 }` and `{ width: 800, height: 2000 }`; throws `/pixels/` for `{ width: 300, height: 260 }`; throws `/limit is 16777216/` for `{ width: 800, height: 600, byteLength: 17 * 1024 * 1024 }`.
- `"prepareImage encodes base64 that round-trips"` → `prepareImage(pngBytes(800, 600))` has `format "png"`, and `Buffer.from(screenshot.data_base64, "base64")` deep-equals the input bytes.
- `"validateBox accepts a well-formed answer"` → `{ type: "box", box: { top: 0.25, bottom: 0.82, left: 0.44, right: 0.84 }, confidence: 0.92 }` returns `box.left === 0.44` and `confidence === 0.92`.
- `"validateBox rejects malformed answers"` → `assert.throws(/malformed box/)` for each of: missing `type`; `left === right`; `top > bottom`; edge `1.2`; edge `NaN`; string edge; `confidence: "0.9"`.
- `"boxToPixels matches the spec example"` → `boxToPixels({ top: 0.25, bottom: 0.82, left: 0.44, right: 0.84 }, 1512, 941)` deep-equals `{ x: 665, y: 235, width: 605, height: 537, center: { x: 968, y: 504 } }`.
- `"a sub-pixel box does not crash"` → `boxToPixels({ top: 0.5, bottom: 0.502, left: 0.5, right: 0.502 }, 280, 280)` returns finite numbers with `center.x` between `x` and `x + width`.
- `"pixelToViewport divides by the scale"` → `pixelToViewport({ x: 968, y: 504 }, 2)` deep-equals `{ x: 484, y: 252 }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/image.test.ts`
Expected: FAIL with module-not-found for `../src/core/image.ts`.

- [ ] **Step 3: Implement `src/core/image.ts`**

Algorithm notes (the tests and signatures determine the rest):

- `pngSize`: require ≥24 bytes, the 8-byte signature, and `IHDR` at bytes 12–15; read big-endian uint32 width at 16, height at 20. Return `null` on any miss.
- `jpegSize`: require `FF D8`; scan for `0xFF` markers (skipping fill `0xFF` bytes); SOF markers are `C0–C3, C5–C7, C9–CB, CD–CF`; at a SOF, require `i + 9 <= bytes.length` and read big-endian uint16 height at `i+5`, width at `i+7`. Return `null` on any miss.
- `detectImage`: try `pngSize`, then `jpegSize`; neither → the "not a PNG or JPEG" error.
- `validateImage`: byte limit → side limits → total-pixels limits, with messages from the spec: side error `Screenshot is W×H; each side must be 280–1568 px. Resize or use a viewport screenshot.`; total error `Screenshot is W×H (N pixels); total pixels must be 78400–2458624. Resize it.`; size error `Screenshot is N bytes; the limit is 16777216. Resize or re-export it.`
- `prepareImage`: `detectImage` → `validateImage` → `{ format, width, height, data_base64: Buffer.from(bytes).toString("base64") }`.
- `validateBox`: wrap the checks in one `try/catch` that rethrows `TypeSafe returned a malformed box.` (mirrors `validateChoice` style).
- `boxToPixels` / `pixelToViewport`: `Math.round` per the global constraints; center from the rounded edges.

Add to `src/core/types.ts`:

```ts
export type ImageFormat = "png" | "jpg";
export interface Screenshot { format: ImageFormat; width: number; height: number; data_base64: string; }
export interface BoxEdges { top: number; bottom: number; left: number; right: number; }
export interface PixelRect { x: number; y: number; width: number; height: number; center: { x: number; y: number }; }
export interface ImageResult {
  width: number; height: number;
  box?: BoxEdges; pixel?: PixelRect; viewport?: { x: number; y: number };
  present?: number; confidence?: number;
  model?: unknown; usage?: unknown; latency_ms: number;
  error?: string;
}
```

and add `image?: ImageResult;` to `JevChoice`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/image.test.ts` then `npm run typecheck`
Expected: all PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/image.ts src/core/types.ts src/core/index.ts test/image.test.ts
git commit -m "feat: image prep and box geometry in core/image"
```

---

### Task 2: Image-aware requests and the visual CLICK offer (`src/core/jev.ts`)

**Files:**
- Modify: `src/core/jev.ts`
- Test: `test/jev.test.ts`

**Interfaces:**

- Consumes: `prepareImage`-shaped `Screenshot` (Task 1 types), `buildElementTable` output.
- Produces:
  - `export interface ChooseOptions { env?: JevEnv; fetchFn?: typeof fetch; image?: Screenshot; box?: "auto" | "always"; imageScale?: number; }`
  - `buildRequest(state, goal, history, image?: Screenshot)` returns `{ body, elements, targets, controls, operations, visualClick: boolean }` (one new field).
  - `choose(state, goal, history, opts: ChooseOptions = {})` — phase 1 only in this task; still one fetch call.
  - `export const VISUAL_CHOICE = "VISUAL_CLICK";`
  - `export const IMAGE_MODEL = "jev-preview";`

- [ ] **Step 1: Write the failing tests**

Add to `test/jev.test.ts` (reuse the existing `page` fixture; `shot` = `{ format: "png", width: 800, height: 600, data_base64: "aGk=" }`):

- `"image-less requests carry no assets and keep the default model"` → via a capturing `fetchFn` mock (like the existing one), `choose(page, "g", [], { env: { TYPESAFE_API_KEY: "k" }, fetchFn })`; assert the captured body has no `assets` key, `body.state.screenshot === undefined`, and captured `init.headers["TypeSafe-Danger-Zone-Images"] === undefined`. Also `buildRequest(page, "goal", [])` result has `visualClick === false`.
- `"image requests carry one asset, the state reference, the header, and jev-preview"` → `buildRequest(page, "goal", [], shot)`: `body.state.screenshot === Object.keys(body.assets)[0]`; `body.assets[ref]` deep-equals `{ type: "image", format: "png", data_base64: "aGk=" }`; `visualClick === false` (the fixture has click candidates); captured fetch headers from `choose(..., { image: shot })` include `"TypeSafe-Danger-Zone-Images": "true"`; captured `body.model === "jev-preview"`.
- `"offers a visual CLICK only when zero click candidates and an image"` → `canvasPage` = `{ ...page, actions: [] }`: with `shot`, `visualClick === true` and `body.questions.operation.criteria.CLICK` is a string; without image, `visualClick === false` and `criteria.CLICK === undefined`.
- `"TYPESAFE_MODEL still wins in image mode"` → `choose(..., { image: shot, env: { TYPESAFE_API_KEY: "k", TYPESAFE_MODEL: "jev-1.14.0" }, fetchFn })` → captured `body.model === "jev-1.14.0"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/jev.test.ts`
Expected: new cases FAIL (no assets/visualClick support).

- [ ] **Step 3: Implement in `src/core/jev.ts`**

- `request(key, body, fetchFn, extraHeaders: Record<string, string> = {})` — merge into headers.
- `buildRequest`: after building `operations` from targets and controls, insert the visual rule: `const visualClick = Boolean(image) && !targets.CLICK; if (visualClick) operations.CLICK = "Click a spot on the screenshot when no observed element fits.";` (before `operations.DONE`). When `image`: `const ref = randomUUID();` (import from `node:crypto`), set `body.assets = { [ref]: { type: "image", format: image.format, data_base64: image.data_base64 } }` and `body.state.screenshot = ref`.
- `choose`: resolve `const image = opts.image;` `body.model = env.TYPESAFE_MODEL || (image ? IMAGE_MODEL : DEFAULT_MODEL);`; pass `image ? { "TypeSafe-Danger-Zone-Images": "true" } : {}` to `request`.
- Target resolution gains one branch between `if (candidates)` and the controls `else`: when `operation === "CLICK" && visualClick` → `choice = VISUAL_CHOICE; target = "visual"; probabilities[VISUAL_CHOICE] = operationAnswer.probabilities[operation] ?? 0;`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/jev.test.ts` and `node --test test/*.test.ts` (existing suite green) then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/core/jev.ts test/jev.test.ts
git commit -m "feat: image-aware requests and visual CLICK offer"
```

---

### Task 3: Phase 2 — Box + Noul with auto gating

**Files:**
- Modify: `src/core/jev.ts`
- Test: `test/jev.test.ts`

**Interfaces:**

- Consumes: `validateBox`, `boxToPixels`, `pixelToViewport` (Task 1); `VISUAL_CHOICE`, `ChooseOptions`, `visualClick` (Task 2).
- Produces: `choose` triggers phase 2 when `image && (choice === VISUAL_CHOICE || (opts.box === "always" && chosenAction !== undefined))`; success → `decision.image: ImageResult` with `box/pixel/present/confidence/model/usage/latency_ms` (+ `viewport` when `imageScale`); failure rules per Global Constraints.

- [ ] **Step 1: Write the failing tests**

Add to `test/jev.test.ts` with a two-response `fetchFn` mock (first call = phase 1 answers, second = box answers):

Phase-1 answer helper: operation `CLICK` probability 1, plus a `click_target` answer when candidates exist. Phase-2 answer: `{ model: "jev-1.14.0", answers: { target_box: { type: "box", box: { top: 0.25, bottom: 0.82, left: 0.44, right: 0.84 }, confidence: 0.92 }, target_present: { type: "noul", noul: 0.93 } }, usage: { input_tokens: 3900 } }`.

- `"visual target runs phase 2 and returns coordinates"` → canvas page + image: two calls; `d.choice === "VISUAL_CLICK"`; `d.image.pixel` deep-equals `{ x: 352, y: 150, width: 320, height: 342, center: { x: 512, y: 321 } }` (800×600 shot, box above: left 0.44→352, top 0.25→150, right 0.84→672, bottom 0.82→492; center (352+672)/2=512, (150+492)/2=321); `d.image.present === 0.93`; second request body has `questions.target_box.type === "box"` and header `TypeSafe-Danger-Zone-Images`; the two requests use different `state.screenshot` refs.
- `"imageScale adds viewport coordinates"` → same flow with `imageScale: 2` → `d.image.viewport` deep-equals `{ x: 256, y: 161 }` (`Math.round(512/2)`, `Math.round(321/2)`).
- `"node targets skip phase 2 in auto mode"` → clickable page + image → exactly 1 call; `d.image === undefined`.
- `"box always also boxes node targets"` → clickable page + image + `box: "always"` → 2 calls; `d.image.box` present; `d.choice` still the node id.
- `"visual target fails the step when phase 2 fails"` → second call returns `{ ok: false, status: 500, json: async () => ({}) }` → `assert.rejects(/Box request failed for the visual target; no action executed/)`.
- `"box always degrades to image.error for node targets"` → node target + `box: "always"` + second call 500 → resolves; `d.image.error` truthy; `d.image.box === undefined`; `d.choice` unchanged.
- `"malformed box answers follow the same split"` → second call returns a box with `left === right`: visual → rejects; `always` + node → `image.error` matches `/malformed box/`.
- `"a known 1.13 pin pre-empts the box phase"` → `env: { TYPESAFE_API_KEY: "k", TYPESAFE_MODEL: "jev-latest" }` + canvas page + image → rejects `/Jev 1.14/`; exactly 1 call happened.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/jev.test.ts`
Expected: new cases FAIL (no phase 2).

- [ ] **Step 3: Implement phase 2 in `src/core/jev.ts`**

- Private `async function locate(key, body basics, fetchFn, opts): Promise<ImageResult>`:
  - fresh `randomUUID()` ref; body `{ model, state: { page: { url, title }, screenshot: ref }, assets: { [ref]: … }, questions: { target_box: { type: "box", instructions }, target_present: { type: "noul", instructions } } }`.
  - Visual instructions: box `the element to click to advance this goal: ${goal}`; noul `` Is the element to click to advance this goal visible in `screenshot`? ``.
  - Candidate instructions: box `the element labeled "${action.label}"${action.role ? ` (role: ${action.role})` : ""} on the page`; noul `` Is the element labeled "${action.label}" visible in `screenshot`? ``.
  - `validateBox(result.answers?.target_box)`; noul must satisfy the 0–1 finite check or `throw new Error("TypeSafe returned a malformed noul.")`.
  - Assemble `ImageResult` (box, pixel, present, confidence, model, usage, latency_ms; viewport when `imageScale !== undefined` after a defensive positive-finite check).
- In `choose`, after target resolution: compute `chosenAction`; if the trigger condition holds, run `locate` inside `try/catch`:
  - known 1.13 pins: `const KNOWN_1_13 = new Set(["jev-latest", "jev-1.13.0"]);` → throw the Global-Constraints message before calling.
  - catch: visual → rethrow `Box request failed for the visual target; no action executed. (${message})`; otherwise `imageResult = { width: image.width, height: image.height, latency_ms: measured, error: message }`.
- Attach `image: imageResult` to the returned `JevChoice` (omit the key entirely when no phase 2 ran).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/jev.test.ts` and `node --test test/*.test.ts`, then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/core/jev.ts test/jev.test.ts
git commit -m "feat: box phase with auto gating and degradation rules"
```

---

### Task 4: CLI flags, step envelope, and `planStep` pass-through

**Files:**
- Modify: `src/core/step.ts` (5th parameter)
- Modify: `src/cli.ts`
- Test: `test/cli.test.ts`

**Interfaces:**

- Consumes: `prepareImage` (Task 1), `ChooseOptions`, `VISUAL_CHOICE` (Tasks 2–3).
- Produces:
  - `planStep(state, goal, history = [], deps = {}, opts: ChooseOptions = {})` — default decide becomes `choose(page, task, recent, opts)`.
  - `export function imageOptions(flags: Flags): ChooseOptions` in `src/cli.ts` — reads/validates `--image`, `--box`, `--image-scale`; errors: `--box requires --image`, `--image-scale requires --image`, `--box must be auto or always`, `--image-scale must be a positive number`.
  - Step output `action` gains `visual: true` and empty `node` for `VISUAL_CHOICE`; HELP lists the new flags on `decide`/`step`.

- [ ] **Step 1: Write the failing tests**

Add to `test/cli.test.ts` (unit tests can import `imageOptions` directly; spawn tests dump a file via `writeFileSync`):

- `"rejects --box and --image-scale without --image"` → `assert.throws(() => imageOptions({ box: "always" }), /--box requires --image/)`; same for `{ "image-scale": "2" }`.
- `"validates flag values"` → `assert.throws(() => imageOptions({ image: pngFile, box: "sometimes" }), /auto or always/)`; `assert.throws(() => imageOptions({ image: pngFile, "image-scale": "abc" }), /positive number/)`.
- `"prepares a screenshot from a file"` → write `pngBytes(800, 600)` to a temp `.png`; `imageOptions({ image: file })` returns `{ image: { format: "png", width: 800, height: 600, … } }`.
- `"rejects a non-image file"` → write "hello" as `.png`; `assert.throws(… /not a PNG or JPEG/)`.
- spawn tests: `decide --goal g --page - --box always` (stdin snapshot) → status 2, stdout `""`, stderr matches `/--box requires --image/`; `step --goal g --page - --image /nonexistent/shot.png` → status 2, stderr `error` present, stdout `""` (missing-file Review Focus item).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/cli.test.ts`
Expected: FAIL (no `imageOptions`; unknown flags ignored today).

- [ ] **Step 3: Implement**

- `step.ts`: add the 5th parameter; default decide `(page, task, recent) => choose(page, task, recent, opts)`.
- `cli.ts`: implement `imageOptions` (read via `readFileSync`, `prepareImage(new Uint8Array(...))`; validation order: no-image → box/scale flags error; then box value; then scale value; then read/prepare). Wire into `decideCommand` (4th arg of `choose`) and `stepCommand` (5th arg of `planStep`). In `stepCommand`'s envelope: `const visual = result.choice === VISUAL_CHOICE; const action = visual ? { operation: "CLICK", node: "", visual: true, kind: "click", label: "visual target", role: null, value: null } : describeAction(result.operation, target);` Update `HELP` flag lines and the keys footer.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/cli.test.ts`, `node --test test/*.test.ts`, `npm run typecheck`; spot-check `./src/cli.ts help`.

- [ ] **Step 5: Commit**

```bash
git add src/core/step.ts src/cli.ts test/cli.test.ts
git commit -m "feat: cli visual mode flags and visual step envelope"
```

---

### Task 5: OpenCode plugin params

**Files:**
- Modify: `src/harness/opencode.ts`

**Interfaces:**

- Consumes: `prepareImage` (Task 1), `ChooseOptions`, `VISUAL_CHOICE` (Tasks 2–3).
- Produces: `jev_decide` and `jev_step` accept `imagePath`, `box` (`enum ["auto","always"]`), `imageScale`; `jev_step` output gains `visual: boolean`.

- [ ] **Step 1: Implement**

- Import `readFileSync` from `node:fs`, `prepareImage` from `../core/image.ts`, `VISUAL_CHOICE` from `../core/jev.ts`.
- Shared helper in the plugin: `function visualOptions(input): ChooseOptions` — `box`/`imageScale` without `imagePath` throw `box requires imagePath` / `imageScale requires imagePath`; with `imagePath`, `image = prepareImage(new Uint8Array(readFileSync(imagePath)))`.
- Add the three properties to both tools' `input.properties` with descriptions: imagePath — "Path to a PNG/JPEG screenshot (280–1568 px per side). Enables visual mode: the screenshot joins the request state; Box questions return pixel coordinates for targets with no DOM node."; box — "auto (default) boxes only visual targets; always also boxes node targets."; imageScale — "Device scale factor of the screenshot (1 CSS px = scale image px); adds viewport coordinates for the box center."
- Pass options into `choose` / `planStep`; `jev_step` returns `{ ...result, text_model: textModel, visual: result.choice === VISUAL_CHOICE }`.
- Update the two tool descriptions with one sentence each: "Pass imagePath for visual mode; act on nodes when present, else click image.pixel.center (or image.viewport) gated on image.present."

- [ ] **Step 2: Verify**

Run: `npm run typecheck` and `node --test test/*.test.ts` (plugin has no dedicated runtime test; typecheck plus the untouched `opencode-text.test.ts` is the gate).

- [ ] **Step 3: Commit**

```bash
git add src/harness/opencode.ts
git commit -m "feat: opencode plugin visual mode params"
```

---

### Task 6: Docs — README, skill, landing page

**Files:**
- Modify: `README.md`
- Modify: `skill/SKILL.md`
- Modify: `docs/index.html`

**Interfaces:**

- Consumes: the shipped CLI/plugin behavior (Tasks 4–5); exact copy below.

- [ ] **Step 1: README**

Three edits:
1. Intro sentence "No screenshots in the loop, visible text only." → "No screenshots in the loop by default — opt-in visual mode passes one screenshot per cycle so Box questions can return pixel coordinates when a page has no clickable DOM nodes."
2. CLI synopsis block: add `[--image shot.png] [--box auto|always] [--image-scale S]` to `decide` and `step` lines, and two lines under the block:

```
--image passes a PNG/JPEG screenshot into the decision (visual mode).
--box always also asks for the chosen node element's box, not just visual targets.
```

3. New section after "Loop" titled `## Visual mode (images + Box)` with: how the two phases work; the node-vs-pixel rule (`action.visual` → click `image.pixel.center`; `image.viewport` with `--image-scale`; full-page screenshots need the harness's scroll offset); `image.present` guidance (no official threshold; ≥ 0.5 to start); limits (280–1568 px per side, ≤16 MiB, PNG/JPEG — resize or use a viewport screenshot); model default `jev-preview` (Box needs Jev 1.14) and the `TYPESAFE_MODEL` override; cost/latency note (one extra model call per visual cycle; phase-2 `usage`/`latency_ms` reported under `image`).

Also: update the Limits bullet list (image bullet) and the Layout block (`src/core/image.ts`) and the plugin-tools list (`imagePath`/`box` on `jev_decide`/`jev_step`).

- [ ] **Step 2: skill/SKILL.md**

- Fast path: add `SHOT=$(mktemp)` beside the existing temp files; after the snapshot comment add: `# Optional visual mode: screenshot to "$SHOT" (PNG/JPEG, ≤1568 px per side)`; append `--image "$SHOT"` to the `jev step` invocation; replace the act comment with: `# node present → act on NODE; DEC.action.visual → click DEC.image.pixel.center (or .viewport), gated on DEC.image.present`.
- Rules: add `- Coordinates come only from DEC.image.pixel / DEC.image.viewport; never estimate click points.`

- [ ] **Step 3: docs/index.html**

Add one paragraph after the "Fast cycles, small bills" section, matching the surrounding markup:

```html
<p class="section-lede">Opt-in visual mode passes one screenshot per cycle: Jev sees the page, and Box questions return pixel coordinates for targets that have no DOM node — canvas UIs, unlabeled icons. Text-only cycles are unchanged and one extra model call only runs when it is needed.</p>
```

- [ ] **Step 4: Verify and commit**

Run: `node --test test/*.test.ts` (sanity), review the rendered Markdown/edit consistency.

```bash
git add README.md skill/SKILL.md docs/index.html
git commit -m "docs: visual mode readme, skill, and landing page"
```

---

### Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full gates**

Run: `npm test` and `npm run typecheck`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 2: Smoke the CLI help and error contract**

Run: `./src/cli.ts help` (exit 0, shows new flags) and `./src/cli.ts decide --goal g --page - --box always` with a pasted snapshot on stdin (exit 2, single `{error}` line).

- [ ] **Step 3: Confirm no-image regression**

Run: `git diff HEAD~6 --stat` (expect only the files listed in File Structure) and re-run `node --test test/jev.test.ts` to confirm the byte-identical no-image tests stay green.

- [ ] **Step 4: Commit any fixes**

Only if the verification surfaced issues; otherwise nothing to commit.
