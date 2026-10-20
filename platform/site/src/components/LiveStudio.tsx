import { useEffect, useRef, useState } from 'react';
import { feedFromSnapshot, useCommunity, useFeed } from '../lib/community';
import type { FeedEvent, StudioDoc } from '../lib/community-types';
import { copy } from '../lib/copy';
import type { Snapshot } from '../lib/source';
import { twitchChannel, twitchUrl } from '../lib/twitch';
import { Glyph } from './Glyph';
import { Pipe } from './Pipe';
import { EmptyRoom, StudioRoom, type Pulse } from './StudioRoom';

// Home's opening section (docs/specs/final-state.md, The live studio): the room and the pipe beside
// it. The room's era comes from /api/community/studio, the garage when that does not answer. The
// pulses come from real changes only: a card's funding rising in a new snapshot drops a coin, a card
// that ships sends a box off the dock, and a suggestion in the feed arrives as a paper plane. The
// first snapshot and the first feed read play nothing.

export function snapshotPulses(before: Snapshot, after: Snapshot): Pulse[] {
  const was = new Map(before.cards.map((card) => [card.id, card]));
  const out: Pulse[] = [];
  for (const card of after.cards) {
    const old = was.get(card.id);
    if (old === undefined) continue;
    if (card.funded_usd > old.funded_usd) out.push({ id: `coin-${card.id}-${card.funded_usd}`, kind: 'coin', cardId: card.id });
    if (card.stage === 'live' && old.stage !== 'live') out.push({ id: `box-${card.id}`, kind: 'box', cardId: card.id });
  }
  return out;
}

export function feedPulses(seen: ReadonlySet<string>, events: readonly FeedEvent[]): Pulse[] {
  return events.filter((event) => event.kind === 'suggestion' && !seen.has(event.id)).map((event) => ({ id: `plane-${event.id}`, kind: 'plane' as const }));
}

export function useStudioDoc() {
  const doc = useCommunity<StudioDoc>('/studio', 0);
  return doc.state === 'ready' ? doc.data : null;
}

/**
 * The stream, when the build names a channel (VITE_TWITCH_CHANNEL): a small Live badge that is a link
 * to twitch.tv, never an embed (the policy allows no third-party frame). No channel, nothing.
 */
export function TwitchLink({ channel }: { channel: string | null }) {
  if (channel === null) return null;
  return (
    <p className="twitch">
      <a className="tag tag-stamp" data-state="live" href={twitchUrl(channel)} aria-label={copy.studioRoom.twitchLabel.replace('{channel}', channel.toLowerCase())}>
        <Glyph name="play" />
        {copy.studioRoom.twitch}
      </a>
    </p>
  );
}

export function LiveStudio({
  snapshot,
  pipeSize = 1,
  pipe = true,
  unavailable = null,
}: {
  /** Null while home's snapshot loads: the room is drawn empty in its own box and the pipe tells the feed. */
  snapshot: Snapshot | null;
  /** How many of the pipe's newest rows to show. */
  pipeSize?: number;
  /** Draw the pipe here; home's floor draws it beside the pitch instead (FloorPipe). */
  pipe?: boolean;
  /**
   * While snapshot is null: the line that says it will not come (it failed, or there is no database),
   * or null while it is still loading. The pipe then stops saying it is loading and says so too.
   */
  unavailable?: string | null;
}) {
  const studio = useStudioDoc();
  const feed = useFeed();
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const previous = useRef<Snapshot | null>(null);
  const seenFeed = useRef<Set<string> | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = snapshot;
    if (before === null || snapshot === null || before === snapshot) return;
    const fresh = snapshotPulses(before, snapshot);
    if (fresh.length > 0) setPulses((was) => [...was.slice(-12), ...fresh]);
  }, [snapshot]);

  useEffect(() => {
    if (feed.state !== 'ready') return;
    if (seenFeed.current === null) {
      seenFeed.current = new Set(feed.events.map((event) => event.id));
      return;
    }
    const fresh = feedPulses(seenFeed.current, feed.events);
    for (const event of feed.events) seenFeed.current.add(event.id);
    if (fresh.length > 0) setPulses((was) => [...was.slice(-12), ...fresh]);
  }, [feed.state, feed.events]);

  // A feed that answers with nothing yet tells the snapshot's events too, so the pipe is empty only
  // when the studio has no card at all.
  const live = feed.state === 'ready' && feed.events.length > 0;
  const events = live ? feed.events : snapshot === null ? [] : feedFromSnapshot(snapshot);
  return (
    <section className="section live-studio" aria-labelledby="studio" id="studio-live">
      <div className="live-studio-head">
        <h2 id="studio">{copy.studioRoom.title}</h2>
        <p>{copy.studioRoom.intro}</p>
        <TwitchLink channel={twitchChannel()} />
      </div>
      {/* The room is wide and the pipe a column: the pipe shows as many rows as sit beside the room. */}
      <div className="live-studio-grid">
        {snapshot === null ? <EmptyRoom studio={studio} /> : <StudioRoom snapshot={snapshot} studio={studio} pulses={pulses} />}
        {pipe ? (
        <Pipe
          events={events}
          live={live}
          loading={feed.state === 'loading' || (snapshot === null && !live && unavailable === null)}
          unavailable={snapshot === null && !live ? unavailable : null}
          hasOlder={feed.hasOlder}
          loadingOlder={feed.loadingOlder}
          onOlder={feed.loadOlder}
          // On home the pipe sits under the panel, its foot on the room's foot: the newest rows only
          // (pipeSize), and the ledger keeps the rest.
          pageSize={pipeSize}
          paging={false}
        />
        ) : null}
      </div>
    </section>
  );
}
