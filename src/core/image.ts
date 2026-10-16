// Image preparation for visual mode: pure helpers, no fs and no network, so
// every harness surface can prepare a screenshot the same way. See the
// visual-mode design in docs/superpowers/specs/2026-10-16-visual-mode-design.md.
import type { BoxEdges, ImageFormat, PixelRect, Screenshot } from "./types.ts";

// Limits from the TypeSafe images documentation.
export const IMAGE_LIMITS = {
  maxBytes: 16 * 1024 * 1024,
  minSide: 280,
  maxSide: 1568,
  minPixels: 78_400,
  maxPixels: 2_458_624,
};

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = [0x49, 0x48, 0x44, 0x52]; // "IHDR"
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** PNG dimensions from the IHDR chunk; null when the header is not a valid PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (!PNG_MAGIC.every((byte, i) => bytes[i] === byte)) return null;
  if (!IHDR.every((byte, i) => bytes[12 + i] === byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** JPEG dimensions from the first SOF segment; null when the header is not a valid JPEG. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte before a marker
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2; // standalone markers carry no length
      continue;
    }
    if (marker === 0xda) return null; // start of scan: no SOF before it
    if (i + 4 > bytes.length) return null;
    if (SOF_MARKERS.has(marker)) {
      if (i + 9 > bytes.length) return null;
      return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
    }
    i += 2 + view.getUint16(i + 2);
  }
  return null;
}

export function detectImage(bytes: Uint8Array): { format: ImageFormat; width: number; height: number } {
  const png = pngSize(bytes);
  if (png) return { format: "png", ...png };
  const jpg = jpegSize(bytes);
  if (jpg) return { format: "jpg", ...jpg };
  throw new Error("Screenshot is not a PNG or JPEG. Re-export it as PNG or JPEG.");
}

export function validateImage(info: { width: number; height: number; byteLength: number }): void {
  const { width, height, byteLength } = info;
  const { maxBytes, minSide, maxSide, minPixels, maxPixels } = IMAGE_LIMITS;
  if (byteLength > maxBytes) {
    throw new Error(`Screenshot is ${byteLength} bytes; the limit is ${maxBytes}. Resize or re-export it.`);
  }
  if (width < minSide || height < minSide || width > maxSide || height > maxSide) {
    throw new Error(
      `Screenshot is ${width}×${height}; each side must be ${minSide}–${maxSide} px. Resize or use a viewport screenshot.`,
    );
  }
  const total = width * height;
  if (total < minPixels || total > maxPixels) {
    throw new Error(
      `Screenshot is ${width}×${height} (${total} pixels); total pixels must be ${minPixels}–${maxPixels}. Resize it.`,
    );
  }
}

/** Validate bytes and produce the request-ready screenshot (base64, format, size). */
export function prepareImage(bytes: Uint8Array): Screenshot {
  const { format, width, height } = detectImage(bytes);
  validateImage({ width, height, byteLength: bytes.byteLength });
  return { format, width, height, data_base64: Buffer.from(bytes).toString("base64") };
}

// A box answer is only accepted when all four edges are finite fractions in
// [0, 1] that form a non-degenerate rectangle, and confidence is a fraction.
export function validateBox(answer: any): { box: BoxEdges; confidence: number } {
  try {
    if (answer?.type !== "box") throw new Error("type");
    const box = answer.box;
    const isFraction = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
    if (![box?.top, box?.bottom, box?.left, box?.right].every(isFraction)) throw new Error("edges");
    if (!(box.left < box.right && box.top < box.bottom)) throw new Error("order");
    if (!isFraction(answer.confidence)) throw new Error("confidence");
    return {
      box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
      confidence: answer.confidence,
    };
  } catch {
    throw new Error("TypeSafe returned a malformed box.");
  }
}

/** Fractions of the image → pixel rect, rounded to whole pixels. */
export function boxToPixels(box: BoxEdges, width: number, height: number): PixelRect {
  const x = Math.round(box.left * width);
  const y = Math.round(box.top * height);
  const right = Math.round(box.right * width);
  const bottom = Math.round(box.bottom * height);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    center: { x: Math.round((x + right) / 2), y: Math.round((y + bottom) / 2) },
  };
}

/** Image pixels → CSS pixels for a screenshot's device scale factor. */
export function pixelToViewport(center: { x: number; y: number }, scale: number): { x: number; y: number } {
  return { x: Math.round(center.x / scale), y: Math.round(center.y / scale) };
}
