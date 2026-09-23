import { formatInteger, formatUsd } from '../lib/format';
import { legal } from '../lib/legal';
import { unavailableLine, type StudioState } from '../lib/studio';
import { EventList } from './EventList';
import { Stat } from './Stat';

// Kernel (docs/specs/board-site.md). Agent spend and tokens, then the latest agent actions. A part that did not load says so instead
// of showing zero or an empty list.
export function LedgerSummary({ studio }: { studio: StudioState }) {
  if (studio.state === 'loading') {
    return <p className="muted">{legal.loadingLedger}</p>;
  }
  if (studio.state !== 'ready') {
    return <p className="muted">{unavailableLine(studio)}</p>;
  }
  const { totals, missing } = studio.snapshot;
  const tokens = legal.tokensLine
    .replace('{in}', formatInteger(totals.input_tokens))
    .replace('{cached}', formatInteger(totals.cached_tokens))
    .replace('{out}', formatInteger(totals.output_tokens));
  return (
    <>
      {missing.includes('totals') ? (
        <p className="muted">{legal.partUnavailable}</p>
      ) : (
        <>
          <dl className="stats">
            <Stat label={legal.agentSpend} description={legal.describeAgentSpend} value={formatUsd(totals.usd_total)} />
          </dl>
          <p className="muted small">{tokens}</p>
        </>
      )}
      {missing.includes('events') ? (
        <p className="muted">{legal.partUnavailable}</p>
      ) : (
        <EventList snapshot={studio.snapshot} />
      )}
    </>
  );
}
