import { Link, useParams } from 'react-router-dom';
import { plannedState } from '../components/Cards';
import { CardFacts, CardStamp, FundAgreement, liveFundLink } from '../components/Funding';
import { FollowCard } from '../components/Follow';
import { Glyph } from '../components/Glyph';
import { NotFound } from '../components/NotFound';
import { PageHeader } from '../components/PageHeader';
import { MoreLink } from '../components/MoreLink';
import { Replay } from '../components/Replay';
import { ShareCard } from '../components/ShareCard';
import { StoppedFacts } from '../components/Stopped';
import { SuggestedBy } from '../components/SuggestedBy';
import { Supporters } from '../components/Supporters';
import { Timeline } from '../components/Timeline';
import { parseChecks, useCardDetail, type CardDetail, type Milestones } from '../lib/card-source';
import { faceOf, isPlanned } from '../lib/cards';
import { changedLines } from '../lib/config-words';
import { copy } from '../lib/copy';
import { SOURCE_PARAM } from '../lib/count';
import { siteEnv } from '../lib/env';
import { formatClock, formatDateTime, formatInteger, shortSha } from '../lib/format';
import { legal } from '../lib/legal';
import { agentsOffline } from '../lib/offline';
import type { Snapshot } from '../lib/source';
import { useStudio } from '../lib/studio';

// A card's own page, /card/:id (docs/specs/supporter-pages.md), in the card lane: its money shows only
// through kernel components (CardFacts, CardStamp, Supporters, StoppedFacts), as home's does. The title on the
// signal plate; then on paper, stacked at the reading measure at every width, the face with Play (or
// a planned card's roadmap state) and Tell me when this ships (docs/specs/card-follows.md), the facts,
// what changed, who suggested it, why it stopped, the supporters and what the agents did. Stacked, because the face and the facts have heights that have nothing to do with
// each other: side by side, one column always ended far above the other (DESIGN.md, No dead space).

const words = copy.cardPage;

const EMPTY: Snapshot = {
  pool: null,
  cards: [],
  funding: {},
  launchedAt: null,
  paused: false,
  totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
  events: [],
  deploys: [],
  roles: [],
  cardTitles: {},
  missing: ['funding', 'roles', 'money'],
};

/** The snapshot the face and the stopped words read, with this card's own funding from its document. */
function withCard(snapshot: Snapshot | null, detail: CardDetail): Snapshot {
  const base = snapshot ?? EMPTY;
  const funding = { ...base.funding };
  if (detail.funding !== null) funding[detail.card.id] = { contributors: detail.funding.contributors, credited_usd: detail.funding.credited_usd };
  return { ...base, funding, missing: base.missing.filter((part) => part !== 'funding') };
}

function minutesBetween(from: string, to: string): number | null {
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? Math.max(1, Math.round(ms / 60_000)) : null;
}

/**
 * A shipped card's time words for its stamp line: "Live 40 minutes after work started, 14:00 to
 * 14:40", in the reader's own time, with the dates when the two fall on different days; null until
 * both a start and a live time are recorded.
 */
export function liveWhen(m: Milestones): string | null {
  if (m.started_at === null || m.live_at === null) return null;
  const minutes = minutesBetween(m.started_at, m.live_at);
  if (minutes === null) return null;
  const start = new Date(m.started_at);
  const live = new Date(m.live_at);
  const sameDay = start.toDateString() === live.toDateString();
  return words.liveAfter
    .replace('{minutes}', minutes === 1 ? words.minutesOne : words.minutesMany.replace('{n}', formatInteger(minutes)))
    .replace('{start}', sameDay ? formatClock(start) : formatDateTime(m.started_at))
    .replace('{live}', sameDay ? formatClock(live) : formatDateTime(m.live_at));
}

/**
 * The build clock on a building or checks card: whole minutes since work started, rounded down,
 * never seconds ("Building, 42 min in"). The page works it out each time it draws, which is on each
 * live poll while the card moves, so it never ticks. Null on any other stage or before work started.
 */
export function buildClock(stage: string, startedAt: string | null, now: number): string | null {
  if ((stage !== 'building' && stage !== 'gated') || startedAt === null) return null;
  const ms = now - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return words.buildClock[stage === 'building' ? 'building' : 'gated'].replace('{n}', formatInteger(Math.floor(ms / 60_000)));
}

/** Dust's address tagged as reached from a card page (`?from=card`); null when the site has no play address. */
export function playFromCard(playUrl: string): string | null {
  if (playUrl === '') return null;
  const url = new URL(playUrl);
  url.searchParams.set(SOURCE_PARAM, 'card');
  return url.toString();
}

/**
 * The card's state line over its facts: a shipped card's stamp (CardStamp, kernel, adds the cost), or
 * a building or checks card's build clock with, on a Dust card, a plain link to play Dust meanwhile.
 * A building card has no Fund button, so the clock never sits beside one. A stopped card has neither.
 * While the agents are offline a building or checks card says so in the clock's place, with no link
 * to play while they work (docs/specs/honest-status.md).
 */
function StateLine({ detail, snapshot }: { detail: CardDetail; snapshot: Snapshot }) {
  const card = detail.card;
  if (detail.stopped !== null) return null;
  if (card.stage === 'live') {
    const when = liveWhen(detail.milestones);
    return when === null ? null : <CardStamp detail={detail} when={when} />;
  }
  if ((card.stage === 'building' || card.stage === 'gated') && agentsOffline(snapshot)) {
    return (
      <p className="card-state" data-fact="offline">
        {copy.agentsOffline}
      </p>
    );
  }
  const clock = buildClock(card.stage, detail.milestones.started_at, Date.now());
  if (clock === null) return null;
  const play = card.folder === 'seed-1' ? playFromCard(siteEnv().playUrl) : null;
  return (
    <>
      <p className="card-state" data-fact="clock">
        {clock}
      </p>
      {play === null ? null : (
        <p className="more card-play-while">
          <a href={play}>{words.playWhileBuilding}</a>
        </p>
      )}
    </>
  );
}

/**
 * Whether the face drawn at the top of the page shows the card's spec rows (Funded, Contributors):
 * an open, picked or funded card with a target (Funding.tsx CardMoney). The facts then leave them out.
 */
function faceShowsSpecRows(detail: CardDetail): boolean {
  const card = detail.card;
  if (isPlanned(card) || card.funding_target_usd <= 0) return false;
  if (detail.stopped !== null) return detail.stopped.stage === 'paused' && card.stage !== 'building' && card.stage !== 'gated';
  const face = faceOf(card);
  return face === 'open' || face === 'picked' || face === 'funded';
}

function Facts({ detail, snapshot }: { detail: CardDetail; snapshot: Snapshot }) {
  const m = detail.milestones;
  const sha = detail.card.commit_sha;
  return (
    <section className="section" aria-labelledby="card-facts">
      <h2 id="card-facts">{words.factsHeading}</h2>
      <StateLine detail={detail} snapshot={snapshot} />
      <CardFacts detail={detail} onFace={faceShowsSpecRows(detail)}>
        {m.gate_at === null || m.gate === null ? null : (
          <div data-fact="gate">
            <dt>{words.gate}</dt>
            <dd>{(m.gate === 'passed' ? words.gatePassed : words.gateFailed).replace('{time}', formatDateTime(m.gate_at))}</dd>
          </div>
        )}
      </CardFacts>
      {sha === null ? null : (
        <p className="card-meta" data-fact="commit">
          {words.merged.split('{sha}')[0]}
          <code>{shortSha(sha)}</code>
          {words.merged.split('{sha}')[1]}
        </p>
      )}
    </section>
  );
}

/** What changed on a live config card: each value the gate checked, from its public acceptance_test. */
function Changed({ detail }: { detail: CardDetail }) {
  if (detail.card.stage !== 'live') return null;
  const checks = parseChecks(detail.card.acceptance_test);
  if (checks.length === 0) return null;
  const { lines, rest } = changedLines(checks);
  return (
    <section className="section" aria-labelledby="card-changed">
      <h2 id="card-changed">{words.changedHeading}</h2>
      <p className="muted">{words.changedLede}</p>
      {lines.length === 0 ? null : (
        <ul className="rows what-changed">
          {lines.map((line, index) => (
            <li key={index} data-plain="true">
              {line}
            </li>
          ))}
        </ul>
      )}
      {rest === null ? null : <p className="muted what-changed-rest">{rest}</p>}
    </section>
  );
}

/**
 * A planned card (next or later, not started) takes no money, so its page draws no face (which would
 * read Open for funding): it says "Planned and not built yet", "Approved, opens soon" or "Held by the
 * board" with the board's reason, and links home's cards to fund.
 */
function Planned({ detail }: { detail: CardDetail }) {
  const state = plannedState(detail.card);
  return (
    <div className="card-planned" data-planned={detail.card.id}>
      <p className="lede">{state.label}</p>
      {state.reason === null ? null : <p className="muted">{state.reason}</p>}
      <p className="more">
        <Link to="/">{copy.roadmapLink}</Link>
      </p>
    </div>
  );
}

function Detail({ detail, snapshot }: { detail: CardDetail; snapshot: Snapshot }) {
  return (
    <>
      {/* From 64rem the face stays in view in its own column while the facts scroll beside it, so its
          height is not meant to match theirs (DESIGN.md, No dead space). */}
      <section className="card-face-column" aria-labelledby="card-face" data-balance="ignore">
        <h2 id="card-face" className="sr-only">
          {words.cardHeading}
        </h2>
        {detail.stopped === null && isPlanned(detail.card) ? <Planned detail={detail} /> : <Replay detail={detail} snapshot={snapshot} />}
        {liveFundLink(detail.card, snapshot) ? <FundAgreement /> : null}
        <FollowCard cardId={detail.card.id} stage={detail.card.stage} />
        {liveFundLink(detail.card, snapshot) ? (
          <p className="more">
            <MoreLink to="/contribute#perks-title">{legal.perks.link}</MoreLink>
          </p>
        ) : null}
      </section>
      <Facts detail={detail} snapshot={snapshot} />
      <Changed detail={detail} />
      <SuggestedBy cardId={detail.card.id} />
      {detail.stopped === null ? null : (
        <section className="section" aria-labelledby="card-stopped">
          <h2 id="card-stopped">{words.stoppedHeading}</h2>
          <div className="stopped-facts">
            <StoppedFacts card={detail.stopped} snapshot={snapshot} />
          </div>
        </section>
      )}
      <section className="section" aria-labelledby="card-supporters">
        <h2 id="card-supporters">{legal.supportersHeading}</h2>
        {detail.supporter_count === 0 ? null : <p className="muted">{legal.supportersLede}</p>}
        <Supporters supporters={detail.supporters} count={detail.supporter_count} />
      </section>
      <section className="section" aria-labelledby="card-lines">
        <h2 id="card-lines">{words.linesHeading}</h2>
        {detail.lines.length === 0 ? null : <p className="muted">{words.linesLede}</p>}
        <Timeline lines={detail.lines} count={detail.line_count} roles={detail.roles} team={snapshot.roles} />
      </section>
      {/* What the agents are told: on the card's own page only, not on every card (the board, 27 Sep 2026). */}
      {detail.card.intent === null || detail.card.intent.trim() === '' ? null : (
        <section className="section" aria-labelledby="card-brief">
          <h2 id="card-brief">{copy.agentBrief}</h2>
          {/* Closed by default: a brief can name files and fields, which most readers do not need. */}
          <details className="card-brief">
            <summary>{copy.agentBriefOpen}</summary>
            <p>{detail.card.intent}</p>
          </details>
        </section>
      )}
    </>
  );
}

export function CardPage() {
  const { id = '' } = useParams();
  const studio = useStudio();
  const state = useCardDetail(id);
  const snapshot = studio.state === 'ready' ? studio.snapshot : null;
  if (state.state === 'not-found') return <NotFound body={words.notFound} />;
  const known = snapshot?.cards.find((card) => card.id === id.toLowerCase());
  const title = state.state === 'ready' ? state.detail.card.title : (known?.title ?? words.cardTitle);
  // Whether a face under the plate says the title: on a phone the plate then keeps only the back link
  // and Share (styles.css), so the face and its Fund this card come into the first screen. A planned
  // card draws no face, and a card that did not load has none.
  const faceTitled =
    state.state === 'loading' ? known === undefined || !isPlanned(known) : state.state === 'ready' && !(state.detail.stopped === null && isPlanned(state.detail.card));
  // The body arrives after first paint, so the signal plate never grows to fill a short window: the
  // title renders once, where it stays, and the paper band takes the height left over (styles.css).
  // The plate carries no lede: the face under it says the summary, and a short plate puts the face's
  // Fund this card in view when the page opens (docs/specs/brand.md, the second review).
  return (
    <main className={faceTitled ? 'title-stays card-page face-titled' : 'title-stays card-page'}>
      <div className="band">
        <p className="back">
          <Link className="target" to="/#fund">
            <Glyph name="arrow-left" />
            {words.back}
          </Link>
        </p>
        <PageHeader title={title} />
        {state.state === 'ready' ? (
          <ShareCard title={title} url={`${window.location.origin}/card/${state.detail.card.id}`} />
        ) : state.state === 'loading' ? (
          // The share line's room while the card loads, so the body below does not drop when it arrives.
          <p className="share-card" aria-hidden="true">
            <span className="share-card-room" />
          </p>
        ) : null}
      </div>
      <div className="band">
        {state.state === 'loading' ? (
          <p className="muted" aria-busy="true">
            {words.loading}
          </p>
        ) : state.state === 'error' ? (
          <p className="muted">{legal.cardUnavailable}</p>
        ) : (
          <Detail detail={state.detail} snapshot={withCard(snapshot, state.detail)} />
        )}
      </div>
    </main>
  );
}
