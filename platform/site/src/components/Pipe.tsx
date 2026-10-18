import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FeedEvent, FeedKind } from '../lib/community-types';
import { copy } from '../lib/copy';
import { relativeTime } from '../lib/community';
import { motionAllowed } from '../lib/motion';
import { PersonLink } from './Person';
import { Glyph, RarityTag, type GlyphName } from './Glyph';

// The pipe (docs/specs/final-state.md, The live studio): the feed beside the studio, the ledger told
// as a story. Each event is a row: a glyph and a word for its kind (never colour alone), who did it
// (a public supporter's name and avatar, or Anonymous), the card's rarity when it has one, how long
// ago, and a link. New rows slide in from above; the list is a polite live region. The ledger stays
// the record.

export const FEED_KINDS: Record<FeedKind, { glyph: GlyphName; word: string }> = {
  contribution: { glyph: 'coin-outline', word: copy.pipe.kinds.contribution },
  card_opened: { glyph: 'flag', word: copy.pipe.kinds.card_opened },
  stage: { glyph: 'gear', word: copy.pipe.kinds.stage },
  shipped: { glyph: 'box', word: copy.pipe.kinds.shipped },
  suggestion: { glyph: 'plane', word: copy.pipe.kinds.suggestion },
  badge: { glyph: 'badge', word: copy.pipe.kinds.badge },
  milestone: { glyph: 'milestone', word: copy.pipe.kinds.milestone },
  seed_featured: { glyph: 'seed', word: copy.pipe.kinds.seed_featured },
  era: { glyph: 'blocks', word: copy.pipe.kinds.era },
};

function linkOf(event: FeedEvent): string | null {
  if (event.cardId !== undefined) return `/card/${event.cardId}`;
  if (event.kind === 'milestone') return '/goals';
  if (event.kind === 'era') return '/studio/history';
  if (event.kind === 'suggestion') return '/suggest';
  if (event.kind === 'seed_featured') return '/seeds';
  if (event.actor) return `/u/${event.actor.handle}`;
  return null;
}

function Who({ event, linked }: { event: FeedEvent; linked: boolean }) {
  if (event.kind !== 'contribution' && event.kind !== 'badge' && !event.actor) return null;
  return (
    <span className="pipe-who">
      <PersonLink person={event.actor ?? null} linked={linked} />
    </span>
  );
}

export function PipeRow({ event, now, linked = true }: { event: FeedEvent; now: number; linked?: boolean }) {
  const kind = FEED_KINDS[event.kind] ?? FEED_KINDS.stage;
  const link = linked ? linkOf(event) : null;
  return (
    <li className="pipe-row" data-kind={event.kind} data-event={event.id}>
      <span className="pipe-kind">
        <Glyph name={kind.glyph} />
        {kind.word}
      </span>
      <p className="pipe-text">{link === null ? event.text : <Link to={link}>{event.text}</Link>}</p>
      <p className="pipe-meta">
        <Who event={event} linked={linked} />
        {event.rarity === undefined || event.rarity === 'common' ? null : <RarityTag rarity={event.rarity} />}
        <time dateTime={event.at}>{relativeTime(event.at, now)}</time>
      </p>
    </li>
  );
}

export type PipeProps = {
  events: readonly FeedEvent[];
  /** The feed answered; false when the pipe tells the snapshot's events instead. */
  live: boolean;
  loading: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  onOlder: () => void;
  /** Rows shown at first, and added by each press of Older. */
  pageSize?: number;
  headingLevel?: 2 | 3;
  /** The broadcast overlay draws no Older button. */
  paging?: boolean;
  /** False on an overlay that is watched, not clicked (/broadcast): rows carry no links. */
  linked?: boolean;
};

export function Pipe({ events, live, loading, hasOlder, loadingOlder, onOlder, pageSize = 8, headingLevel = 3, paging = true, linked = true }: PipeProps) {
  const list = useRef<HTMLOListElement>(null);
  const known = useRef<Set<string> | null>(null);
  const [count, setCount] = useState(pageSize);
  const shown = events.slice(0, count);
  const more = events.length > count || (live && hasOlder);
  const older = () => {
    if (events.length <= count) onOlder();
    setCount((n) => n + pageSize);
  };
  const now = Date.now();
  // A row that arrives after the first paint slides in; the first paint is drawn as it is.
  useEffect(() => {
    const ids = new Set(shown.map((event) => event.id));
    const before = known.current;
    known.current = ids;
    if (before === null || !motionAllowed() || list.current === null) return;
    const fresh = shown.filter((event) => !before.has(event.id));
    fresh.slice(0, 3).forEach((event, i) => {
      const row = list.current?.querySelector<HTMLElement>(`[data-event="${CSS.escape(event.id)}"]`);
      row?.animate?.(
        [
          { transform: 'translateY(-10px)', opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 360, delay: i * 60, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'backwards' },
      );
    });
  });
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className="pipe" aria-labelledby="pipe-title">
      <Heading id="pipe-title" className="pipe-title">
        {copy.pipe.title}
      </Heading>
      <p className="pipe-intro">{live ? copy.pipe.intro : copy.pipe.fallback}</p>
      {loading && shown.length === 0 ? (
        <p className="muted" aria-busy="true">
          {copy.pipe.loading}
        </p>
      ) : shown.length === 0 ? (
        <p className="pipe-empty">
          <Glyph name="coin-outline" />
          {copy.pipe.empty}
        </p>
      ) : (
        <ol className="pipe-rows" ref={list} aria-live="polite" aria-relevant="additions">
          {shown.map((event) => (
            <PipeRow key={event.id} event={event} now={now} linked={linked} />
          ))}
        </ol>
      )}
      {paging && more ? (
        <p className="pipe-older">
          <button type="button" className="button button-secondary" onClick={older} disabled={loadingOlder}>
            {loadingOlder ? copy.pipe.loadingOlder : copy.pipe.older}
          </button>
        </p>
      ) : null}
    </section>
  );
}
