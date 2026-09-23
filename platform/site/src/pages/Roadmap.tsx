import { Glyph, SUITS } from '../components/Glyph';
import { PageHeader } from '../components/PageHeader';
import { StaleNotice } from '../components/StaleNotice';
import { CATEGORY_FILTERS, categoryOf, plannedCards, PLANNED_HORIZONS, type CardCategory } from '../lib/cards';
import { copy } from '../lib/copy';
import type { Card, Snapshot } from '../lib/source';
import { unavailableLine, useStudio } from '../lib/studio';

const roadmap = copy.roadmap;
const CATEGORIES = CATEGORY_FILTERS.filter((filter): filter is CardCategory => filter !== 'all');

function PlannedList({ cards }: { cards: Card[] }) {
  return (
    <ul className="planned">
      {cards.map((card) => (
        <li key={card.id}>
          <h4>{card.title}</h4>
          {card.summary === null || card.summary.trim() === '' ? null : <p>{card.summary}</p>}
          <p className="card-meta">{roadmap.planned}</p>
        </li>
      ))}
    </ul>
  );
}

function Horizons({ snapshot }: { snapshot: Snapshot }) {
  const planned = plannedCards(snapshot.cards);
  return (
    <>
      {PLANNED_HORIZONS.map((horizon) => {
        const cards = planned[horizon];
        return (
          <section key={horizon} className="section" aria-labelledby={`roadmap-${horizon}`}>
            <h2 id={`roadmap-${horizon}`}>{roadmap.horizons[horizon]}</h2>
            <p className="muted">{roadmap.horizonIntros[horizon]}</p>
            {cards.length === 0 ? (
              <p className="muted">{roadmap.empty}</p>
            ) : (
              CATEGORIES.map((category) => {
                const inCategory = cards.filter((card) => categoryOf(card) === category);
                if (inCategory.length === 0) return null;
                return (
                  <div key={category} className="planned-group">
                    <h3 className="with-glyph">
                      <Glyph name={SUITS[category].glyph} />
                      {SUITS[category].label}
                    </h3>
                    <PlannedList cards={inCategory} />
                  </div>
                );
              })
            )}
          </section>
        );
      })}
    </>
  );
}

/**
 * The roadmap: cards on horizon next and later, grouped by horizon and then category, each labelled
 * planned and not built. It has no bars, no fund links and no status, because none of these cards
 * takes money until the board moves it to horizon now.
 */
export function Roadmap() {
  const studio = useStudio();
  return (
    <main>
      <PageHeader title={roadmap.title} lede={roadmap.lede}>
        <StaleNotice studio={studio} />
      </PageHeader>
      {studio.state === 'loading' ? <p className="muted">{roadmap.loading}</p> : null}
      {studio.state === 'unconfigured' || studio.state === 'error' ? <p className="muted">{unavailableLine(studio)}</p> : null}
      {studio.state === 'ready' ? <Horizons snapshot={studio.snapshot} /> : null}
    </main>
  );
}
