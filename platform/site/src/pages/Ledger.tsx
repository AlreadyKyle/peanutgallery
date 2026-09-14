import { DeployList } from '../components/DeployList';
import { LedgerSummary } from '../components/LedgerSummary';
import { Meter } from '../components/Meter';
import { copy } from '../lib/copy';
import { useStudio } from '../lib/studio';

export function Ledger() {
  const studio = useStudio();
  return (
    <main>
      <div className="masthead">
        <h1 className="display">{copy.ledger}</h1>
      </div>
      <section className="section" aria-label="Pool">
        <h2 className="label">{copy.pool}</h2>
        <Meter studio={studio} />
      </section>
      <section className="section" aria-label="Agent work">
        <h2 className="label">{copy.agentWork}</h2>
        <LedgerSummary studio={studio} />
      </section>
      <section className="section" aria-label="Deploys">
        <h2 className="label">{copy.deploys}</h2>
        {studio.state === 'ready' ? (
          <DeployList snapshot={studio.snapshot} />
        ) : (
          <p>{studio.state === 'loading' ? copy.loadingDeploys : copy.meterUnavailable}</p>
        )}
      </section>
    </main>
  );
}
