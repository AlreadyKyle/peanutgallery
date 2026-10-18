// The Daily Dust result card (docs/specs/daily-dust.md): a 1200 by 630 picture drawn in code in the
// studio's ink-on-paper style, as render/share-image.ts draws the run card: the day, the score, the run
// as eight inked bars (the glyph row drawn), its highlights in pills and the day's address, over the
// suit band. It reads the result only and sends nothing anywhere.
import { dailyHighlights, dailyLink, dailyScoreLine, formatDailyDate, ROW_GLYPHS, type DailyResult } from './daily';
import { formatDust } from './format';
import {
  cardFile,
  COLORS,
  drawPaper,
  drawPill,
  drawSuitBand,
  FONT,
  IMAGE_HEIGHT,
  IMAGE_WIDTH,
  MARGIN,
  PILL_GAP,
  PILL_PAD,
  type CardContext,
  type Pill,
} from './share-image';
import type { Strings } from './strings';

export const DAILY_FILE_NAME = 'daily-dust.png';

const SAND = '#f1d99c';
// Eight bars across the card's width between its margins: 8 x 114 + 7 x 20 = 1052 of 1056.
const BAR_WIDTH = 114;
const BAR_GAP = 20;
const BAR_BASE = 430;
const BAR_MAX = 140;
const BAR_MIN = 18;
const PILL_Y = 458;

export interface DailyFacts {
  kicker: string;
  date: string;
  score: string;
  scoreLabel: string;
  levels: number[];
  highlights: string[];
  url: string;
}

export function dailyFacts(result: DailyResult, strings: Strings): DailyFacts {
  const score = formatDust(result.score);
  const line = dailyScoreLine(result, strings);
  return {
    kicker: strings.daily.kicker,
    date: formatDailyDate(result.date),
    score,
    // The score line without its number: "dust in 4 minutes".
    scoreLabel: line.replace(score, '').trim(),
    levels: result.levels,
    highlights: dailyHighlights(result, strings),
    url: dailyLink(result.date).replace(/^https?:\/\//, ''),
  };
}

/** Where each bar of the row stands: left edge, top and height, one per half minute. */
export function barLayout(levels: readonly number[]): { x: number; y: number; height: number; top: boolean }[] {
  const steps = ROW_GLYPHS.length - 1;
  const highest = Math.max(0, ...levels);
  return levels.map((level, i) => {
    const clamped = Math.max(0, Math.min(steps, level));
    const height = BAR_MIN + ((BAR_MAX - BAR_MIN) * clamped) / steps;
    return { x: MARGIN + i * (BAR_WIDTH + BAR_GAP), y: BAR_BASE - height, height, top: clamped === highest };
  });
}

/** The highlights' pills, in one row from the left margin. */
export function highlightPills(labels: readonly string[], measure: (text: string) => number): Pill[] {
  const pills: Pill[] = [];
  let x = MARGIN;
  for (const label of labels) {
    const width = measure(label) + PILL_PAD * 2;
    if (x + width > IMAGE_WIDTH - MARGIN) break;
    pills.push({ label, x, y: PILL_Y, width });
    x += width + PILL_GAP;
  }
  return pills;
}

export function drawDailyCard(ctx: CardContext, facts: DailyFacts): void {
  drawPaper(ctx);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = COLORS.accent;
  ctx.font = `bold 56px ${FONT}`;
  ctx.fillText(facts.kicker, MARGIN, MARGIN + 40);
  ctx.fillStyle = COLORS.muted;
  ctx.font = `bold 36px ${FONT}`;
  const dateWidth = ctx.measureText(facts.date).width;
  ctx.fillText(facts.date, IMAGE_WIDTH - MARGIN - dateWidth, MARGIN + 36);

  ctx.fillStyle = COLORS.text;
  ctx.font = `bold 120px ${FONT}`;
  ctx.fillText(facts.score, MARGIN, 250);
  const scoreWidth = ctx.measureText(facts.score).width;
  ctx.fillStyle = COLORS.muted;
  ctx.font = `44px ${FONT}`;
  ctx.fillText(facts.scoreLabel, MARGIN + scoreWidth + 22, 250);

  // The row: one inked bar per half minute, the tallest in the suit magenta, on a ruled baseline.
  for (const bar of barLayout(facts.levels)) {
    ctx.fillStyle = COLORS.panelEdge;
    ctx.beginPath();
    ctx.roundRect(bar.x + 5, bar.y + 5, BAR_WIDTH, bar.height, 10);
    ctx.fill();
    ctx.fillStyle = bar.top ? COLORS.accent : SAND;
    ctx.strokeStyle = COLORS.panelEdge;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(bar.x, bar.y, BAR_WIDTH, bar.height, 10);
    ctx.fill();
    ctx.stroke();
  }

  ctx.font = `30px ${FONT}`;
  for (const pill of highlightPills(facts.highlights, (text) => ctx.measureText(text).width)) drawPill(ctx, pill);

  ctx.fillStyle = COLORS.muted;
  ctx.font = `32px ${FONT}`;
  ctx.fillText(facts.url, MARGIN, IMAGE_HEIGHT - MARGIN + 16);
  drawSuitBand(ctx);
}

/** The card as a PNG file for the share sheet, or null where the browser cannot draw one. Synchronous. */
export function dailyCardFile(facts: DailyFacts, doc: Document = document): File | null {
  return cardFile((ctx) => drawDailyCard(ctx, facts), DAILY_FILE_NAME, doc);
}
