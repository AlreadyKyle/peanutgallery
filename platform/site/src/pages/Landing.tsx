import { Link } from 'react-router-dom';
import { GoalBars } from '../components/GoalBars';
import { LedgerSummary } from '../components/LedgerSummary';
import { Meter } from '../components/Meter';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { launchLine } from '../lib/launch';
import { useStudio } from '../lib/studio';

export function Landing() {
  const env = siteEnv();
  const studio = useStudio();
  return (
    <main>
      <div className="masthead">
        <h1 className="sr-only">{copy.studioName}</h1>
        <p className="launch">{launchLine(env.launchAt)}</p>
      </div>

      <section className="lead" aria-label="Contribute">
        {env.stripePaymentLinkUrl === '' ? (
          <p>{copy.contributeUnavailable}</p>
        ) : (
          <a className="button" href={env.stripePaymentLinkUrl}>
            {copy.contribute}
          </a>
        )}
        <p>{copy.split}</p>
      </section>

      <section className="section" aria-label="Meter">
        <h2 className="label">{copy.meter}</h2>
        <Meter studio={studio} />
      </section>

      <section className="section" aria-label="Ledger">
        <h2 className="label">{copy.ledger}</h2>
        <LedgerSummary studio={studio} />
        <p>
          <Link className="more" to="/ledger">
            {copy.fullLedger}
          </Link>
        </p>
      </section>

      <section className="section" aria-label="Sprint goals">
        <h2 className="label">{copy.build}</h2>
        <GoalBars studio={studio} />
        <p>{copy.preLaunch}</p>
      </section>

      <section className="section" aria-label="Policies">
        <h2 className="label">{copy.policies}</h2>
        <p>{copy.artPolicy}</p>
        <p>{copy.allAges}</p>
        <p>{copy.kernel}</p>
      </section>
    </main>
  );
}
