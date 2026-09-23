import { useState } from 'react';
import { categoryOf, groupCards, inCategory, sourceLabel, visibleFilters, type CategoryFilter } from '../lib/cards';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import type { Card, Snapshot } from '../lib/source';
import type { StudioState } from '../lib/studio';
import { CardFace } from './Card';
import { shippedCaption as moneyCaption } from './Funding';
import { Glyph, SUITS } from './Glyph';
import { Guarded } from './Guarded';

// The card groups, in the platform code lane. Each card is drawn by Card.tsx; its money (the bar,
// the spec rows, what a card spent and the Fund this card link) comes from Funding.tsx and the
// snapshot guard from Guarded.tsx, both kernel.
export { FundingBar, fundingCaption } from './Funding';
export { Guarded } from './Guarded';
export { CardFace } from './Card';

function blank(text: string | null): boolean {
  return text === null || text.trim() === '';
}

function CardGrid({ cards, snapshot }: { cards: Card[]; snapshot: Snapshot }) {
  return (
    <ul className="card-grid">
      {cards.map((card) => (
        <CardFace key={card.id} card={card} snapshot={snapshot} />
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

/** One filter chip: the suit glyph and label (or All), its count, and the check glyph while pressed. */
export function FilterChip({
  option,
  count,
  pressed,
  onPress,
}: {
  option: CategoryFilter;
  count: number;
  pressed: boolean;
  onPress: () => void;
}) {
  return (
    <button type="button" className="filter" aria-pressed={pressed} onClick={onPress}>
      {pressed ? <Glyph name="check" /> : null}
      {option === 'all' ? null : <Glyph name={SUITS[option].glyph} />}
      {copy.categories[option]} <span className="filter-count">{count}</span>
    </button>
  );
}

/**
 * Cards open for funding, filtered by what they spend money on. The studio chip shows only while it
 * has cards; a chip that empties while pressed falls back to All.
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
                <FilterChip key={option} option={option} count={count(option)} pressed={filter === option} onPress={() => setFilter(option)} />
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

/** The shipped row's money line, from Funding.tsx (kernel), with the card's source as the layout names it. */
export function shippedCaption(card: Card, snapshot: Snapshot): string {
  return moneyCaption(card, snapshot, sourceLabel(card.source));
}

/** One shipped card as a row. In example mode it has no Play the game link. */
export function ShippedRow({ card, snapshot, example = false }: { card: Card; snapshot: Snapshot; example?: boolean }) {
  const env = siteEnv();
  const titleId = `${example ? 'example' : 'shipped'}-title-${card.id}`;
  const suit = SUITS[categoryOf(card)];
  return (
    <li>
      <p className="shipped-category with-glyph">
        <Glyph name={suit.glyph} />
        {suit.label}
      </p>
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
