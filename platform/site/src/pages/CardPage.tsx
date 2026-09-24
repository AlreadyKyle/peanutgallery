import { Link, useParams } from 'react-router-dom';
import { plannedState } from '../components/Cards';
import { CardFacts } from '../components/Funding';
import { Glyph } from '../components/Glyph';
import { NotFound } from '../components/NotFound';
import { PageHeader } from '../components/PageHeader';
import { Replay } from '../components/Replay';
import { StoppedFacts } from '../components/Stopped';
import { Supporters } from '../components/Supporters';
import { Timeline } from '../components/Timeline';
import { parseChecks, useCardDetail, type CardDetail } from '../lib/card-source';
import { faceOf, isPlanned } from '../lib/cards';
import { copy } from '../lib/copy';
import { formatDateTime, formatInteger, shortSha } from '../lib/format';
import { legal } from '../lib/legal';
import type { Snapshot } from '../lib/source';
import { useStudio } from '../lib/studio';

// A card's own page, /card/:id (docs/specs/supporter-pages.md), in the card lane: its money shows only
// through kernel components (CardFacts, Supporters, StoppedFacts), as home's does. The title on the
// signal plate; then on paper, stacked at the reading measure at every width, the face with Play (or
// a planned card's roadmap state), the facts, what changed, why it stopped, the supporters and what
// the agents did. Stacked, because the face and the facts have heights that have nothing to do with
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

function Facts({ detail }: { detail: CardDetail }) {
  const m = detail.milestones;
  const minutes = m.started_at !== null && m.live_at !== null ? minutesBetween(m.started_at, m.live_at) : null;
  const sha = detail.card.commit_sha;
  return (
    <section className="section" aria-labelledby="card-facts">
      <h2 id="card-facts">{words.factsHeading}</h2>
      <CardFacts detail={detail} onFace={faceShowsSpecRows(detail)}>
        {minutes === null ? null : (
          <div data-fact="time">
            <dt>{words.timeToLive}</dt>
            <dd>{minutes === 1 ? words.minutesOne : words.minutesMany.replace('{n}', formatInteger(minutes))}</dd>
          </div>
        )}
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
  return (
    <section className="section" aria-labelledby="card-changed">
      <h2 id="card-changed">{words.changedHeading}</h2>
      <p className="muted">{words.changedLede}</p>
      <ul className="rows what-changed">
        {checks.map((check) => (
          <li key={`${check.file} ${check.path}`}>
            <code>
              {words.changedValue.replace('{file}', check.file).replace('{path}', check.path).replace('{value}', check.value ?? words.changed)}
            </code>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A card on the roadmap (next or later, not started) takes no money, so its page draws no face (which
 * would read Open for funding): it says what /roadmap says, "Planned and not built yet", "Approved,
 * opens soon" or "Held by the board" with the board's reason, and links the roadmap.
 */
function Planned({ detail }: { detail: CardDetail }) {
  const state = plannedState(detail.card);
  return (
    <div className="card-planned" data-planned={detail.card.id}>
      <p className="lede">{state.label}</p>
      {state.reason === null ? null : <p className="muted">{state.reason}</p>}
      <p className="more">
        <Link to="/roadmap">{copy.roadmapLink}</Link>
      </p>
    </div>
  );
}

function Detail({ detail, snapshot }: { detail: CardDetail; snapshot: Snapshot }) {
  return (
    <>
      {detail.stopped === null && isPlanned(detail.card) ? <Planned detail={detail} /> : <Replay detail={detail} snapshot={snapshot} />}
      <Facts detail={detail} />
      <Changed detail={detail} />
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
        <Timeline lines={detail.lines} count={detail.line_count} roles={detail.roles} />
      </section>
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
  const summary = state.state === 'ready' ? state.detail.card.summary : null;
  // The body arrives after first paint, so the signal plate never grows to fill a short window: the
  // title renders once, where it stays, and the paper band takes the height left over (styles.css).
  return (
    <main className="title-stays">
      <div className="band">
        <p className="back">
          <Link className="target" to="/">
            <Glyph name="arrow-left" />
            {words.back}
          </Link>
        </p>
        <PageHeader title={title} lede={summary === null || summary.trim() === '' ? undefined : summary} />
      </div>
      <div className="band">
        {state.state === 'loading' ? (
          <p className="muted" aria-busy="true">
            {words.loading}
          </p>
        ) : state.state === 'error' ? (
          <p className="muted">{words.unavailable}</p>
        ) : (
          <Detail detail={state.detail} snapshot={withCard(snapshot, state.detail)} />
        )}
      </div>
    </main>
  );
}
