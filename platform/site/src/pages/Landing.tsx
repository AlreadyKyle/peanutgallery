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

// Order: what the studio is and how to take part, then what is building and what is next (the
// reasons to visit), then how it works, the money and the rules.
export function Landing() {
  const env = siteEnv();
  const studio = useStudio();
  const launch = launchLine(studio);
  return (
    <main>
      <div className="hero">
        <h1>{copy.pitchTitle}</h1>
        <p className="lede">{copy.pitchBody}</p>
        {launch === null ? null : <p className="muted">{launch}</p>}
        {env.stripePaymentLinkUrl === '' ? (
          <p>{copy.contributeUnavailable}</p>
        ) : (
          <p>
            <a className="button" href={env.stripePaymentLinkUrl}>
              {copy.contribute}
            </a>
          </p>
        )}
        <p className="muted small">{copy.split}</p>
      </div>

      <section className="section" aria-labelledby="now">
        <h2 id="now">{copy.now}</h2>
        <NowList studio={studio} />
      </section>

      <section className="section" aria-labelledby="next">
        <h2 id="next">{copy.next}</h2>
        <p className="muted">{copy.nextIntro}</p>
        <NextList studio={studio} />
      </section>

      <section className="section" aria-labelledby="how">
        <h2 id="how">{copy.howItWorks}</h2>
        <ol className="steps">
          {copy.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="section" aria-labelledby="funding">
        <h2 id="funding">{copy.meter}</h2>
        <Meter studio={studio} />
      </section>

      <section className="section" aria-labelledby="ledger">
        <h2 id="ledger">{copy.ledger}</h2>
        <LedgerSummary studio={studio} />
        <p>
          <Link to="/ledger">{copy.fullLedger}</Link>
        </p>
      </section>

      <section className="section" aria-labelledby="rules">
        <h2 id="rules">{copy.policies}</h2>
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
