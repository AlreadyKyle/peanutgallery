// The picture that goes with Share your run: a 1200 by 630 card drawn in code (docs/PLAN.md §4 Art
// policy), with the run's dust, its unlocks by name and the game's address. It reads the save only and
// sends nothing anywhere; render/share.ts hands it to the share sheet beside the text.
import type { SimConfig, SimState } from '../sim/types';
import { fill, formatDust } from './format';
import type { Strings } from './strings';

export const IMAGE_WIDTH = 1200;
export const IMAGE_HEIGHT = 630;
export const IMAGE_FILE_NAME = 'dust-run.png';

// The scene's palette (render/scene.ts), as CSS colours.
const COLORS = {
  background: '#12161c',
  panel: '#1c222b',
  panelEdge: '#2b3440',
  accent: '#d9a441',
  bar: '#6fa8dc',
  text: '#e8e6df',
  muted: '#9aa3ad',
};
const FONT = 'sans-serif';
const MARGIN = 72;
// Unlock names sit in pills, at most two rows of them; the rest collapse to "+N" so the address stays clear.
const PILL_HEIGHT = 48;
const PILL_PAD = 20;
const PILL_GAP = 12;
const PILL_TOP = 410;
const PILL_ROWS = 2;

export interface Pill {
  label: string;
  x: number;
  y: number;
  width: number;
}

export function layoutPills(names: readonly string[], measure: (text: string) => number): Pill[] {
  const right = IMAGE_WIDTH - MARGIN;
  const place = (labels: readonly string[]): Pill[] | null => {
    const pills: Pill[] = [];
    let x = MARGIN;
    let row = 0;
    for (const label of labels) {
      const width = Math.min(measure(label) + PILL_PAD * 2, right - MARGIN);
      if (x + width > right) {
        row += 1;
        x = MARGIN;
      }
      if (row >= PILL_ROWS) return null;
      pills.push({ label, x, y: PILL_TOP + row * (PILL_HEIGHT + 16), width });
      x += width + PILL_GAP;
    }
    return pills;
  };
  // Drop names from the end until the rest and their "+N" fit.
  for (let shown = names.length; shown >= 0; shown -= 1) {
    const labels = shown === names.length ? names : [...names.slice(0, shown), `+${names.length - shown}`];
    const pills = place(labels);
    if (pills !== null) return pills;
  }
  return [];
}

export interface RunFacts {
  title: string;
  dust: string;
  dustLabel: string;
  unlocks: string;
  names: string[];
  url: string;
}

export function runFacts(state: SimState, config: SimConfig, strings: Strings, url: string): RunFacts {
  const byId = new Map(config.unlocks.unlocks.map((u) => [u.id, u.name]));
  return {
    title: strings.title,
    dust: formatDust(state.totalDust),
    dustLabel: strings.share.imageDust,
    unlocks: fill(strings.share.imageUnlocks, {
      unlocked: String(state.unlocked.length),
      total: String(config.unlocks.unlocks.length),
    }),
    names: state.unlocked.map((u) => byId.get(u.id) ?? u.id),
    url: url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
  };
}

/** The slice of CanvasRenderingContext2D the card uses, so tests can record the calls. */
export type CardContext = Pick<
  CanvasRenderingContext2D,
  'fillStyle' | 'strokeStyle' | 'lineWidth' | 'font' | 'textBaseline' | 'fillRect' | 'fillText' | 'measureText' | 'beginPath' | 'arc' | 'fill' | 'stroke' | 'roundRect'
>;

export function drawRunCard(ctx: CardContext, facts: RunFacts): void {
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

  // Motes of dust, scattered evenly by a fixed low-discrepancy sequence, so every card looks the same.
  ctx.fillStyle = COLORS.panelEdge;
  for (let i = 1; i <= 40; i += 1) {
    const x = ((i * 0.7548776662) % 1) * IMAGE_WIDTH;
    const y = ((i * 0.5698402910) % 1) * IMAGE_HEIGHT;
    ctx.beginPath();
    ctx.arc(x, y, 2 + (i % 4), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.accent;
  ctx.font = `bold 56px ${FONT}`;
  ctx.fillText(facts.title, MARGIN, MARGIN + 48);

  ctx.fillStyle = COLORS.text;
  ctx.font = `bold 140px ${FONT}`;
  ctx.fillText(facts.dust, MARGIN, 290);
  const dustWidth = ctx.measureText(facts.dust).width;
  ctx.fillStyle = COLORS.muted;
  ctx.font = `48px ${FONT}`;
  ctx.fillText(facts.dustLabel, MARGIN + dustWidth + 24, 290);

  ctx.fillStyle = COLORS.bar;
  ctx.font = `bold 40px ${FONT}`;
  ctx.fillText(facts.unlocks, MARGIN, 370);

  ctx.font = `30px ${FONT}`;
  for (const pill of layoutPills(facts.names, (text) => ctx.measureText(text).width)) {
    ctx.fillStyle = COLORS.panel;
    ctx.strokeStyle = COLORS.panelEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(pill.x, pill.y, pill.width, PILL_HEIGHT, PILL_HEIGHT / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.fillText(pill.label, pill.x + PILL_PAD, pill.y + 34);
  }

  ctx.fillStyle = COLORS.muted;
  ctx.font = `32px ${FONT}`;
  ctx.fillText(facts.url, MARGIN, IMAGE_HEIGHT - MARGIN + 16);
}

/**
 * Draws the card on a fresh canvas and returns it as a PNG file, or null where the browser cannot.
 * Synchronous on purpose: Safari only opens the share sheet inside the click, so no await comes first.
 */
export function runCardFile(facts: RunFacts, doc: Document = document): File | null {
  const canvas = doc.createElement('canvas');
  canvas.width = IMAGE_WIDTH;
  canvas.height = IMAGE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (ctx === null || typeof ctx.roundRect !== 'function') return null;
  drawRunCard(ctx, facts);
  const url = canvas.toDataURL('image/png');
  const prefix = 'data:image/png;base64,';
  if (!url.startsWith(prefix)) return null;
  const binary = atob(url.slice(prefix.length));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], IMAGE_FILE_NAME, { type: 'image/png' });
}
