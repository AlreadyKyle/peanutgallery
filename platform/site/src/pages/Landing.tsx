import { Link } from 'react-router-dom';
import { EventList } from '../components/EventList';
import { ExplainerVideo } from '../components/ExplainerVideo';
import { MachineFlow } from '../components/Flow';
import { splitSentence } from '../components/Funding';
import { Glyph } from '../components/Glyph';
import { Announcer } from '../components/Announcer';
import { PoolLine } from '../components/PoolStat';
import { StaleNotice } from '../components/StaleNotice';
import { MoreLink } from '../components/MoreLink';
import { TeamStrip } from '../components/TeamStrip';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { legal } from '../lib/legal';
import { useLiveHome, type HomeView } from '../lib/live';
import { teamStrip } from '../lib/roster';
import type { Snapshot } from '../lib/source';
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
    <div className="hero hero-with-video">
      <div className="hero-text">
        <h1>{copy.pitchTitle}</h1>
        <p className="lede">{copy.pitchBody}</p>
        <p className="hero-actions">
          {env.playUrl === '' ? null : (
            <a className="button" href={env.playUrl}>
              <Glyph name="cartridge" />
              {copy.playFree}
            </a>
          )}
          <Link className="target" to="/how-it-works">
            {copy.howItWorks}
          </Link>
        </p>
      </div>
      {/* The studio's state: under the pitch on a phone, under the pitch and the video from 64rem. */}
      <div className="hero-status">
        <StatusLine studio={studio} view={live.view} />
        <StaleNotice studio={studio} />
        <Announcer message={live.message} />
      </div>
      <ExplainerVideo />
    </div>
  );
}

/** How the cards move: the four lanes, or the loading or unavailable line while there is no snapshot. */
function FlowSection({ studio, live }: { studio: StudioState; live: ReturnType<typeof useLiveHome> }) {
  const view = live.view;
  return (
    <section className="section flow" aria-labelledby="flow">
      <h2 id="flow">{copy.flow.title}</h2>
      <p>{copy.flow.intro}</p>
      {view !== null ? (
        <MachineFlow snapshot={view.snapshot} groups={view.groups} changed={live.changed} />
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
  // The same rule as /team (lib/roster.ts teamStatus): roles on the team, running or paused.
  const roles = teamStrip(snapshot);
  if (roles.length === 0) return null;
  return (
    <div className="band">
      <section className="section" aria-labelledby="team">
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
            <EventList snapshot={snapshot} limit={HOME_ACTIONS} collapse />
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
        <FlowSection studio={studio} live={live} />
      </div>
      {view === null ? null : <TeamSection view={view} />}
      <div className="band">
        <MoneySection studio={studio} view={view} />
      </div>
    </main>
  );
}
