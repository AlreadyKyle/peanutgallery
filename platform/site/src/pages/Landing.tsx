import { Link } from 'react-router-dom';
import { BuildingNow, FundBoard, QueuedList } from '../components/Cards';
import { LedgerSummary } from '../components/LedgerSummary';
import { Meter } from '../components/Meter';
import { RightNow } from '../components/RightNow';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { formatDate } from '../lib/format';
import { useStudio, type StudioState } from '../lib/studio';

function launchLine(studio: StudioState): string | null {
  if (studio.state !== 'ready') return null;
  const at = studio.snapshot.launchedAt;
  return at === null ? copy.notLiveYet : `${copy.liveSince} ${formatDate(at)}`;
}

// Order: what the studio is and its state right now, then what is building and what to fund (the
// reasons to visit), then what is queued, how it works, the money and the rules.
export function Landing() {
  const env = siteEnv();
  const studio = useStudio();
  const launch = launchLine(studio);
  return (
    <main className="wide">
      <div className="intro">
        <div className="hero">
          <h1>{copy.pitchTitle}</h1>
          <p className="lede">{copy.pitchBody}</p>
          {launch === null ? null : <p className="muted">{launch}</p>}
          {env.stripePaymentLinkUrl === '' ? (
            <p>{copy.contributeUnavailable}</p>
          ) : (
            <p>
              <Link className="button" to="/contribute">
                {copy.contribute}
              </Link>
            </p>
          )}
          <p className="muted small">{copy.split}</p>
        </div>
        <RightNow studio={studio} />
      </div>

      {studio.state === 'ready' ? <BuildingNow snapshot={studio.snapshot} /> : null}

      <section className="section" aria-labelledby="fund">
        <h2 id="fund">{copy.fund}</h2>
        <p className="muted">{copy.fundIntro}</p>
        <FundBoard studio={studio} />
      </section>

      {studio.state === 'ready' ? <QueuedList snapshot={studio.snapshot} /> : null}

      <section className="section" aria-labelledby="how">
        <h2 id="how">{copy.howItWorks}</h2>
        <ol className="steps">
          {copy.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <div className="columns">
        <section className="section" aria-labelledby="funding">
          <h2 id="funding">{copy.meter}</h2>
          <Meter studio={studio} />
        </section>

        <section className="section" aria-labelledby="ledger">
          <h2 id="ledger">{copy.ledger}</h2>
          <LedgerSummary studio={studio} events={false} />
          <p>
            <Link to="/ledger">{copy.fullLedger}</Link>
          </p>
        </section>
      </div>

      <section className="section" aria-labelledby="rules">
        <h2 id="rules">{copy.policies}</h2>
        <div className="prose">
          <p>{copy.artPolicy}</p>
          <p>{copy.allAges}</p>
          <p>{copy.fixedRulesIntro}</p>
          <ul className="rules">
            {copy.fixedRules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
