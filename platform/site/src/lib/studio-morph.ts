import { useEffect, type RefObject } from 'react';
import { motionAllowed } from './motion';

// Home's studio shrinks into the rail (docs/specs/place.md, The floor; DESIGN.md, Motion): from
// 64rem, as the page scrolls from the top to where the rail holds still, the big room on the plate
// moves and scales onto the rail's small map, and the map takes over once it lands. The scroll drives
// it, so it is the reader's own motion, never a timed one, and nothing plays while the page is still.
// Only transform and opacity change. Under reduced motion, below 64rem, or before the rail is drawn,
// nothing is set: the room stays on the plate and the map in the rail, both drawn still.
//
// The main element carries data-morph while it runs: "start" at the top (the big room is live and
// pressable, the map hidden), "on" while it moves (the big room takes no pointer, so it never sits
// over a control it would block) and "done" once it lands (the big room fades out over the map, which
// fades in, and is then hidden). The share travelled, eased, is --morph, from 0 to 1; styles.css fades
// the big room's tags and era label with it.

const BIG = '.floor-plate .studio-frame';
const SMALL = '.floor-map .studio-frame';

interface Layout {
  readonly big: HTMLElement;
  /** The big room's frame in page coordinates, untransformed. */
  readonly bigLeft: number;
  readonly bigTop: number;
  readonly bigWidth: number;
  /** The small map's frame: its left and width, its offset inside the rail, and the rail's page top before it sticks. */
  readonly smallLeft: number;
  readonly smallWidth: number;
  readonly offset: number;
  readonly railTop: number;
  /** The rail's sticky top, in pixels. */
  readonly stick: number;
}

/** How far the scroll has gone towards the rail sticking, from 0 to 1. */
export function morphShare(scrollY: number, railTop: number, stick: number): number {
  const end = railTop - stick;
  if (end <= 0) return 1;
  return Math.min(Math.max(scrollY / end, 0), 1);
}

/** The eased share: slow off the top, slow onto the rail. */
export function eased(share: number): number {
  return share * share * (3 - 2 * share);
}

/** The big room's transform at a share: from where it stands to over the map, as the map sits now. */
export function morphTransform(layout: Omit<Layout, 'big'>, scrollY: number, share: number): string {
  const railNow = Math.max(layout.stick, layout.railTop - scrollY);
  const dx = layout.smallLeft - layout.bigLeft;
  const dy = railNow + layout.offset - (layout.bigTop - scrollY);
  const scale = 1 + (layout.smallWidth / layout.bigWidth - 1) * share;
  return `translate(${(dx * share).toFixed(2)}px, ${(dy * share).toFixed(2)}px) scale(${scale.toFixed(4)})`;
}

export function useStudioMorph(root: RefObject<HTMLElement | null>, ready: boolean): void {
  useEffect(() => {
    const main = root.current;
    if (!ready || main === null || !motionAllowed() || typeof window.matchMedia !== 'function') return;
    const wide = window.matchMedia('(min-width: 64rem)');
    let layout: Layout | null = null;
    let frame = 0;
    let state = '';

    const mark = (next: string) => {
      if (next === state) return;
      state = next;
      if (next === '') delete main.dataset.morph;
      else main.dataset.morph = next;
      // Landed, the big room is see-through, so its tags leave the tab order and the reading order.
      layout?.big.toggleAttribute('inert', next === 'done');
    };

    const clear = () => {
      layout?.big.style.removeProperty('transform');
      main.style.removeProperty('--morph');
      mark('');
      layout = null;
    };

    const measure = () => {
      const big = main.querySelector<HTMLElement>(BIG);
      const small = main.querySelector<HTMLElement>(SMALL);
      const rail = small?.closest<HTMLElement>('.floor-rail') ?? null;
      const floor = rail?.parentElement ?? null;
      if (!wide.matches || big === null || small === null || rail === null || floor === null) {
        clear();
        return;
      }
      big.style.removeProperty('transform');
      const b = big.getBoundingClientRect();
      const s = small.getBoundingClientRect();
      const r = rail.getBoundingClientRect();
      if (b.width === 0 || s.width === 0) {
        clear();
        return;
      }
      const y = window.scrollY;
      layout = {
        big,
        bigLeft: b.left,
        bigTop: b.top + y,
        bigWidth: b.width,
        smallLeft: s.left,
        smallWidth: s.width,
        offset: s.top - r.top,
        // The rail stands at the floor's top until it sticks, so the floor's top is where it starts.
        railTop: floor.getBoundingClientRect().top + y,
        stick: parseFloat(getComputedStyle(rail).top) || 0,
      };
      big.toggleAttribute('inert', state === 'done');
    };

    const draw = () => {
      frame = 0;
      if (layout === null) return;
      const y = window.scrollY;
      const share = morphShare(y, layout.railTop, layout.stick);
      const e = eased(share);
      main.style.setProperty('--morph', e.toFixed(4));
      // Once landed the room keeps following the map, so it fades out exactly over it.
      layout.big.style.transform = share === 0 ? '' : morphTransform(layout, y, e);
      mark(share === 0 ? 'start' : share >= 1 ? 'done' : 'on');
    };

    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(draw);
    };
    const relayout = () => {
      measure();
      schedule();
    };

    relayout();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', relayout);
    wide.addEventListener?.('change', relayout);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(relayout);
    observer?.observe(main);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', relayout);
      wide.removeEventListener?.('change', relayout);
      observer?.disconnect();
      clear();
    };
  }, [root, ready]);
}
