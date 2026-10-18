import { Link } from 'react-router-dom';
import { CoinMark, FundingBar } from '../components/Funding';
import { PageHeader } from '../components/PageHeader';
import { KeepThisCard } from '../components/Perks';
import { ShareCard } from '../components/ShareCard';
import { LinkedText } from '../components/TextPage';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { formatDay, formatInteger } from '../lib/format';
import { legal } from '../lib/legal';
import type { Card, Snapshot } from '../lib/source';
import { useStudio } from '../lib/studio';
import { useThanks, type ThanksAnswer } from '../lib/thanks';

// Kernel (docs/specs/supporter-pages.md): /thanks, where Stripe's redirect lands after a payment. It
// reads private money rows only through thanks_for_session, whose answer holds no amount, email or
// name. Two bands: the thank-you on the signal plate, then where the money went and how to follow
// it on paper.

const words = legal.thanks;
type Recorded = Extract<ThanksAnswer, { status: 'recorded' }>;

const OPEN_STAGES = new Set(['proposed', 'designing', 'voted']);

/** A reached card's one state line, from the stage the live document carries. */
function stateLine(card: Card | undefined, stopped: boolean): string | null {
  if (stopped) return words.stateStopped;
  if (card === undefined) return null;
  if (OPEN_STAGES.has(card.stage)) return words.stateOpen;
  if (card.stage === 'funded') return words.stateFunded;
  if (card.stage === 'building') return words.stateBuilding;
  if (card.stage === 'gated') return words.stateChecks;
  if (card.stage === 'live') return words.stateLive;
  return null;
}

function ReachedRow({ id, snapshot }: { id: string; snapshot: Snapshot | null }) {
  const card = snapshot?.cards.find((c) => c.id === id);
  const stopped = snapshot?.stopped?.find((s) => s.card_id === id);
  const title = card?.title ?? stopped?.title ?? words.cardFallback;
  const line = stateLine(card, stopped !== undefined);
  const open = card !== undefined && OPEN_STAGES.has(card.stage) && card.funding_target_usd > 0;
  return (
    <li data-card={id}>
      <div className="row-body">
        <h3 className="row-title">
          <Link to={`/card/${id}`}>{title}</Link>
        </h3>
        {line === null ? null : <p className="card-meta">{line}</p>}
        {open ? <FundingBar card={card} /> : null}
      </div>
    </li>
  );
}

type Step = (typeof words.nextSteps)[number]['key'];

/** Which step of What happens next a card is on, from its stage; null while it is still open. */
export function currentStep(stage: string | undefined): Step | null {
  if (stage === 'funded') return 'drafting';
  if (stage === 'building') return 'building';
  if (stage === 'gated') return 'gate';
  if (stage === 'live') return 'live';
  return null;
}

/**
 * The reward (docs/specs/supporter-loop.md): the card the money went to first, drawn as a card with
 * the supporter's number on its face, then what happens to it next and its Share button. A payment
 * with no supporter number draws the face without one; nothing here holds an amount, email or name.
 */
function RewardBand({ id, answer, snapshot }: { id: string; answer: Recorded; snapshot: Snapshot | null }) {
  const card = snapshot?.cards.find((c) => c.id === id);
  const stopped = snapshot?.stopped?.find((s) => s.card_id === id);
  const title = card?.title ?? stopped?.title ?? words.cardFallback;
  const line = stateLine(card, stopped !== undefined);
  const now = stopped === undefined ? currentStep(card?.stage) : null;
  return (
    <section className="section thanks-reward" aria-labelledby="reward">
      <h2 id="reward" className="sr-only">
        {words.faceHeading}
      </h2>
      <div className="card thanks-face" data-card={id}>
        {answer.supporter === null ? null : (
          <p className="thanks-number" data-supporter={answer.supporter.number}>
            {words.faceNumber.replace('{n}', formatInteger(answer.supporter.number))}
          </p>
        )}
        <h3>
          <Link to={`/card/${id}`}>{title}</Link>
        </h3>
        {line === null ? null : <p className="card-meta">{line}</p>}
      </div>
      <p className="muted">{words.shareLede}</p>
      <ShareCard title={title} url={`${window.location.origin}/card/${id}`} />
      {stopped === undefined ? (
        <>
          <h3 id="next">{words.nextHeading}</h3>
          <ol className="thanks-next" aria-labelledby="next">
            {words.nextSteps.map((step) => (
              <li key={step.key} data-step={step.key} aria-current={now === step.key ? 'step' : undefined}>
                <strong>{step.label}</strong> {step.body}
                {now === step.key ? <span className="thanks-now"> {words.nextNow}</span> : null}
              </li>
            ))}
          </ol>
          <p data-note="ship-email">{words.shipEmail}</p>
        </>
      ) : null}
    </section>
  );
}

function HomeLinks() {
  const env = siteEnv();
  return (
    <p className="hero-actions">
      <Link className="button" to="/">
        {copy.home}
      </Link>
      {env.stripePaymentLinkUrl === '' ? null : (
        <Link className="button btn-coin" to="/contribute">
          <CoinMark />
          {copy.contribute}
        </Link>
      )}
    </p>
  );
}

/** Follow along: the card's own page, and the Discord invite with its age line. */
function FollowAlong({ cardId }: { cardId: string | null }) {
  const env = siteEnv();
  if (cardId === null && env.discordInvite === '') return null;
  return (
    <section className="section" aria-labelledby="follow">
      <h2 id="follow">{words.followHeading}</h2>
      <p className="hero-actions">
        {cardId === null ? null : (
          <Link className="button" to={`/card/${cardId}`}>
            {words.watchCard}
          </Link>
        )}
        {env.discordInvite === '' ? null : (
          <a className="button button-secondary" href={env.discordInvite}>
            {words.discord}
          </a>
        )}
      </p>
      {env.discordInvite === '' ? null : <p className="muted small">{words.discordAge}</p>}
    </section>
  );
}

function RecordedBody({ answer, snapshot }: { answer: Recorded; snapshot: Snapshot | null }) {
  const reversed = answer.credit === 'reversed';
  const reached = reversed ? [] : answer.reached;
  const watch = answer.namedCardId ?? reached[0] ?? null;
  return (
    <>
      {reversed || watch === null ? null : <RewardBand id={watch} answer={answer} snapshot={snapshot} />}
      {reversed ? null : (
        <section className="section" aria-label={copy.perks.keepTitle}>
          <KeepThisCard />
        </section>
      )}
      <section className="section" aria-labelledby="reached">
        <h2 id="reached">{words.reachedHeading}</h2>
        {reversed ? (
          <p>{words.reversed}</p>
        ) : (
          <>
            {reached.length === 0 ? (
              <p className="muted">{words.reachedNone}</p>
            ) : (
              <>
                <p className="muted">{words.reachedLede}</p>
                <ul className="rows reached">
                  {reached.map((id) => (
                    <ReachedRow key={id} id={id} snapshot={snapshot} />
                  ))}
                </ul>
              </>
            )}
            {answer.credit === 'held' && answer.heldUntil !== null ? (
              <p data-note="held">{words.held.replace('{date}', formatDay(answer.heldUntil))}</p>
            ) : null}
            {answer.waiting ? <p data-note="waiting">{words.waiting}</p> : null}
          </>
        )}
        {answer.termsVersion === null ? null : (
          <p className="muted small" data-note="terms">
            <LinkedText text={words.terms.replace('{n}', formatInteger(answer.termsVersion))} version={answer.termsVersion} />
          </p>
        )}
      </section>
      <FollowAlong cardId={reversed ? null : watch} />
    </>
  );
}

/** Under the Thank you heading: the supporter's number, or nothing for a payment with none. */
function supporterLine(answer: Recorded): string | undefined {
  if (answer.supporter === null) return undefined;
  return words.youAre.replace('{n}', formatInteger(answer.supporter.number));
}

// Every state keeps the signal plate to its title (main.title-stays, styles.css): the page starts
// pending and grows when the answer comes, so a plate that filled the window would move the title.
export function Thanks() {
  const studio = useStudio();
  const state = useThanks();
  const snapshot = studio.state === 'ready' ? studio.snapshot : null;

  if (state.kind === 'pending') {
    return (
      <main className="title-stays sheet">
        <div className="band">
          <PageHeader title={words.recordingTitle} lede={words.recordingLede} />
        </div>
        <div className="band">
          <p className="lede" aria-busy="true" role="status">
            {words.recordingBody}
          </p>
        </div>
      </main>
    );
  }
  if (state.kind === 'recorded') {
    return (
      <main className="title-stays sheet">
        <div className="band">
          <PageHeader title={words.title} lede={supporterLine(state.answer)} />
        </div>
        <div className="band">
          <RecordedBody answer={state.answer} snapshot={snapshot} />
        </div>
      </main>
    );
  }
  // No session, the board's own test payment, or not recorded after three minutes: a plain thank-you.
  return (
    <main className="title-stays sheet">
      <div className="band">
        <PageHeader title={words.title} lede={state.kind === 'fallback' ? words.fallback : words.plainLede} />
      </div>
      <div className="band">
        <HomeLinks />
        {state.kind === 'fallback' ? <FollowAlong cardId={null} /> : null}
      </div>
    </main>
  );
}
