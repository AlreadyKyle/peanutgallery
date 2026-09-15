import { copy } from '../lib/copy';
import { formatUsd } from '../lib/format';
import type { StudioState } from '../lib/studio';
import { Stat } from './Stat';

export function Meter({ studio }: { studio: StudioState }) {
  if (studio.state === 'loading') {
    return <p className="muted">{copy.loadingFigures}</p>;
  }
  if (studio.state !== 'ready' || studio.snapshot.pool === null) {
    return <p className="muted">{copy.meterUnavailable}</p>;
  }
  const pool = studio.snapshot.pool;
  return (
    <dl className="stats">
      <Stat label={copy.poolBalance} description={copy.describeAvailable} value={formatUsd(pool.balance_usd)} />
      <Stat label={copy.reserve} description={copy.describeReserve} value={formatUsd(pool.reserve_usd)} />
      <Stat
        label={copy.incidentReserve}
        description={copy.describeIncidentReserve}
        value={formatUsd(pool.incident_reserve_usd)}
      />
    </dl>
  );
}
