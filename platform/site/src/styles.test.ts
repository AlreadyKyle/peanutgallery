import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { COLOUR_PAIRS, COLOUR_TOKENS, MARK_PAIRS } from './lib/colour';
import { contrast } from './lib/contrast';

// DESIGN.md is the style guide; these tests keep the stylesheets to it. tokens.css holds every token
// and every colour; styles.css holds the rules.
// jsdom gives import.meta.url an http scheme, so resolve from the package root vitest runs in.
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const tokens = read('src/tokens.css');
const styles = read('src/styles.css');
const both = `${tokens}\n${styles}`;
const FONT = 'public/fonts/atkinson-hyperlegible-next-400-700.woff2';
const SIZES = ['--size-small', '--size-body', '--size-lead', '--size-large', '--size-display'];

function rem(token: string): number {
  const match = tokens.match(new RegExp(`${token}:\\s*([0-9.]+)rem`));
  if (!match) throw new Error(`${token} is not defined`);
  return Number(match[1]);
}

/** A colour token's six-digit hex from tokens.css, following an alias such as --suit-studio: var(--signal). */
function hex(token: string): string {
  const match = tokens.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6}|var\\((--[a-z-]+)\\))`));
  if (!match) throw new Error(`${token} is not a six-digit hex colour`);
  return match[2] === undefined ? match[1]! : hex(match[2]);
}

type Rule = { selector: string; body: string; media: string };

/** Each rule as its selector, its body and the @media it sits in (or ''), comments removed. */
function rules(css: string): Rule[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  let depth = 0;
  let media = '';
  let start = 0;
  let mediaDepth = -1;
  for (let i = 0; i < plain.length; i += 1) {
    const ch = plain[i];
    if (ch === '{') {
      const prelude = plain.slice(start, i).trim();
      if (prelude.startsWith('@media') || prelude.startsWith('@supports') || prelude.startsWith('@layer')) {
        media = prelude;
        mediaDepth = depth;
        depth += 1;
        start = i + 1;
        continue;
      }
      const end = plain.indexOf('}', i);
      out.push({ selector: prelude, body: plain.slice(i + 1, end), media: mediaDepth >= 0 ? media : '' });
      i = end;
      start = i + 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === mediaDepth) {
        mediaDepth = -1;
        media = '';
      }
      start = i + 1;
    } else if (ch === ';' && depth === 0 && plain.slice(start, i).trim().startsWith('@import')) {
      start = i + 1;
    }
  }
  return out;
}

const ALL_RULES = [...rules(tokens), ...rules(styles)];

// Tokens that alias a colour for a role (the studio suit is the signal) are colours too; the role
// tokens (--primary-bg and the rest) name no colour of their own.
const ROLES = ['--text-muted', '--hairline', '--focus-colour', '--primary-bg', '--primary-fg', '--primary-hover', '--primary-press', '--outline-bg', '--outline-fg', '--outline-hover', '--outline-press', '--coin-hover', '--quiet-fg', '--quiet-edge', '--suit-tile-game', '--suit-tile-studio', '--live-mark'];

// Colour vision (Machado 2009 at severity 1.0 on linear sRGB), then CIE76 delta-E in CIELAB (D65).
const CVD_MODES = ['normal', 'protan', 'deutan', 'tritan'] as const;
type CvdMode = (typeof CVD_MODES)[number];
const MACHADO: Record<CvdMode, number[][]> = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function lab(colour: string, mode: CvdMode): number[] {
  const linear = [1, 3, 5].map((i) => {
    const v = parseInt(colour.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = MACHADO[mode].map((row) => Math.min(1, Math.max(0, row[0]! * linear[0]! + row[1]! * linear[1]! + row[2]! * linear[2]!)));
  const x = (0.4124 * r! + 0.3576 * g! + 0.1805 * b!) / 0.95047;
  const y = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  const z = (0.0193 * r! + 0.1192 * g! + 0.9505 * b!) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE(a: string, b: string, mode: CvdMode): number {
  const [p, q] = [lab(a, mode), lab(b, mode)];
  return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
}

const selectorsOf = (rule: Rule) => rule.selector.split(',').map((s) => s.trim().replace(/\s+/g, ' '));

describe('tokens.css', () => {
  it('is imported first by styles.css, and is light only', () => {
    expect(styles.trimStart().startsWith("@import './tokens.css';")).toBe(true);
    expect(tokens).toMatch(/color-scheme:\s*light;/);
    expect(both).not.toMatch(/prefers-color-scheme/);
  });

  it('writes colours only in tokens.css, and there only in :root', () => {
    const colour = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
    expect(rules(styles).filter((rule) => colour.test(rule.body)).map((rule) => rule.selector)).toEqual([]);
    expect(rules(tokens).filter((rule) => rule.selector !== ':root' && colour.test(rule.body)).map((rule) => rule.selector)).toEqual([]);
  });

  it('retires --accent, --track, --radius-box and --ground', () => {
    expect(both).not.toMatch(/--accent\b|--track\b|--radius-box\b|--ground\b/);
  });
});

describe('type scale', () => {
  it('defines exactly the five sizes, in increasing order', () => {
    const defined = [...tokens.matchAll(/(--size-[a-z]+):\s*[0-9.]+rem/g)].map((m) => m[1]);
    expect(defined).toEqual(SIZES);
    const values = SIZES.map(rem);
    for (let i = 1; i < values.length; i += 1) expect(values[i]).toBeGreaterThan(values[i - 1]!);
    expect(values.map((v) => v * 16)).toEqual([14, 17, 20, 24, 30]);
  });

  it('keeps each step within a 1.2 ratio of its neighbour, rounded to the nearest quarter pixel', () => {
    const values = SIZES.map(rem);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]! / values[i - 1]!).toBeGreaterThan(1.15);
      expect(values[i]! / values[i - 1]!).toBeLessThan(1.26);
    }
  });

  it('sets every font-size from a size token', () => {
    const declarations = [...both.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    const stray = declarations.filter((value) => !/^var\(--size-(small|body|lead|large|display)\)$/.test(value) && value !== '0.9em');
    expect(stray).toEqual([]);
  });

  it('sets card titles at the lead size and bold', () => {
    const title = ALL_RULES.find((rule) => rule.selector === '.card h3');
    expect(title?.body).toMatch(/font-size:\s*var\(--size-lead\)/);
    expect(title?.body).toMatch(/font-weight:\s*var\(--weight-bold\)/);
  });

  it('uses nothing below weight 400', () => {
    for (const match of tokens.matchAll(/--weight-[a-z]+:\s*(\d+)/g)) expect(Number(match[1])).toBeGreaterThanOrEqual(400);
    for (const match of both.matchAll(/font-weight:\s*([^;]+);/g)) {
      const value = match[1]!.trim();
      expect(/^var\(--weight-(body|medium|strong|bold)\)$/.test(value) || /^400 700$/.test(value), value).toBe(true);
    }
  });
});

describe('the font', () => {
  it('loads one same-origin woff2 under /fonts/, with swap, weights 400 to 700', () => {
    const faces = [...tokens.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    const urls = faces.flatMap((face) => [...face.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]!.replace(/['"]/g, '')));
    expect(urls).toEqual(['/fonts/atkinson-hyperlegible-next-400-700.woff2']);
    expect(faces[0]).toMatch(/font-display:\s*swap/);
    expect(faces[0]).toMatch(/font-weight:\s*400 700/);
  });

  it('computes the fallback metrics (scripts/font-metrics.py) instead of leaving the swap to chance', () => {
    const fallback = [...tokens.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!).find((face) => /Atkinson Fallback/.test(face));
    for (const descriptor of ['size-adjust', 'ascent-override', 'descent-override', 'line-gap-override']) {
      expect(fallback, descriptor).toMatch(new RegExp(`${descriptor}:\\s*[0-9.]+%`));
    }
    expect(tokens).toMatch(/--font-sans:\s*'Atkinson Hyperlegible Next', 'Atkinson Fallback'/);
  });

  it('preloads the font from index.html', () => {
    expect(read('index.html')).toContain(
      '<link rel="preload" href="/fonts/atkinson-hyperlegible-next-400-700.woff2" as="font" type="font/woff2" crossorigin />',
    );
  });

  it('stays within its 18,208-byte budget and ships its licence', () => {
    expect(statSync(resolve(process.cwd(), FONT)).size).toBeLessThanOrEqual(18_208);
    expect(read('public/fonts/OFL.txt')).toMatch(/SIL Open Font License, Version 1\.1/);
  });

  it('keeps tabular figures (tnum) in its GSUB, which pyftsubset drops by default', () => {
    expect(gsubFeatures(readFileSync(resolve(process.cwd(), FONT)))).toEqual(expect.arrayContaining(['tnum', 'case', 'locl']));
  });
});

// The WOFF2 known-table tags, in the order the format numbers them (only those up to GSUB matter here).
const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

/** The feature tags in a WOFF2 file's GSUB table: its table directory read, its tables decompressed. */
function gsubFeatures(file: Buffer): string[] {
  expect(file.toString('ascii', 0, 4)).toBe('wOF2');
  const numTables = file.readUInt16BE(12);
  const compressedSize = file.readUInt32BE(20);
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i += 1) {
      const byte = file[at++]!;
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error('bad UIntBase128');
  };
  const tables: { tag: string; length: number }[] = [];
  for (let t = 0; t < numTables; t += 1) {
    const flags = file[at++]!;
    const tag = (flags & 0x3f) === 63 ? file.toString('ascii', at, (at += 4)) : KNOWN[flags & 0x3f]!;
    const version = flags >> 6;
    const origLength = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    tables.push({ tag, length: transformed ? base128() : origLength });
  }
  const data = brotliDecompressSync(file.subarray(at, at + compressedSize));
  let offset = 0;
  for (const table of tables) {
    if (table.tag === 'GSUB') {
      const gsub = data.subarray(offset, offset + table.length);
      const list = gsub.readUInt16BE(6);
      const count = gsub.readUInt16BE(list);
      return Array.from({ length: count }, (_, i) => gsub.toString('ascii', list + 2 + i * 6, list + 6 + i * 6));
    }
    offset += table.length;
  }
  return [];
}

describe('plain and readable', () => {
  it('uses uppercase only on the wordmark, and italic nowhere', () => {
    const upper = ALL_RULES.filter((rule) => /text-transform:\s*uppercase/.test(rule.body)).map((rule) => rule.selector);
    expect(upper).toEqual(['.wordmark']);
    expect(both).not.toMatch(/font-style:\s*(italic|oblique)/);
    expect(ALL_RULES.find((rule) => rule.selector === 'body')?.body).toMatch(/font-synthesis-style:\s*none/);
  });

  it('balances the lines of every heading', () => {
    const headings = ALL_RULES.find((rule) => rule.selector.replace(/\s+/g, '') === 'h1,h2,h3');
    expect(headings?.body).toMatch(/text-wrap:\s*balance/);
  });

  it('never uses the 900 display weight or letter-spacing', () => {
    expect(both).not.toMatch(/font-weight:\s*900|--weight-display|letter-spacing/);
  });

  it('gives buttons, nav links and fields the 44px touch target', () => {
    expect(tokens).toMatch(/--target:\s*2\.75rem/);
    for (const selector of ['.button,\nbutton', 'nav a', 'input,\nselect,\ntextarea']) {
      const rule = rules(styles).find((r) => r.selector === selector);
      expect(rule?.body, selector).toContain('min-height: var(--target)');
    }
  });
});

describe('colour (DESIGN.md, Colour), measured from tokens.css', () => {
  it('lists every colour token of tokens.css in lib/colour.ts, and nothing else', () => {
    const defined = [...tokens.matchAll(/^\s*(--[a-z-]+):\s*(#[0-9a-fA-F]{6}|var\(--[a-z-]+\));/gm)]
      .filter((m) => m[2]!.startsWith('#') || !ROLES.includes(m[1]!))
      .map((m) => m[1]!)
      .filter((name) => !name.startsWith('--creature-'));
    expect(COLOUR_TOKENS.map((token) => token.name).sort()).toEqual(defined.sort());
  });

  for (const pair of COLOUR_PAIRS) {
    const label = `${pair.fg} on ${pair.bg}`;
    if (pair.banned) {
      it(`keeps ${label} below ${pair.floor}, so a rule keeps it off the page`, () => {
        expect(contrast(hex(pair.fg), hex(pair.bg))).toBeLessThan(pair.floor);
      });
    } else if (pair.floor > 0) {
      it(`measures ${label} at ${pair.floor} or better`, () => {
        expect(contrast(hex(pair.fg), hex(pair.bg))).toBeGreaterThanOrEqual(pair.floor);
      });
    }
  }

  it('keeps every pair of marks at least 25 delta-E apart under normal vision, protanopia, deuteranopia and tritanopia', () => {
    for (const [a, b] of MARK_PAIRS) {
      for (const mode of CVD_MODES) {
        expect(deltaE(hex(a), hex(b), mode), `${a} vs ${b}, ${mode}`).toBeGreaterThanOrEqual(25);
      }
    }
  });

  it('draws the change marker at 3:1 or better on paper, work, signal and ink (currentColor: ink, ink, paper, paper)', () => {
    expect(contrast(hex('--ink'), hex('--paper'))).toBeGreaterThanOrEqual(3);
    expect(contrast(hex('--ink'), hex('--work'))).toBeGreaterThanOrEqual(3);
    expect(contrast(hex('--paper'), hex('--signal'))).toBeGreaterThanOrEqual(3);
    expect(contrast(hex('--paper'), hex('--ink'))).toBeGreaterThanOrEqual(3);
  });

  it('never gives text a colour: coin, signal, suit and live stay out of color:, but for the Live mark, and the suit tile glyph is paper', () => {
    const coloured = /(^|[;\s])color:\s*var\(--(coin|signal|suit|live)/;
    expect(ALL_RULES.filter((rule) => coloured.test(rule.body)).map((rule) => rule.selector)).toEqual(["[data-state='live'] > .glyph"]);
    expect(ALL_RULES.find((rule) => rule.selector === "[data-state='live'] > .glyph")?.body).toMatch(/color:\s*var\(--live-mark\)/);
    expect(ALL_RULES.find((rule) => rule.selector === '.suit-tile')?.body).toMatch(/color:\s*var\(--paper\)/);
  });

  it('uses amber only for money: Contribute, the funding bar, the coin mark and the Funded glyph', () => {
    const amber = rules(styles)
      .filter((rule) => /var\(--coin(-down|-up|-hover)?\)/.test(rule.body))
      .flatMap(selectorsOf);
    expect(amber.sort()).toEqual(
      [
        '.coin-face',
        '.glyph-money',
        '.funding-bar-fill',
        '.button.btn-coin',
        '.button.btn-coin:hover',
        '.button.btn-coin:active',
        'main > .band:first-child',
        '.page:has(> main > .band:first-child) > .topbar',
      ].sort(),
    );
    // The signal plate's only amber is the hover it gives Contribute there.
    const signal = rules(styles).filter((rule) => rule.selector.startsWith('main > .band:first-child'));
    expect(signal.flatMap((rule) => rule.body.match(/var\(--coin[a-z-]*\)/g) ?? [])).toEqual(['var(--coin-up)']);
    expect(tokens).toMatch(/--coin-hover:\s*var\(--coin-down\)/);
  });

  it('draws every glyph in currentColor, but the Funded glyph and the coin mark, which are money', () => {
    const fills = ALL_RULES.filter((rule) => /(^|[;\s])fill:\s*var\(--/.test(rule.body)).map((rule) => rule.selector);
    expect(fills.filter((selector) => /glyph|coin/.test(selector)).sort()).toEqual(['.coin-face', '.glyph-money']);
    for (const selector of ['.glyph-line', '.glyph-fill']) {
      expect(ALL_RULES.find((rule) => rule.selector === selector)?.body).toMatch(/currentColor/);
    }
  });

  it('fills the overscroll with the top bar ground: html paints a solid signal and body paints nothing', () => {
    // Browsers fill a pull past the edge with the root's background colour, never an image, and
    // WebKit blends body's colour over it; .page paints the paper.
    const html = ALL_RULES.filter((rule) => rule.selector === 'html');
    expect(html.map((rule) => rule.body.match(/background[a-z-]*:[^;]*/g) ?? []).flat()).toEqual(['background-color: var(--signal)']);
    expect(ALL_RULES.filter((rule) => /(^|,)\s*html\b/.test(rule.selector) && rule.selector !== 'html' && /background/.test(rule.body))).toEqual([]);
    expect(ALL_RULES.filter((rule) => rule.selector === 'body' && /background/.test(rule.body))).toEqual([]);
    expect(ALL_RULES.find((rule) => rule.selector === '.page')?.body).toMatch(/background:\s*var\(--paper\)/);
  });

  it('never uses a gradient but for the Paused hatch, nor a glow or shadow but the change marker', () => {
    const gradients = ALL_RULES.filter((rule) => /gradient\(/.test(rule.body)).map((rule) => rule.selector);
    expect(gradients).toEqual([".card[data-face='paused']::before"]);
    const shadows = ALL_RULES.filter((rule) => /(box|text)-shadow:/.test(rule.body)).map((rule) => rule.selector);
    expect(shadows).toEqual(['.changed']);
  });
});

describe('bands', () => {
  const SIGNAL_GROUND = ['main > .band:first-child', '.page:has(> main > .band:first-child) > .topbar'];
  const INK_GROUND = ['main > .band:nth-child(2n + 3)', '.page:has(> main > .band:last-child:nth-child(even)) > .site-footer'];
  const PAPER_GROUND = ['main > .band:nth-child(even)', '.page:has(> main > .band:last-child:nth-child(odd)) > .site-footer'];
  const block = (selectors: string[]) => ALL_RULES.find((rule) => selectorsOf(rule).join('|') === selectors.join('|'));
  const grounded = (token: string) =>
    ALL_RULES.filter(
      (rule) =>
        new RegExp(`(^|[;\\s])background:\\s*var\\(--${token}\\)`).test(rule.body) &&
        selectorsOf(rule).some((s) => /(\.band(:[a-z-]+\([^)]*\))*|\.site-footer|\.topbar)$/.test(s)),
    ).flatMap(selectorsOf);

  it('colours bands only by their position: band 1 signal, even bands paper, odd bands from 3 ink, the footer the next', () => {
    expect(grounded('signal')).toEqual(SIGNAL_GROUND);
    expect(grounded('ink')).toEqual(INK_GROUND);
    expect(grounded('paper')).toEqual(PAPER_GROUND);
    // Band 2 is always paper, so the signal plate never touches ink; the footer is never signal.
    expect(SIGNAL_GROUND.some((s) => s.includes('site-footer'))).toBe(false);
    const classes = [...both.matchAll(/\.([a-z][a-z0-9-]*)/gi)].map((m) => m[1]!);
    expect(classes.filter((name) => /band-|-band|on-ink|on-signal|ink-|dark/.test(name) && name !== 'band')).toEqual([]);
  });

  it('resets the roles on the signal plate and on ink, and turns the focus ring paper there: 3px at a 2px offset', () => {
    const focus = ALL_RULES.find((rule) => rule.selector === ':focus-visible');
    expect(focus?.body).toMatch(/outline:\s*3px solid var\(--focus-colour\)/);
    expect(focus?.body).toMatch(/outline-offset:\s*2px/);
    expect(tokens).toMatch(/--focus-colour:\s*var\(--signal\)/);
    expect(tokens).toMatch(/--primary-bg:\s*var\(--signal\)/);
    const signal = block(SIGNAL_GROUND)?.body ?? '';
    const ink = block(INK_GROUND)?.body ?? '';
    for (const body of [signal, ink]) {
      expect(body).toMatch(/--focus-colour:\s*var\(--paper\)/);
      expect(body).toMatch(/--suit-tile-game:\s*transparent/);
      expect(body).toMatch(/--suit-tile-studio:\s*transparent/);
      expect(body).toMatch(/--live-mark:\s*currentColor/);
      expect(body).toMatch(/--primary-bg:\s*var\(--paper\)/);
      expect(body).toMatch(/--mark-filter:\s*invert\(1\)/);
    }
    expect(signal).toMatch(/--text-muted:\s*var\(--muted-on-signal\)/);
    expect(signal).toMatch(/--hairline:\s*var\(--line-on-signal\)/);
    expect(signal).toMatch(/--coin-hover:\s*var\(--coin-up\)/);
    expect(signal).toMatch(/--quiet-edge:\s*var\(--muted-on-signal\)/);
    expect(ink).toMatch(/--text-muted:\s*var\(--muted-on-ink\)/);
    expect(ink).toMatch(/--hairline:\s*var\(--line-on-ink\)/);
    expect(ink).not.toMatch(/--coin-hover/);
  });

  it('draws the change marker and the pressed border in currentColor, never var(--ink)', () => {
    const changed = ALL_RULES.filter((rule) => selectorsOf(rule).some((s) => s.includes('.changed')));
    expect(changed.length).toBeGreaterThan(0);
    for (const rule of changed) {
      expect(rule.body).toMatch(/box-shadow:\s*inset 3px 0 0 currentColor/);
      expect(rule.body).not.toMatch(/var\(--ink\)/);
    }
    const pressed = ALL_RULES.filter((rule) => rule.selector.includes("aria-pressed='true'"));
    expect(pressed.length).toBeGreaterThan(0);
    for (const rule of pressed) {
      expect(rule.body).toMatch(/border(-color)?:\s*(3px solid )?currentColor|border-width:\s*3px/);
      expect(rule.body).not.toMatch(/var\(--ink\)/);
    }
  });

  it('keeps Contribute ink on coin on every ground: it sets its own colour after the link rules, and no band rule repaints links', () => {
    const coin = rules(styles).find((rule) => rule.selector.startsWith('.button.btn-coin,'));
    expect(coin?.body).toMatch(/color:\s*var\(--ink\)/);
    expect(styles.indexOf('.button.btn-coin')).toBeGreaterThan(styles.indexOf('\na {'));
    const repaint = ALL_RULES.filter(
      (rule) => selectorsOf(rule).some((s) => /(nth-child\([^)]*\)|first-child)[^,]*\ba\b/.test(s)) && /(^|[;\s])color:/.test(rule.body),
    );
    expect(repaint).toEqual([]);
  });

  it('marks each band edge with a CanvasText rule, keeps the peanut unfiltered, and keeps the money glyph and suit tiles legible under forced colours', () => {
    const forced = ALL_RULES.filter((rule) => rule.media.includes('forced-colors: active'));
    expect(forced.find((rule) => rule.selector.includes('main > .band + .band'))?.body).toMatch(/border-top:\s*1px solid CanvasText/);
    expect(forced.find((rule) => rule.selector === '.mark')?.body).toMatch(/filter:\s*none/);
    expect(forced.find((rule) => rule.selector === '.funding-bar-fill')?.body).toMatch(/forced-color-adjust:\s*none[\s\S]*background:\s*Highlight/);
    expect(forced.find((rule) => rule.selector === '.glyph-money')?.body).toMatch(/fill:\s*CanvasText/);
    expect(forced.find((rule) => rule.selector === '.suit-tile')?.body).toMatch(/border:\s*1px solid CanvasText/);
  });
});

describe('no dead space (DESIGN.md)', () => {
  it('fills every row of a card grid, a team grid and a fill grid: two columns from 48rem, three from 72rem, never a hidden card', () => {
    const fill = rules(styles).filter((rule) => /grid-column:\s*span [34]/.test(rule.body));
    expect(fill.length).toBeGreaterThanOrEqual(2);
    for (const rule of fill) for (const s of selectorsOf(rule)) expect(s).toMatch(/:has\(> :last-child:nth-child\((2n \+ 3|3n \+ 2|3n \+ 4)\)\)/);
    expect(styles).toMatch(/@media \(min-width: 72rem\) \{\s*\.card-grid,/);
  });

  it('draws the team strip as one row, one column per member, from 48rem', () => {
    expect(ALL_RULES.find((rule) => rule.selector === '.team-strip' && rule.media.includes('48rem'))?.body).toMatch(/grid-auto-flow:\s*column/);
  });

  it('lets one block of a pair take the row alone, so nothing leaves an empty column', () => {
    expect(ALL_RULES.find((rule) => rule.selector === '.pair:has(> :only-child)')?.body).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
  });
});

describe('motion', () => {
  it('keeps every transition and animation inside prefers-reduced-motion: no-preference', () => {
    const moving = ALL_RULES.filter((rule) => /(^|[;\s])(transition|animation)(-[a-z-]+)?:/.test(rule.body));
    expect(moving.length).toBeGreaterThan(0);
    for (const rule of moving) expect(rule.media, rule.selector).toBe('@media (prefers-reduced-motion: no-preference)');
    expect(both).not.toMatch(/@keyframes/);
  });

  it('takes every duration and easing from a token, never runs forever, and never animates all', () => {
    for (const match of both.matchAll(/(?:^|[;\s])(?:transition|animation):\s*([^;]+);/g)) {
      const value = match[1]!;
      expect(value, value).not.toMatch(/\b\d+(\.\d+)?m?s\b/);
      expect(value, value).toMatch(/var\(--dur-(quick|move|flip)\)/);
      expect(value, value).not.toMatch(/\ball\b/);
    }
    expect(both).not.toMatch(/\binfinite\b|view-transition|@starting-style|\blinear\(/);
    for (const [token, ms] of [
      ['--dur-quick', 150],
      ['--dur-move', 240],
      ['--dur-flip', 400],
      ['--stagger', 50],
    ] as const) {
      expect(tokens).toMatch(new RegExp(`${token}:\\s*${ms}ms;`));
    }
  });

  it('moves only transform and opacity', () => {
    for (const match of both.matchAll(/(?:^|[;\s])transition:\s*([^;]+);/g)) {
      for (const part of match[1]!.split(',')) expect(part.trim().split(/\s+/)[0]).toMatch(/^(transform|opacity)$/);
    }
  });
});
