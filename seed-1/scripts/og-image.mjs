import { deflateSync } from 'node:zlib';

// The link preview picture for Dust: a 1200 by 630 PNG drawn in code at build time from the game's
// own shapes and palette (docs/PLAN.md §4 Art policy; render/favicon.svg, render/share-image.ts).
// No image asset, no font and no dependency: shapes are rasterised here and encoded with node:zlib.
// The words a preview shows come from the og:image:alt text in index.html, not from the picture,
// except the name, drawn as block letters.
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const OG_FILE_NAME = 'og-dust.png';

/** @typedef {readonly [number, number, number]} Rgb */

// The scene's palette (render/scene.ts, render/share-image.ts).
/** @type {Record<'background' | 'panel' | 'panelEdge' | 'accent' | 'bar' | 'text', Rgb>} */
const COLORS = {
  background: [0x12, 0x16, 0x1c],
  panel: [0x1c, 0x22, 0x2b],
  panelEdge: [0x2b, 0x34, 0x40],
  accent: [0xd9, 0xa4, 0x41],
  bar: [0x6f, 0xa8, 0xdc],
  text: [0xe8, 0xe6, 0xdf],
};

// 5 by 7 block letters for the name.
/** @type {Record<string, string[]>} */
const GLYPHS = {
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
};

/**
 * @param {number} width
 * @param {number} height
 */
function createCanvas(width, height) {
  const pixels = new Uint8Array(width * height * 3);
  /** @type {(x: number, y: number, color: Rgb, alpha: number) => void} */
  const blend = (x, y, color, alpha) => {
    if (x < 0 || y < 0 || x >= width || y >= height || alpha <= 0) return;
    const a = Math.min(1, alpha);
    const i = (y * width + x) * 3;
    for (let c = 0; c < 3; c += 1) pixels[i + c] = Math.round((pixels[i + c] ?? 0) * (1 - a) + (color[c] ?? 0) * a);
  };
  return {
    pixels,
    /** @type {(x: number, y: number, w: number, h: number, color: Rgb) => void} */
    rect(x, y, w, h, color) {
      for (let py = Math.max(0, Math.floor(y)); py < Math.min(height, Math.ceil(y + h)); py += 1) {
        for (let px = Math.max(0, Math.floor(x)); px < Math.min(width, Math.ceil(x + w)); px += 1) blend(px, py, color, 1);
      }
    },
    // A circle with a one-pixel anti-aliased edge.
    /** @type {(cx: number, cy: number, r: number, color: Rgb) => void} */
    circle(cx, cy, r, color) {
      for (let py = Math.floor(cy - r - 1); py <= Math.ceil(cy + r + 1); py += 1) {
        for (let px = Math.floor(cx - r - 1); px <= Math.ceil(cx + r + 1); px += 1) {
          const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
          blend(px, py, color, r - d + 0.5);
        }
      }
    },
    // A rectangle with round ends (the bar and pills of the scene).
    /** @type {(x: number, y: number, w: number, h: number, color: Rgb) => void} */
    capsule(x, y, w, h, color) {
      const r = h / 2;
      this.rect(x + r, y, w - h, h, color);
      this.circle(x + r, y + r, r, color);
      this.circle(x + w - r, y + r, r, color);
    },
  };
}

/**
 * @param {ReturnType<typeof createCanvas>} canvas
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} cell
 * @param {Rgb} color
 */
function drawText(canvas, text, x, y, cell, color) {
  let left = x;
  for (const ch of text) {
    const rows = GLYPHS[ch] ?? [];
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx += 1) {
        if (row[rx] === '1') canvas.rect(left + rx * cell, y + ry * cell, cell, cell, color);
      }
    });
    left += 6 * cell;
  }
}

/** The picture's raw RGB pixels, row by row. Deterministic: every build draws the same picture. */
export function drawOgPixels() {
  const canvas = createCanvas(OG_WIDTH, OG_HEIGHT);
  canvas.rect(0, 0, OG_WIDTH, OG_HEIGHT, COLORS.background);

  // Motes of dust, scattered by the same fixed sequence as the run card.
  for (let i = 1; i <= 60; i += 1) {
    const x = ((i * 0.7548776662) % 1) * OG_WIDTH;
    const y = ((i * 0.569840291) % 1) * OG_HEIGHT;
    canvas.circle(x, y, 2 + (i % 4), COLORS.panelEdge);
  }

  // The name, in block letters, and a production bar beneath it.
  drawText(canvas, 'DUST', 96, 150, 24, COLORS.accent);
  canvas.capsule(96, 360, 480, 36, COLORS.panel);
  canvas.capsule(96, 360, 330, 36, COLORS.bar);
  // Unlock pills, as the game lists them.
  canvas.capsule(96, 430, 150, 44, COLORS.panelEdge);
  canvas.capsule(262, 430, 190, 44, COLORS.panelEdge);
  canvas.capsule(468, 430, 110, 44, COLORS.panel);

  // The dust pile of the favicon (render/favicon.svg, a 32 unit square), scaled up on the right.
  const scale = 16;
  const ox = 660;
  const oy = 60;
  /** @type {Array<[number, number, number]>} */
  const grains = [

    [16, 21, 8],
    [8, 14, 3],
    [23, 12, 2.5],
    [21, 22, 2],
  ];
  for (const [cx, cy, r] of grains) {
    canvas.circle(ox + cx * scale, oy + cy * scale, r * scale, COLORS.accent);
  }
  // A highlight on the pile, and a gold base line along the bottom edge.
  canvas.circle(ox + 13 * scale, oy + 18 * scale, 2 * scale, [0xe6, 0xbb, 0x66]);
  canvas.rect(0, OG_HEIGHT - 12, OG_WIDTH, 12, COLORS.accent);
  return canvas.pixels;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {Uint8Array} data
 */
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Encodes 8-bit RGB pixels as a PNG file.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgb
 * @returns {Buffer}
 */
export function encodePng(width, height, rgb) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function ogImagePng() {
  return encodePng(OG_WIDTH, OG_HEIGHT, drawOgPixels());
}
