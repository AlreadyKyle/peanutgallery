import { copy } from '../lib/copy';

/**
 * A polite live region for a list of cards (WCAG 4.1.3): empty while the list loads, then the count
 * once it arrives, or that they did not load (the page's own line says why). It is always in the page, so a screen
 * reader hears the change; the list's own loading line stays on screen as before.
 */
export function CardsStatus({ count, unavailable }: { count: number | null; unavailable: boolean }) {
  const message = unavailable ? copy.cardsUnavailable : (count === null ? '' : count === 1 ? copy.cardsLoadedOne : `${count}${copy.cardsLoadedMany}`);
  return (
    <p className="sr-only" role="status" aria-live="polite" data-cards-status="">
      {message}
    </p>
  );
}
