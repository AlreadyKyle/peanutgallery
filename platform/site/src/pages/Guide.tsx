import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { CardFace } from '../components/Card';
import { FilterChip } from '../components/Cards';
import { CoinMark, FundingBar, type SpecRow } from '../components/Funding';
import { Glyph, STATE_TAGS, SUITS, type GlyphName } from '../components/Glyph';
import { LiveUpdates } from '../components/LiveUpdates';
import { PageHeader } from '../components/PageHeader';
import { FACES, type CategoryFilter, type Face } from '../lib/cards';
import { contrast } from '../lib/contrast';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { formatDateTime, formatUsd, percent } from '../lib/format';
import { legal } from '../lib/legal';
import { deal, flip, fundTick, slam } from '../lib/motion';
import { runsCards } from '../lib/roster';
import type { Card, Role, Snapshot } from '../lib/source';
import { useStudio } from '../lib/studio';

// The design guide: an unlisted page (routes.tsx gives it a path and no top bar link; it asks search
// engines not to index it) that shows every part of the design system with the real components. It
// is the design-system pull request's mockup (DESIGN.md, Mockups). Everything made up for it is
// marked Sample; the team strip draws the real roles from the snapshot.

const guide = copy.guide;
export const GUIDE_PATH = '/design-kit-7q4m';

/** Ask search engines not to index this page, for as long as it is open. */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

function Sample() {
  return <span className="sample-label">{guide.sample}</span>;
}

const NOW = Date.now();
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

function sampleCard(id: string, fields: Partial<Card>): Card {
  return {
    id,
    title: '',
    summary: null,
    intent: null,
    source: 'board',
    stage: 'proposed',
    shape: 'goal',
    bucket: 'game',
    folder: 'seed-1',
    horizon: 'now',
    rank: null,
    executor_role_id: null,
    funding_target_usd: 1.5,
    funded_usd: 0,
    spent_usd: 0,
    created_at: iso(600),
    updated_at: iso(60),
    live_at: null,
    ...fields,
  };
}

const SAMPLE_BUILDER: Role = {
  id: 'sample-builder',
  name: guide.cards.builder,
  title: guide.cards.builder,
  description: null,
  species_note: '',
  model: '',
  write_access: true,
  state: 'active',
  hired_at: iso(6000),
};

const c = guide.cards;
const FACE_CARDS: Record<Face, Card> = {
  open: sampleCard('sample-open', { ...c.open, funded_usd: 0.4 }),
  picked: sampleCard('sample-picked', { ...c.picked, stage: 'voted', funding_target_usd: 3, funded_usd: 0.9 }),
  funded: sampleCard('sample-funded', { ...c.funded, stage: 'funded', funded_usd: 1.5 }),
  building: sampleCard('sample-building', { ...c.building, stage: 'building', spent_usd: 0.42, executor_role_id: SAMPLE_BUILDER.id }),
  checks: sampleCard('sample-checks', { ...c.checks, stage: 'gated', spent_usd: 0.61, executor_role_id: SAMPLE_BUILDER.id }),
  live: sampleCard('sample-live', { ...c.live, stage: 'live', shape: 'oneoff', funding_target_usd: 0, spent_usd: 0.24, live_at: iso(90) }),
  paused: sampleCard('sample-paused', { ...c.paused, shape: 'oneoff', funded_usd: 0.75 }),
  rejected: sampleCard('sample-rejected', { ...c.rejected, folder: 'platform', bucket: 'studio', shape: 'oneoff', funding_target_usd: 0 }),
};

function sampleSnapshot(cards: Card[], contributors: Record<string, number>): Snapshot {
  return {
    pool: null,
    cards,
    funding: Object.fromEntries(Object.entries(contributors).map(([id, n]) => [id, { contributors: n, credited_usd: 0 }])),
    launchedAt: null,
    paused: true,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles: [SAMPLE_BUILDER],
    cardTitles: {},
    missing: [],
  };
}

const FACE_SNAPSHOT = sampleSnapshot(Object.values(FACE_CARDS), {
  'sample-open': 2,
  'sample-picked': 3,
  'sample-funded': 4,
  'sample-live': 2,
  'sample-paused': 3,
});

// ---------------------------------------------------------------- tokens, measured on the page

type Pair = { fg: string; bg: string; min: number; kind: 'text' | 'edge' };

const PAPER_PAIRS: Pair[] = [
  { fg: '--ink', bg: '--paper', min: 7, kind: 'text' },
  { fg: '--muted', bg: '--paper', min: 4.5, kind: 'text' },
  { fg: '--ink', bg: '--work', min: 7, kind: 'text' },
  { fg: '--muted', bg: '--work', min: 4.5, kind: 'text' },
  { fg: '--ink', bg: '--coin', min: 7, kind: 'text' },
  { fg: '--ink', bg: '--paper-hover', min: 7, kind: 'text' },
  { fg: '--field', bg: '--paper', min: 3, kind: 'edge' },
  { fg: '--field', bg: '--work', min: 3, kind: 'edge' },
  { fg: '--coin', bg: '--paper', min: 0, kind: 'edge' },
  { fg: '--line', bg: '--paper', min: 0, kind: 'edge' },
];

const INK_PAIRS: Pair[] = [
  { fg: '--paper', bg: '--ink', min: 7, kind: 'text' },
  { fg: '--muted-on-ink', bg: '--ink', min: 4.5, kind: 'text' },
  { fg: '--muted-on-ink', bg: '--ink-hover', min: 4.5, kind: 'text' },
  { fg: '--paper', bg: '--ink-hover', min: 7, kind: 'text' },
  { fg: '--field', bg: '--ink', min: 3, kind: 'edge' },
  { fg: '--coin', bg: '--ink', min: 3, kind: 'edge' },
  { fg: '--coin-down', bg: '--ink', min: 3, kind: 'edge' },
  { fg: '--line-on-ink', bg: '--ink', min: 0, kind: 'edge' },
];

/** The tokens' values as the page has them, read once it has rendered. */
function useTokenValues(names: readonly string[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    setValues(Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()])));
    // The names are fixed lists.
  }, []);
  return values;
}

const ALL_TOKENS = [...new Set([...PAPER_PAIRS, ...INK_PAIRS].flatMap((pair) => [pair.fg, pair.bg]))];

function Swatches({ pairs, values }: { pairs: Pair[]; values: Record<string, string> }) {
  return (
    <ul className="swatches">
      {pairs.map((pair) => {
        const fg = values[pair.fg] ?? '';
        const bg = values[pair.bg] ?? '';
        const measured = /^#[0-9a-f]{6}$/i.test(fg) && /^#[0-9a-f]{6}$/i.test(bg) ? contrast(fg, bg).toFixed(2) : '';
        const chip: CSSProperties =
          pair.kind === 'text'
            ? { background: `var(${pair.bg})`, color: `var(${pair.fg})`, borderColor: 'var(--field)' }
            : { background: `var(${pair.bg})`, borderColor: 'var(--field)' };
        return (
          <li key={`${pair.fg}-${pair.bg}`} className="swatch">
            <div className="swatch-chip" style={chip}>
              {pair.kind === 'text' ? guide.specimen : <span className="swatch-edge" style={{ borderColor: `var(${pair.fg})` }} />}
            </div>
            <dl>
              <dt>
                <code>{pair.fg}</code> {pair.kind === 'text' ? guide.on : guide.against} <code>{pair.bg}</code>
              </dt>
              <dd>
                {fg} / {bg}
              </dd>
              <dd>
                <strong className="figure">{measured}</strong>
                 ({pair.min > 0 ? guide.atLeast.replace('{n}', String(pair.min)) : guide.decorative})
              </dd>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- band 1: on ink

function PlayDust() {
  const env = siteEnv();
  const inner = (
    <>
      <Glyph name="cartridge" />
      {copy.play} {copy.categories.game}
    </>
  );
  return env.playUrl === '' ? (
    <button type="button" className="button" aria-disabled="true">
      {inner}
    </button>
  ) : (
    <a className="button" href={env.playUrl}>
      {inner}
    </a>
  );
}

function LiveUpdatesDemo() {
  const [count, setCount] = useState(0);
  const [paused, setPaused] = useState(false);
  return (
    <>
      <LiveUpdates count={count} paused={paused} onTogglePause={() => setPaused((p) => !p)} onShow={() => setCount(0)} />
      <p className="cluster">
        <button type="button" className="button button-secondary" onClick={() => setCount((n) => n + 3)}>
          {guide.liveDemo}
        </button>
        <Sample />
      </p>
    </>
  );
}

function SampleRows() {
  return (
    <ul className="rows">
      <li className="changed">
        <span className="row-time">{formatDateTime(iso(5))}</span>
        <span>
          {c.builder} {legal.eventVerbs.ship}
        </span>
      </li>
      <li>
        <span className="row-time">{formatDateTime(iso(9))}</span>
        <span>
          {c.builder} {legal.eventVerbs.gate_pass}
        </span>
      </li>
    </ul>
  );
}

function PoolLine() {
  return (
    <p className="pool-line with-glyph">
      <CoinMark />
      <span className="figure">{formatUsd(0.5)}</span> {legal.poolBalance.toLowerCase()} <Sample />
    </p>
  );
}

function ContributeLink() {
  return (
    <Link className="button btn-coin" to="/contribute">
      <CoinMark />
      {copy.contribute}
    </Link>
  );
}

function InkBand({ values, studio }: { values: Record<string, string>; studio: ReturnType<typeof useStudio> }) {
  const role = studio.state === 'ready' ? studio.snapshot.roles.find((r) => runsCards(r)) : undefined;
  return (
    <div className="band">
      <PageHeader title={guide.title} lede={guide.lede} />
      <section className="section" aria-labelledby="guide-ink">
        <h2 id="guide-ink">{guide.onInk}</h2>
        <p>{guide.onInkIntro}</p>
        <div className="guide-grid">
          <div className="demo">
            <p className="cluster">
              <PlayDust />
              <Link to="/how-it-works">{copy.howItWorks}</Link>
            </p>
            <p className="caption">{guide.primaryNote}</p>
            <LiveUpdatesDemo />
            <p className="caption">
              {guide.outlineNote} {guide.pressedNote}
            </p>
            <p className="cluster">
              <ContributeLink />
            </p>
            <PoolLine />
            <p className="caption">{guide.coinNote}</p>
          </div>
          <div className="demo">
            <h3>{guide.statusHeading}</h3>
            <p className="status-line is-paused">
              <span>
                <strong>{guide.statusFigure}</strong> {guide.statusRest}
              </span>
            </p>
            <p>
              <Sample />
            </p>
            <p className="notice">{legal.pausedNotice}</p>
            <p className="caption">{guide.noticeNote}</p>
            <h3>{guide.focusHeading}</h3>
            <p className="caption">{guide.focusIntro}</p>
            <h3>{guide.rowsHeading}</h3>
            <SampleRows />
            <p className="caption">
              {guide.rowsIntro} <Sample />
            </p>
            <h3>{guide.markHeading}</h3>
            <p className="cluster">
              <img className="mark" src="/peanut.png" alt="" width={48} height={48} />
              {role === undefined ? null : <Avatar note={role.species_note} size={72} />}
            </p>
            <p className="caption">{guide.markNote}</p>
          </div>
        </div>
      </section>
      <section className="section" aria-labelledby="guide-ink-tokens">
        <h2 id="guide-ink-tokens">{guide.tokensHeading}</h2>
        <p>{guide.tokensIntro}</p>
        <Swatches pairs={INK_PAIRS} values={values} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- band 2: paper, the cards

function FaceGallery() {
  return (
    <section className="section" aria-labelledby="guide-cards">
      <h2 id="guide-cards">{guide.cardsHeading}</h2>
      <p>{guide.cardsIntro}</p>
      <div className="face-grid">
        {FACES.map((face) => (
          <figure key={face} className="demo">
            <ul className="card-grid">
              <CardFace
                card={FACE_CARDS[face]}
                snapshot={FACE_SNAPSHOT}
                mode="sample"
                face={face === 'paused' || face === 'rejected' ? face : undefined}
                stamp={face === 'live'}
                reason={face === 'rejected' ? c.reason : undefined}
              />
            </ul>
            <figcaption className="caption">
              {guide.faces[face]} <Sample />
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function Bars() {
  return (
    <section className="section" aria-labelledby="guide-bar">
      <h2 id="guide-bar">{guide.barHeading}</h2>
      <p>{guide.barIntro}</p>
      <div className="bar-samples">
        {[5, 50, 100].map((share) => (
          <div key={share} className="bar-sample">
            <span className="with-glyph">
              <Sample /> <span className="figure">{`${share}%`}</span>
            </span>
            <FundingBar card={sampleCard(`bar-${share}`, { title: `${guide.sample} ${share}%`, funding_target_usd: 100, funded_usd: share })} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Coin() {
  return (
    <section className="section" aria-labelledby="guide-coin">
      <h2 id="guide-coin">{guide.coinHeading}</h2>
      <p>{guide.coinIntro}</p>
      <div className="cluster">
        <span className="coin-large">
          <CoinMark />
        </span>
        <PoolLine />
        <ContributeLink />
      </div>
    </section>
  );
}

const STATE_ORDER: readonly Face[] = FACES;
const ARROWS: readonly GlyphName[] = ['arrow-right', 'arrow-left', 'arrow-up', 'arrow-down'];

function Glyphs() {
  return (
    <section className="section" aria-labelledby="guide-glyphs">
      <h2 id="guide-glyphs">{guide.glyphsHeading}</h2>
      <p>{guide.glyphsIntro}</p>
      <ul className="glyph-list">
        {STATE_ORDER.map((face) => (
          <li key={face} className="with-glyph">
            <Glyph name={STATE_TAGS[face].glyph} />
            {STATE_TAGS[face].word}
          </li>
        ))}
        <li className="with-glyph">
          <Glyph name="check" />
          {guide.pressedGlyph}
        </li>
        <li className="with-glyph">
          {ARROWS.map((name) => (
            <Glyph key={name} name={name} />
          ))}
          {guide.arrows}
        </li>
      </ul>
    </section>
  );
}

function Suits() {
  const [pressed, setPressed] = useState<CategoryFilter>('all');
  const counts: Record<CategoryFilter, number> = { all: 7, game: 6, studio: 1 };
  return (
    <section className="section" aria-labelledby="guide-suits">
      <h2 id="guide-suits">{guide.suitsHeading}</h2>
      <p>{guide.suitsIntro}</p>
      <ul className="glyph-list">
        {(['game', 'studio'] as const).map((suit) => (
          <li key={suit} className="with-glyph">
            <Glyph name={SUITS[suit].glyph} />
            {SUITS[suit].label}
          </li>
        ))}
      </ul>
      <div className="filters" role="group" aria-label={copy.filterLabel}>
        {(['all', 'game', 'studio'] as const).map((option) => (
          <FilterChip key={option} option={option} count={counts[option]} pressed={pressed === option} onPress={() => setPressed(option)} />
        ))}
      </div>
      <p className="caption">
        {guide.chipsNote} <Sample />
      </p>
    </section>
  );
}

function PaperButtons() {
  return (
    <section className="section" aria-labelledby="guide-buttons">
      <h2 id="guide-buttons">{guide.buttonsHeading}</h2>
      <div className="cluster">
        <PlayDust />
        <button type="button" className="button button-secondary">
          {copy.pauseLiveUpdates}
        </button>
        <button type="button" className="button button-secondary" aria-pressed="true">
          <Glyph name="check" />
          {copy.pauseLiveUpdates}
        </button>
        <button type="button" className="button button-quiet" aria-disabled="true">
          {copy.upToDate}
        </button>
        <ContributeLink />
        <Link to="/how-it-works">{copy.howItWorks}</Link>
      </div>
    </section>
  );
}

function States() {
  return (
    <section className="section" aria-labelledby="guide-states">
      <h2 id="guide-states">{guide.statesHeading}</h2>
      <p className="muted">{copy.fundEmpty}</p>
      <p className="muted" aria-busy="true">
        {copy.loadingCards}
      </p>
      <p className="muted">{legal.partUnavailable}</p>
      <p className="muted small">{legal.staleFigures}</p>
    </section>
  );
}

// ---------------------------------------------------------------- motion demos

/** One sample card in a list the demo can reach, with the demo's Play button under it. */
function DemoCard({ children, listRef }: { children: ReactNode; listRef: RefObject<HTMLUListElement | null> }) {
  return (
    <ul className="card-grid" ref={listRef}>
      {children}
    </ul>
  );
}

const firstCard = (list: HTMLUListElement | null) => list?.querySelector<HTMLElement>('li.card') ?? null;

function DealDemo() {
  const [round, setRound] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    if (round > 0 && list.current !== null) deal([...list.current.querySelectorAll<HTMLElement>('li.card')]);
  }, [round]);
  const cards = [FACE_CARDS.open, FACE_CARDS.picked].map((card) => ({ ...card, id: `${card.id}-deal-${round}`, summary: null }));
  return (
    <div className="demo">
      <p className="cluster">
        <button type="button" className="button" onClick={() => setRound((r) => r + 1)}>
          {guide.playDeal}
        </button>
        <Sample />
      </p>
      <p className="caption">{guide.dealNote}</p>
      <DemoCard listRef={list}>
        {cards.map((card) => (
          <CardFace key={card.id} card={card} snapshot={sampleSnapshot(cards, {})} mode="sample" />
        ))}
      </DemoCard>
    </div>
  );
}

function FundTickDemo() {
  const [funded, setFunded] = useState(0.75);
  const [changed, setChanged] = useState<SpecRow[]>([]);
  const from = useRef(funded);
  const list = useRef<HTMLUListElement>(null);
  const card = sampleCard('sample-tick', { ...c.paused, funded_usd: funded });
  useLayoutEffect(() => {
    if (from.current === funded) return;
    fundTick(list.current?.querySelector<HTMLElement>('.funding-bar-fill') ?? null, percent(from.current, 1.5), percent(funded, 1.5));
    from.current = funded;
  }, [funded]);
  return (
    <div className="demo">
      <p className="cluster">
        <button
          type="button"
          className="button"
          onClick={() => {
            setFunded((f) => (f < 1 ? 1.25 : 0.75));
            setChanged(['funded']);
          }}
        >
          {guide.playFundTick}
        </button>
        <Sample />
      </p>
      <p className="caption">{guide.fundTickNote}</p>
      <DemoCard listRef={list}>
        <CardFace card={card} snapshot={sampleSnapshot([card], { 'sample-tick': 3 })} mode="sample" changed={changed} />
      </DemoCard>
    </div>
  );
}

function FlipDemo() {
  const [done, setDone] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const card = done ? { ...FACE_CARDS.funded, id: 'sample-flip' } : sampleCard('sample-flip', { ...c.funded, funded_usd: 1.2 });
  return (
    <div className="demo">
      <p className="cluster">
        <button type="button" className="button" onClick={() => void flip(firstCard(list.current), () => setDone((d) => !d))}>
          {guide.playFlip}
        </button>
        <Sample />
      </p>
      <p className="caption">
        {guide.flipNote} {guide.flipBackNote}
      </p>
      <DemoCard listRef={list}>
        <CardFace card={card} snapshot={sampleSnapshot([card], { 'sample-flip': done ? 4 : 3 })} mode="sample" />
      </DemoCard>
    </div>
  );
}

function SlamDemo() {
  const list = useRef<HTMLUListElement>(null);
  return (
    <div className="demo">
      <p className="cluster">
        <button type="button" className="button" onClick={() => slam(firstCard(list.current))}>
          {guide.playSlam}
        </button>
        <Sample />
      </p>
      <p className="caption">{guide.slamNote}</p>
      <DemoCard listRef={list}>
        <CardFace card={FACE_CARDS.live} snapshot={FACE_SNAPSHOT} mode="sample" stamp />
      </DemoCard>
    </div>
  );
}

function PaperBand({ values }: { values: Record<string, string> }) {
  return (
    <div className="band">
      <FaceGallery />
      <Bars />
      <div className="guide-grid">
        <Coin />
        <Glyphs />
        <Suits />
        <PaperButtons />
      </div>
      <section className="section" aria-labelledby="guide-live">
        <h2 id="guide-live">{guide.liveHeading}</h2>
        <p>{guide.liveIntro}</p>
        <p className="caption">{guide.focusIntro}</p>
      </section>
      <section className="section" aria-labelledby="guide-paper-rows">
        <h2 id="guide-paper-rows">{guide.rowsHeading}</h2>
        <SampleRows />
        <p className="caption">
          {guide.rowsIntro} <Sample />
        </p>
      </section>
      <States />
      <section className="section" aria-labelledby="guide-paper-tokens">
        <h2 id="guide-paper-tokens">{guide.tokensHeading}</h2>
        <p>{guide.tokensIntro}</p>
        <Swatches pairs={PAPER_PAIRS} values={values} />
      </section>
      <section className="section" aria-labelledby="guide-motion">
        <h2 id="guide-motion">{guide.motionHeading}</h2>
        <p>{guide.motionIntro}</p>
        <div className="guide-grid">
          <DealDemo />
          <FundTickDemo />
          <FlipDemo />
          <SlamDemo />
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- band 3: the team strip on ink

function TeamStrip({ roles, asleep }: { roles: Role[]; asleep: boolean }) {
  return (
    <ul className="team-strip">
      {roles.map((role) => (
        <li key={role.id}>
          <Link className="member" to={`/team#agent-${role.id}`}>
            <Avatar note={role.species_note} asleep={asleep} size={72} />
            <span>
              <span className="member-name">{role.name}</span>
              <span className="member-job">{role.description ?? role.title}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TeamBand({ studio }: { studio: ReturnType<typeof useStudio> }) {
  const roles = studio.state === 'ready' ? studio.snapshot.roles.filter((role) => runsCards(role)).slice(0, 3) : [];
  return (
    <div className="band">
      <section className="section" aria-labelledby="guide-team">
        <h2 id="guide-team">{guide.teamHeading}</h2>
        <p>{guide.teamIntro}</p>
        {roles.length === 0 ? (
          <p className="muted">{studio.state === 'loading' ? copy.team.loading : guide.teamEmpty}</p>
        ) : (
          <>
            <h3>{guide.asleep}</h3>
            <TeamStrip roles={roles} asleep />
            <h3>{guide.awake}</h3>
            <TeamStrip roles={roles} asleep={false} />
          </>
        )}
      </section>
    </div>
  );
}

/** The design guide: three bands, ink, paper and ink, so the footer follows on paper. */
export function Guide() {
  useNoIndex();
  const studio = useStudio();
  const values = useTokenValues(ALL_TOKENS);
  return (
    <main className="wide guide">
      <InkBand values={values} studio={studio} />
      <PaperBand values={values} />
      <TeamBand studio={studio} />
    </main>
  );
}
