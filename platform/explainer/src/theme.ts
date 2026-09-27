import { Easing } from 'remotion';

// The site's tokens (platform/site/src/tokens.css), which theme.test.ts holds equal. One colour, one
// meaning, as on the site: amber is money, ink is the studio, green is Live, magenta is Dust.
export const C = {
  paper: '#ffffff',
  ink: '#111111',
  muted: '#5c5c5c',
  field: '#7d7d7d',
  line: '#d6d6d6',
  paperHover: '#eeeff0',
  mutedOnInk: '#a3a3a3',
  lineOnInk: '#333333',
  work: '#d4e1ee',
  suitGame: '#b0226a',
  live: '#16701f',
  coin: '#d9a441',
  coinDown: '#b8862f',
  coinUp: '#ecc36e',
} as const;

export const CREATURE: Record<string, string> = {
  blue: '#8db9e8',
  lavender: '#cbbdee',
  green: '#9bd3a6',
  pink: '#f3b0c6',
  orange: '#f5b97a',
  yellow: '#f5dc7a',
  purple: '#b39ae0',
  grey: '#c3c7cc',
  teal: '#7fcbc5',
  red: '#eb9a9a',
  brown: '#cfa77c',
};

/** Dust's own ground (seed-1/render/scene.ts), for the phone the game is shown in. */
export const DUST_BACKGROUND = '#12161c';

export const FONT = "'Atkinson Hyperlegible Next', Arial, sans-serif";

// The site's curves (--ease-out, --ease-in), and a symmetric one for the plate folding and moves
// that start and stop at rest.
export const EASE_OUT = Easing.bezier(0.2, 0, 0, 1);
export const EASE_IN = Easing.bezier(0.55, 0, 1, 0.45);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
