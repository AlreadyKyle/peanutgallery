import { DeployList } from '../components/DeployList';
import { LedgerSummary } from '../components/LedgerSummary';
import { Meter } from '../components/Meter';
import { copy } from '../lib/copy';
import { useStudio } from '../lib/studio';

export function Ledger() {
  const studio = useStudio();
  return (
    <main>
      <h1>Ledger</h1>
      <section aria-label="Pool">
        <h2>Pool</h2>
        <Meter studio={studio} />
      </section>
      <section aria-label="Agent work">
        <h2>Agent work</h2>
        <LedgerSummary studio={studio} />
      </section>
      <section aria-label="Deploys">
        <h2>Deploys</h2>
        {studio.state === 'ready' ? (
          <DeployList snapshot={studio.snapshot} />
        ) : (
          <p>{studio.state === 'loading' ? 'Loading deploys.' : copy.meterUnavailable}</p>
        )}
      </section>
    </main>
  );
}
