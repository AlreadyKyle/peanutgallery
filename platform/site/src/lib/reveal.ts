import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { motionAllowed } from './motion';

// The scroll reveal (docs/specs/final-state.md, the motion pass; DESIGN.md, Motion): a section below
// the fold fades in as it comes into view, once, over --dur-reveal with the scene's easing. The
// production pass makes it lead the eye: the section's label, heading and intro rise --reveal-rise
// into place over --dur-rise, each --stagger-reveal after the one before, and the cards of a grid
// that arrive together are dealt one after another. Only opacity and transform change, so no box
// shifts while it plays, and nothing that holds a control ever rises: a card, a button or a link
// only fades, so nothing a reader might press moves under the pointer. A part rises only once the
// reader scrolls to it: what the observer finds already near the window when the page opens only
// fades, so nothing on a page that has not moved yet is drawn away from where it rests (e2e/card.spec.ts
// measures the card page's headings while the replay plays). Nothing is hidden by a
// stylesheet: a section is drawn as it is until the observer sees it nearing the window, so the
// first paint is complete, and under reduced motion nothing changes at all.

const SELECTOR = 'main > .band > .section, main > .band > section, .floor-parts > section, .how-steps > li, .card-grid > li, .seed-grid > li, .goal';

/** The parts of a section that rise: its label, its heading and its one intro, in reading order. */
const LOCKUP = ':scope > .station-index, :scope > h2, :scope > h2 + p, :scope > .live-studio-head, :scope > .how-text > h2, :scope > .how-text > h2 + p';

/** The cards of a grid, dealt one after another rather than raised. */
const DEALT = '.card-grid > li, .seed-grid > li';

const CONTROL = 'a, button, input, select, textarea, summary, [tabindex]';

/** The most a batch of cards is staggered by, so a long grid is never still waiting to appear. */
const MAX_STEPS = 6;

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

function ms(name: string, fallback: string): number {
  const value = token(name, fallback);
  const n = parseFloat(value);
  return value.endsWith('ms') ? n : n * 1000;
}

/** Holds no control, so it may rise. */
export function mayRise(el: Element): boolean {
  return !el.matches(CONTROL) && el.querySelector(CONTROL) === null;
}

export function useScrollReveal(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!motionAllowed() || typeof IntersectionObserver === 'undefined') return;
    const seen = new WeakSet<Element>();
    const fade = ms('--dur-reveal', '480ms');
    const rise = ms('--dur-rise', '720ms');
    const step = ms('--stagger-reveal', '150ms');
    const distance = token('--reveal-rise', '1.5rem');
    const easing = token('--ease-scene', 'cubic-bezier(0.22, 1, 0.36, 1)');
    // The observer's first answer for each part says where it is when it is first watched, before
    // the reader has scrolled; only a later answer can raise it.
    const reported = new WeakSet<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        // Cards that arrive in one batch are dealt in reading order, a step apart per grid.
        const dealt = new Map<Element, number>();
        const first = new WeakSet<Element>();
        for (const entry of entries) {
          if (!reported.has(entry.target)) first.add(entry.target);
          reported.add(entry.target);
        }
        const arriving = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => entry.target as HTMLElement)
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        for (const el of arriving) {
          observer.unobserve(el);
          // Already on screen when first seen: drawn as it is.
          if (el.getBoundingClientRect().top < window.innerHeight) continue;
          const grid = el.matches(DEALT) ? el.parentElement : null;
          const index = grid === null ? 0 : (dealt.get(grid) ?? 0);
          if (grid !== null) dealt.set(grid, index + 1);
          el.animate?.([{ opacity: 0 }, { opacity: 1 }], {
            duration: fade,
            delay: Math.min(index, MAX_STEPS) * step,
            easing,
            fill: 'backwards',
          });
          if (grid !== null || first.has(el)) continue;
          let order = 0;
          for (const part of el.querySelectorAll(LOCKUP)) {
            if (!mayRise(part)) continue;
            part.animate?.(
              [
                { opacity: 0, transform: `translateY(${distance})` },
                { opacity: 1, transform: 'none' },
              ],
              { duration: rise, delay: order * step, easing, fill: 'backwards' },
            );
            order += 1;
          }
        }
      },
      // Fire a little before the section enters, so it is in motion as it arrives.
      { rootMargin: '0px 0px 20% 0px' },
    );
    const scan = () => {
      for (const el of document.querySelectorAll(SELECTOR)) {
        if (seen.has(el)) continue;
        seen.add(el);
        // Only what starts below the window takes part.
        if (el.getBoundingClientRect().top > window.innerHeight) observer.observe(el);
      }
    };
    const first = requestAnimationFrame(scan);
    const main = document.querySelector('main');
    const mutations = new MutationObserver(() => scan());
    if (main !== null) mutations.observe(main, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(first);
      observer.disconnect();
      mutations.disconnect();
    };
  }, [pathname]);
}
