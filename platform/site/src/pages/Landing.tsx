import { useRef } from 'react';
import { CardsStatus } from '../components/CardsStatus';
import { EventList } from '../components/EventList';
import { ExplainerVideo } from '../components/ExplainerVideo';
import { FundNow } from '../components/Flow';
import { BuildingStation, FloorRail, FLOOR_STATIONS, IdeasStation, NextStation, ShippedStation, StationPart, stationCounts, useIdeasStation, useLitStation, useSignedInPanel, WelcomePanel } from '../components/Floor';
import { Glyph } from '../components/Glyph';
import { LiveStudio } from '../components/LiveStudio';
import { MachineCard } from '../components/MachineCard';
import { Announcer } from '../components/Announcer';
import { PoolLine } from '../components/PoolStat';
import { SinceLastVisit } from '../components/SinceLastVisit';
import { StaleNotice } from '../components/StaleNotice';
import { MoreLink } from '../components/MoreLink';
import { TeamStrip } from '../components/TeamStrip';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { useLastVisit } from '../lib/last-visit';
import { legal } from '../lib/legal';
import { useLiveHome, type HomeView } from '../lib/live';
import { agentsOffline } from '../lib/offline';
import { useStudioMorph } from '../lib/studio-morph';
import { teamStrip } from '../lib/roster';
import { unavailableLine, useStudio, type StudioState } from '../lib/studio';

// Home, in the board's order (DESIGN.md, Home; docs/specs/home-flow.md, docs/specs/place.md), on
// bands: the ink plate with the room and the pitch; the floor (paper), the only band with cards: the
// cards to fund, the first game, the players' ideas, then Next up, Building and Shipped; the team
// (ink); where the money goes. A band with nothing to show
// is not drawn, and the bands after it take their colour from their new place.

/** Home shows the five latest agent actions. */
export const HOME_ACTIONS = 5;

/** "6 cards are open for funding.", with the figure at 600. */
function Count({ n, words }: { n: number; words: { one: string; many: string; restOne: string; restMany: string } }) {
  return (
    <>
      <strong>{n === 1 ? words.one : words.many.replace('{n}', String(n))}</strong> {n === 1 ? words.restOne : words.restMany}
    </>
  );
}

/**
 * The status line: one true sentence from the snapshot home is drawn from. It says how many cards
 * are open and how many are building, or, while the agents are offline, that they are instead of
 * what they build (docs/specs/honest-status.md, PLAN.md §10 decision 77). It never says the studio
 * is paused (decision 62): the public site shows no paused notice.
 */
function StatusLine({ view }: { view: HomeView }) {
  const { fund, now } = view.groups;
  const offline = agentsOffline(view.snapshot);
  return (
    <p className="status-line">
      <span>
        {fund.length > 0 ? (
          <Count n={fund.length} words={copy.status.open} />
        ) : !offline && view.snapshot.supply?.drafting === true ? (
          copy.status.drafting
        ) : (
          copy.status.openNone
        )}
        {offline ? (
          ` ${copy.agentsOffline}`
        ) : now.length === 0 ? null : (
          <>
            {' '}
            <Count n={now.length} words={copy.status.building} />
          </>
        )}
      </span>
    </p>
  );
}

function Hero() {
  const env = siteEnv();
  return (
    <div className="hero hero-home">
      <h1>{copy.pitchTitle}</h1>
      <p className="lede">{copy.pitchBody}</p>
      {/* The pitch asks for funding, so its button goes to the cards to fund; Play free follows it, and
          How it works stays in the top bar (decision 72). */}
      <p className="hero-actions">
        <a className="button" href="#fund">
          <Glyph name="coin-outline" />
          {copy.fundACard}
        </a>
        {env.playUrl === '' ? null : (
          <a className="target" href={env.playUrl}>
            {copy.playFree}
          </a>
        )}
      </p>
    </div>
  );
}

/**
 * The studio's state in one line, its stale notice and the announcer for screen readers. It opens the
 * Fund station, over the cards it counts, not the plate (the board, 18 October 2026: the line is not
 * needed above the fold).
 */
function StudioStatus({ studio, live }: { studio: StudioState; live: ReturnType<typeof useLiveHome> }) {
  return (
    <>
      {/* While there is no snapshot the station's own line says it is loading or unavailable. */}
      {live.view === null ? null : <StatusLine view={live.view} />}
      <StaleNotice studio={studio} />
      <Announcer message={live.message} />
    </>
  );
}

/**
 * The first game and the explainer under one heading at the section size, side by side from 80rem: the
 * game's box art, its name, one line and Play (decision 68), and the video that shows how a card
 * becomes a change in it. Without a play address the video takes the row alone, with no heading.
 */
function ShowcaseSection() {
  const env = siteEnv();
  // The still, not the loop: at this size the loop's white scene read as a blank panel.
  if (env.playUrl === '') {
    return (
      <div className="showcase">
        <ExplainerVideo still />
      </div>
    );
  }
  // The heading stands over the game and the video; the game's own section takes its name from it.
  return (
    <div className="showcase">
      <h2 id="game">{copy.game.title}</h2>
      <section className="game-tile" aria-labelledby="game">
        <img className="game-shot" src="/games/dust-box-art.svg" width={375} height={500} alt={copy.game.alt} />
        <div className="game-text">
          <p className="game-name">{copy.game.name}</p>
          <p>{copy.game.line}</p>
          <p>
            <a className="button" href={env.playUrl}>
              <Glyph name="cartridge" />
              {copy.game.play}
            </a>
          </p>
        </div>
      </section>
      <ExplainerVideo still />
    </div>
  );
}

/**
 * The Fund station: the cards open for funding, first and biggest, or the loading or unavailable line
 * while there is no snapshot; then a link to what a contribution gets you.
 */
function FundSection({ studio, live, index }: { studio: StudioState; live: ReturnType<typeof useLiveHome>; index: number }) {
  const view = live.view;
  return (
    <StationPart id="fund" index={index} title={copy.flow.fundTitle} intro={copy.flow.fundIntro}>
      <div className="fund-status">
        <StudioStatus studio={studio} live={live} />
      </div>
      <CardsStatus
        count={view !== null ? view.groups.fund.length : null}
        unavailable={view === null && studio.state !== 'loading'}
      />
      {view !== null ? (
        <FundNow cards={view.groups.fund} snapshot={view.snapshot} changed={live.changed} machine={<MachineCard agreement={false} />} />
      ) : studio.state === 'loading' ? (
        <p className="muted" aria-busy="true">
          {copy.loadingCards}
        </p>
      ) : (
        <p className="muted">{unavailableLine(studio)}</p>
      )}
      {/* The Machine card (docs/specs/final-state.md, Card suits): always open, general support. With the
          cards drawn it sits beside the next card in line; without them it follows the loading line. */}
      {view !== null ? null : <MachineCard />}
      {/* What a contribution gets you is said on /contribute and /me (docs/specs/place.md); here, a link. */}
      <p className="more">
        <MoreLink to="/contribute#perks-title">{legal.perks.link}</MoreLink>
      </p>
    </StationPart>
  );
}

function TeamSection({ view }: { view: HomeView }) {
  const snapshot = view.snapshot;
  // The same rule as /team (lib/roster.ts teamStatus): roles on the team, running or paused.
  const roles = teamStrip(snapshot);
  if (roles.length === 0) return null;
  return (
    <div className="band">
      <section className="section" aria-labelledby="team" data-station-part="team">
        <h2 id="team">{copy.team.title}</h2>
        <TeamStrip roles={roles} asleep={false} />
        <p className="more">
          <MoreLink to="/team">{copy.team.meetAll}</MoreLink>
        </p>
      </section>
    </div>
  );
}

/** Where the money goes: the pool with the coin, that every figure is on the ledger, the latest agent actions and the ledger link. */
function MoneySection({ studio, view }: { studio: StudioState; view: HomeView | null }) {
  const snapshot = view?.snapshot ?? null;
  return (
    <section className="section" aria-labelledby="money">
      <h2 id="money">{legal.moneyHeading}</h2>
      {/* The pool on the left, the latest agent actions beside it from 64rem. */}
      <div className="money-grid">
        <div className="money-summary">
          {snapshot === null ? (
            <p className="muted" aria-busy={studio.state === 'loading' ? 'true' : undefined}>
              {studio.state === 'loading' ? legal.loadingFigures : unavailableLine(studio)}
            </p>
          ) : snapshot.pool === null ? (
            <p className="muted">{legal.partUnavailable}</p>
          ) : (
            <PoolLine balance={snapshot.pool.balance_usd} />
          )}
        </div>
        <div className="money-actions">
          {snapshot === null ? null : (
            <>
              <h3 className="rows-heading">{legal.latestActions}</h3>
              {snapshot.missing.includes('events') ? (
                <p className="muted">{legal.partUnavailable}</p>
              ) : (
                <EventList snapshot={snapshot} limit={HOME_ACTIONS} collapse />
              )}
            </>
          )}
          <p className="more">
            <MoreLink to="/ledger">{copy.fullLedger}</MoreLink>
          </p>
        </div>
      </div>
    </section>
  );
}

/** The stations in the floor's order, as the parts of the page that light them. */
const STATION_IDS = FLOOR_STATIONS.map((station) => station.id);

export function Landing() {
  const studio = useStudio();
  const live = useLiveHome(studio);
  const view = live.view;
  const since = useLastVisit();
  const player = useSignedInPanel();
  const ideas = useIdeasStation();
  const lit = useLitStation(STATION_IDS, view !== null);
  const main = useRef<HTMLElement>(null);
  // From 64rem the plate's room shrinks onto the rail's map as the page scrolls (lib/studio-morph.ts).
  useStudioMorph(main, view !== null);
  return (
    <main className="wide home" ref={main}>
      {/* The floor's plate (docs/specs/place.md): the room large, its stations as links, and beside it
          who you are to the studio today: the pitch on a first visit, your level and your cards once
          signed in. The pipe sits under the panel. */}
      <div className="band floor-plate">
        {player === null ? (
          <Hero />
        ) : (
          <WelcomePanel profile={player} snapshot={view?.snapshot ?? null} />
        )}
        {/* While the snapshot loads, the room is drawn empty in its own box and the pipe tells the feed,
            so nothing under them moves when the agents arrive. */}
        <LiveStudio snapshot={view?.snapshot ?? null} pipeSize={2} />
      </div>
      {/* The stations in the machine's order, the rail with the room's small map beside them from
          64rem; then the first game. */}
      <div className="band floor-band">
        {view === null ? null : <SinceLastVisit cards={view.snapshot.cards} since={since} />}
        {/* Fund and the first game hold their place while the snapshot loads, so neither is drawn
            twice and a link to #fund lands where it stays. */}
        <div className="floor">
          {view === null ? null : <FloorRail snapshot={view.snapshot} lit={lit} counts={stationCounts(view.snapshot, view.groups, null)} ideas={ideas.shown} />}
          <div className="floor-parts">
            <FundSection studio={studio} live={live} index={1} />
            {/* The first game follows the cards to fund, above how the cards move (decision 70). */}
            <ShowcaseSection />
            {view === null ? null : (
              <>
                {ideas.shown ? <IdeasStation index={2} station={ideas} /> : null}
                <NextStation snapshot={view.snapshot} groups={view.groups} index={3} />
                <BuildingStation snapshot={view.snapshot} groups={view.groups} index={4} />
                <ShippedStation snapshot={view.snapshot} groups={view.groups} index={5} />
              </>
            )}
          </div>
        </div>
      </div>
      {view === null ? null : <TeamSection view={view} />}
      <div className="band">
        <MoneySection studio={studio} view={view} />
      </div>
    </main>
  );
}
