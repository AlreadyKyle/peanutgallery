// Kernel (platform/gate/kernel-paths.txt; docs/specs/card-preview.md): the 1200×630 link preview of
// one card, drawn in code from its public /api/card document and served by card.mts as the card
// page's og:image.
//
// The face shows the card's title and summary, its Supporter numbers (never amounts, never ranked),
// what the agents have spent on it, and its draft-to-live time once it is live. Nothing here counts
// down and nothing suggests chance (docs/research/comparables.md). The colours are tokens.css's, which
// card-preview.test.ts checks; the type is the site's own face, from @fontsource (satori reads woff,
// not the site's variable woff2). satori lays the face out as SVG with the text as paths, and resvg
// draws the PNG, so no font is needed at draw time.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import satori from 'satori';
import { SITE, STUDIO_NAME } from './card-meta.ts';

export const WIDTH = 1200;
export const HEIGHT = 630;

/** tokens.css values, checked by card-preview.test.ts. */
export const TOKENS = {
  paper: '#ffffff',
  ink: '#111111',
  muted: '#5c5c5c',
  line: '#d6d6d6',
  work: '#d4e1ee',
  live: '#16701f',
  coin: '#d9a441',
} as const;

const ADDRESS = new URL(SITE).host;

/** The most Supporter numbers the face lists before "and N more". */
const SHOWN_SUPPORTERS = 8;
const TITLE_MAX = 70;
const SUMMARY_MAX = 150;

/** The few fields of /api/card the face reads. */
export type PreviewCard = {
  title: string;
  summary: string;
  stage: string;
  spentUsd: number;
  supporters: number[];
  supporterCount: number;
  createdAt: string;
  liveAt: string | null;
};

type Doc = Record<string, unknown>;

function isDoc(value: unknown): value is Doc {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The face's fields from site_card's JSON text, or null when it is not a card document. */
export function previewCardFrom(body: string): PreviewCard | null {
  const root: unknown = JSON.parse(body);
  if (!isDoc(root) || !isDoc(root.card)) return null;
  const card = root.card;
  const title = str(card.title);
  if (title === '') return null;
  const supporters = Array.isArray(root.supporters)
    ? root.supporters.filter(isDoc).map((row) => num(row.number)).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  return {
    title,
    summary: str(card.summary),
    stage: str(card.stage),
    spentUsd: num(root.spent_usd),
    supporters,
    supporterCount: Math.max(num(root.supporter_count), supporters.length),
    createdAt: str(card.created_at),
    liveAt: typeof card.live_at === 'string' ? card.live_at : null,
  };
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  // Cut on a code point, so an emoji at the edge is dropped whole rather than split in half.
  let out = '';
  for (const point of flat) {
    if (out.length + point.length > max - 1) break;
    out += point;
  }
  return `${out.trimEnd()}…`;
}

export function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Draft to live as whole days, or hours under a day; null until the card is live. */
export function draftToLive(createdAt: string, liveAt: string | null): string | null {
  if (liveAt === null) return null;
  const ms = Date.parse(liveAt) - Date.parse(createdAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  if (hours < 24) return hours === 1 ? '1 hour' : `${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

/** "#1, #4 and #9", or "#1, #4 … and 12 more"; supporters are listed by number, never by amount. */
export function supporterLine(numbers: number[], count: number): string {
  if (count === 0) return 'No supporters yet';
  const shown = numbers.slice(0, SHOWN_SUPPORTERS).map((n) => `#${n}`);
  const more = count - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  if (shown.length === 1) return shown[0]!;
  return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

/** The card's state words, as src/lib/copy.ts's status lines; checked by card-preview.test.ts. */
export const STAGE_WORDS: Record<string, string> = {
  proposed: 'Planned',
  designing: 'Planned',
  voted: 'Open for funding',
  funded: 'Funded',
  building: 'Building',
  gated: 'Being checked',
  paused: 'Paused',
  live: 'Live',
  rejected: 'Not built',
};

type Node = { type: string; props: Doc & { children?: unknown } };

function el(type: string, style: Doc, children?: unknown): Node {
  return { type, props: { style, children } };
}

function stat(label: string, value: string): Node {
  return el('div', { display: 'flex', flexDirection: 'column', marginRight: 56 }, [
    el('div', { fontSize: 22, color: TOKENS.muted }, label),
    el('div', { fontSize: 34, fontWeight: 700, color: TOKENS.ink }, value),
  ]);
}

/** The face as satori's element tree. */
export function face(card: PreviewCard): Node {
  const live = card.stage === 'live';
  const building = card.stage === 'building' || card.stage === 'gated';
  const time = draftToLive(card.createdAt, card.liveAt);
  const stats = [stat('Supporters', String(card.supporterCount)), stat('Agents spent', formatUsd(card.spentUsd))];
  if (time !== null) stats.push(stat('Draft to live', time));
  return el(
    'div',
    {
      width: WIDTH,
      height: HEIGHT,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: 48,
      background: building ? TOKENS.work : TOKENS.paper,
      color: TOKENS.ink,
      fontFamily: 'Atkinson Hyperlegible Next',
      border: `8px solid ${TOKENS.ink}`,
    },
    [
      el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 26 }, [
        el('div', { fontWeight: 700 }, STUDIO_NAME),
        el(
          'div',
          {
            display: 'flex',
            padding: '4px 16px',
            border: `3px solid ${live ? TOKENS.live : TOKENS.ink}`,
            color: live ? TOKENS.live : TOKENS.ink,
            fontWeight: 700,
          },
          STAGE_WORDS[card.stage] ?? 'Card',
        ),
      ]),
      el('div', { display: 'flex', flexDirection: 'column' }, [
        el('div', { fontSize: 56, fontWeight: 700, lineHeight: 1.15, marginBottom: 20 }, clip(card.title, TITLE_MAX)),
        el('div', { fontSize: 28, lineHeight: 1.4, color: TOKENS.muted }, clip(card.summary, SUMMARY_MAX)),
      ]),
      el('div', { display: 'flex', flexDirection: 'column' }, [
        el('div', { display: 'flex', marginBottom: 20 }, stats),
        el('div', { display: 'flex', justifyContent: 'space-between', borderTop: `2px solid ${TOKENS.line}`, paddingTop: 16, fontSize: 22, color: TOKENS.muted }, [
          el('div', {}, clip(`Supporters ${supporterLine(card.supporters, card.supporterCount)}`, 70)),
          el('div', {}, ADDRESS),
        ]),
      ]),
    ],
  );
}

const require = createRequire(import.meta.url);
const FONT_DIR = '@fontsource/atkinson-hyperlegible-next/files';
let ready: Promise<{ fonts: { name: string; data: Buffer; weight: 400 | 700; style: 'normal' }[] }> | null = null;

function load() {
  ready ??= (async () => {
    await initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    const font = (weight: 400 | 700) => ({
      name: 'Atkinson Hyperlegible Next',
      data: readFileSync(require.resolve(`${FONT_DIR}/atkinson-hyperlegible-next-latin-${weight}-normal.woff`)),
      weight,
      style: 'normal' as const,
    });
    return { fonts: [font(400), font(700)] };
  })();
  return ready;
}

/** The card's preview as PNG bytes. */
export async function renderPreview(card: PreviewCard): Promise<Uint8Array> {
  const { fonts } = await load();
  // satori takes React elements; plain { type, props } objects are what JSX compiles to.
  const svg = await satori(face(card) as Parameters<typeof satori>[0], { width: WIDTH, height: HEIGHT, fonts });
  return new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
}
