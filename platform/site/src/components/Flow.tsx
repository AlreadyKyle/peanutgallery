import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { flowLanes, FLOW_LANE_CARDS, FLOW_LANES, shippedAt, type CardGroups, type FlowLane } from '../lib/cards';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { formatDate } from '../lib/format';
import { legal } from '../lib/legal';
import { agentsOffline } from '../lib/offline';
import type { Card, Snapshot } from '../lib/source';
import { CardFace } from './Card';
import { CoinMark, FundAgreement, liveFundLink, type SpecRow } from './Funding';
import { Glyph } from './Glyph';
import { MoreLink } from './MoreLink';

// Home's card band (docs/specs/home-flow.md, DESIGN.md Home). First the cards you can fund, as full
// faces in the fund grid (the live view's tick, flip and deal find them there, lib/live.ts; their
// money comes from Funding.tsx, kernel, unchanged), or with none open a panel that funds the next card
// in line. Then the flow: three lanes side by side, Next up, Building and Shipped. Every lane says who
// acts in it, shows at most three compact faces and never stands empty: a lane with no card says what
// happens next.

function countLine(n: number): string {
  return n === 1 ? copy.flow.countOne : copy.flow.count.replace('{n}', String(n));
}

/** The Game Designer's state, from the studio's supply: offline, drafting now, done for today, or waiting. */
export function draftingLine(snapshot: Snapshot): { text: string; drafting: boolean } {
  const supply = snapshot.supply ?? null;
  if (supply?.offline === true) return { text: copy.agentsOffline, drafting: false };
  if (supply?.drafting === true) return { text: copy.flow.drafting, drafting: true };
  if (supply?.reason === 'daily_limit' && supply.run_limit > 0) {
    return { text: copy.flow.draftingDone.replace('{n}', String(supply.run_limit)), drafting: false };
  }
  if (supply?.reason === 'no_money') return { text: copy.flow.draftingNoMoney, drafting: false };
  return { text: copy.flow.draftingIdle, drafting: false };
}

/** Building's empty line: when a funded card starts, unless the agents are offline. */
export function buildingEmptyLine(snapshot: Snapshot): string {
  return agentsOffline(snapshot) ? copy.flow.lanes.building.emptyOffline : copy.flow.lanes.building.empty;
}

/** A lane's heading: its step on the rail, its name and how many cards it holds. */
function LaneHead({ lane, step, count }: { lane: FlowLane; step: number; count: number }) {
  return (
    <>
      <p className="flow-step" aria-hidden="true">
        <span className="flow-step-number">{String(step).padStart(2, '0')}</span>
      </p>
      <h3 id={`lane-${lane}`} className="flow-title">
        {copy.flow.lanes[lane].title} <span className="flow-count">{countLine(count)}</span>
      </h3>
    </>
  );
}

/** Who acts in a lane. In Next up it is the Game Designer's state: offline, drafting now, done for today, or waiting. */
function LaneWho({ lane, snapshot }: { lane: FlowLane; snapshot: Snapshot }) {
  if (lane !== 'next') return <p className="flow-who">{copy.flow.lanes[lane].who}</p>;
  const designer = draftingLine(snapshot);
  return (
    <p className="flow-who flow-agent" data-drafting={designer.drafting ? 'true' : undefined}>
      <Glyph name="pencil" />
      <span>{designer.text}</span>
    </p>
  );
}

/** A lane's cards as compact faces. Only Next up draws the Planned face; the others take their stage's. */
function LaneCards({ cards, snapshot, planned = false }: { cards: Card[]; snapshot: Snapshot; planned?: boolean }) {
  return (
    <ul className="flow-cards">
      {cards.slice(0, FLOW_LANE_CARDS).map((card) => (
        <CardFace key={card.id} card={card} snapshot={snapshot} compact face={planned ? 'planned' : undefined} />
      ))}
    </ul>
  );
}

/** What a lane with no card says instead: a tile with the next thing that happens. */
function EmptyTile({ children }: { children: ReactNode }) {
  return <div className="flow-empty">{children}</div>;
}

/** A lane's body: its cards, or its tile. */
function LaneBody({ lane, cards, snapshot, lastShipped }: { lane: FlowLane; cards: Card[]; snapshot: Snapshot; lastShipped: Card | undefined }) {
  if (cards.length > 0) return <LaneCards cards={cards} snapshot={snapshot} planned={lane === 'next'} />;
  if (lane === 'building') {
    return (
      <EmptyTile>
        <p>{buildingEmptyLine(snapshot)}</p>
        {lastShipped === undefined ? null : (
          <p className="card-meta">
            {copy.flow.lanes.building.lastBuilt.replace('{title}', lastShipped.title).replace('{date}', formatDate(shippedAt(lastShipped)))}
          </p>
        )}
      </EmptyTile>
    );
  }
  return (
    <EmptyTile>
      <p>{lane === 'next' ? copy.flow.lanes.next.empty : copy.flow.lanes.shipped.empty}</p>
    </EmptyTile>
  );
}

/** Home shows this many cards to fund, one row of full faces; /contribute has the rest. */
export const HOME_FUND_CARDS = 3;

/**
 * The cards open for funding, first on home and as big as a card gets: full faces in the waterfall's
 * order, the agreement under them, a link to the rest on /contribute, then the Machine card. With none
 * open, a panel that funds the next card in line beside the Machine card, and the agreement under
 * both. The agreement is said once in the Fund station and covers every link to checkout in it, so
 * the Machine card passed here draws none of its own.
 */
export function FundNow({
  cards,
  snapshot,
  changed = {},
  machine = null,
}: {
  cards: Card[];
  snapshot: Snapshot;
  changed?: Readonly<Record<string, readonly SpecRow[]>>;
  /** The Machine card, set under the cards (docs/specs/brand.md, Home), drawn with agreement={false}. */
  machine?: ReactNode;
}) {
  const env = siteEnv();
  const machineLinks = machine !== null && env.stripePaymentLinkUrl !== '';
  if (cards.length === 0) {
    // The Game Designer's drafting line is Next up's, so the panel does not say it twice.
    return (
      <>
        <div className="fund-ways">
          <div className="fund-empty">
            <p className="fund-empty-title">{legal.pickForMe}</p>
            <p>{legal.fundEmptyBody}</p>
            {env.stripePaymentLinkUrl === '' ? null : (
              <Link className="button btn-coin" to="/contribute">
                <CoinMark />
                {copy.contribute}
              </Link>
            )}
          </div>
          {machine}
        </div>
        {machineLinks ? <FundAgreement /> : null}
      </>
    );
  }
  const shown = cards.slice(0, HOME_FUND_CARDS);
  return (
    <>
      <ul className="card-grid fund-grid">
        {shown.map((card) => (
          <CardFace key={card.id} card={card} snapshot={snapshot} changed={changed[card.id]} />
        ))}
      </ul>
      {shown.some((card) => liveFundLink(card, snapshot)) || machineLinks ? <FundAgreement /> : null}
      {cards.length > HOME_FUND_CARDS ? <MoreLinkLine to="/contribute" words={copy.flow.fundMore.replace('{n}', String(cards.length))} /> : null}
      {/* There is always more than one way to fund (decision 73): under the open cards, the Machine
          card, which takes money for the studio as a whole. Fund the next card in line is on
          /contribute only, since it and the Machine card both mean "any card". */}
      {machineLinks ? <div className="fund-ways">{machine}</div> : null}
    </>
  );
}

/** The link under a lane to the rest of its cards, or nothing. */
function LaneMore({ lane }: { lane: FlowLane }) {
  if (lane === 'shipped') return <MoreLinkLine to="/reports" words={copy.flow.lanes.shipped.more} />;
  return null;
}

function MoreLinkLine({ to, words }: { to: string; words: string }) {
  return (
    <p className="more">
      <MoreLink to={to}>{words}</MoreLink>
    </p>
  );
}

/** The three lanes, in order, each never empty. */
export function MachineFlow({ snapshot, groups }: { snapshot: Snapshot; groups: CardGroups }) {
  const lanes = flowLanes(groups);
  // A lane is as long as the cards in it, like a column on a board: Shipped holds three while Building
  // may hold a tile, so the lanes are uneven by nature. Their rows are shared (styles.css), so every
  // lane's first card starts on one line; the balance audit leaves them be (scripts/layout-audit.mjs).
  return (
    <ol className="flow-lanes" data-balance="ignore">
      {FLOW_LANES.map((lane, index) => (
        <li key={lane} className="flow-lane" data-lane={lane} aria-labelledby={`lane-${lane}`}>
          <LaneHead lane={lane} step={index + 1} count={lanes[lane].length} />
          <LaneWho lane={lane} snapshot={snapshot} />
          <LaneBody lane={lane} cards={lanes[lane]} snapshot={snapshot} lastShipped={lanes.shipped[0]} />
          <LaneMore lane={lane} />
        </li>
      ))}
    </ol>
  );
}
