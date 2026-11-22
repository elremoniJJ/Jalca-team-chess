import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

/** CRC-32 (IEEE 802.3), the checksum every PNG chunk carries. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Cover for the OpenChat channel icon ASSET.
 *
 * The accepted change crops the user-supplied OpenChat channel icon tight to
 * the drawn figure (so the figure fills the icon box instead of sitting tiny
 * inside a large white margin), preserves the white background, and writes the
 * result to `src/frontend/public/assets/openchat/openchat-channel-icon.png`.
 *
 * The component-level wiring (link target, accessible name, em sizing, and
 * document order relative to the wordmark in both headers) is covered in
 * openchat-icon-cover.test.tsx. This file pins the on-disk artifact the
 * component references:
 *
 *   - the PNG exists and is a real, non-empty PNG (magic number, not a renamed
 *     placeholder);
 *   - it is square, so the figure is not distorted in the icon box;
 *   - it is cropped tight to the figure — the drawn (non-white) content reaches
 *     near every edge, so the figure fills the icon box rather than floating in
 *     a large white margin;
 *   - the white background is preserved — the border pixels are white, not
 *     transparent or a different colour.
 *
 * Paths are resolved from the frontend package root (the working directory the
 * `test` script runs in) rather than from `import.meta.url`, which Vitest
 * rewrites to a non-file URL under jsdom.
 */

const ICON_PATH = resolve(
  process.cwd(),
  "public/assets/openchat/openchat-channel-icon.png",
);

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

interface DecodedPng {
  width: number;
  height: number;
  /** PNG colour type from IHDR (2 = truecolour RGB, 6 = truecolour+alpha). */
  colorType: number;
  /** PNG bit depth from IHDR. */
  bitDepth: number;
  /** PNG interlace method from IHDR (0 = none). */
  interlace: number;
  /** Chunk type names in file order, e.g. ["IHDR", "IDAT", "IEND"]. */
  chunkTypes: string[];
  /** RGBA pixels, 4 bytes per pixel, row-major. */
  pixels: Uint8Array;
}

/**
 * Minimal PNG decoder for the single-image, 8-bit RGB/RGBA, non-interlaced
 * PNGs this asset uses. It parses IHDR, concatenates IDAT, inflates, and
 * reverses the per-scanline filters. It is deliberately small: the test only
 * needs pixel values to find the figure's bounding box and sample the border.
 *
 * It also validates the structural properties a browser needs to render the
 * image at all: every chunk's CRC, a complete IEND, and a fully-consumed
 * inflated pixel stream. A PNG that fails any of these shows the browser's
 * broken-image placeholder even though the file "is a PNG" by magic number.
 */
function decodePng(png: Buffer): DecodedPng {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a PNG");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let sawIend = false;
  const idat: Buffer[] = [];
  const chunkTypes: string[] = [];

  while (offset < png.length) {
    if (offset + 12 > png.length) {
      throw new Error("truncated PNG chunk header");
    }
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    const crc = png.readUInt32BE(offset + 8 + length);
    const expectedCrc = crc32(png.subarray(offset + 4, offset + 8 + length));
    if (crc !== expectedCrc) {
      throw new Error(`bad CRC on ${type} chunk`);
    }
    chunkTypes.push(type);
    offset += 12 + length; // length + type + data + CRC

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      sawIend = true;
      break;
    }
  }

  if (!sawIend) {
    throw new Error("missing IEND chunk");
  }
  if (bitDepth !== 8) {
    throw new Error(`unsupported bit depth ${bitDepth}`);
  }
  if (interlace !== 0) {
    throw new Error("interlaced PNGs are not supported");
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) {
    throw new Error(`unsupported colour type ${colorType}`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const expectedRawLength = height * (stride + 1);
  if (raw.length !== expectedRawLength) {
    throw new Error(
      `inflated pixel stream is ${raw.length} bytes, expected ${expectedRawLength}`,
    );
  }
  const pixels = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);

  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    for (let i = 0; i < stride; i++) {
      const x = raw[pos++];
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = x;
          break;
        case 1:
          value = x + a;
          break;
        case 2:
          value = x + b;
          break;
        case 3:
          value = x + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          value = x + pred;
          break;
        }
        default:
          throw new Error(`unknown filter ${filter}`);
      }
      cur[i] = value & 0xff;
    }

    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      pixels[dst] = cur[src];
      pixels[dst + 1] = cur[src + 1];
      pixels[dst + 2] = cur[src + 2];
      pixels[dst + 3] = channels === 4 ? cur[src + 3] : 255;
    }
    prev.set(cur);
  }

  return { width, height, colorType, bitDepth, interlace, chunkTypes, pixels };
}

/** A pixel is "figure" when it is not near-white and not transparent. */
function isFigure(pixels: Uint8Array, index: number): boolean {
  const r = pixels[index];
  const g = pixels[index + 1];
  const b = pixels[index + 2];
  const a = pixels[index + 3];
  if (a < 16) return false;
  return r < 240 || g < 240 || b < 240;
}

describe("OpenChat channel icon asset", () => {
  it("exists as a non-empty, valid PNG", () => {
    const stat = statSync(ICON_PATH);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);

    const png = readFileSync(ICON_PATH);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

    const decoded = decodePng(png);
    expect(decoded.width).toBeGreaterThan(0);
    expect(decoded.height).toBeGreaterThan(0);
  });

  it("is a browser-safe PNG: 8-bit truecolour (RGB/RGBA), not palette/indexed", () => {
    // A palette/indexed PNG (colour type 3) or a non-8-bit image can fail to
    // decode in the browser and render as the broken-image placeholder even
    // though the file passes a magic-number check. Pin the exact colour model
    // the browser needs: 8-bit truecolour RGB (2) or RGBA (6), non-interlaced.
    const decoded = decodePng(readFileSync(ICON_PATH));

    expect(decoded.bitDepth).toBe(8);
    expect([2, 6]).toContain(decoded.colorType);
    expect(decoded.colorType).not.toBe(3); // palette / indexed
    expect(decoded.interlace).toBe(0);
  });

  it("has valid chunk CRCs, a complete IEND, and a fully-decodable pixel stream", () => {
    // decodePng throws on a bad CRC, a missing IEND, or a truncated/oversized
    // inflated pixel stream, so a successful decode is itself the assertion.
    // Assert the structural shape explicitly so a regression that drops IEND
    // or reorders chunks is caught with a clear message.
    const decoded = decodePng(readFileSync(ICON_PATH));

    expect(decoded.chunkTypes[0]).toBe("IHDR");
    expect(decoded.chunkTypes).toContain("IDAT");
    expect(decoded.chunkTypes[decoded.chunkTypes.length - 1]).toBe("IEND");
    // Every pixel was decoded: the RGBA buffer is exactly width*height*4.
    expect(decoded.pixels.length).toBe(decoded.width * decoded.height * 4);
  });

  it("is square so the figure is not distorted in the icon box", () => {
    const { width, height } = decodePng(readFileSync(ICON_PATH));
    expect(width).toBe(height);
  });

  it("is cropped tight to the figure rather than padded with a large white margin", () => {
    const { width, height, pixels } = decodePng(readFileSync(ICON_PATH));

    // Find the bounding box of the drawn (non-white) figure.
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (isFigure(pixels, (y * width + x) * 4)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    expect(maxX).toBeGreaterThanOrEqual(0);
    expect(maxY).toBeGreaterThanOrEqual(0);

    // The figure must reach near every edge: the tight crop leaves only a
    // small white margin. A regression that re-pads the image (the bug this
    // change fixes) would leave the figure small and centred, so the margin
    // would be a large fraction of the canvas.
    const margin = Math.round(Math.min(width, height) * 0.2);
    expect(minX).toBeLessThanOrEqual(margin);
    expect(minY).toBeLessThanOrEqual(margin);
    expect(width - 1 - maxX).toBeLessThanOrEqual(margin);
    expect(height - 1 - maxY).toBeLessThanOrEqual(margin);

    // The figure's bounding box must fill most of the canvas area, which is
    // the observable outcome of cropping tight to the figure.
    const bboxArea = (maxX - minX + 1) * (maxY - minY + 1);
    expect(bboxArea / (width * height)).toBeGreaterThanOrEqual(0.6);
  });

  it("preserves the white background", () => {
    const { width, height, pixels } = decodePng(readFileSync(ICON_PATH));

    // The four corners are background, not figure. They must be opaque white,
    // so the white background is preserved rather than made transparent or
    // tinted.
    const corners = [
      0,
      (width - 1) * 4,
      (height - 1) * width * 4,
      ((height - 1) * width + (width - 1)) * 4,
    ];
    for (const index of corners) {
      expect(pixels[index]).toBe(255);
      expect(pixels[index + 1]).toBe(255);
      expect(pixels[index + 2]).toBe(255);
      expect(pixels[index + 3]).toBe(255);
    }
  });
});
