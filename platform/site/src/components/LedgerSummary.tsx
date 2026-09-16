import { copy } from '../lib/copy';
import { formatInteger, formatUsd } from '../lib/format';
import type { StudioState } from '../lib/studio';
import { EventList } from './EventList';
import { Stat } from './Stat';

// Agent spend and tokens, then the latest agent actions. A part that did not load says so instead
// of showing zero or an empty list.
export function LedgerSummary({ studio }: { studio: StudioState }) {
  if (studio.state === 'loading') {
    return <p className="muted">{copy.loadingLedger}</p>;
  }
  if (studio.state !== 'ready') {
    return <p className="muted">{copy.meterUnavailable}</p>;
  }
  const { totals, missing } = studio.snapshot;
  const tokens = copy.tokensLine
    .replace('{in}', formatInteger(totals.input_tokens))
    .replace('{cached}', formatInteger(totals.cached_tokens))
    .replace('{out}', formatInteger(totals.output_tokens));
  return (
    <>
      {missing.includes('totals') ? (
        <p className="muted">{copy.partUnavailable}</p>
      ) : (
        <>
          <dl className="stats">
            <Stat label={copy.agentSpend} description={copy.describeAgentSpend} value={formatUsd(totals.usd_total)} />
          </dl>
          <p className="muted small">{tokens}</p>
        </>
      )}
      {missing.includes('events') ? (
        <p className="muted">{copy.partUnavailable}</p>
      ) : (
        <EventList snapshot={studio.snapshot} />
      )}
    </>
  );
}
