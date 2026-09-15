import { DeployList } from '../components/DeployList';
import { LedgerSummary } from '../components/LedgerSummary';
import { Meter } from '../components/Meter';
import { PageHeader } from '../components/PageHeader';
import { copy } from '../lib/copy';
import { useStudio } from '../lib/studio';

export function Ledger() {
  const studio = useStudio();
  return (
    <main>
      <PageHeader title={copy.ledger} lede={copy.ledgerLede} />
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
          <p className="muted">{studio.state === 'loading' ? copy.loadingDeploys : copy.meterUnavailable}</p>
        )}
      </section>
    </main>
  );
}
