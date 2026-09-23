import { formatUsd } from '../lib/format';
import { legal } from '../lib/legal';
import { unavailableLine, type StudioState } from '../lib/studio';
import { PoolStat } from './PoolStat';
import { StaleLine } from './StaleNotice';
import { Stat } from './Stat';

// Kernel (docs/specs/board-site.md): the pool, the reserve, the emergency fund and held money.
// The meter sits on the landing and the ledger page, which each carry the live StaleNotice, so the
// line here is visual only: a reader scrolling to the money sees it beside the figures.
export function Meter({ studio }: { studio: StudioState }) {
  if (studio.state === 'loading') {
    return <p className="muted">{legal.loadingFigures}</p>;
  }
  if (studio.state !== 'ready' || studio.snapshot.pool === null) {
    return <p className="muted">{unavailableLine(studio)}</p>;
  }
  const pool = studio.snapshot.pool;
  return (
    <>
      <StaleLine studio={studio} />
      <dl className="stats">
        <PoolStat balance={pool.balance_usd} />
        <Stat label={legal.reserve} description={legal.describeReserve} value={formatUsd(pool.reserve_usd)} />
        <Stat
          label={legal.incidentReserve}
          description={legal.describeIncidentReserve}
          value={formatUsd(pool.incident_reserve_usd)}
        />
        <Stat label={legal.held} description={legal.describeHeld} value={formatUsd(pool.held_usd)} />
      </dl>
    </>
  );
}
