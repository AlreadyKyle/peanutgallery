import type { ReactNode } from 'react';
import { CardFace, ShippedRow } from '../components/Cards';
import { DeployList } from '../components/DeployList';
import { EventList } from '../components/EventList';
import { Example } from '../components/Example';
import { PageHeader } from '../components/PageHeader';
import { PausedNotice } from '../components/PausedNotice';
import { SplitStats } from '../components/Funding';
import { LinkedText } from '../components/TextPage';
import { groupCards, fundingPlace } from '../lib/cards';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import { canFund } from '../lib/payment';
import type { Card, Snapshot } from '../lib/source';
import { useStudio } from '../lib/studio';

// The page's title, lede and example labels are words in copy.ts; its steps, the split example and
// where the money goes state money, so they are in legal.ts, and the split's figures come from
// Funding.tsx (both kernel, docs/specs/board-site.md).
const page = copy.howItWorksPage;
const money = legal.howMoneyMoves;

const EXAMPLE_ID = 'example';
/** The made-up agent actions, newest first: a start, a tool call and passed checks. */
const EXAMPLE_EVENT_TYPES = ['gate_pass', 'tool_call', 'start'] as const;

/** Made-up visuals carry times relative to now, so no fixed date is ever invented. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function emptySnapshot(): Snapshot {
  return {
    pool: null,
    cards: [],
    funding: {},
    launchedAt: null,
    paused: false,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles: [],
    cardTitles: {},
    missing: [],
  };
}

/** A made-up card for a visual when the studio has no real one to show. */
function exampleCard(overrides: Partial<Card>): Card {
  return {
    id: EXAMPLE_ID,
    title: page.exampleCard.title,
    summary: page.exampleCard.summary,
    intent: null,
    source: 'board',
    stage: 'proposed',
    shape: 'goal',
    bucket: 'game',
    folder: 'seed-1',
    horizon: 'now',
    rank: null,
    executor_role_id: null,
    funding_target_usd: 3,
    funded_usd: 1.2,
    spent_usd: 0,
    created_at: minutesAgo(60),
    updated_at: minutesAgo(60),
    live_at: null,
    ...overrides,
  };
}

function madeUp(cards: Card[], contributors: number): Snapshot {
  return { ...emptySnapshot(), cards, funding: { [EXAMPLE_ID]: { contributors, credited_usd: 0 } } };
}

function CardExample({ card, snapshot, real }: { card: Card; snapshot: Snapshot; real: boolean }) {
  return (
    <Example real={real}>
      <ul className="card-grid">
        <CardFace card={card} snapshot={snapshot} mode="example" />
      </ul>
    </Example>
  );
}

function PickVisual({ snapshot }: { snapshot: Snapshot | null }) {
  const open = snapshot === null ? undefined : groupCards(snapshot.cards, fundingPlace(snapshot)).fund.find(canFund);
  if (snapshot !== null && open !== undefined) return <CardExample card={open} snapshot={snapshot} real />;
  const card = exampleCard({});
  return <CardExample card={card} snapshot={madeUp([card], 2)} real={false} />;
}

function SplitVisual() {
  return (
    <Example real={false} caption={money.splitCaption}>
      <SplitStats />
    </Example>
  );
}

function BarVisual({ snapshot }: { snapshot: Snapshot | null }) {
  const queued = snapshot === null ? undefined : groupCards(snapshot.cards).queued.find((card) => card.funding_target_usd > 0);
  if (snapshot !== null && queued !== undefined) return <CardExample card={queued} snapshot={snapshot} real />;
  const card = exampleCard({ stage: 'funded', funded_usd: 3 });
  return <CardExample card={card} snapshot={madeUp([card], 3)} real={false} />;
}

function BuildVisual({ snapshot }: { snapshot: Snapshot | null }) {
  if (snapshot !== null && !snapshot.missing.includes('events') && snapshot.events.length > 0) {
    return (
      <Example real>
        <EventList snapshot={{ ...snapshot, events: snapshot.events.slice(0, 3) }} />
      </Example>
    );
  }
  const events = EXAMPLE_EVENT_TYPES.map((type, i) => ({
    id: `example-${i}`,
    card_id: EXAMPLE_ID,
    role_id: null,
    type,
    created_at: minutesAgo(4 * i),
  }));
  return (
    <Example real={false}>
      <EventList snapshot={{ ...emptySnapshot(), events, cardTitles: { [EXAMPLE_ID]: page.exampleCard.title } }} />
    </Example>
  );
}

function ChecksVisual({ snapshot }: { snapshot: Snapshot | null }) {
  if (snapshot !== null && !snapshot.missing.includes('deploys') && snapshot.deploys.length > 0) {
    return (
      <Example real>
        <DeployList snapshot={{ ...snapshot, deploys: snapshot.deploys.slice(0, 2) }} />
      </Example>
    );
  }
  const deploys = [
    { id: 'example-2', folder: 'seed-1', sha: '4f1c2d9e0b7a', is_green: true, created_at: minutesAgo(2) },
    { id: 'example-1', folder: 'seed-1', sha: '9a7e3b1c5d2f', is_green: false, created_at: minutesAgo(20) },
  ];
  return (
    <Example real={false}>
      <DeployList snapshot={{ ...emptySnapshot(), deploys }} />
    </Example>
  );
}

function ShippedVisual({ snapshot }: { snapshot: Snapshot | null }) {
  const latest = snapshot === null ? undefined : groupCards(snapshot.cards).shipped[0];
  const [card, shown, real] =
    snapshot !== null && latest !== undefined
      ? [latest, snapshot, true]
      : (() => {
          const example = exampleCard({ stage: 'live', funded_usd: 3, spent_usd: 0.24, live_at: minutesAgo(1) });
          return [example, madeUp([example], 3), false] as const;
        })();
  return (
    <Example real={real}>
      <ul className="rows rail">
        <ShippedRow card={card} snapshot={shown} example />
      </ul>
    </Example>
  );
}

const VISUALS: ((snapshot: Snapshot | null) => ReactNode)[] = [
  (snapshot) => <PickVisual snapshot={snapshot} />,
  () => <SplitVisual />,
  (snapshot) => <BarVisual snapshot={snapshot} />,
  (snapshot) => <BuildVisual snapshot={snapshot} />,
  (snapshot) => <ChecksVisual snapshot={snapshot} />,
  (snapshot) => <ShippedVisual snapshot={snapshot} />,
];

/**
 * The whole path of a contribution: six steps, each a short text with the real component that shows
 * it under it, in example mode. A visual uses a real public record where one exists and made-up
 * figures, labelled so, where none does. Then where the money goes, holds and refunds, and the rules.
 * Three bands (DESIGN.md, Bands): the heading and the paused notice on the signal plate, the steps
 * and their examples on paper, and the money and the rules on ink. Each step stacks its text over its
 * example at every width, so a short text never floats beside a tall card. The all-ages line is in
 * every footer.
 */
export function HowItWorks() {
  const studio = useStudio();
  const snapshot = studio.state === 'ready' ? studio.snapshot : null;
  return (
    <main className="wide">
      <div className="band">
        <PageHeader title={page.title} lede={page.lede}>
          <PausedNotice studio={studio} />
        </PageHeader>
      </div>
      <div className="band">
        <ol className="how-steps">
          {money.blocks.map((block, index) => (
            <li key={block.heading} className="how-step">
              <div className="how-text">
                <h2 id={`how-${index + 1}`}>{block.heading}</h2>
                {block.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
              <div className="how-visual">{VISUALS[index]?.(snapshot)}</div>
            </li>
          ))}
        </ol>
      </div>
      <div className="band">
        {money.sections.map((section, index) => (
          <section key={section.heading} className="section" aria-labelledby={`how-more-${index + 1}`}>
            <h2 id={`how-more-${index + 1}`}>{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>
                <LinkedText text={paragraph} />
              </p>
            ))}
          </section>
        ))}
        <section className="section" aria-labelledby="how-rules">
          <h2 id="how-rules">{page.rulesHeading}</h2>
          <div className="prose">
            <p>{legal.fixedRulesIntro}</p>
            <ul className="rules">
              {legal.fixedRules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            <p>{legal.artPolicy}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
