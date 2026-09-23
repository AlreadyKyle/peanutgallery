import { Link } from 'react-router-dom';
import { BuildingNow, FundBoard, QueuedList, ShippedList } from '../components/Cards';
import { LedgerSummary } from '../components/LedgerSummary';
import { Meter } from '../components/Meter';
import { RightNow } from '../components/RightNow';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { formatDate } from '../lib/format';
import { legal } from '../lib/legal';
import { useStudio, type StudioState } from '../lib/studio';

// Nothing until the studio row has loaded, so a failed read never says the studio is not live.
function launchLine(studio: StudioState): string | null {
  if (studio.state !== 'ready' || studio.snapshot.missing.includes('studio')) return null;
  const at = studio.snapshot.launchedAt;
  return at === null ? copy.notLiveYet : `${copy.liveSince} ${formatDate(at)}`;
}

// Order: what the studio is and its state right now, then what is building and what to fund (the
// reasons to visit), then what is queued and what has shipped, how it works, the money and the rules.
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
          {launch === null ? null : <p className="muted small">{launch}</p>}
          {env.stripePaymentLinkUrl === '' ? (
            <p>{legal.contributeUnavailable}</p>
          ) : (
            <p>
              <Link className="button" to="/contribute">
                {copy.contribute}
              </Link>
            </p>
          )}
          <p className="muted small">{legal.split}</p>
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

      {studio.state === 'ready' ? <ShippedList snapshot={studio.snapshot} /> : null}

      <section className="section" aria-labelledby="how">
        <h2 id="how">{copy.howItWorks}</h2>
        <ol className="steps">
          {copy.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p>
          <Link to="/how-it-works">{copy.howItWorksMore}</Link>
        </p>
      </section>

      <div className="columns">
        <section className="section" aria-labelledby="funding">
          <h2 id="funding">{legal.meter}</h2>
          <Meter studio={studio} />
        </section>

        <section className="section" aria-labelledby="ledger">
          <h2 id="ledger">{legal.ledger}</h2>
          <LedgerSummary studio={studio} />
          <p>
            <Link to="/ledger">{copy.fullLedger}</Link>
          </p>
        </section>
      </div>

      <section className="section" aria-labelledby="rules">
        <h2 id="rules">{copy.policies}</h2>
        <div className="prose">
          <p>{legal.artPolicy}</p>
          <p>{legal.allAges}</p>
          <p>{legal.fixedRulesIntro}</p>
          <ul className="rules">
            {legal.fixedRules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
