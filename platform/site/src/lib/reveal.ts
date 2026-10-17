import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { motionAllowed } from './motion';

// The scroll reveal (docs/specs/final-state.md, the motion pass): a section below the fold fades in
// as it comes into view, once, over --dur-reveal with the scene's easing. Only its opacity changes,
// so no box shifts while it plays (e2e/card.spec.ts measures that). Nothing is hidden by a
// stylesheet: a section is drawn as it is until the observer sees it nearing the window, so the first
// paint is complete, and under reduced motion nothing changes at all.

const SELECTOR = 'main > .band > .section, main > .band > section, .card-grid > li, .seed-grid > li, .goal';

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

export function useScrollReveal(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!motionAllowed() || typeof IntersectionObserver === 'undefined') return;
    const seen = new WeakSet<Element>();
    const duration = parseFloat(token('--dur-reveal', '480ms'));
    const easing = token('--ease-scene', 'cubic-bezier(0.22, 1, 0.36, 1)');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          const el = entry.target as HTMLElement;
          // Already on screen when first seen: drawn as it is.
          if (el.getBoundingClientRect().top < window.innerHeight) continue;
          el.animate?.(
            [{ opacity: 0 }, { opacity: 1 }],
            { duration, easing, fill: 'backwards' },
          );
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
