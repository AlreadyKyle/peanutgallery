import { useState, type ReactNode } from 'react';
import {
  categoryOf,
  groupCards,
  inCategory,
  shippedAt,
  sourceLabel,
  statusOf,
  visibleFilters,
  type CategoryFilter,
} from '../lib/cards';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { formatDate, formatUsd } from '../lib/format';
import { canFund, fundLink } from '../lib/payment';
import type { Card, Snapshot } from '../lib/source';
import { unavailableLine, type StudioState } from '../lib/studio';
import { contributorsLine, FundingBar, fundingCaption } from './Funding';

export { FundingBar, fundingCaption } from './Funding';

export function Guarded({
  studio,
  children,
}: {
  studio: StudioState;
  children: (snapshot: Snapshot) => ReactNode;
}) {
  if (studio.state === 'loading') {
    return <p className="muted">{copy.loadingCards}</p>;
  }
  if (studio.state !== 'ready') {
    return <p className="muted">{unavailableLine(studio)}</p>;
  }
  return <>{children(studio.snapshot)}</>;
}

function blank(text: string | null): boolean {
  return text === null || text.trim() === '';
}

const STATUS_WORDS: Record<ReturnType<typeof statusOf>, string> = {
  building: copy.statusBuilding,
  gated: copy.statusGated,
  queued: copy.statusQueued,
  picked: copy.statusPicked,
  open: copy.statusOpen,
  shipped: copy.statusShipped,
};

// The agent brief stays public but collapsed behind a native disclosure.
function Brief({ intent }: { intent: string | null }) {
  if (blank(intent)) return null;
  return (
    <details className="brief">
      <summary>{copy.agentBrief}</summary>
      <p>{intent}</p>
    </details>
  );
}

/**
 * One card as a box: category and status on top, title and summary, then money and the action
 * pinned to the bottom. In example mode (/how-it-works) it renders no link, button or disclosure at
 * all, whatever canFund or the Payment Link say, so an illustration can never take a payment.
 */
export function CardBox({ card, snapshot, example = false }: { card: Card; snapshot: Snapshot; example?: boolean }) {
  const env = siteEnv();
  const titleId = `${example ? 'example' : 'card'}-title-${card.id}`;
  const status = statusOf(card);
  const caption = fundingCaption(card, snapshot);
  const building = status === 'building' || status === 'gated';
  return (
    <li className="card">
      <p className="card-top">
        <span className="card-category">{copy.categories[categoryOf(card)]}</span>
        <span className={status === 'open' ? 'card-status' : 'card-status badge'}>{STATUS_WORDS[status]}</span>
      </p>
      <h3 id={titleId}>{card.title}</h3>
      {blank(card.summary) ? null : <p className="card-summary">{card.summary}</p>}
      <div className="card-bottom">
        {building ? (
          <p className="card-meta">
            {card.spent_usd > 0 ? `${formatUsd(card.spent_usd)} ${copy.spentSoFar} · ` : ''}
            {sourceLabel(card.source)}
          </p>
        ) : null}
        {!building && caption !== null ? (
          <>
            <FundingBar card={card} />
            <p className="card-meta">{caption}</p>
          </>
        ) : null}
        {!example && !building && env.stripePaymentLinkUrl !== '' && canFund(card) ? (
          <a
            className="button button-secondary button-block"
            href={fundLink(env.stripePaymentLinkUrl, card.id)}
            aria-describedby={titleId}
          >
            {copy.fundThis}
          </a>
        ) : null}
        {example ? null : <Brief intent={card.intent} />}
      </div>
    </li>
  );
}

function CardGrid({ cards, snapshot }: { cards: Card[]; snapshot: Snapshot }) {
  return (
    <ul className="card-grid">
      {cards.map((card) => (
        <CardBox key={card.id} card={card} snapshot={snapshot} />
      ))}
    </ul>
  );
}

/** The cards being built, or nothing: the Right now panel already says when nothing is building. */
export function BuildingNow({ snapshot }: { snapshot: Snapshot }) {
  const { now } = groupCards(snapshot.cards);
  if (now.length === 0) return null;
  return (
    <section className="section" aria-labelledby="now">
      <h2 id="now">{copy.now}</h2>
      <CardGrid cards={now} snapshot={snapshot} />
    </section>
  );
}

/**
 * Cards open for funding, filtered by what they spend money on. The studio and next game chips show
 * only while they have cards; a chip that empties while pressed falls back to All.
 */
export function FundBoard({ studio }: { studio: StudioState }) {
  const [chosen, setFilter] = useState<CategoryFilter>('all');
  return (
    <Guarded studio={studio}>
      {(snapshot) => {
        const { fund } = groupCards(snapshot.cards);
        const options = visibleFilters(fund);
        const filter = options.includes(chosen) ? chosen : 'all';
        const shown = fund.filter((card) => inCategory(card, filter));
        const count = (option: CategoryFilter) => fund.filter((card) => inCategory(card, option)).length;
        const note = filter === 'all' ? null : copy.categoryNotes[filter];
        return (
          <>
            <div className="filters" role="group" aria-label={copy.filterLabel}>
              {options.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="filter"
                  aria-pressed={filter === option}
                  onClick={() => setFilter(option)}
                >
                  {copy.categories[option]} <span className="filter-count">{count(option)}</span>
                </button>
              ))}
            </div>
            {note === null ? null : <p className="muted">{note}</p>}
            {shown.length === 0 ? (
              <p className="muted">{copy.fundEmpty}</p>
            ) : (
              <CardGrid cards={shown} snapshot={snapshot} />
            )}
          </>
        );
      }}
    </Guarded>
  );
}

/**
 * "$1.23 spent · 3 contributors · shipped 15 Sep 2026"; a card nobody funded names its source
 * instead. Only studio-billed spend is public, so a card built on the founder's time shows none.
 * When the funding figures did not load, a goal card leaves its count out instead of showing 0.
 */
export function shippedCaption(card: Card, snapshot: Snapshot): string {
  const funding = snapshot.funding[card.id];
  let who: string | null = sourceLabel(card.source);
  if (card.shape === 'goal' || funding !== undefined) {
    who = snapshot.missing.includes('funding') ? null : contributorsLine(funding?.contributors ?? 0);
  }
  const cost = card.spent_usd > 0 ? `${formatUsd(card.spent_usd)} ${copy.spent} · ` : '';
  const count = who === null ? '' : `${who} · `;
  return `${cost}${count}${copy.shippedOn} ${formatDate(shippedAt(card))}`;
}

/** One shipped card as a row. In example mode it has no Play the game link. */
export function ShippedRow({ card, snapshot, example = false }: { card: Card; snapshot: Snapshot; example?: boolean }) {
  const env = siteEnv();
  const titleId = `${example ? 'example' : 'shipped'}-title-${card.id}`;
  return (
    <li>
      <p className="shipped-category">{copy.categories[categoryOf(card)]}</p>
      <h3 id={titleId}>{card.title}</h3>
      {blank(card.summary) ? null : <p>{card.summary}</p>}
      <p className="card-meta">{shippedCaption(card, snapshot)}</p>
      {!example && env.playUrl !== '' && card.folder === 'seed-1' ? (
        <p className="small">
          <a href={env.playUrl} aria-describedby={titleId}>
            {copy.playTheGame}
          </a>
        </p>
      ) : null}
    </li>
  );
}

/** Live cards, newest first, as rows: what each change cost, who funded it and when it shipped. */
export function ShippedList({ snapshot }: { snapshot: Snapshot }) {
  const { shipped } = groupCards(snapshot.cards);
  if (shipped.length === 0) return null;
  return (
    <section className="section" aria-labelledby="shipped">
      <h2 id="shipped">{copy.shipped}</h2>
      <p className="muted">{copy.shippedIntro}</p>
      <ul className="shipped">
        {shipped.map((card) => (
          <ShippedRow key={card.id} card={card} snapshot={snapshot} />
        ))}
      </ul>
    </section>
  );
}

/** Funded cards waiting for the agents, as a compact list. */
export function QueuedList({ snapshot }: { snapshot: Snapshot }) {
  const { queued } = groupCards(snapshot.cards);
  if (queued.length === 0) return null;
  return (
    <section className="section" aria-labelledby="queued">
      <h2 id="queued">{copy.queued}</h2>
      <p className="muted">{copy.queuedIntro}</p>
      <ul className="rows">
        {queued.map((card) => (
          <li key={card.id}>
            <span className="row-strong">{card.title}</span>
            <span className="muted">
              {copy.categories[categoryOf(card)]} · {sourceLabel(card.source)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
