import { Link } from 'react-router-dom';
import { shippedAt } from '../lib/cards';
import { copy } from '../lib/copy';
import { formatDate } from '../lib/format';
import { shippedSince } from '../lib/last-visit';
import type { Card } from '../lib/source';

/**
 * Home's "Since your last visit" strip (docs/specs/supporter-loop.md): the cards that shipped since
 * this browser last opened home, each linking its own page. Nothing on a first visit or when none did.
 */
export function SinceLastVisit({ cards, since }: { cards: readonly Card[]; since: number | null }) {
  const shipped = shippedSince(cards, since);
  if (shipped.length === 0) return null;
  return (
    <section className="section since-visit" aria-labelledby="since-visit">
      <h2 id="since-visit">{copy.sinceVisit.heading}</h2>
      <ul className="rows">
        {shipped.map((card) => (
          <li key={card.id} data-card={card.id}>
            <span className="row-time">{formatDate(shippedAt(card))}</span>
            <div className="row-body">
              <p className="row-title">
                <Link to={`/card/${card.id}`}>{card.title}</Link>
              </p>
              <p className="card-meta">{copy.sinceVisit.shipped}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
