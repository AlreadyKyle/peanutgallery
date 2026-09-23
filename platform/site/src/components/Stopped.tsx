import { copy } from '../lib/copy';
import { formatDate, formatInteger, formatUsd } from '../lib/format';
import { legal } from '../lib/legal';
import type { Snapshot, StoppedCard } from '../lib/source';

// Kernel (docs/specs/money-surfaces.md): /ledger's Stopped band, the one public list of rejected and
// paused cards (R14, L02), from public_stopped_cards. Rows, never card faces (DESIGN.md, Rows): the
// date it stopped in the rail, then its title, why in plain words and its money. A paused card keeps
// its money; a card that didn't ship says who funded it and where its unspent money went. Each list
// is drawn only with rows, and the component draws nothing with none.

/** Why a card stopped, in plain words: its code's entry, else its stage's fallback. The raw code never shows. */
export function stopReason(card: Pick<StoppedCard, 'stage' | 'failing_check'>): string {
  const words = card.failing_check === null ? undefined : legal.failingCheckWords[card.failing_check];
  return words ?? (card.stage === 'paused' ? legal.pausedFallback : legal.rejectedFallback);
}

/** "funded by $1.20 from 2 supporters", the count left out when the funding figures did not load; null when nothing reached it. */
export function fundedBy(card: StoppedCard, snapshot: Snapshot): string | null {
  if (card.credited_usd <= 0) return null;
  const usd = formatUsd(card.credited_usd);
  if (snapshot.missing.includes('funding')) return legal.fundedByAmount.replace('{usd}', usd);
  const count = snapshot.funding[card.card_id]?.contributors ?? 0;
  if (count === 0) return legal.fundedByAmount.replace('{usd}', usd);
  return (count === 1 ? legal.fundedByOne : legal.fundedByMany.replace('{n}', formatInteger(count))).replace('{usd}', usd);
}

/** "Its unspent money went to A cheaper Cart ($0.40) and Not on a card yet ($0.10).", or null when none moved. */
export function movedLine(card: StoppedCard): string | null {
  if (card.moved.length === 0) return null;
  const places = card.moved.map((move) =>
    legal.movedPlace
      .replace('{place}', move.to_card_id === null ? legal.notOnCard : (move.to_title ?? legal.anotherCard))
      .replace('{usd}', formatUsd(move.usd)),
  );
  const list = places.length === 1 ? places[0]! : `${places.slice(0, -1).join(', ')} and ${places.at(-1)!}`;
  return legal.movedTo.replace('{places}', list);
}

/** The paused state as a tag: the pause glyph (drawn here, as Glyph.tsx draws it) and its word. */
function PausedTag() {
  return (
    <span className="tag" data-state="paused">
      <svg className="glyph" viewBox="0 0 16 16" width={16} height={16} aria-hidden="true" focusable="false" data-glyph="pause">
        <path className="glyph-fill" d="M3.75 2.5h3v11h-3zM9.25 2.5h3v11h-3z" />
      </svg>
      {copy.statusPaused}
    </span>
  );
}

function StoppedRow({ card, snapshot }: { card: StoppedCard; snapshot: Snapshot }) {
  const spent = `${formatUsd(card.spent_usd)} ${legal.spent}`;
  const paused = card.stage === 'paused';
  const funded = paused ? null : fundedBy(card, snapshot);
  const moved = paused ? null : movedLine(card);
  return (
    <li data-card={card.card_id}>
      <span className="row-time">{formatDate(card.stopped_at)}</span>
      <div className="row-body">
        <h4 className="row-title">{card.title}</h4>
        <p>{stopReason(card)}</p>
        <p className="row-meta">
          {paused ? <PausedTag /> : null}
          <span className="card-meta">{[spent, funded].filter((part): part is string => part !== null).join(' · ')}</span>
        </p>
        {paused ? <p className="muted">{legal.pausedMoneyStays}</p> : null}
        {moved === null ? null : <p className="muted">{moved}</p>}
      </div>
    </li>
  );
}

function StoppedList({ id, heading, cards, snapshot }: { id: string; heading: string; cards: StoppedCard[]; snapshot: Snapshot }) {
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="rows-heading">
        {heading}
      </h3>
      <ul className="rows rail">
        {cards.map((card) => (
          <StoppedRow key={card.card_id} card={card} snapshot={snapshot} />
        ))}
      </ul>
    </section>
  );
}

export function Stopped({ snapshot }: { snapshot: Snapshot }) {
  const cards = snapshot.stopped ?? [];
  if (cards.length === 0) return null;
  return (
    <>
      <StoppedList id="stopped-paused" heading={legal.pausedHeading} cards={cards.filter((card) => card.stage === 'paused')} snapshot={snapshot} />
      <StoppedList id="stopped-rejected" heading={legal.didntShipHeading} cards={cards.filter((card) => card.stage === 'rejected')} snapshot={snapshot} />
    </>
  );
}
