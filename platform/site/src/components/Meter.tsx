import { copy } from '../lib/copy';
import { formatUsd } from '../lib/format';
import type { StudioState } from '../lib/studio';

export function Meter({ studio }: { studio: StudioState }) {
  if (studio.state === 'loading') {
    return <p className="meter-status">{copy.loadingFigures}</p>;
  }
  if (studio.state !== 'ready' || studio.snapshot.pool === null) {
    return <p className="meter-status">{copy.meterUnavailable}</p>;
  }
  const pool = studio.snapshot.pool;
  return (
    <dl className="figures">
      <div className="figure">
        <dt>{copy.poolBalance}</dt>
        <dd>{formatUsd(pool.balance_usd)}</dd>
      </div>
      <div className="figure">
        <dt>{copy.reserve}</dt>
        <dd>{formatUsd(pool.reserve_usd)}</dd>
      </div>
      <div className="figure">
        <dt>{copy.incidentReserve}</dt>
        <dd>{formatUsd(pool.incident_reserve_usd)}</dd>
      </div>
    </dl>
  );
}
