# Visual mode (images + Box) — design

Date: 2026-10-16
Status: approved (design), pending spec review

## Goal

Add an opt-in **visual mode** to the decision core: harnesses that can take
screenshots pass the image into `decide` / `step`; the screenshot joins the
TypeSafe request state (Jev sees the page), and when a page offers no clickable
DOM candidates the decision can return **pixel coordinates** via a Box question.
The text-only path is unchanged, byte for byte.

## Background (facts from the TypeSafe docs)

- Images ride in the request's top-level `assets` map (`type: "image"`,
  `data_base64` + `format`, or multipart `part`), referenced as plain text from
  `state` / `instructions`. Every request containing an image or a Box question
  needs the `TypeSafe-Danger-Zone-Images: true` header.
- Limits: PNG/JPEG stills, 280–1568 px per side, ≤16 MiB file, total pixels
  78,400–2,458,624, 32 MiB request body. An image placed in `state` once is one
  copy; each extra reference use adds another copy.
- **Box**: `{"type": "box", "instructions": "…"}` → four edges
  (`top/bottom/left/right`, fractions 0–1, `left<right`, `top<bottom`) plus
  `confidence`. Needs Jev 1.14 (`jev-preview` / `jev-1.14.0`). A Box answer is
  always a box — there is no "not found" — so the docs prescribe pairing it
  with a Noul presence check.
- Pricing: **$0.042/Mtok input, output tokens free**; images count as input
  tokens (`usage.input_tokens` includes them); rate limits are tokens/sec per
  org. No separate image charge.
- Model aliases: `jev-latest` → `jev-1.13.0` (images yes, **Box no**);
  `jev-preview` → `jev-1.14.0`. Same price.

## Decisions

- **Approach: two-phase, auto-gated (Approach 1).** Phase 1 = today's choices
  with the screenshot in `state`. Phase 2 (Box + Noul) runs only when the
  chosen target is the visual pseudo-target, or when `--box always` is set.
  Rejected: box-always (2 image copies + 2 calls per cycle where the node path
  already suffices) and single-call speculative Box questions (the box may
  disagree with the chosen target, and the disagreement surfaces exactly when
  coordinates are the only execution path — ungrounded guesses are what this
  repo exists to prevent).
- **Visual target rule.** With an image present and zero clickable DOM
  candidates, `CLICK` stays offered with help that it targets a spot on the
  screenshot. When it wins, no target question is asked (one possibility);
  code resolves it as `VISUAL_CLICK`.
- **Coordinates.** Always return `box` (fractions) + `pixel` (image-space rect
  and center) + image `width`/`height`. Optional `--image-scale <s>`
  (1 CSS px = `s` image px) additionally emits `viewport: {x, y}` for the box
  center in CSS px. All conversions round edges and centers with `Math.round`.
  Without the flag, no viewport coordinates are guessed. Full-page screenshots
  need the harness to add its scroll offset — documented, not inferred.
- **Degradation is asymmetric.** Phase 1 failure = today's behavior (throw,
  exit 2, nothing executed). Phase 2 failure: for a visual target the step
  fails (coordinates were the only executable path — never fabricate); for
  `--box always` on a node target the decision stands and gains
  `image.error` (the node action is intact; never a silent partial result).
- **Low `present` is not an error.** It is exposed for the harness's own
  threshold; docs recommend none. The skill suggests ≥ 0.5 to start, and
  re-decide/scroll instead of clicking below it.
- **Model resolution in image mode.** `TYPESAFE_MODEL` if set, else
  `jev-preview`. If a pinned model is a known 1.13 name (`jev-latest`,
  `jev-1.13.0`) and a Box question is needed, fail before the call with a
  message naming Jev 1.14; unknown strings pass through.
- **Scope guards.** One image per request (v1). `Loop`/embedding API
  unchanged. No auto-resize; the harness prepares images per docs guidance.

## Architecture

```
src/core/image.ts       new, pure: PNG/JPEG detect + dimension parse from
                        headers, limit validation, base64, box-answer
                        validation, fraction→pixel, scale→viewport
src/core/jev.ts         choose(…, {image, box}); phase-2 locate(); image
                        header; visual CLICK offer; 1.13 pre-emption
src/core/types.ts       Screenshot / BoxAnswer / ImageResult; JevChoice
                        gains optional image
src/cli.ts              --image <path>, --box auto|always, --image-scale <s>
                        on decide/step; file read + validate at the surface
src/harness/opencode.ts imagePath + box params on jev_decide / jev_step
```

Flow: screenshot file → validate → phase 1 (choices + image in `state`) →
if visual target (or `box=always`): phase 2 Box + Noul for the chosen target →
result gains the `image` block → harness executes.

## Request shapes

Phase 1, image present (text-only requests are byte-identical to today):

```json
{ "model": "jev-preview",
  "state": { "page": {…}, "elements": [ … ],
             "recent_actions": [ … ], "screenshot": "<ref>" },
  "assets": { "<ref>": { "type": "image", "format": "png",
                         "data_base64": "…" } },
  "questions": { …unchanged, plus CLICK when no click candidates exist… } }
```

Phase 2 (questions; the target named from the chosen candidate, or from the
goal when visual):

```json
{ "target_box":     { "type": "box",
                      "instructions": "the element to click to advance …" },
  "target_present": { "type": "noul",
                      "instructions": "Is that element visible in `screenshot`?" } }
```

## Result shape

```json
{ "choice": "VISUAL_CLICK", "operation": "CLICK", "target": "visual",
  "confidence": 0.94, "text": null,
  "action": { "operation": "CLICK", "node": "", "visual": true,
              "kind": "click", "label": "visual target" },
  "image": { "width": 1512, "height": 941,
             "box": { "top": 0.25, "bottom": 0.82,
                      "left": 0.44, "right": 0.84 },
             "pixel": { "x": 665, "y": 235, "width": 605, "height": 537,
                        "center": { "x": 968, "y": 504 } },
             "viewport": { "x": 484, "y": 252 },
             "present": 0.93, "confidence": 0.92, "model": "jev-1.14.0",
             "latency_ms": 812, "usage": { "input_tokens": 3900 } } }
```

Harness contract: node present → act on the node; `visual: true` → click
`image.pixel.center` (or `image.viewport` when `--image-scale` was given),
gated on `present`. `image.error` replaces the box fields when phase 2 fails
under `--box always`.

## Validation & errors

- Image checks with exact, actionable messages: not PNG/JPEG; side outside
  280–1568 ("resize or use a viewport screenshot"); file >16 MiB; total
  pixels outside range. CLI writes one `{error}` line, exit 2, nothing partial.
- Box validation: four finite edges in 0–1, `left<right`, `top<bottom`;
  violation = malformed answer → degradation rules above.
- `--box` without `--image` is a usage error (exit 2): there is no image to
  box anything on.
- Animated-PNG detection is out of scope: format/dims/size are validated
  locally, the API rejects the rest.

## Accounting

Top-level `usage` / `latency_ms` keep today's meaning (phase 1); phase 2
reports `image.usage` / `image.latency_ms` so real per-cycle cost and latency
are measurable on the user's pages.

## Testing

- New `test/image.test.ts`: PNG/JPEG header dimension parsing on synthetic
  buffers; format/limit rejections; base64; box validation (non-finite,
  inverted, out-of-range); fraction→pixel rounding; scale→viewport.
- `test/jev.test.ts` additions (mock fetch): image-less requests byte-identical
  to today; image requests carry asset + danger-zone header + `jev-preview`
  default; visual CLICK offered only when zero candidates + image; phase 2
  invoked exactly for visual targets in auto mode and node targets under
  `always`; both degradation paths; 1.13 pre-emption.
- `test/cli.test.ts` additions: flag pass-through; bad image → exit 2 + clear
  message.
- Existing tests stay green; `npm test` + `npm run typecheck` before done.

## Docs

- README: "Visual mode" section — flags, node-vs-pixel rule, presence
  guidance, limits + resize advice, cost/latency notes, model note.
- `skill/SKILL.md`: fast path gains the screenshot step and the act-by-node
  else-pixel rule; rules gain "coordinates come only from `image.pixel` /
  `image.viewport`".
- Plugin tool descriptions mention `imagePath` / `box`; landing page gets a
  short visual-mode mention.

## Out of scope

- Multiple images per request; TYPE_TEXT/SELECT visual targets.
- Box for verification on every action by default (opt-in `--box always` only).
- Image cropping/tiling escalation; auto-resize; animated-PNG detection;
  `Loop` image support.
