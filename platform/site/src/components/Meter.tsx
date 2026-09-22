import { copy } from '../lib/copy';
import { formatUsd } from '../lib/format';
import { unavailableLine, type StudioState } from '../lib/studio';
import { StaleLine } from './StaleNotice';
import { Stat } from './Stat';

// The meter sits on the landing and the ledger page, which each carry the live StaleNotice, so the
// line here is visual only: a reader scrolling to the money sees it beside the figures.
export function Meter({ studio }: { studio: StudioState }) {
  if (studio.state === 'loading') {
    return <p className="muted">{copy.loadingFigures}</p>;
  }
  if (studio.state !== 'ready' || studio.snapshot.pool === null) {
    return <p className="muted">{unavailableLine(studio)}</p>;
  }
  const pool = studio.snapshot.pool;
  return (
    <>
      <StaleLine studio={studio} />
      <dl className="stats">
        <Stat label={copy.poolBalance} description={copy.describeAvailable} value={formatUsd(pool.balance_usd)} />
        <Stat label={copy.reserve} description={copy.describeReserve} value={formatUsd(pool.reserve_usd)} />
        <Stat
          label={copy.incidentReserve}
          description={copy.describeIncidentReserve}
          value={formatUsd(pool.incident_reserve_usd)}
        />
        <Stat label={copy.held} description={copy.describeHeld} value={formatUsd(pool.held_usd)} />
      </dl>
    </>
  );
}
