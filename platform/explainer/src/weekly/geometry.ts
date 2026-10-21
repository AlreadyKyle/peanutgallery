import { FORMATS, type Format } from '../format';

// Where everything sits in each cut. One frame position and scale for every capture in the video,
// one headline size and one support size, wide margins. The video is horizontal only: the words in a
// column on the left and the frame on the right.

export type WeeklyGeometry = {
  format: Format;
  id: string;
  /** The words: left edge, width, and where the block centres (wide) or starts (tall). */
  text: { x: number; width: number; y: number; anchor: 'centre' | 'top' };
  type: { label: number; headline: number; support: number };
  /** The browser frame: its outer box. The capture inside it is 16:9. */
  frame: { x: number; y: number; width: number; bar: number; border: number };
};

const BAR_H = 52;
const BORDER = 4;

function frameFor(x: number, width: number, centreY: number | null, bottom: number | null) {
  const inner = width - BORDER * 2;
  const height = Math.round((inner * 9) / 16) + BAR_H + BORDER * 2;
  const y = centreY !== null ? Math.round(centreY - height / 2) : (bottom ?? 0) - height;
  return { x, y, width, bar: BAR_H, border: BORDER };
}

export const WEEKLY: Record<'wide', WeeklyGeometry> = {
  wide: {
    format: FORMATS.wide,
    id: 'weekly-wide',
    text: { x: 120, width: 560, y: 592, anchor: 'centre' },
    type: { label: 28, headline: 64, support: 34 },
    frame: frameFor(760, 1040, 592, null),
  },
};

/** The capture's box inside the frame, in the composition's pixels. */
export function screenBox(g: WeeklyGeometry) {
  const { x, y, width, bar, border } = g.frame;
  const w = width - border * 2;
  return { x: x + border, y: y + border + bar, width: w, height: Math.round((w * 9) / 16) };
}

export function frameHeight(g: WeeklyGeometry): number {
  const s = screenBox(g);
  return s.height + g.frame.bar + g.frame.border * 2;
}
