import { Link } from 'react-router-dom';
import { categoryOf, shippedAt, sourceLabel, type CategoryFilter } from '../lib/cards';
import { copy } from '../lib/copy';
import { formatDate } from '../lib/format';
import { legal } from '../lib/legal';
import type { Card, Snapshot } from '../lib/source';
import { shippedMeta } from './Funding';
import { Glyph, StateTag, SUITS, SuitTag } from './Glyph';

// The card groups, in the platform code lane. Each card is drawn by Card.tsx; its money (the bar,
// the spec rows, what a card spent and the Fund this card link) comes from Funding.tsx, kernel.
// Shipped and planned cards are rows on /roadmap and the guide; home draws its cards as compact faces
// in its flow (Flow.tsx), in a page's second band (DESIGN.md, Bands).
export { FundingBar, fundingCaption } from './Funding';
export { Guarded } from './Guarded';
export { CardFace } from './Card';

function blank(text: string | null): boolean {
  return text === null || text.trim() === '';
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
    <button type="button" className="filter" aria-pressed={pressed} onClick={onPress} data-suit={option === 'all' ? undefined : option}>
      {pressed ? <Glyph name="check" /> : null}
      {option === 'all' ? null : (
        <span className="suit-tile">
          <Glyph name={SUITS[option].glyph} />
        </span>
      )}
      {copy.categories[option]} <span className="filter-count">{count}</span>
    </button>
  );
}

/**
 * One shipped card as a rail row: the day it shipped in the rail, then its title, then its suit, the
 * Live tag and what it cost and who funded it (Funding.tsx, kernel).
 */
export function ShippedRow({ card, snapshot, example = false }: { card: Card; snapshot: Snapshot; example?: boolean }) {
  return (
    <li>
      <span className="row-time">{formatDate(shippedAt(card))}</span>
      <div className="row-body">
        <h3 className="row-title" id={`${example ? 'example' : 'shipped'}-title-${card.id}`}>
          {card.title}
        </h3>
        <p className="row-meta">
          <SuitTag suit={categoryOf(card)} />
          <StateTag face="live" />
          <span className="card-meta">{shippedMeta(card, snapshot, sourceLabel(card.source))}</span>
          {/* The Watch link ends the meta line, so a shipped row is two lines, like a planned one. */}
          {example ? null : (
            <span className="row-link">
              <Link to={`/card/${card.id}`} aria-describedby={`shipped-title-${card.id}`}>
                {copy.cardPage.watchWasBuilt}
              </Link>
            </span>
          )}
        </p>
      </div>
    </li>
  );
}

/**
 * A planned card's state on /roadmap (docs/specs/supporter-pages.md): held by the board with its
 * reason when vetoed; approved and opening soon when an approved agent card waits to be dealt (its
 * opens_at is set and it is not on now); else planned and not built yet.
 */
export function plannedState(card: Card): { label: string; reason: string | null } {
  if (card.board_vetoed === true) return { label: legal.heldByBoard, reason: blank(card.board_veto_reason ?? null) ? null : card.board_veto_reason! };
  if (card.opens_at && card.horizon !== 'now') return { label: copy.roadmap.opensSoon, reason: null };
  return { label: copy.roadmap.planned, reason: null };
}

/**
 * A planned card as a rail row: its suit in the rail, then its title, and on /roadmap its summary and
 * state. /roadmap's rows sit under a group heading (h4) whose intro says planned once, so a row shows
 * its state only when it is approved and opening soon or held by the board (docs/specs/copy-pass.md).
 */
export function PlannedRow({ card, detail = false, byline = null, level = 3 }: { card: Card; detail?: boolean; byline?: string | null; level?: 3 | 4 }) {
  const state = plannedState(card);
  const Title = level === 4 ? 'h4' : 'h3';
  const label = detail && state.label !== copy.roadmap.planned ? state.label : null;
  return (
    <li data-card={card.id}>
      <span className="row-rail">
        <SuitTag suit={categoryOf(card)} />
      </span>
      <div className="row-body">
        <Title className="row-title">{card.title}</Title>
        {!detail || blank(card.summary) ? null : <p>{card.summary}</p>}
        {detail && byline ? <p className="card-meta card-byline">{byline}</p> : null}
        {label === null ? null : <p className="card-meta">{label}</p>}
        {detail && state.reason !== null ? <p className="muted">{state.reason}</p> : null}
      </div>
    </li>
  );
}
