import { useEffect, useRef, useState } from 'react';
import { copy } from '../lib/copy';
import { formatInteger, formatUsd } from '../lib/format';
import { legal } from '../lib/legal';
import { unavailableLine, type StudioState } from '../lib/studio';
import { EventList } from './EventList';
import { Stat } from './Stat';

/** The ledger shows this many agent actions until the reader asks for the rest. */
export const LEDGER_ACTIONS = 10;

// Kernel (docs/specs/board-site.md). Agent spend, with its tokens as a second line under the figure,
// then the latest agent actions: the newest ten, and "Show all n agent actions", which shows the rest
// and moves focus to the eleventh. A part that did not load says so instead of showing zero or an
// empty list.
export function LedgerSummary({ studio }: { studio: StudioState }) {
  const [all, setAll] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const focusNext = useRef(false);
  useEffect(() => {
    if (!all || !focusNext.current) return;
    focusNext.current = false;
    list.current?.querySelector<HTMLElement>('li[tabindex="-1"]')?.focus();
  }, [all]);
  if (studio.state === 'loading') {
    return (
      <p className="muted" aria-busy="true">
        {legal.loadingLedger}
      </p>
    );
  }
  if (studio.state !== 'ready') {
    return <p className="muted">{unavailableLine(studio)}</p>;
  }
  const { totals, missing, events } = studio.snapshot;
  const tokens = legal.tokensLine
    .replace('{in}', formatInteger(totals.input_tokens))
    .replace('{cached}', formatInteger(totals.cached_tokens))
    .replace('{out}', formatInteger(totals.output_tokens));
  const capped = !all && events.length > LEDGER_ACTIONS;
  return (
    <>
      {missing.includes('totals') ? (
        <p className="muted">{legal.partUnavailable}</p>
      ) : (
        <dl className="stats">
          <Stat label={legal.agentSpend} description={legal.describeAgentSpend} note={tokens} value={formatUsd(totals.usd_total)} />
        </dl>
      )}
      <h3 className="rows-heading">{legal.latestActions}</h3>
      {missing.includes('events') ? (
        <p className="muted">{legal.partUnavailable}</p>
      ) : (
        <div ref={list}>
          <EventList snapshot={studio.snapshot} limit={capped ? LEDGER_ACTIONS : undefined} focusAt={all ? LEDGER_ACTIONS : undefined} />
          {capped ? (
            <p className="show-more">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  focusNext.current = true;
                  setAll(true);
                }}
              >
                {copy.showAllActions.replace('{n}', formatInteger(events.length))}
              </button>
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
