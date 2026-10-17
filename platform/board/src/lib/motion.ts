import { useEffect } from 'react';
import { flushSync } from 'react-dom';

// The board's motion (the public site's standard in its DESIGN.md, Motion, brought to an
// operator console with restraint): a tab change cross-fades through the browser's view transition, a
// panel that has just loaded fades in, and a section that starts below the window fades in once as it
// arrives. Only opacity moves here; the press and the tile lift are CSS transforms in styles.css, inside
// prefers-reduced-motion: no-preference. Under reduced motion (anything but no-preference) nothing here
// animates: the change is applied at once, so document.getAnimations() stays empty. Nothing is hidden
// by a stylesheet, so the first paint is complete and a control never moves under the pointer.

/** True only when the viewer has said nothing against motion. */
export function motionAllowed(win: Window | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  return win !== undefined && typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: no-preference)').matches;
}

function token(name: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

function ms(value: string): number {
  const n = parseFloat(value);
  return value.endsWith('ms') ? n : n * 1000;
}

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown };

/**
 * Applies a state change, cross-fading the old view into the new one where the browser has view
 * transitions and motion is allowed; elsewhere the change simply happens.
 */
export function swapView(update: () => void): void {
  const doc = typeof document === 'undefined' ? undefined : (document as ViewTransitionDocument);
  if (doc?.startViewTransition === undefined || !motionAllowed()) {
    update();
    return;
  }
  doc.startViewTransition.call(doc, () => flushSync(update));
}

/** Fades an element in over --dur-reveal, once; nothing under reduced motion. */
export function fadeIn(element: Element | null): void {
  if (!(element instanceof HTMLElement) || typeof element.animate !== 'function' || !motionAllowed()) return;
  element.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: ms(token('--dur-reveal', '320ms')),
    easing: token('--ease-scene', 'cubic-bezier(0.22, 1, 0.36, 1)'),
    fill: 'backwards',
  });
}

const REVEAL = 'main > section';

/**
 * The scroll reveal: each panel section that starts below the window fades in as it comes into view,
 * once. A section already on screen is drawn as it is.
 */
export function useSectionReveal(): void {
  useEffect(() => {
    if (!motionAllowed() || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          fadeIn(entry.target);
        }
      },
      { rootMargin: '0px 0px 10% 0px' },
    );
    const frame = requestAnimationFrame(() => {
      for (const section of document.querySelectorAll(REVEAL)) {
        if (section.getBoundingClientRect().top > window.innerHeight) observer.observe(section);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
}
