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

// The game's palette (render/style.css, render/scene.ts): paper, ink, the pile's sand, the Dust suit
// magenta and two of the studio's creature fills.
/** @type {Record<'paper' | 'mote' | 'ink' | 'sand' | 'sandDeep' | 'magenta' | 'green' | 'blue' | 'side', Rgb>} */
const COLORS = {
  paper: [0xfd, 0xfc, 0xf8],
  mote: [0xe6, 0xdf, 0xd0],
  ink: [0x15, 0x15, 0x15],
  sand: [0xf1, 0xd9, 0x9c],
  sandDeep: [0xe3, 0xc3, 0x7e],
  magenta: [0xb0, 0x22, 0x6a],
  green: [0x9b, 0xd3, 0xa6],
  blue: [0x8d, 0xb9, 0xe8],
  side: [0xe6, 0xdc, 0xcb],
};

// The name as thick strokes, each letter a list of polylines in a 100 by 160 box.
/** @type {(cx: number, cy: number, r: number, from: number, to: number) => Array<[number, number]>} */
const arc = (cx, cy, r, from, to) => {
  /** @type {Array<[number, number]>} */
  const points = [];
  for (let i = 0; i <= 16; i += 1) {
    const a = from + ((to - from) * i) / 16;
    points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return points;
};
/** @type {Record<string, Array<Array<[number, number]>>>} */
const LETTERS = {
  D: [[[0, 0], [0, 160], [30, 160], ...arc(30, 80, 80, Math.PI / 2, -Math.PI / 2), [0, 0]]],
  U: [[[0, 0], [0, 110], ...arc(50, 110, 50, Math.PI, 0), [100, 0]]],
  S: [[...arc(50, 40, 40, -0.35, -Math.PI * 1.5), ...arc(50, 120, 40, -Math.PI / 2, Math.PI - 0.35)]],
  T: [
    [[0, 0], [100, 0]],
    [[50, 0], [50, 160]],
  ],
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
    // A stroke with round caps from (x1, y1) to (x2, y2), `w` wide, with an anti-aliased edge.
    /** @type {(x1: number, y1: number, x2: number, y2: number, w: number, color: Rgb) => void} */
    line(x1, y1, x2, y2, w, color) {
      const r = w / 2;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy || 1;
      for (let py = Math.floor(Math.min(y1, y2) - r - 1); py <= Math.ceil(Math.max(y1, y2) + r + 1); py += 1) {
        for (let px = Math.floor(Math.min(x1, x2) - r - 1); px <= Math.ceil(Math.max(x1, x2) + r + 1); px += 1) {
          const t = Math.max(0, Math.min(1, ((px + 0.5 - x1) * dx + (py + 0.5 - y1) * dy) / len2));
          const d = Math.hypot(px + 0.5 - (x1 + t * dx), py + 0.5 - (y1 + t * dy));
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
 * @param {number} scale
 * @param {number} weight
 * @param {Rgb} color
 */
function drawText(canvas, text, x, y, scale, weight, color) {
  let left = x;
  for (const ch of text) {
    for (const stroke of LETTERS[ch] ?? []) {
      for (let i = 1; i < stroke.length; i += 1) {
        const [ax, ay] = stroke[i - 1] ?? [0, 0];
        const [bx, by] = stroke[i] ?? [0, 0];
        canvas.line(left + ax * scale, y + ay * scale, left + bx * scale, y + by * scale, weight, color);
      }
    }
    left += 140 * scale;
  }
}

/** The picture's raw RGB pixels, row by row. Deterministic: every build draws the same picture. */
export function drawOgPixels() {
  const canvas = createCanvas(OG_WIDTH, OG_HEIGHT);
  canvas.rect(0, 0, OG_WIDTH, OG_HEIGHT, COLORS.paper);

  // The page's dot grid.
  for (let y = 11; y < OG_HEIGHT; y += 22) {
    for (let x = 11; x < OG_WIDTH; x += 22) canvas.circle(x, y, 1.4, COLORS.mote);
  }

  // The name in block letters: an ink shadow offset down and right, then the letters in ink with a
  // paper inner cut, the studio's thick-line look.
  drawText(canvas, 'DUST', 124, 128, 1.12, 40, COLORS.magenta);
  drawText(canvas, 'DUST', 116, 120, 1.12, 40, COLORS.ink);
  // A goal bar: ink outline, magenta fill.
  canvas.capsule(96, 372, 500, 40, COLORS.ink);
  canvas.capsule(101, 377, 490, 30, COLORS.paper);
  canvas.capsule(101, 377, 330, 30, COLORS.magenta);
  // Unlock pills, outlined in ink.
  /** @type {Array<[number, number]>} */
  const pills = [
    [96, 150],
    [262, 190],
    [468, 120],
  ];
  for (const [x, w] of pills) {
    canvas.capsule(x, 440, w, 48, COLORS.ink);
    canvas.capsule(x + 4, 444, w - 8, 40, COLORS.paper);
  }

  // The island: an ink-edged diamond slab with its side, the pile and its flag, two trees.
  const cx = 900;
  const cy = 330;
  const hw = 230;
  const hh = 120;
  /** @type {(dy: number, color: Rgb, grow: number) => void} */
  const diamond = (dy, color, grow) => {
    for (let y = -hh - grow; y <= hh + grow; y += 1) {
      const half = (hw + grow * 2) * (1 - Math.abs(y) / (hh + grow));
      canvas.rect(cx - half, cy + dy + y, half * 2, 1, color);
    }
  };
  diamond(110, COLORS.mote, 6);
  for (let d = 56; d >= 0; d -= 1) diamond(d, d === 56 || d === 0 ? COLORS.ink : d % 18 === 0 ? COLORS.ink : COLORS.side, 4);
  diamond(0, COLORS.paper, 0);
  // The pile: a dome of sand edged in ink, its right flank in shade.
  /** @type {(r: number, color: Rgb, shift: number) => void} */
  const dome = (r, color, shift) => {
    for (let y = -r; y <= 0; y += 1) {
      const half = Math.sqrt(r * r - y * y);
      canvas.rect(cx - half + shift, cy + 40 + y, half * 2, 1, color);
    }
  };
  dome(104, COLORS.ink, 0);
  dome(97, COLORS.sand, 0);
  for (let y = -60; y <= 0; y += 1) {
    const half = Math.sqrt(97 * 97 - y * y);
    canvas.rect(cx + half * 0.35, cy + 40 + y, half * 0.65, 1, COLORS.sandDeep);
  }
  canvas.rect(cx - 104, cy + 37, 208, 7, COLORS.ink);
  // The flag.
  canvas.rect(cx - 5, cy - 150, 10, 90, COLORS.ink);
  for (let y = 0; y < 44; y += 1) canvas.rect(cx + 5, cy - 150 + y, 76 * (1 - Math.abs(y - 22) / 22), 1, COLORS.magenta);
  // Two trees and a pond.
  /** @type {Array<[number, number]>} */
  const trees = [
    [cx - 160, cy + 10],
    [cx + 150, cy - 6],
  ];
  for (const [tx, ty] of trees) {
    canvas.circle(tx, ty, 30, COLORS.ink);
    canvas.circle(tx, ty, 25, COLORS.green);
  }
  canvas.circle(cx + 40, cy + 84, 24, COLORS.ink);
  canvas.circle(cx + 40, cy + 84, 19, COLORS.blue);

  // The suit band along the bottom edge, ruled off in ink.
  canvas.rect(0, OG_HEIGHT - 26, OG_WIDTH, 6, COLORS.ink);
  canvas.rect(0, OG_HEIGHT - 20, OG_WIDTH, 20, COLORS.magenta);
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
