import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMyProfile, useSignedIn } from '../lib/account';
import { flowLanes, FLOW_LANE_CARDS, shippedAt, type CardGroups } from '../lib/cards';
import { useCommunity } from '../lib/community';
import type { PageDoc, Profile, SuggestionSummary } from '../lib/community-types';
import { copy } from '../lib/copy';
import { formatDate } from '../lib/format';
import { teamStrip } from '../lib/roster';
import type { Card, Snapshot } from '../lib/source';
import { useSignInOpen } from '../lib/sign-in';
import { Suggestion } from '../pages/Suggest';
import { CardFace } from './Card';
import { buildingEmptyLine, draftingLine } from './Flow';
import { Glyph, type GlyphName } from './Glyph';
import { MoreLink } from './MoreLink';
import { PersonAvatar } from './Person';
import { XpBar } from './ProfileView';
import { useStudioDoc } from './LiveStudio';
import { StudioRoom, type StationPiece, type StationTag } from './StudioRoom';

// Home's floor (docs/specs/place.md): the studio is the place, and its stations are the page's map.
// Each station stands on a piece of the room (the whiteboard, the hopper, the desks, the dock, the
// lounge's sofa) and is a link to its part of the page; the part in view lights its station, in the
// room on the plate and in the rail's small map beside the stations. The order keeps the board's
// (decisions 67 and 70): the cards to fund first, one scroll from the top, then the first game, then
// the players' ideas, then how the cards move (Next up, Building, Shipped). Next up has no piece of its
// own in the room, so it has no tag; the rail lists it.

export type StationId = 'ideas' | 'fund' | 'next' | 'building' | 'shipped' | 'team';

export const FLOOR_STATIONS: readonly { id: StationId; piece: StationPiece | null; glyph: GlyphName }[] = [
  { id: 'fund', piece: 'hopper', glyph: 'coin-outline' },
  { id: 'ideas', piece: 'whiteboard', glyph: 'plane' },
  { id: 'next', piece: null, glyph: 'pencil' },
  { id: 'building', piece: 'desks', glyph: 'gear' },
  { id: 'shipped', piece: 'dock', glyph: 'box' },
  { id: 'team', piece: 'sofa', glyph: 'team' },
];

/** The stations this snapshot draws: the team's only while it has roles, as home's team band does. */
export function floorStations(snapshot: Snapshot) {
  const team = teamStrip(snapshot).length > 0;
  return FLOOR_STATIONS.filter((station) => station.id !== 'team' || team);
}

/** The stations that stand at a piece of the room, for the rail map's lit outline. */
export function stationTags(snapshot: Snapshot): StationTag[] {
  return floorStations(snapshot).flatMap(({ id, piece }) => (piece === null ? [] : [{ id, piece }]));
}

/**
 * Which station's part of the page the reader is at: the last one whose top has passed a line a little
 * above the window's middle. It holds through what sits between two stations (the first game, after
 * Fund), so the rail always shows where the reader is once they reach the first station, and none
 * before it (the plate at the top). Reading the page lights a station; nothing moves (DESIGN.md, Motion).
 */
export function litStation(parts: readonly { id: string; top: number }[], line: number): string | null {
  let lit: string | null = null;
  for (const part of parts) if (part.top <= line) lit = part.id;
  return lit;
}

export function useLitStation(ids: readonly string[], ready: boolean): string | null {
  const [lit, setLit] = useState<string | null>(null);
  const key = ids.join(' ');
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const parts: { id: string; top: number }[] = [];
      for (const id of ids) {
        const box = document.querySelector(`[data-station-part="${id}"]`)?.getBoundingClientRect();
        // A part that is not laid out (not drawn yet, or no layout at all) lights nothing.
        if (box !== undefined && box.height > 0) parts.push({ id, top: box.top });
      }
      setLit(litStation(parts, window.innerHeight * 0.4));
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
    // The ids are read through their joined key; the parts mount once the snapshot is drawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
  return lit;
}

/** How many things wait at each station, for the rail. */
export function stationCounts(snapshot: Snapshot, groups: CardGroups, ideas: number | null): Record<StationId, number | null> {
  const lanes = flowLanes(groups);
  return {
    ideas,
    fund: groups.fund.length,
    next: lanes.next.length,
    building: lanes.building.length,
    shipped: lanes.shipped.length,
    team: teamStrip(snapshot, Number.POSITIVE_INFINITY).length,
  };
}

/**
 * The rail beside the stations from 64rem: the room again as a small map, its lit station outlined,
 * and the stations as a list of links with what waits at each. It stays in view while the stations
 * scroll past, so the page reads as walking round the studio. Under 64rem the map is not drawn and the
 * list is a strip of station links above the stations.
 */
export function FloorRail({ snapshot, lit, counts }: { snapshot: Snapshot; lit: string | null; counts: Record<StationId, number | null> }) {
  const studio = useStudioDoc();
  return (
    <nav className="floor-rail" aria-label={copy.floor.railLabel} data-balance="ignore">
      <div className="floor-map">
        <StudioRoom snapshot={snapshot} studio={studio} facts={false} interactive={false} stations={stationTags(snapshot)} lit={lit} />
      </div>
      <ol className="floor-stations">
        {floorStations(snapshot).map(({ id, glyph }) => {
          const words = copy.floor.stations[id];
          const n = counts[id];
          return (
            <li key={id} data-lit={lit === id ? 'true' : undefined}>
              <a href={`#${id}`} aria-current={lit === id ? 'location' : undefined}>
                <Glyph name={glyph} />
                <span className="floor-station-name">{words.name}</span>
                {n === null ? null : <span className="floor-station-count">{n}</span>}
              </a>
            </li>
          );
        })}
      </ol>
      <p className="small floor-ledger">
        <Link to="/ledger">{copy.floor.ledger}</Link>
      </p>
    </nav>
  );
}

/**
 * A station's part of the floor: its head (glyph and where in the room), its heading and what it is,
 * then its body. No number is drawn (the board, 18 October 2026: no 01, 02 over sections); `index`
 * is the station's place on the walk, kept for the callers' order.
 */
export function StationPart({ id, title, intro, children }: { id: StationId; index: number; title: string; intro?: ReactNode; children: ReactNode }) {
  const glyph = FLOOR_STATIONS.find((station) => station.id === id)?.glyph ?? 'gear';
  return (
    <section className="section station-part" data-station-part={id} aria-labelledby={id}>
      <p className="station-index" aria-hidden="true">
        <Glyph name={glyph} />
        <span>{copy.floor.stations[id].where}</span>
      </p>
      <h2 id={id}>{title}</h2>
      {intro === undefined ? null : <p>{intro}</p>}
      {children}
    </section>
  );
}

/** A station's cards as compact faces in a grid, or a dashed tile saying what happens next. */
export function StationCards({ cards, snapshot, planned = false, empty }: { cards: readonly Card[]; snapshot: Snapshot; planned?: boolean; empty: ReactNode }) {
  if (cards.length === 0) return <div className="flow-empty">{empty}</div>;
  return (
    <ul className="card-grid station-cards">
      {cards.slice(0, FLOW_LANE_CARDS).map((card) => (
        <CardFace key={card.id} card={card} snapshot={snapshot} compact face={planned ? 'planned' : undefined} />
      ))}
    </ul>
  );
}

/** The ideas board's top ideas, read from the cached public list, declined ones left out. */
export const FLOOR_IDEAS = 3;

export function useTopIdeas() {
  const doc = useCommunity<PageDoc<SuggestionSummary>>('/suggestions?sort=top', 60_000);
  if (doc.state !== 'ready') return { state: doc.state, items: [] as SuggestionSummary[] };
  return { state: doc.state, items: doc.data.items.filter((item) => item.state !== 'declined').slice(0, FLOOR_IDEAS) };
}

/**
 * The Ideas station: the crowd's top ideas with their state and upvotes (a signed-in player can
 * upvote here), and the way to pitch one. The review agent that reads ideas has no tools; the agents
 * that build never see a player's words. The ideas' area is left out here: home names a game only in
 * its game tile (decision 68).
 */
export function IdeasStation({ index }: { index: number }) {
  const signedIn = useSignedIn();
  const signInOpen = useSignInOpen();
  // While sign-in is closed nobody can pitch, so the station reads the board and says why.
  const pitching = signedIn || signInOpen;
  const ideas = useTopIdeas();
  return (
    <StationPart id="ideas" index={index} title={copy.ideas.title} intro={copy.ideas.intro}>
      {ideas.state === 'loading' ? (
        <p className="muted" aria-busy="true">
          {copy.ideas.loading}
        </p>
      ) : ideas.state === 'unavailable' ? (
        <div className="flow-empty">
          <p>{copy.ideas.unavailable}</p>
        </div>
      ) : ideas.items.length === 0 ? (
        <div className="flow-empty">
          <p>{pitching ? copy.ideas.empty : copy.ideas.emptyClosed}</p>
        </div>
      ) : (
        <ol className="suggestions floor-ideas">
          {ideas.items.map((item) => (
            <Suggestion key={item.id} item={item} signedIn={signedIn} area={false} />
          ))}
        </ol>
      )}
      {pitching ? null : <p className="small station-note">{copy.ideas.closed}</p>}
      <p className="hero-actions station-actions">
        {pitching ? (
          <Link className="button" to="/suggest#suggest-send">
            <Glyph name="plane" />
            {copy.ideas.pitch}
          </Link>
        ) : null}
        <MoreLink to="/suggest">{copy.ideas.all}</MoreLink>
      </p>
      <p className="small muted station-note">
        <Glyph name="checklist" />
        <span>{copy.ideas.safety}</span>
      </p>
    </StationPart>
  );
}

/**
 * Next up (decisions 67 and 69): what the Game Designer is doing, from the supply's text-free status,
 * then the agents' approved cards waiting to open, never a backlog entry. Never blank: the line is
 * always there.
 */
export function NextStation({ snapshot, groups, index }: { snapshot: Snapshot; groups: CardGroups; index: number }) {
  const drafts = flowLanes(groups).next;
  const designer = draftingLine(snapshot);
  return (
    <StationPart id="next" index={index} title={copy.flow.lanes.next.title}>
      <p className="flow-who flow-agent" data-drafting={designer.drafting ? 'true' : undefined}>
        <Glyph name="pencil" />
        <span>{designer.text}</span>
      </p>
      {drafts.length === 0 ? null : <StationCards cards={drafts} snapshot={snapshot} planned empty={null} />}
    </StationPart>
  );
}

export function BuildingStation({ snapshot, groups, index }: { snapshot: Snapshot; groups: CardGroups; index: number }) {
  const lanes = flowLanes(groups);
  const last = lanes.shipped[0];
  return (
    <StationPart id="building" index={index} title={copy.flow.lanes.building.title} intro={copy.flow.lanes.building.who}>
      <StationCards
        cards={lanes.building}
        snapshot={snapshot}
        empty={
          <>
            <p>{buildingEmptyLine(snapshot)}</p>
            {last === undefined ? null : (
              <p className="card-meta">{copy.flow.lanes.building.lastBuilt.replace('{title}', last.title).replace('{date}', formatDate(shippedAt(last)))}</p>
            )}
          </>
        }
      />
    </StationPart>
  );
}

export function ShippedStation({ snapshot, groups, index }: { snapshot: Snapshot; groups: CardGroups; index: number }) {
  const lanes = flowLanes(groups);
  return (
    <StationPart id="shipped" index={index} title={copy.flow.lanes.shipped.title} intro={copy.flow.lanes.shipped.who}>
      <StationCards cards={lanes.shipped} snapshot={snapshot} empty={<p>{copy.flow.lanes.shipped.empty}</p>} />
      <p className="more">
        <MoreLink to="/reports">{copy.flow.lanes.shipped.more}</MoreLink>
      </p>
    </StationPart>
  );
}

/** Where a card the player backed is now, in words, from the snapshot's copy of it. */
export function stageWords(card: Card | undefined): string {
  const words = copy.desk.stage;
  if (card === undefined) return words.other;
  if (card.stage === 'live') return words.live;
  if (card.stage === 'building') return words.building;
  if (card.stage === 'gated') return words.gated;
  if (card.stage === 'funded') return words.funded;
  if (card.stage === 'proposed' || card.stage === 'designing' || card.stage === 'voted') return words.open;
  return words.other;
}

/** The player's backed cards, newest first, each with where it is now. */
export function YourCards({ profile, snapshot, limit }: { profile: Profile; snapshot: Snapshot | null; limit: number }) {
  const byId = new Map((snapshot?.cards ?? []).map((card) => [card.id, card]));
  const shown = profile.collection.slice(0, limit);
  if (shown.length === 0) return <p className="muted">{copy.here.noCards}</p>;
  return (
    <ul className="here-cards">
      {shown.map((card) => (
        <li key={card.cardId}>
          <Link to={`/card/${card.cardId}`}>{card.title}</Link>
          <span className="small muted">{stageWords(byId.get(card.cardId))}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The plate's panel for a signed-in player: welcome back by name, the level and XP to the next, the
 * cards they backed and where each is now, and the ways to their desk and to pitch an idea. A
 * visitor who is not signed in gets the pitch instead (Landing's Hero). While the profile loads, or
 * when it cannot be read, the pitch shows, so the plate never waits on the player's document.
 */
export function useSignedInPanel(): Profile | null {
  const me = useMyProfile();
  return me.state === 'ready' ? me.profile : null;
}

export function WelcomePanel({ profile, snapshot, status }: { profile: Profile; snapshot: Snapshot | null; status?: ReactNode }) {
  const more = profile.collection.length - 3;
  return (
    <div className="hero hero-home here-panel">
      <p className="here-who">
        <PersonAvatar person={profile} size={40} />
      </p>
      <h1>{copy.here.welcome.replace('{name}', profile.displayName)}</h1>
      <XpBar profile={profile} />
      <h2 className="here-label">{copy.here.yourCards}</h2>
      <YourCards profile={profile} snapshot={snapshot} limit={3} />
      {more > 0 ? <p className="small muted">{copy.here.more.replace('{n}', String(more))}</p> : null}
      <p className="hero-actions">
        <a className="button" href="#fund">
          {copy.here.fund}
        </a>
        <Link className="button button-secondary" to="/me">
          {copy.here.desk}
        </Link>
        <Link className="target" to="/suggest#suggest-send">
          {copy.here.pitch}
        </Link>
      </p>
      {status === undefined ? null : <div className="hero-status">{status}</div>}
    </div>
  );
}
