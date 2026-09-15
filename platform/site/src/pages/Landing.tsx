import { Link } from 'react-router-dom';
import { LedgerSummary } from '../components/LedgerSummary';
import { Meter } from '../components/Meter';
import { NextList, NowList } from '../components/NowNext';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { formatDate } from '../lib/format';
import { useStudio, type StudioState } from '../lib/studio';

function launchLine(studio: StudioState): string | null {
  if (studio.state !== 'ready') return null;
  const at = studio.snapshot.launchedAt;
  return at === null ? copy.notLiveYet : `${copy.liveSince} ${formatDate(at)}`;
}

// Only a loaded launch date hides the pre-launch offer; unknown state keeps it.
function hasLaunched(studio: StudioState): boolean {
  return studio.state === 'ready' && studio.snapshot.launchedAt !== null;
}

export function Landing() {
  const env = siteEnv();
  const studio = useStudio();
  const launch = launchLine(studio);
  return (
    <main>
      <div className="masthead">
        <h1 className="sr-only">{copy.studioName}</h1>
        <p className="pitch">{copy.pitch}</p>
        {launch === null ? null : <p className="launch">{launch}</p>}
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
        {hasLaunched(studio) ? null : <p>{copy.preLaunch}</p>}
      </section>

      <section className="section" aria-label="How it works">
        <h2 className="label">{copy.howItWorks}</h2>
        <ol className="steps">
          {copy.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
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

      <section className="section" aria-label="Now">
        <h2 className="label">{copy.now}</h2>
        <NowList studio={studio} />
      </section>

      <section className="section" aria-label="Next">
        <h2 className="label">{copy.next}</h2>
        <NextList studio={studio} />
      </section>

      <section className="section" aria-label="Policies">
        <h2 className="label">{copy.policies}</h2>
        <p>{copy.artPolicy}</p>
        <p>{copy.allAges}</p>
        <p>{copy.fixedRulesIntro}</p>
        <ul className="rules">
          {copy.fixedRules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
