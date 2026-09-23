import { DeployList } from '../components/DeployList';
import { LedgerSummary } from '../components/LedgerSummary';
import { Meter } from '../components/Meter';
import { FundingLines, MoneyIn, NotOnCardStat } from '../components/MoneyIn';
import { PageHeader } from '../components/PageHeader';
import { StaleNotice } from '../components/StaleNotice';
import { Stopped } from '../components/Stopped';
import { legal } from '../lib/legal';
import { unavailableLine, useStudio } from '../lib/studio';

// Kernel (docs/specs/board-site.md): the public ledger, with its strings from legal.ts. Full-width
// bands stacked (DESIGN.md, Bands): the heading on the signal plate, then by position the funding
// (with Not on a card yet), money in, the stopped cards (only while there are any, or when they did
// not load), the agent work and the deploys (docs/specs/money-surfaces.md). Nothing sits side by
// side, so no short block leaves an empty column beside a long one.

export function Ledger() {
  const studio = useStudio();
  const snapshot = studio.state === 'ready' ? studio.snapshot : null;
  const stoppedMissing = snapshot !== null && snapshot.missing.includes('stopped');
  const showStopped = snapshot !== null && (stoppedMissing || (snapshot.stopped ?? []).length > 0);
  return (
    <main>
      <div className="band">
        <PageHeader title={legal.ledger} lede={legal.ledgerLede}>
          <StaleNotice studio={studio} />
        </PageHeader>
      </div>
      <div className="band">
        <section className="section" aria-labelledby="funding">
          <h2 id="funding">{legal.meter}</h2>
          <Meter
            studio={studio}
            figures={snapshot === null ? null : <NotOnCardStat snapshot={snapshot} />}
            after={snapshot === null ? null : <FundingLines snapshot={snapshot} />}
          />
          <p className="muted small">{legal.usdNote}</p>
        </section>
      </div>
      <div className="band">
        <section className="section" aria-labelledby="money-in">
          <h2 id="money-in">{legal.moneyIn}</h2>
          <p>{legal.moneyInLede}</p>
          <MoneyIn studio={studio} />
        </section>
      </div>
      {showStopped ? (
        <div className="band">
          <section className="section" aria-labelledby="stopped">
            <h2 id="stopped">{legal.stoppedHeading}</h2>
            <p>{legal.stoppedLede}</p>
            {stoppedMissing ? <p className="muted">{legal.partUnavailable}</p> : <Stopped snapshot={snapshot} />}
          </section>
        </div>
      ) : null}
      <div className="band">
        <section className="section" aria-labelledby="agent-work">
          <h2 id="agent-work">{legal.agentWork}</h2>
          <LedgerSummary studio={studio} />
        </section>
      </div>
      <div className="band">
        <section className="section" aria-labelledby="deploys">
          <h2 id="deploys">{legal.deploys}</h2>
          {studio.state === 'ready' ? (
            <DeployList snapshot={studio.snapshot} />
          ) : (
            <p className="muted">{studio.state === 'loading' ? legal.loadingDeploys : unavailableLine(studio)}</p>
          )}
        </section>
      </div>
    </main>
  );
}
