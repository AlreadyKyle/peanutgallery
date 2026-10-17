import { useEffect, useRef, useState } from 'react';
import { feedFromSnapshot, useCommunity, useFeed } from '../lib/community';
import type { FeedEvent, StudioDoc } from '../lib/community-types';
import { copy } from '../lib/copy';
import type { Snapshot } from '../lib/source';
import { roomRoles } from '../lib/studio-scene';
import { twitchChannel, twitchUrl } from '../lib/twitch';
import { Glyph } from './Glyph';
import { Pipe } from './Pipe';
import { StudioRoom, type Pulse } from './StudioRoom';

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

export function LiveStudio({ snapshot }: { snapshot: Snapshot }) {
  const studio = useStudioDoc();
  const feed = useFeed();
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const previous = useRef<Snapshot | null>(null);
  const seenFeed = useRef<Set<string> | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = snapshot;
    if (before === null || before === snapshot) return;
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

  const live = feed.state === 'ready';
  const events = live ? feed.events : feedFromSnapshot(snapshot);
  return (
    <section className="section live-studio" aria-labelledby="studio" id="studio-live">
      <h2 id="studio">{copy.studioRoom.title}</h2>
      <p>{copy.studioRoom.intro}</p>
      <TwitchLink channel={twitchChannel()} />
      {/* The room is wide and the pipe a column: the pipe shows as many rows as sit beside the room. */}
      <div className="live-studio-grid">
        <StudioRoom snapshot={snapshot} studio={studio} pulses={pulses} />
        <Pipe
          events={events}
          live={live}
          loading={feed.state === 'loading'}
          hasOlder={feed.hasOlder}
          loadingOlder={feed.loadingOlder}
          onOlder={feed.loadOlder}
          // With no team in the room there are no written facts under it, so fewer rows sit beside it.
          // On home the studio's label heads the same column, so five rows end level with the facts.
          pageSize={roomRoles(snapshot).length === 0 ? 4 : 5}
        />
      </div>
    </section>
  );
}
