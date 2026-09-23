import { writtenBy } from '../components/Card';
import { PlannedRow } from '../components/Cards';
import { PageHeader } from '../components/PageHeader';
import { StaleNotice } from '../components/StaleNotice';
import { plannedCards, PLANNED_HORIZONS, type PlannedHorizon } from '../lib/cards';
import { copy } from '../lib/copy';
import type { Card, Snapshot } from '../lib/source';
import { unavailableLine, useStudio } from '../lib/studio';

const roadmap = copy.roadmap;

function Horizon({ horizon, cards, snapshot }: { horizon: PlannedHorizon; cards: Card[]; snapshot: Snapshot }) {
  return (
    <section className="section" aria-labelledby={`roadmap-${horizon}`}>
      <h2 id={`roadmap-${horizon}`}>{roadmap.horizons[horizon]}</h2>
      <p className="muted">{roadmap.horizonIntros[horizon]}</p>
      {cards.length === 0 ? (
        <p className="muted">{roadmap.empty}</p>
      ) : (
        <ul className="rows rail">
          {cards.map((card) => (
            <PlannedRow key={card.id} card={card} detail byline={writtenBy(card, snapshot)} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The roadmap: cards on horizon next and later, a band each (Next on paper, Later on ink), as rail
 * rows with the suit in the rail, each labelled planned and not built. It has no bars, no fund links and no status, because none of these cards
 * takes money until the board moves it to horizon now.
 */
export function Roadmap() {
  const studio = useStudio();
  return (
    <main>
      <div className="band">
        <PageHeader title={roadmap.title} lede={roadmap.lede}>
          <StaleNotice studio={studio} />
        </PageHeader>
      </div>
      {studio.state === 'ready' ? (
        PLANNED_HORIZONS.map((horizon) => (
          <div key={horizon} className="band">
            <Horizon horizon={horizon} cards={plannedCards(studio.snapshot.cards)[horizon]} snapshot={studio.snapshot} />
          </div>
        ))
      ) : (
        <div className="band">
          <p className="muted">{studio.state === 'loading' ? roadmap.loading : unavailableLine(studio)}</p>
        </div>
      )}
    </main>
  );
}
