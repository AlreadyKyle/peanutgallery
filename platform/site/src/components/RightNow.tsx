import { Link } from 'react-router-dom';
import { groupCards } from '../lib/cards';
import { copy } from '../lib/copy';
import { formatUsd } from '../lib/format';
import type { Snapshot } from '../lib/source';
import type { StudioState } from '../lib/studio';
import { Stat } from './Stat';

/**
 * The glanceable state of the studio beside the pitch: money available, what is building and what
 * shipped last. It stays about as tall as the pitch it sits beside, so the row leaves no gap; the
 * agent work itself is the Ledger section below and the ledger page.
 */
export function RightNow({ studio }: { studio: StudioState }) {
  return (
    <aside className="panel" aria-labelledby="right-now">
      <h2 id="right-now">{copy.rightNow}</h2>
      {studio.state === 'loading' ? <p className="muted">{copy.loadingFigures}</p> : null}
      {studio.state === 'unconfigured' || studio.state === 'error' ? <p className="muted">{copy.meterUnavailable}</p> : null}
      {studio.state === 'ready' ? <Ready snapshot={studio.snapshot} /> : null}
    </aside>
  );
}

function Ready({ snapshot }: { snapshot: Snapshot }) {
  const { now, shipped } = groupCards(snapshot.cards);
  const latest = shipped[0];
  return (
    <>
      {snapshot.pool === null ? null : (
        <dl className="stats">
          <Stat label={copy.poolBalance} description={copy.describeAvailable} value={formatUsd(snapshot.pool.balance_usd)} />
        </dl>
      )}
      <p>
        {now.length === 0 ? (
          <span className="muted">{copy.nowEmpty}</span>
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
