import { DeployList } from '../components/DeployList';
import { LedgerSummary } from '../components/LedgerSummary';
import { Meter } from '../components/Meter';
import { PageHeader } from '../components/PageHeader';
import { StaleNotice } from '../components/StaleNotice';
import { copy } from '../lib/copy';
import { unavailableLine, useStudio } from '../lib/studio';

export function Ledger() {
  const studio = useStudio();
  return (
    <main>
      <PageHeader title={copy.ledger} lede={copy.ledgerLede}>
        <StaleNotice studio={studio} />
      </PageHeader>
      <section className="section" aria-labelledby="funding">
        <h2 id="funding">{copy.meter}</h2>
        <Meter studio={studio} />
      </section>
      <section className="section" aria-labelledby="agent-work">
        <h2 id="agent-work">{copy.agentWork}</h2>
        <LedgerSummary studio={studio} />
      </section>
      <section className="section" aria-labelledby="deploys">
        <h2 id="deploys">{copy.deploys}</h2>
        {studio.state === 'ready' ? (
          <DeployList snapshot={studio.snapshot} />
        ) : (
          <p className="muted">{studio.state === 'loading' ? copy.loadingDeploys : unavailableLine(studio)}</p>
        )}
      </section>
    </main>
  );
}
