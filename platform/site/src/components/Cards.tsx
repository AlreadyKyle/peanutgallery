import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { categoryOf, groupCards, inCategory, shippedAt, sourceLabel, visibleFilters, type CategoryFilter } from '../lib/cards';
import { copy } from '../lib/copy';
import { formatDate } from '../lib/format';
import type { Card, Snapshot } from '../lib/source';
import { CardFace } from './Card';
import { shippedMeta, type SpecRow } from './Funding';
import { Glyph, STATE_TAGS, SUITS } from './Glyph';

// The card groups, in the platform code lane. Each card is drawn by Card.tsx; its money (the bar,
// the spec rows, what a card spent and the Fund this card link) comes from Funding.tsx, kernel.
// Queued, Shipped and planned cards are rows, never cards: only the fund grid and Building now draw
// card faces, and both sit in a page's second band (DESIGN.md, Bands).
export { FundingBar, fundingCaption } from './Funding';
export { Guarded } from './Guarded';
export { CardFace } from './Card';

/** The fund grid shows this many cards on a phone until the viewer asks for the rest. */
export const PHONE_CARDS = 3;

function blank(text: string | null): boolean {
  return text === null || text.trim() === '';
}

/** The cards being built, or nothing: the status line already says when nothing is building. */
export function BuildingNow({ cards, snapshot }: { cards: Card[]; snapshot: Snapshot }) {
  if (cards.length === 0) return null;
  return (
    <section className="section" aria-labelledby="now">
      <h2 id="now">{copy.now}</h2>
      <ul className="card-grid">
        {cards.map((card) => (
          <CardFace key={card.id} card={card} snapshot={snapshot} />
        ))}
      </ul>
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
 * Cards open for funding, filtered by what they spend money on, in the order given (home passes its
 * frozen layout). The studio chip shows only while it has cards; a chip that empties while pressed
 * falls back to All. A phone shows the first three and "Show all n cards", which shows the rest and
 * moves focus to the fourth card's title.
 */
export function FundBoard({
  snapshot,
  cards = groupCards(snapshot.cards).fund,
  changed = {},
}: {
  snapshot: Snapshot;
  cards?: Card[];
  changed?: Readonly<Record<string, readonly SpecRow[]>>;
}) {
  const [chosen, setFilter] = useState<CategoryFilter>('all');
  const [all, setAll] = useState(false);
  const grid = useRef<HTMLUListElement>(null);
  const focusFourth = useRef(false);
  const options = visibleFilters(cards);
  const filter = options.includes(chosen) ? chosen : 'all';
  const shown = cards.filter((card) => inCategory(card, filter));
  const count = (option: CategoryFilter) => cards.filter((card) => inCategory(card, option)).length;
  const note = filter === 'all' ? null : copy.categoryNotes[filter];

  useEffect(() => {
    if (!all || !focusFourth.current) return;
    focusFourth.current = false;
    grid.current?.querySelectorAll<HTMLElement>('li.card h3')[PHONE_CARDS]?.focus();
  }, [all]);

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
        <ul className="card-grid fund-grid" ref={grid} data-all={all ? 'true' : undefined}>
          {shown.map((card, index) => (
            <CardFace key={card.id} card={card} snapshot={snapshot} changed={changed[card.id]} focusable={index === PHONE_CARDS} />
          ))}
        </ul>
      )}
      {all || shown.length <= PHONE_CARDS ? null : (
        <p className="show-all">
          <button
            type="button"
            className="button button-secondary button-block"
            onClick={() => {
              focusFourth.current = true;
              setAll(true);
            }}
          >
            {copy.showAllCards.replace('{n}', String(shown.length))}
          </button>
        </p>
      )}
    </>
  );
}

/** Funded cards waiting for the agents, as rows: the suit in the rail, the title beside it. */
export function QueuedList({ cards }: { cards: Card[] }) {
  return (
    <section className="section" aria-labelledby="queued">
      <h2 id="queued">{copy.queued}</h2>
      {cards.length === 0 ? (
        <p className="muted">{copy.queuedEmpty}</p>
      ) : (
        <>
          <p className="muted">{copy.queuedIntro}</p>
          <ul className="rows rail">
            {cards.map((card) => (
              <li key={card.id}>
                <SuitCell card={card} />
                <div className="row-body">
                  <span className="row-strong">{card.title}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function SuitCell({ card }: { card: Card }) {
  const suit = SUITS[categoryOf(card)];
  return (
    <span className="row-time with-glyph">
      <Glyph name={suit.glyph} />
      {suit.label}
    </span>
  );
}

/**
 * One shipped card as a rail row: the day it shipped in the rail, then the Live tag and its title,
 * then what it cost and who funded it (Funding.tsx, kernel).
 */
export function ShippedRow({ card, snapshot, example = false }: { card: Card; snapshot: Snapshot; example?: boolean }) {
  const live = STATE_TAGS.live;
  return (
    <li>
      <span className="row-time">{formatDate(shippedAt(card))}</span>
      <div className="row-body">
        <h3 className="row-title" id={`${example ? 'example' : 'shipped'}-title-${card.id}`}>
          <span className="tag" data-state="live">
            <Glyph name={live.glyph} />
            {live.word}
          </span>{' '}
          {card.title}
        </h3>
        <p className="card-meta">{shippedMeta(card, snapshot, sourceLabel(card.source))}</p>
      </div>
    </li>
  );
}

/** Live cards, newest first, as rail rows, and a link to the roadmap. */
export function ShippedList({ cards, snapshot }: { cards: Card[]; snapshot: Snapshot }) {
  if (cards.length === 0) return null;
  return (
    <section className="section" aria-labelledby="shipped">
      <h2 id="shipped">{copy.shipped}</h2>
      <ul className="rows rail">
        {cards.map((card) => (
          <ShippedRow key={card.id} card={card} snapshot={snapshot} />
        ))}
      </ul>
      <p className="more">
        <Link to="/roadmap">{copy.roadmapLink}</Link>
      </p>
    </section>
  );
}

/** A planned card as a rail row: its suit in the rail, then its title, and on /roadmap its summary and state. */
export function PlannedRow({ card, detail = false }: { card: Card; detail?: boolean }) {
  return (
    <li>
      <SuitCell card={card} />
      <div className="row-body">
        <h3 className="row-title">{card.title}</h3>
        {!detail || blank(card.summary) ? null : <p>{card.summary}</p>}
        {detail ? <p className="card-meta">{copy.roadmap.planned}</p> : null}
      </div>
    </li>
  );
}

/** The next planned cards as rows, and a link to the roadmap. */
export function PlannedNext({ cards }: { cards: Card[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="section" aria-labelledby="planned-next">
      <h2 id="planned-next">{copy.plannedNext}</h2>
      <ul className="rows rail">
        {cards.map((card) => (
          <PlannedRow key={card.id} card={card} />
        ))}
      </ul>
      <p className="more">
        <Link to="/roadmap">{copy.roadmapLink}</Link>
      </p>
    </section>
  );
}
