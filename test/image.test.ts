import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IMAGE_LIMITS,
  boxToPixels,
  detectImage,
  pixelToViewport,
  prepareImage,
  validateBox,
  validateImage,
} from "../src/core/image.ts";

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

describe("detectImage", () => {
  it("detects PNG dimensions", () => {
    assert.deepEqual(detectImage(pngBytes(800, 600)), { format: "png", width: 800, height: 600 });
  });

  it("detects JPEG dimensions", () => {
    assert.deepEqual(detectImage(jpegBytes(1512, 941)), { format: "jpg", width: 1512, height: 941 });
  });

  it("rejects non-images and corrupt headers", () => {
    assert.throws(
      () => detectImage(new TextEncoder().encode("GIF89a0123456789abcdefghijklmnop")),
      /not a PNG or JPEG/,
    );
    assert.throws(() => detectImage(new TextEncoder().encode("just text")), /not a PNG or JPEG/);
    assert.throws(() => detectImage(pngBytes(800, 600).slice(0, 16)), /not a PNG or JPEG/);
    assert.throws(() => prepareImage(pngBytes(0, 0)), /280/);
  });
});

describe("validateImage", () => {
  it("accepts a legal size", () => {
    validateImage({ width: 800, height: 600, byteLength: 1024 });
  });

  it("rejects images outside the limits", () => {
    assert.throws(() => validateImage({ width: 200, height: 600, byteLength: 1024 }), /280–1568/);
    assert.throws(() => validateImage({ width: 800, height: 2000, byteLength: 1024 }), /280–1568/);
    assert.throws(() => validateImage({ width: 300, height: 260, byteLength: 1024 }), /280–1568/);
    assert.throws(
      () => validateImage({ width: 800, height: 600, byteLength: 17 * 1024 * 1024 }),
      /limit is 16777216/,
    );
  });

  it("keeps total-pixel bounds consistent with the side bounds", () => {
    // The pixel bounds are exactly minSide²–maxSide², so a rectangle that
    // passes the side checks always passes the pixel check; the pixel guard
    // in validateImage is defense-in-depth, pinned here so it cannot drift.
    assert.equal(IMAGE_LIMITS.minPixels, IMAGE_LIMITS.minSide * IMAGE_LIMITS.minSide);
    assert.equal(IMAGE_LIMITS.maxPixels, IMAGE_LIMITS.maxSide * IMAGE_LIMITS.maxSide);
  });
});

describe("prepareImage", () => {
  it("encodes base64 that round-trips", () => {
    const bytes = pngBytes(800, 600);
    const screenshot = prepareImage(bytes);
    assert.equal(screenshot.format, "png");
    assert.deepEqual(new Uint8Array(Buffer.from(screenshot.data_base64, "base64")), bytes);
  });
});

describe("validateBox", () => {
  it("accepts a well-formed answer", () => {
    const answer = {
      type: "box",
      box: { top: 0.25, bottom: 0.82, left: 0.44, right: 0.84 },
      confidence: 0.92,
    };
    const result = validateBox(answer);
    assert.equal(result.box.left, 0.44);
    assert.equal(result.confidence, 0.92);
  });

  it("rejects malformed answers", () => {
    const good = {
      type: "box",
      box: { top: 0.25, bottom: 0.82, left: 0.44, right: 0.84 },
      confidence: 0.92,
    };
    const cases = [
      { ...good, type: undefined },
      { ...good, box: { ...good.box, right: 0.44 } },
      { ...good, box: { ...good.box, top: 0.9, bottom: 0.1 } },
      { ...good, box: { ...good.box, left: 1.2 } },
      { ...good, box: { ...good.box, top: NaN } },
      { ...good, box: { ...good.box, bottom: "0.8" } },
      { ...good, confidence: "0.9" },
    ];
    for (const answer of cases) assert.throws(() => validateBox(answer), /malformed box/);
  });
});

describe("boxToPixels", () => {
  it("matches the spec example", () => {
    assert.deepEqual(boxToPixels({ top: 0.25, bottom: 0.82, left: 0.44, right: 0.84 }, 1512, 941), {
      x: 665,
      y: 235,
      width: 605,
      height: 537,
      center: { x: 968, y: 504 },
    });
  });

  it("a sub-pixel box does not crash", () => {
    const rect = boxToPixels({ top: 0.5, bottom: 0.502, left: 0.5, right: 0.502 }, 280, 280);
    assert.ok(Number.isFinite(rect.width) && Number.isFinite(rect.height));
    assert.ok(rect.center.x >= rect.x && rect.center.x <= rect.x + rect.width);
  });
});

describe("pixelToViewport", () => {
  it("divides by the scale", () => {
    assert.deepEqual(pixelToViewport({ x: 968, y: 504 }, 2), { x: 484, y: 252 });
  });
});
