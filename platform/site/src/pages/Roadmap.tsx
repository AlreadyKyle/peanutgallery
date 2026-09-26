import { writtenBy } from '../components/Card';
import { PlannedRow } from '../components/Cards';
import { PageHeader } from '../components/PageHeader';
import { StaleNotice } from '../components/StaleNotice';
import { plannedCards, PLANNED_HORIZONS, type PlannedHorizon } from '../lib/cards';
import { copy } from '../lib/copy';
import type { Card, Snapshot } from '../lib/source';
import { unavailableLine, useStudio } from '../lib/studio';

const roadmap = copy.roadmap;

/**
 * A planned card's group on /roadmap (docs/specs/copy-pass.md): board work, which no card funds, by
 * its marker; otherwise by folder, the game for players and platform for the studio. Never by bucket
 * (PLAN.md §4 Work).
 */
export type RoadmapGroup = 'players' | 'studio' | 'board';
export const ROADMAP_GROUPS: readonly RoadmapGroup[] = ['players', 'studio', 'board'];

export function roadmapGroup(card: Card): RoadmapGroup {
  if (card.board_work === true) return 'board';
  return card.folder === 'platform' ? 'studio' : 'players';
}

function Rows({ cards, snapshot }: { cards: Card[]; snapshot: Snapshot }) {
  return (
    <ul className="rows rail">
      {cards.map((card) => (
        <PlannedRow key={card.id} card={card} detail level={4} byline={writtenBy(card, snapshot)} />
      ))}
    </ul>
  );
}

/**
 * One group of a horizon: its heading, one line that says planned, and its rows. Board work is a
 * native disclosure, closed until the reader opens it, so it never reads as work supporters fund.
 */
function Group({ horizon, group, cards, snapshot }: { horizon: PlannedHorizon; group: RoadmapGroup; cards: Card[]; snapshot: Snapshot }) {
  const id = `roadmap-${horizon}-${group}`;
  const words = roadmap.groups[group];
  if (group === 'board') {
    return (
      <details className="roadmap-group roadmap-board" data-group={group}>
        <summary>
          <h3 id={id}>{words.heading}</h3>
        </summary>
        <p className="muted">{words.intro}</p>
        <Rows cards={cards} snapshot={snapshot} />
      </details>
    );
  }
  return (
    <section className="roadmap-group" data-group={group} aria-labelledby={id}>
      <h3 id={id}>{words.heading}</h3>
      <p className="muted">{words.intro}</p>
      <Rows cards={cards} snapshot={snapshot} />
    </section>
  );
}

function Horizon({ horizon, cards, snapshot }: { horizon: PlannedHorizon; cards: Card[]; snapshot: Snapshot }) {
  return (
    <section className="section" aria-labelledby={`roadmap-${horizon}`}>
      <h2 id={`roadmap-${horizon}`}>{roadmap.horizons[horizon]}</h2>
      <p className="muted">{roadmap.horizonIntros[horizon]}</p>
      {cards.length === 0 ? (
        <p className="muted">{roadmap.empty}</p>
      ) : (
        ROADMAP_GROUPS.map((group) => {
          const inGroup = cards.filter((card) => roadmapGroup(card) === group);
          return inGroup.length === 0 ? null : <Group key={group} horizon={horizon} group={group} cards={inGroup} snapshot={snapshot} />;
        })
      )}
    </section>
  );
}

/**
 * The roadmap: cards on horizon next and later, a band each (Next on paper, Later on ink). In each,
 * the cards for players, then the studio's, then board work in a closed disclosure; an empty group is
 * not drawn. Rail rows with the suit in the rail. It has no bars, no fund links and no status, because
 * none of these cards takes money until the board moves it to horizon now, and board work never does.
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
          <p className="muted" aria-busy={studio.state === 'loading' ? 'true' : undefined}>
            {studio.state === 'loading' ? roadmap.loading : unavailableLine(studio)}
          </p>
        </div>
      )}
    </main>
  );
}
