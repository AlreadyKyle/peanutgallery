// The site's motion (DESIGN.md, Motion): the fund tick, the flip, the deal and the slam, each tied to
// a real change or a press. Only transform and opacity move, with the durations and easings from
// tokens.css. Under reduced motion (anything but prefers-reduced-motion: no-preference) each one
// applies its end state at once and creates no animation, so document.getAnimations() stays empty.

const FALLBACK: Record<string, string> = {
  '--dur-move': '240ms',
  '--dur-flip': '400ms',
  '--stagger': '50ms',
  '--ease-out': 'cubic-bezier(0.2, 0, 0, 1)',
  '--ease-in': 'cubic-bezier(0.55, 0, 1, 0.45)',
};

/** True only when the viewer has said nothing against motion. */
export function motionAllowed(win: Window = window): boolean {
  return typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: no-preference)').matches;
}

function token(name: string): string {
  const value = typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? FALLBACK[name]! : value;
}

function ms(name: string): number {
  const value = token(name);
  const n = parseFloat(value);
  return value.endsWith('ms') ? n : n * 1000;
}

function canAnimate(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && typeof element.animate === 'function' && motionAllowed();
}

/** Where the fill's transform puts it for a share of the bar, in pixels: at least 2px once above zero. */
function fillX(width: number, pct: number): number {
  return pct <= 0 ? -width : Math.max((width * pct) / 100, 2) - width;
}

/**
 * The fund tick: the funding bar's fill moves from the old share to the new one over --dur-move. The
 * fill is already drawn at the new share (styles.css); this plays the way there.
 */
export function fundTick(fill: HTMLElement | null, fromPct: number, toPct: number): void {
  if (!canAnimate(fill)) return;
  const width = fill.parentElement?.clientWidth ?? fill.clientWidth;
  fill.animate([{ transform: `translateX(${fillX(width, fromPct)}px)` }, { transform: `translateX(${fillX(width, toPct)}px)` }], {
    duration: ms('--dur-move'),
    easing: token('--ease-out'),
  });
}

/**
 * The flip in place: rotateY 0 to 90 degrees in half of --dur-flip, `swap` changes the face, then 90
 * back to 0. Same slot, same height, so nothing around it moves. Reduced motion: the swap only.
 */
export async function flip(card: HTMLElement | null, swap: () => void): Promise<void> {
  if (!canAnimate(card)) {
    swap();
    return;
  }
  const half = ms('--dur-flip') / 2;
  const out = card.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(90deg)' }], {
    duration: half,
    easing: token('--ease-in'),
    fill: 'forwards',
  });
  await out.finished.catch(() => undefined);
  swap();
  // Let the new face render before it turns back.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  const back = card.animate([{ transform: 'rotateY(90deg)' }, { transform: 'rotateY(0deg)' }], {
    duration: half,
    easing: token('--ease-out'),
  });
  out.cancel();
  await back.finished.catch(() => undefined);
}

/**
 * The deal: cards the viewer asked to see come in from 12px above at -3 degrees and from nothing,
 * over --dur-move, --stagger apart. It plays only when the viewer presses Show updates.
 */
export function deal(cards: readonly HTMLElement[]): void {
  const step = ms('--stagger');
  cards.forEach((card, i) => {
    if (!canAnimate(card)) return;
    card.animate(
      [
        { transform: 'translateY(-12px) rotate(-3deg)', opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: ms('--dur-move'), easing: token('--ease-out'), delay: i * step, fill: 'backwards' },
    );
  });
}

/** The slam, when a card ships (a replay only in v1): from 1.04 and 8px up, to rest. */
export function slam(card: HTMLElement | null): void {
  if (!canAnimate(card)) return;
  card.animate(
    [
      { transform: 'translateY(-8px) scale(1.04)' },
      { transform: 'none' },
    ],
    { duration: ms('--dur-move'), easing: token('--ease-out') },
  );
}
