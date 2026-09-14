import { copy } from '../lib/copy';
import { formatInteger, formatUsd } from '../lib/format';
import type { StudioState } from '../lib/studio';
import { EventList } from './EventList';

export function LedgerSummary({ studio }: { studio: StudioState }) {
  if (studio.state === 'loading') {
    return <p>{copy.loadingLedger}</p>;
  }
  if (studio.state !== 'ready') {
    return <p>{copy.meterUnavailable}</p>;
  }
  const { totals } = studio.snapshot;
  return (
    <>
      <dl className="figures figures-small">
        <div className="figure">
          <dt>{copy.agentSpend}</dt>
          <dd>{formatUsd(totals.usd_total)}</dd>
        </div>
        <div className="figure">
          <dt>{copy.inputTokens}</dt>
          <dd>{formatInteger(totals.input_tokens)}</dd>
        </div>
        <div className="figure">
          <dt>{copy.cachedTokens}</dt>
          <dd>{formatInteger(totals.cached_tokens)}</dd>
        </div>
        <div className="figure">
          <dt>{copy.outputTokens}</dt>
          <dd>{formatInteger(totals.output_tokens)}</dd>
        </div>
      </dl>
      <EventList snapshot={studio.snapshot} />
    </>
  );
}
