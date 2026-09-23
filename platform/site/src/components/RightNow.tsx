import { Link } from 'react-router-dom';
import { groupCards } from '../lib/cards';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import type { Snapshot } from '../lib/source';
import { unavailableLine, type StudioState } from '../lib/studio';
import { isPaused, PausedNotice } from './PausedNotice';
import { PoolStat } from './PoolStat';
import { StaleNotice } from './StaleNotice';

/**
 * The glanceable state of the studio beside the pitch: the money in the pool, what is building and
 * what shipped last, and a notice while the agents are paused. It stays about as tall as the pitch it
 * sits beside, so the row leaves no gap; the agent work itself is the Ledger section below and the
 * ledger page.
 */
export function RightNow({ studio }: { studio: StudioState }) {
  return (
    <aside className="panel" aria-labelledby="right-now">
      <h2 id="right-now">{copy.rightNow}</h2>
      <StaleNotice studio={studio} />
      {studio.state === 'loading' ? <p className="muted">{legal.loadingFigures}</p> : null}
      {studio.state === 'unconfigured' || studio.state === 'error' ? <p className="muted">{unavailableLine(studio)}</p> : null}
      {studio.state === 'ready' ? <Ready studio={studio} snapshot={studio.snapshot} /> : null}
    </aside>
  );
}

function Ready({ studio, snapshot }: { studio: StudioState; snapshot: Snapshot }) {
  const { now, shipped } = groupCards(snapshot.cards);
  const latest = shipped[0];
  const paused = isPaused(studio);
  return (
    <>
      <PausedNotice studio={studio} />
      {snapshot.pool === null ? null : (
        <dl className="stats">
          <PoolStat balance={snapshot.pool.balance_usd} />
        </dl>
      )}
      <p>
        {now.length === 0 ? (
          <span className="muted">{paused ? copy.nowEmptyPaused : copy.nowEmpty}</span>
        ) : (
          <>
            <span className="row-strong">{copy.buildingLine}</span> {now.map((card) => card.title).join(', ')}
          </>
        )}
      </p>
      {latest === undefined ? null : (
        <p>
          <span className="row-strong">{copy.latestShipped}</span> {latest.title}
        </p>
      )}
      <p className="small">
        <Link to="/ledger">{copy.fullLedger}</Link>
      </p>
    </>
  );
}
