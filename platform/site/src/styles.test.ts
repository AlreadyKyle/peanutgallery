import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
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

function hex(token: string): string {
  const match = tokens.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`${token} is not a six-digit hex colour`);
  return match[1]!;
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

describe('contrast (WCAG 2.x), measured from tokens.css', () => {
  it('on paper and the work face: ink at least 7, muted 4.5, field 3; ink on the coin at least 7', () => {
    for (const ground of ['--paper', '--work']) {
      expect(contrast(hex('--ink'), hex(ground)), `ink on ${ground}`).toBeGreaterThanOrEqual(7);
      expect(contrast(hex('--muted'), hex(ground)), `muted on ${ground}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex('--field'), hex(ground)), `field on ${ground}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(hex('--ink'), hex('--coin'))).toBeGreaterThanOrEqual(7);
    expect(contrast(hex('--ink'), hex('--coin-down'))).toBeGreaterThanOrEqual(4.5);
  });

  it('on ink: paper at least 7, muted-on-ink 4.5 on ink and ink-hover, field 3, the coins 3, and the press fills', () => {
    const ink = hex('--ink');
    expect(contrast(hex('--paper'), ink)).toBeGreaterThanOrEqual(7);
    expect(contrast(hex('--muted-on-ink'), ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex('--muted-on-ink'), hex('--ink-hover'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex('--field'), ink)).toBeGreaterThanOrEqual(3);
    expect(contrast(hex('--coin'), ink)).toBeGreaterThanOrEqual(3);
    expect(contrast(hex('--coin-down'), ink)).toBeGreaterThanOrEqual(3);
    expect(contrast(ink, hex('--paper-hover'))).toBeGreaterThanOrEqual(7);
    expect(contrast(hex('--paper'), hex('--ink-hover'))).toBeGreaterThanOrEqual(7);
  });

  it('draws the change marker at 3:1 or better on paper, work and ink (currentColor: ink, ink, paper)', () => {
    expect(contrast(hex('--ink'), hex('--paper'))).toBeGreaterThanOrEqual(3);
    expect(contrast(hex('--ink'), hex('--work'))).toBeGreaterThanOrEqual(3);
    expect(contrast(hex('--paper'), hex('--ink'))).toBeGreaterThanOrEqual(3);
  });

  it('never sets the coin as a text colour', () => {
    const offenders = ALL_RULES.filter((rule) => /(^|[;\s])color:\s*var\(--coin/.test(rule.body)).map((rule) => rule.selector);
    expect(offenders).toEqual([]);
  });
});

describe('bands', () => {
  const INK_GROUND = [
    'main > .band:nth-child(odd)',
    '.page:has(> main > .band:first-child) > .topbar',
    '.page:has(> main > .band:last-child:nth-child(even)) > .site-footer',
  ];
  const PAPER_GROUND = ['main > .band:nth-child(even)', '.page:has(> main > .band:last-child:nth-child(odd)) > .site-footer'];

  it('colours bands only by their position, with no per-page band colour class', () => {
    const inkGround = ALL_RULES.filter((rule) => /(^|[;\s])background:\s*var\(--ink\)/.test(rule.body));
    expect(inkGround.flatMap(selectorsOf)).toEqual(INK_GROUND);
    const paperBands = ALL_RULES.filter((rule) => selectorsOf(rule).some((s) => /(\.band(:[a-z-]+\([^)]*\))*|\.site-footer|\.topbar)$/.test(s)) && /(^|[;\s])background:\s*var\(--paper\)/.test(rule.body));
    expect(paperBands.flatMap(selectorsOf)).toEqual(PAPER_GROUND);
    const classes = [...both.matchAll(/\.([a-z][a-z0-9-]*)/gi)].map((m) => m[1]!);
    expect(classes.filter((name) => /band-|-band|on-ink|ink-|dark/.test(name) && name !== 'band')).toEqual([]);
  });

  it('turns the focus ring paper in an ink band: 3px at a 2px offset, in the focus role colour', () => {
    const focus = ALL_RULES.find((rule) => rule.selector === ':focus-visible');
    expect(focus?.body).toMatch(/outline:\s*3px solid var\(--focus-colour\)/);
    expect(focus?.body).toMatch(/outline-offset:\s*2px/);
    const ink = ALL_RULES.find((rule) => selectorsOf(rule).join('|') === INK_GROUND.join('|'));
    expect(ink?.body).toMatch(/--focus-colour:\s*var\(--paper\)/);
    expect(ink?.body).toMatch(/--text-muted:\s*var\(--muted-on-ink\)/);
    expect(ink?.body).toMatch(/--hairline:\s*var\(--line-on-ink\)/);
    expect(tokens).toMatch(/--focus-colour:\s*var\(--ink\)/);
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

  it('keeps Contribute ink on coin in an ink band: it sets its own colour after the link rules, and no band rule repaints links', () => {
    const coin = rules(styles).find((rule) => rule.selector.startsWith('.button.btn-coin,'));
    expect(coin?.body).toMatch(/color:\s*var\(--ink\)/);
    expect(styles.indexOf('.button.btn-coin')).toBeGreaterThan(styles.indexOf('\na {'));
    const repaint = ALL_RULES.filter((rule) => selectorsOf(rule).some((s) => /nth-child\(odd\)[^,]*\ba\b/.test(s)) && /(^|[;\s])color:/.test(rule.body));
    expect(repaint).toEqual([]);
  });

  it('marks each band edge with a CanvasText rule and keeps the peanut unfiltered under forced colours', () => {
    const forced = ALL_RULES.filter((rule) => rule.media.includes('forced-colors: active'));
    expect(forced.find((rule) => rule.selector.includes('main > .band + .band'))?.body).toMatch(/border-top:\s*1px solid CanvasText/);
    expect(forced.find((rule) => rule.selector === '.mark')?.body).toMatch(/filter:\s*none/);
    expect(forced.find((rule) => rule.selector === '.funding-bar-fill')?.body).toMatch(/forced-color-adjust:\s*none[\s\S]*background:\s*Highlight/);
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
