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
      <h1>{copy.studioName}</h1>
      <p className="pitch">{copy.pitch}</p>
      <p className="launch">{launchLine(env.launchAt)}</p>

      <section aria-label="Contribute">
        {env.stripePaymentLinkUrl === '' ? (
          <p>{copy.contributeUnavailable}</p>
        ) : (
          <a className="button" href={env.stripePaymentLinkUrl}>
            {copy.contribute}
          </a>
        )}
        <p>{copy.split}</p>
      </section>

      <section aria-label="Meter">
        <h2>Meter</h2>
        <Meter studio={studio} />
      </section>

      <section aria-label="Ledger">
        <h2>Ledger</h2>
        <LedgerSummary studio={studio} />
      </section>

      <section aria-label="Sprint goals">
        <h2>Build 1</h2>
        <GoalBars studio={studio} />
        <p>{copy.preLaunch}</p>
      </section>

      <section aria-label="Policies">
        <p>{copy.artPolicy}</p>
        <p>{copy.allAges}</p>
        <p>{copy.kernel}</p>
      </section>

      {env.discordInvite === '' ? null : (
        <p>
          <a href={env.discordInvite}>{copy.discord}</a>
        </p>
      )}

      <footer>
        <p>{copy.footer}</p>
      </footer>
    </main>
  );
}
