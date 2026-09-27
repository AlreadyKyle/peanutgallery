// The two cuts of the one video: 16:9 for wide screens and 4:5 for phones (the site picks one by
// width). Every scene is choreographed once on a 900 by 820 stage; each cut places and scales that
// stage beside or under the words.

export type FormatName = 'wide' | 'tall';

export type Format = {
  name: FormatName;
  id: string;
  width: number;
  height: number;
  /** The black top bar the opening plate folds into, as on the site. */
  bar: number;
  margin: number;
  /** The words: left edge, width, type size, and the y they centre on (wide) or start at (tall). */
  text: { x: number; y: number; width: number; size: number; anchor: 'centre' | 'top' };
  /** The stage's centre and scale. */
  stage: { cx: number; cy: number; scale: number };
  /** The mark's height in the top bar and at full size in the opening and closing plates. */
  mark: { bar: number; plate: number };
};

export const STAGE = { width: 900, height: 820 } as const;

export const FORMATS: Record<FormatName, Format> = {
  wide: {
    name: 'wide',
    id: 'explainer-wide',
    width: 1920,
    height: 1080,
    bar: 104,
    margin: 120,
    text: { x: 120, y: 600, width: 680, size: 56, anchor: 'centre' },
    stage: { cx: 1350, cy: 600, scale: 1 },
    mark: { bar: 46, plate: 300 },
  },
  tall: {
    name: 'tall',
    id: 'explainer-tall',
    width: 1080,
    height: 1350,
    bar: 112,
    margin: 72,
    text: { x: 72, y: 176, width: 936, size: 52, anchor: 'top' },
    stage: { cx: 540, cy: 880, scale: 0.96 },
    mark: { bar: 48, plate: 280 },
  },
};
