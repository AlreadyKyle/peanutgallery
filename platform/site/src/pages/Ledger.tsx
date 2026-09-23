import { DeployList } from '../components/DeployList';
import { LedgerSummary } from '../components/LedgerSummary';
import { Meter } from '../components/Meter';
import { PageHeader } from '../components/PageHeader';
import { StaleNotice } from '../components/StaleNotice';
import { legal } from '../lib/legal';
import { unavailableLine, useStudio } from '../lib/studio';

// Kernel (docs/specs/board-site.md): the public ledger, with its strings from legal.ts.

export function Ledger() {
  const studio = useStudio();
  return (
    <main>
      <PageHeader title={legal.ledger} lede={legal.ledgerLede}>
        <StaleNotice studio={studio} />
      </PageHeader>
      <section className="section" aria-labelledby="funding">
        <h2 id="funding">{legal.meter}</h2>
        <Meter studio={studio} />
      </section>
      <section className="section" aria-labelledby="agent-work">
        <h2 id="agent-work">{legal.agentWork}</h2>
        <LedgerSummary studio={studio} />
      </section>
      <section className="section" aria-labelledby="deploys">
        <h2 id="deploys">{legal.deploys}</h2>
        {studio.state === 'ready' ? (
          <DeployList snapshot={studio.snapshot} />
        ) : (
          <p className="muted">{studio.state === 'loading' ? legal.loadingDeploys : unavailableLine(studio)}</p>
        )}
      </section>
    </main>
  );
}
