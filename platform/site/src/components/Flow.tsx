import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { flowLanes, FLOW_LANE_CARDS, FLOW_LANES, shippedAt, type CardGroups, type FlowLane } from '../lib/cards';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { formatDate } from '../lib/format';
import { legal } from '../lib/legal';
import type { Card, Snapshot } from '../lib/source';
import { CardFace } from './Card';
import { CoinMark, FundAgreement, liveFundLink, type SpecRow } from './Funding';
import { Glyph } from './Glyph';
import { MoreLink } from './MoreLink';

// Home's flow (docs/specs/home-flow.md, DESIGN.md Home): one band, four lanes in the order a card
// moves through them, Next up, Fund now, Building and Shipped. Every lane says who acts in it, shows
// at most three cards as compact faces and never stands empty: a lane with no card says what happens
// next. The Fund now lane keeps the fund grid's class, so the live view's tick, flip and deal find
// its cards (lib/live.ts); its money comes from Funding.tsx (kernel), unchanged.

function countLine(n: number): string {
  return n === 1 ? copy.flow.countOne : copy.flow.count.replace('{n}', String(n));
}

/** The Game Designer's state, from the studio's supply: drafting now, done for today, or waiting. */
export function draftingLine(snapshot: Snapshot): { text: string; drafting: boolean } {
  const supply = snapshot.supply ?? null;
  if (supply?.drafting === true) return { text: copy.flow.drafting, drafting: true };
  if (supply?.reason === 'daily_limit' && supply.run_limit > 0) {
    return { text: copy.flow.draftingDone.replace('{n}', String(supply.run_limit)), drafting: false };
  }
  return { text: copy.flow.draftingIdle, drafting: false };
}

/** A lane's heading: its step on the rail, its name and how many cards it holds. */
function LaneHead({ lane, step, count }: { lane: FlowLane; step: number; count: number }) {
  return (
    <>
      <p className="flow-step" aria-hidden="true">
        <span className="flow-step-number">{step}</span>
      </p>
      <h3 id={`lane-${lane}`} className="flow-title">
        {copy.flow.lanes[lane].title} <span className="flow-count">{countLine(count)}</span>
      </h3>
    </>
  );
}

/** Who acts in a lane. In Next up it is the Game Designer's state: drafting now, done for today, or waiting. */
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

function LaneCards({ cards, snapshot, fund = false, changed = {} }: { cards: Card[]; snapshot: Snapshot; fund?: boolean; changed?: Readonly<Record<string, readonly SpecRow[]>> }) {
  return (
    <ul className={fund ? 'flow-cards fund-grid' : 'flow-cards'}>
      {cards.slice(0, FLOW_LANE_CARDS).map((card) => (
        <CardFace key={card.id} card={card} snapshot={snapshot} compact face={card.horizon === 'now' ? undefined : 'planned'} changed={changed[card.id]} />
      ))}
    </ul>
  );
}

/** What a lane with no card says instead: a tile with the next thing that happens. */
function EmptyTile({ children }: { children: ReactNode }) {
  return <div className="flow-empty">{children}</div>;
}

/** A lane's body: its cards, or its tile. */
function LaneBody({ lane, cards, snapshot, lastShipped, changed }: { lane: FlowLane; cards: Card[]; snapshot: Snapshot; lastShipped: Card | undefined; changed: Readonly<Record<string, readonly SpecRow[]>> }) {
  const env = siteEnv();
  if (lane === 'fund') {
    if (cards.length === 0) {
      // Nothing takes money right now: the honest call is the next card in line, which is also what
      // pays for the agents to draft and build the next one.
      return (
        <EmptyTile>
          <p className="flow-empty-title">{legal.pickForMe}</p>
          <p>{legal.nextInLineNone}</p>
          {env.stripePaymentLinkUrl === '' ? null : (
            <Link className="button btn-coin button-block" to="/contribute">
              <CoinMark />
              {copy.contribute}
            </Link>
          )}
        </EmptyTile>
      );
    }
    const shown = cards.slice(0, FLOW_LANE_CARDS);
    return (
      <div>
        <LaneCards cards={shown} snapshot={snapshot} fund changed={changed} />
        {shown.some((card) => liveFundLink(card, snapshot)) ? <FundAgreement /> : null}
      </div>
    );
  }
  if (cards.length > 0) return <LaneCards cards={cards} snapshot={snapshot} />;
  if (lane === 'building') {
    return (
      <EmptyTile>
        <p>{copy.flow.lanes.building.empty}</p>
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

/** The link under a lane to the rest of its cards, or nothing. */
function LaneMore({ lane, count }: { lane: FlowLane; count: number }) {
  if (lane === 'next') return <MoreLinkLine to="/roadmap" words={copy.flow.lanes.next.more} />;
  if (lane === 'shipped') return <MoreLinkLine to="/roadmap" words={copy.flow.lanes.shipped.more} />;
  if (lane === 'fund' && count > FLOW_LANE_CARDS) return <MoreLinkLine to="/contribute" words={copy.flow.lanes.fund.more.replace('{n}', String(count))} />;
  return null;
}

function MoreLinkLine({ to, words }: { to: string; words: string }) {
  return (
    <p className="more">
      <MoreLink to={to}>{words}</MoreLink>
    </p>
  );
}

/** The four lanes, in order, each never empty. */
export function MachineFlow({
  snapshot,
  groups,
  changed = {},
}: {
  snapshot: Snapshot;
  groups: CardGroups;
  changed?: Readonly<Record<string, readonly SpecRow[]>>;
}) {
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
          <LaneBody lane={lane} cards={lanes[lane]} snapshot={snapshot} lastShipped={lanes.shipped[0]} changed={changed} />
          <LaneMore lane={lane} count={lanes[lane].length} />
        </li>
      ))}
    </ol>
  );
}
