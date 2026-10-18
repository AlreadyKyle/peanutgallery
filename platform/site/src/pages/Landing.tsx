import { CardsStatus } from '../components/CardsStatus';
import { EventList } from '../components/EventList';
import { ExplainerVideo } from '../components/ExplainerVideo';
import { FundNow } from '../components/Flow';
import { BuildingStation, FloorRail, FLOOR_STATIONS, IdeasStation, ShippedStation, StationPart, stationCounts, stationTags, useLitStation, useSignedInPanel, WelcomePanel } from '../components/Floor';
import { Perks } from '../components/Perks';
import { useSignedIn } from '../lib/account';
import { splitSentence } from '../components/Funding';
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
import { teamStrip } from '../lib/roster';
import { unavailableLine, useStudio, type StudioState } from '../lib/studio';

// Home, in the board's order (DESIGN.md, Home; docs/specs/home-flow.md), on bands: what the studio
// is and its state (the signal plate); how the cards move, the four lanes from Next up to Shipped,
// the only band with cards (paper); the team (ink); where the money goes. A band with nothing to show
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
 * are open and how many are building. It never says the studio is paused (docs/PLAN.md §10
 * decision 62): the public site shows no paused notice.
 */
function StatusLine({ studio, view }: { studio: StudioState; view: HomeView | null }) {
  if (studio.state === 'loading' && view === null) {
    return (
      <p className="status-line" aria-busy="true">
        {legal.loadingFigures}
      </p>
    );
  }
  if (view === null) return <p className="status-line">{unavailableLine(studio)}</p>;
  const { fund, now } = view.groups;
  return (
    <p className="status-line">
      <span>
        {fund.length > 0 ? (
          <Count n={fund.length} words={copy.status.open} />
        ) : view.snapshot.supply?.drafting === true ? (
          copy.status.drafting
        ) : (
          copy.status.openNone
        )}
        {now.length === 0 ? null : (
          <>
            {' '}
            <Count n={now.length} words={copy.status.building} />
          </>
        )}
      </span>
    </p>
  );
}

function Hero({ studio, live }: { studio: StudioState; live: ReturnType<typeof useLiveHome> }) {
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
      {/* The studio's state, under the actions. */}
      <div className="hero-status">
        <HeroStatus studio={studio} live={live} />
      </div>
    </div>
  );
}

/** The studio's state in one line, its stale notice and the announcer for screen readers. */
function HeroStatus({ studio, live }: { studio: StudioState; live: ReturnType<typeof useLiveHome> }) {
  return (
    <>
      <StatusLine studio={studio} view={live.view} />
      <StaleNotice studio={studio} />
      <Announcer message={live.message} />
    </>
  );
}

/**
 * The first game and the explainer, side by side from 64rem: the game's box art, its name, one line
 * and Play (decision 68), and the video that shows how a card becomes a change in it. Without a play
 * address the video takes the row alone.
 */
function ShowcaseSection() {
  const env = siteEnv();
  return (
    <div className="showcase">
      {env.playUrl === '' ? null : (
        <section className="section game-tile" aria-labelledby="game">
          <img className="game-shot" src="/games/dust-box-art.svg" width={375} height={500} alt={copy.game.alt} />
          <div className="game-text">
            <h2 id="game">{copy.game.title}</h2>
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
      )}
      <ExplainerVideo />
    </div>
  );
}

/**
 * The Fund station: the cards open for funding, first and biggest, or the loading or unavailable line
 * while there is no snapshot; then what a contribution gets you.
 */
function FundSection({ studio, live, index }: { studio: StudioState; live: ReturnType<typeof useLiveHome>; index: number }) {
  const view = live.view;
  const signedIn = useSignedIn();
  return (
    <StationPart id="fund" index={index} title={copy.flow.fundTitle} intro={copy.flow.fundIntro}>
      <CardsStatus
        count={view !== null ? view.groups.fund.length : null}
        unavailable={view === null && studio.state !== 'loading'}
      />
      {view !== null ? (
        <FundNow cards={view.groups.fund} snapshot={view.snapshot} changed={live.changed} machine={<MachineCard />} />
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
      <Perks signIn={!signedIn} />
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

/** Where the money goes: the pool with the coin, the split, the latest agent actions and the ledger. */
function MoneySection({ studio, view }: { studio: StudioState; view: HomeView | null }) {
  const snapshot = view?.snapshot ?? null;
  return (
    <section className="section" aria-labelledby="money">
      <h2 id="money">{legal.moneyHeading}</h2>
      {/* The pool and the split on the left, the latest agent actions beside them from 64rem. */}
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
          <p className="money-split">
            {splitSentence()} {legal.agentShareLine} {legal.notDonations}
          </p>
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
  const lit = useLitStation(STATION_IDS, view !== null);
  return (
    <main className="wide home">
      {/* The floor's plate (docs/specs/place.md): the room large, its stations as links, and beside it
          who you are to the studio today: the pitch on a first visit, your level and your cards once
          signed in. The pipe sits under the panel. */}
      <div className="band floor-plate">
        {player === null ? (
          <Hero studio={studio} live={live} />
        ) : (
          <WelcomePanel profile={player} snapshot={view?.snapshot ?? null} status={<HeroStatus studio={studio} live={live} />} />
        )}
        {view === null ? null : <LiveStudio snapshot={view.snapshot} stations={stationTags()} lit={lit} pipeSize={3} />}
      </div>
      {/* The stations in the machine's order, the rail with the room's small map beside them from
          64rem; then the first game. */}
      <div className="band floor-band">
        {view === null ? null : <SinceLastVisit cards={view.snapshot.cards} since={since} />}
        {view === null ? (
          <FundSection studio={studio} live={live} index={2} />
        ) : (
          <div className="floor">
            <FloorRail snapshot={view.snapshot} lit={lit} counts={stationCounts(view.snapshot, view.groups, null)} />
            <div className="floor-parts">
              <IdeasStation snapshot={view.snapshot} groups={view.groups} index={1} />
              <FundSection studio={studio} live={live} index={2} />
              <BuildingStation snapshot={view.snapshot} groups={view.groups} index={3} />
              <ShippedStation snapshot={view.snapshot} groups={view.groups} index={4} />
            </div>
          </div>
        )}
        <ShowcaseSection />
      </div>
      {view === null ? null : <TeamSection view={view} />}
      <div className="band">
        <MoneySection studio={studio} view={view} />
      </div>
    </main>
  );
}
