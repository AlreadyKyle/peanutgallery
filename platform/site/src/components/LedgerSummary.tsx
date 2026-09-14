import { copy } from '../lib/copy';
import { formatInteger, formatUsd } from '../lib/format';
import type { StudioState } from '../lib/studio';
import { EventList } from './EventList';

export function LedgerSummary({ studio }: { studio: StudioState }) {
  if (studio.state === 'loading') {
    return <p>Loading the ledger.</p>;
  }
  if (studio.state !== 'ready') {
    return <p>{copy.meterUnavailable}</p>;
  }
  const { totals } = studio.snapshot;
  return (
    <>
      <dl className="totals">
        <div>
          <dt>Agent spend</dt>
          <dd>{formatUsd(totals.usd_total)}</dd>
        </div>
        <div>
          <dt>Input tokens</dt>
          <dd>{formatInteger(totals.input_tokens)}</dd>
        </div>
        <div>
          <dt>Cached tokens</dt>
          <dd>{formatInteger(totals.cached_tokens)}</dd>
        </div>
        <div>
          <dt>Output tokens</dt>
          <dd>{formatInteger(totals.output_tokens)}</dd>
        </div>
      </dl>
      <EventList snapshot={studio.snapshot} />
    </>
  );
}
