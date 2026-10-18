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
import { draftingLine } from './Flow';
import { Glyph, type GlyphName } from './Glyph';
import { MoreLink } from './MoreLink';
import { PersonAvatar } from './Person';
import { XpBar } from './ProfileView';
import { useStudioDoc } from './LiveStudio';
import { StudioRoom, type StationPiece, type StationTag } from './StudioRoom';

// Home's floor (docs/specs/place.md): the studio is the place, and its stations are the page's map.
// Each station stands on a piece of the room (the whiteboard, the hopper, the desks, the dock, the
// lounge's sofa) and is a link to its part of the page; the part in view lights its station, in the
// room on the plate and in the rail's small map beside the stations. Fund comes first, one scroll from
// the top, because funding is what moves a card; Ideas follows as the other way in (the crowd's pitches
// beside the studio's own plans), then building and shipping.

export type StationId = 'ideas' | 'fund' | 'building' | 'shipped' | 'team';

export const FLOOR_STATIONS: readonly { id: StationId; piece: StationPiece; glyph: GlyphName }[] = [
  { id: 'fund', piece: 'hopper', glyph: 'coin-outline' },
  { id: 'ideas', piece: 'whiteboard', glyph: 'plane' },
  { id: 'building', piece: 'desks', glyph: 'gear' },
  { id: 'shipped', piece: 'dock', glyph: 'box' },
  { id: 'team', piece: 'sofa', glyph: 'team' },
];

/** The station tags for the room: each a link to its heading on this page. */
export function stationTags(): StationTag[] {
  return FLOOR_STATIONS.map(({ id, piece }) => {
    const words = copy.floor.stations[id];
    return { id, piece, name: words.name, label: copy.floor.goTo.replace('{name}', words.name).replace('{where}', words.where), href: `#${id}` };
  });
}

/**
 * Which station's part of the page is in view: the one whose section crosses the band a little above
 * the window's middle. Null while none is (the plate at the top). Reading the page lights a station;
 * nothing moves (DESIGN.md, Motion).
 */
export function useLitStation(ids: readonly string[], ready: boolean): string | null {
  const [lit, setLit] = useState<string | null>(null);
  const key = ids.join(' ');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.getAttribute('data-station') ?? '', entry.isIntersecting);
        const first = ids.find((id) => seen.get(id) === true) ?? null;
        setLit(first);
      },
      { rootMargin: '-35% 0px -60% 0px' },
    );
    for (const id of ids) {
      const el = document.querySelector(`[data-station-part="${id}"]`);
      if (el !== null) {
        el.setAttribute('data-station', id);
        observer.observe(el);
      }
    }
    return () => observer.disconnect();
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
        <StudioRoom snapshot={snapshot} studio={studio} facts={false} interactive={false} stations={stationTags()} lit={lit} />
      </div>
      <ol className="floor-stations">
        {FLOOR_STATIONS.map(({ id, glyph }, index) => {
          const words = copy.floor.stations[id];
          const n = counts[id];
          return (
            <li key={id} data-lit={lit === id ? 'true' : undefined}>
              <a href={`#${id}`} aria-current={lit === id ? 'location' : undefined}>
                <span className="floor-station-number" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
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

/** A station's part of the floor: its numbered head, its heading and what it is, then its body. */
export function StationPart({ id, index, title, intro, children }: { id: StationId; index: number; title: string; intro?: ReactNode; children: ReactNode }) {
  const glyph = FLOOR_STATIONS.find((station) => station.id === id)?.glyph ?? 'gear';
  return (
    <section className="section station-part" data-station-part={id} aria-labelledby={id}>
      <p className="station-index" aria-hidden="true">
        <span className="flow-step-number">{String(index).padStart(2, '0')}</span>
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
 * upvote here), the drafted cards the Game Designer made waiting to open, and the way to pitch one.
 * The review agent that reads ideas has no tools; the agents that build never see a player's words.
 */
export function IdeasStation({ snapshot, groups, index }: { snapshot: Snapshot; groups: CardGroups; index: number }) {
  const signedIn = useSignedIn();
  const signInOpen = useSignInOpen();
  // While sign-in is closed nobody can pitch, so the station reads the board and says why.
  const pitching = signedIn || signInOpen;
  const ideas = useTopIdeas();
  const drafts = flowLanes(groups).next;
  const designer = draftingLine(snapshot);
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
            <Suggestion key={item.id} item={item} signedIn={signedIn} />
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
      {/* The Game Designer turns the top ideas into cards: what it is doing now, then its drafts. */}
      <h3 className="rows-heading">{copy.ideas.drafts}</h3>
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
            <p>{copy.flow.lanes.building.empty}</p>
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

export function WelcomePanel({ profile, snapshot, status }: { profile: Profile; snapshot: Snapshot | null; status: ReactNode }) {
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
      <div className="hero-status">{status}</div>
    </div>
  );
}
