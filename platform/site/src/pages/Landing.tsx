import { Link } from 'react-router-dom';
import { BuildingNow, FundBoard, PlannedNext, QueuedList, ShippedList } from '../components/Cards';
import { EventList } from '../components/EventList';
import { splitSentence } from '../components/Funding';
import { Glyph } from '../components/Glyph';
import { LiveUpdates } from '../components/LiveUpdates';
import { PoolLine } from '../components/PoolStat';
import { StaleNotice } from '../components/StaleNotice';
import { MoreLink } from '../components/MoreLink';
import { TeamStrip } from '../components/TeamStrip';
import { plannedCards } from '../lib/cards';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { legal } from '../lib/legal';
import { useLiveHome, type HomeView } from '../lib/live';
import { runsCards } from '../lib/roster';
import type { Snapshot } from '../lib/source';
import { unavailableLine, useStudio, type StudioState } from '../lib/studio';

// Home, in the board's order (DESIGN.md, Home), on bands: what the studio is and its state (the
// signal plate); what is building, what to fund and what is queued, the only band with cards
// (paper); the team (ink); what shipped and what is planned next (paper); where the money goes
// (ink). A band with nothing to show is not drawn, and the bands after it take their colour from
// their new place.

/** Home shows the latest three shipped cards, the next three planned and the five latest agent actions. */
export const HOME_SHIPPED = 3;
export const HOME_PLANNED = 3;
export const HOME_ACTIONS = 5;

function paused(snapshot: Snapshot): boolean {
  return snapshot.paused && !snapshot.missing.includes('studio');
}

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
 * are open, how many are building, and whether the agents are paused, which home says only here.
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
  const isPaused = paused(view.snapshot);
  return (
    <p className="status-line">
      {isPaused ? <Glyph name="pause" /> : null}
      <span>
        {fund.length === 0 ? copy.status.openNone : <Count n={fund.length} words={copy.status.open} />}
        {now.length === 0 ? null : (
          <>
            {' '}
            <Count n={now.length} words={copy.status.building} />
          </>
        )}
        {isPaused ? ` ${copy.status.paused}` : null}
      </span>
    </p>
  );
}

function Hero({ studio, live }: { studio: StudioState; live: ReturnType<typeof useLiveHome> }) {
  const env = siteEnv();
  return (
    <div className="hero">
      <h1>{copy.pitchTitle}</h1>
      <p className="lede">{copy.pitchBody}</p>
      <p className="hero-actions">
        {env.playUrl === '' ? null : (
          <a className="button" href={env.playUrl}>
            <Glyph name="cartridge" />
            {copy.playDust}
          </a>
        )}
        <Link className="target" to="/how-it-works">
          {copy.howItWorks}
        </Link>
      </p>
      <StatusLine studio={studio} view={live.view} />
      <StaleNotice studio={studio} />
      <LiveUpdates count={live.count} paused={live.paused} onTogglePause={live.togglePause} onShow={live.show} message={live.message} />
    </div>
  );
}

function FundSection({ studio, live }: { studio: StudioState; live: ReturnType<typeof useLiveHome> }) {
  const view = live.view;
  return (
    <section className="section" aria-labelledby="fund">
      <h2 id="fund">{copy.fund}</h2>
      <p>{copy.fundIntro}</p>
      {view !== null ? (
        <FundBoard snapshot={view.snapshot} cards={view.groups.fund} changed={live.changed} />
      ) : studio.state === 'loading' ? (
        <p className="muted" aria-busy="true">
          {copy.loadingCards}
        </p>
      ) : (
        <p className="muted">{unavailableLine(studio)}</p>
      )}
    </section>
  );
}

function TeamSection({ view }: { view: HomeView }) {
  const snapshot = view.snapshot;
  const laneOpen = snapshot.platformLaneOpen === true;
  const roles = snapshot.roles.filter((role) => role.state === 'active' && runsCards(role, laneOpen)).slice(0, 3);
  if (roles.length === 0) return null;
  return (
    <div className="band">
      <section className="section" aria-labelledby="team">
        <h2 id="team">{copy.team.title}</h2>
        <TeamStrip roles={roles} asleep={paused(snapshot)} />
        <p className="more">
          <MoreLink to="/team">{copy.team.meetAll}</MoreLink>
        </p>
      </section>
    </div>
  );
}

function RoadmapSection({ view }: { view: HomeView }) {
  const shipped = view.groups.shipped.slice(0, HOME_SHIPPED);
  const planned = plannedCards(view.snapshot.cards);
  const next = [...planned.next, ...planned.later].slice(0, HOME_PLANNED);
  if (shipped.length === 0 && next.length === 0) return null;
  return (
    <div className="band">
      <div className="pair">
        <ShippedList cards={shipped} snapshot={view.snapshot} />
        <PlannedNext cards={next} />
      </div>
    </div>
  );
}

/** Where the money goes: the pool with the coin, the split, the latest agent actions and the ledger. */
function MoneySection({ studio, view }: { studio: StudioState; view: HomeView | null }) {
  const snapshot = view?.snapshot ?? null;
  return (
    <section className="section" aria-labelledby="money">
      <h2 id="money">{legal.moneyHeading}</h2>
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
        {splitSentence()} {legal.notDonations}
      </p>
      {snapshot === null ? null : (
        <>
          <h3 className="rows-heading">{legal.latestActions}</h3>
          {snapshot.missing.includes('events') ? (
            <p className="muted">{legal.partUnavailable}</p>
          ) : (
            <EventList snapshot={snapshot} limit={HOME_ACTIONS} />
          )}
        </>
      )}
      <p className="more">
        <MoreLink to="/ledger">{copy.fullLedger}</MoreLink>
      </p>
    </section>
  );
}

export function Landing() {
  const studio = useStudio();
  const live = useLiveHome(studio);
  const view = live.view;
  return (
    <main className="wide home">
      <div className="band">
        <Hero studio={studio} live={live} />
      </div>
      <div className="band">
        {view === null ? null : <BuildingNow cards={view.groups.now} snapshot={view.snapshot} />}
        <FundSection studio={studio} live={live} />
        {view === null ? null : <QueuedList cards={view.groups.queued} />}
      </div>
      {view === null ? null : <TeamSection view={view} />}
      {view === null ? null : <RoadmapSection view={view} />}
      <div className="band">
        <MoneySection studio={studio} view={view} />
      </div>
    </main>
  );
}
