import { copy } from '../lib/copy';
import { formatInteger, formatUsd } from '../lib/format';
import type { StudioState } from '../lib/studio';
import { EventList } from './EventList';
import { Stat } from './Stat';

// The landing shows the totals only; the Ledger page adds the agent work list.
export function LedgerSummary({ studio, events = true }: { studio: StudioState; events?: boolean }) {
  if (studio.state === 'loading') {
    return <p className="muted">{copy.loadingLedger}</p>;
  }
  if (studio.state !== 'ready') {
    return <p className="muted">{copy.meterUnavailable}</p>;
  }
  const { totals } = studio.snapshot;
  const tokens = copy.tokensLine
    .replace('{in}', formatInteger(totals.input_tokens))
    .replace('{cached}', formatInteger(totals.cached_tokens))
    .replace('{out}', formatInteger(totals.output_tokens));
  return (
    <>
      <dl className="stats">
        <Stat label={copy.agentSpend} description={copy.describeAgentSpend} value={formatUsd(totals.usd_total)} />
      </dl>
      <p className="muted small">{tokens}</p>
      {events ? <EventList snapshot={studio.snapshot} /> : null}
    </>
  );
}
