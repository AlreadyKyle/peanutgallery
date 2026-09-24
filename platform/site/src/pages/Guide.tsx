import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { CardFace } from '../components/Card';
import { FilterChip, ShippedRow } from '../components/Cards';
import { CoinMark, FundingBar, type SpecRow } from '../components/Funding';
import { Glyph, STATE_TAGS, SuitTag, type GlyphName } from '../components/Glyph';
import { LiveUpdates } from '../components/LiveUpdates';
import { MachineMark } from '../components/Mark';
import { PageHeader } from '../components/PageHeader';
import { TeamStrip } from '../components/TeamStrip';
import { FACES, type CategoryFilter, type Face } from '../lib/cards';
import { COLOUR_PAIRS, COLOUR_TOKENS } from '../lib/colour';
import { contrast, sixDigit } from '../lib/contrast';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { formatDateTime, formatUsd, percent } from '../lib/format';
import { legal } from '../lib/legal';
import { deal, flip, fundTick, slam } from '../lib/motion';
import { teamStrip } from '../lib/roster';
import type { Card, Role, Snapshot } from '../lib/source';
import { useStudio } from '../lib/studio';

// The design guide: an unlisted page (routes.tsx gives it a path and no top bar link; it asks search
// engines not to index it) that shows every part of the design system with the real components. It
// is the design-system mockup (DESIGN.md, Mockups). Three bands, as every page has them: the signal
// plate, paper (every card), ink. Everything made up for it is marked Sample; the team strip draws
// the real roles from the snapshot, and every colour and ratio is read from tokens.css on the page.

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
  checks: sampleCard('sample-checks', { ...c.checks, folder: 'platform', bucket: 'studio', stage: 'gated', spent_usd: 0.61, executor_role_id: SAMPLE_BUILDER.id }),
  live: sampleCard('sample-live', { ...c.live, stage: 'live', shape: 'oneoff', funding_target_usd: 0, spent_usd: 0.24, live_at: iso(90) }),
  paused: sampleCard('sample-paused', { ...c.paused, funded_usd: 0.75 }),
  rejected: sampleCard('sample-rejected', { ...c.rejected, folder: 'platform', bucket: 'studio', shape: 'oneoff', funding_target_usd: 0 }),
};

/** The faces in two groups by anatomy, so a row never mixes a card that takes money with one that does not. */
const MONEY_FACES: readonly Face[] = ['open', 'picked', 'funded', 'paused'];
const WORK_FACES: readonly Face[] = ['building', 'checks', 'live', 'rejected'];

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

// ---------------------------------------------------------------- colour, measured on the page

/** The colour tokens' values as the page has them, read once it has rendered. */
function useTokenValues(): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    setValues(Object.fromEntries(COLOUR_TOKENS.map(({ name }) => [name, sixDigit(style.getPropertyValue(name)) ?? ''])));
  }, []);
  return values;
}

function ratio(values: Record<string, string>, fg: string, bg: string): string {
  const a = values[fg] ?? '';
  const b = values[bg] ?? '';
  return a !== '' && b !== '' ? contrast(a, b).toFixed(2) : '';
}

function Palette({ values }: { values: Record<string, string> }) {
  return (
    <ul className="swatches fill-grid">
      {COLOUR_TOKENS.map((token) => (
        <li key={token.name} className="swatch">
          <span className="swatch-chip" style={{ background: `var(${token.name})` }} aria-hidden="true" />
          <span className="swatch-text">
            <span>
              <code>{token.name}</code> <span className="muted figure">{values[token.name]}</span>
            </span>
            <span>{token.role}</span>
            <span className="muted figure">{guide.againstPaper.replace('{n}', ratio(values, token.name, '--paper'))}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Pairs({ values }: { values: Record<string, string> }) {
  return (
    <ul className="swatches fill-grid">
      {COLOUR_PAIRS.map((pair) => {
        // Text is drawn only where the pairing is a text pairing that passes; everything else is a shape.
        const text = !pair.banned && pair.floor >= 4.5;
        const chip: CSSProperties = { background: `var(${pair.bg})`, color: `var(${pair.fg})` };
        const floor = pair.banned
          ? guide.banned.replace('{n}', String(pair.floor))
          : pair.floor > 0
            ? guide.atLeast.replace('{n}', String(pair.floor))
            : guide.decorative;
        return (
          <li key={`${pair.fg} ${pair.bg}`} className="swatch" data-banned={pair.banned ? 'true' : undefined}>
            <span className="swatch-chip" style={chip} aria-hidden="true">
              {text ? guide.specimen : <span className="swatch-edge" style={{ borderColor: `var(${pair.fg})` }} />}
            </span>
            <span className="swatch-text">
              <span>
                <code>{pair.fg}</code> {guide.on} <code>{pair.bg}</code>
              </span>
              <span>
                <strong className="figure">{ratio(values, pair.fg, pair.bg)}</strong> <span className="muted">{floor}</span>
              </span>
              <span className="muted">{pair.use}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ColourRules() {
  return (
    <div className="pair rules-pair">
      <section className="section" aria-labelledby="guide-do">
        <h3 id="guide-do">{guide.doHeading}</h3>
        <ul className="rules">
          {guide.rulesDo.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
      <section className="section" aria-labelledby="guide-dont">
        <h3 id="guide-dont">{guide.dontHeading}</h3>
        <ul className="rules">
          {guide.rulesDont.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Colour() {
  const values = useTokenValues();
  return (
    <section className="section" aria-labelledby="guide-colour">
      <h2 id="guide-colour">{guide.colourHeading}</h2>
      <p>{guide.colourIntro}</p>
      <h3>{guide.paletteHeading}</h3>
      <Palette values={values} />
      <h3>{guide.pairsHeading}</h3>
      <p className="caption">{guide.pairsIntro}</p>
      <Pairs values={values} />
      <h3>{guide.rulesHeading}</h3>
      <ColourRules />
    </section>
  );
}

// ---------------------------------------------------------------- the controls, on any ground

function PlayDust() {
  const env = siteEnv();
  const inner = (
    <>
      <Glyph name="cartridge" />
      {copy.playDust}
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

function ContributeLink() {
  return (
    <Link className="button btn-coin" to="/contribute">
      <CoinMark />
      {copy.contribute}
    </Link>
  );
}

function PoolLine() {
  return (
    <p className="pool-line with-glyph">
      <CoinMark />
      <span>
        <span className="figure">{formatUsd(0.5)}</span> {legal.poolInline} <Sample />
      </span>
    </p>
  );
}

/** The controls every ground draws: primary, outline, Contribute, pressed, quiet and a link. */
function Controls() {
  return (
    <div className="cluster">
      <PlayDust />
      <Link className="button button-secondary" to="/ledger">
        {copy.fullLedger}
      </Link>
      <ContributeLink />
      <button type="button" className="button button-secondary" aria-pressed="true">
        <Glyph name="check" />
        {copy.pauseLiveUpdates}
      </button>
      <button type="button" className="button button-quiet" aria-disabled="true">
        {copy.upToDate}
      </button>
      <Link to="/how-it-works">{copy.howItWorks}</Link>
    </div>
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
    <ul className="rows rail">
      <li className="changed">
        <span className="row-time">{formatDateTime(iso(5))}</span>
        <span className="row-body">
          <span className="row-strong">
            {c.builder} {legal.eventVerbs.ship}
          </span>
        </span>
      </li>
      <li>
        <span className="row-time">{formatDateTime(iso(9))}</span>
        <span className="row-body">
          <span className="row-strong">
            {c.builder} {legal.eventVerbs.gate_pass}
          </span>
        </span>
      </li>
    </ul>
  );
}

const SHIPPED: Card[] = guide.shippedTitles.map((title, i) =>
  sampleCard(`sample-shipped-${i}`, {
    title,
    stage: 'live',
    shape: 'oneoff',
    folder: i === 0 ? 'seed-1' : 'platform',
    funding_target_usd: 0,
    spent_usd: i === 0 ? 0.61 : 0.24,
    live_at: iso(90 + i * 600),
  }),
);

/** Shipped rows with the suit tile and the Live mark; `ground` keeps each copy's ids apart. */
function SampleShipped({ ground }: { ground: string }) {
  const cards = SHIPPED.map((card) => ({ ...card, id: `${card.id}-${ground}` }));
  const snapshot = sampleSnapshot(cards, {});
  return (
    <ul className="rows rail">
      {cards.map((card) => (
        <ShippedRow key={card.id} card={card} snapshot={snapshot} example />
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- band 1: the signal plate

function SignalBand() {
  return (
    <div className="band">
      <PageHeader title={guide.title} lede={guide.lede} />
      <section className="section" aria-labelledby="guide-signal">
        <h2 id="guide-signal">{guide.onSignal}</h2>
        <p className="prose">{guide.onSignalIntro}</p>
        <div className="guide-grid">
          <div className="demo">
            <h3>{guide.controlsHeading}</h3>
            <Controls />
            <p className="caption">
              {guide.primaryNote} {guide.outlineNote} {guide.pressedNote} {guide.coinNote}
            </p>
            <h3>{guide.focusHeading}</h3>
            <p className="caption">{guide.focusIntro}</p>
            <h3>{guide.liveHeading}</h3>
            <LiveUpdatesDemo />
            <p className="caption">{guide.liveIntro}</p>
            <PoolLine />
          </div>
          <div className="demo">
            <h3>{guide.statusHeading}</h3>
            <p className="status-line">
              <Glyph name="pause" />
              <span>
                <strong>{guide.statusFigure}</strong> {guide.statusRest} <Sample />
              </span>
            </p>
            <p className="notice">{legal.pausedNotice}</p>
            <p className="caption">{guide.noticeNote}</p>
            <h3>{guide.rowsHeading}</h3>
            <SampleShipped ground="signal" />
            <SampleRows />
            <p className="caption">
              {guide.rowsIntro} {guide.inkRowsNote} <Sample />
            </p>
            <h3>{guide.markHeading}</h3>
            <p className="cluster">
              <MachineMark />
            </p>
            <p className="caption">{guide.markNote}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- band 2: paper, every card

function FaceGroup({ id, heading, faces }: { id: string; heading: string; faces: readonly Face[] }) {
  return (
    <>
      <h3 id={id}>{heading}</h3>
      <ul className="card-grid">
        {faces.map((face) => (
          <CardFace
            key={face}
            card={FACE_CARDS[face]}
            snapshot={FACE_SNAPSHOT}
            mode="sample"
            face={face === 'paused' || face === 'rejected' ? face : undefined}
            stamp={face === 'live'}
            reason={face === 'rejected' ? c.reason : undefined}
          />
        ))}
      </ul>
      <ul className="face-notes">
        {faces.map((face) => (
          <li key={face} className="caption">
            {guide.faces[face]} <Sample />
          </li>
        ))}
      </ul>
    </>
  );
}

function FaceGallery() {
  return (
    <section className="section" aria-labelledby="guide-cards">
      <h2 id="guide-cards">{guide.cardsHeading}</h2>
      <p className="prose">{guide.cardsIntro}</p>
      <FaceGroup id="guide-money-faces" heading={guide.moneyFaces} faces={MONEY_FACES} />
      <FaceGroup id="guide-work-faces" heading={guide.workFaces} faces={WORK_FACES} />
    </section>
  );
}

function Bars() {
  return (
    <section className="section" aria-labelledby="guide-bar">
      <h2 id="guide-bar">{guide.barHeading}</h2>
      <p className="prose">{guide.barIntro}</p>
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
      <p className="prose">{guide.coinIntro}</p>
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

const ARROWS: readonly GlyphName[] = ['arrow-right', 'arrow-left', 'arrow-up', 'arrow-down'];

function Glyphs() {
  return (
    <section className="section" aria-labelledby="guide-glyphs">
      <h2 id="guide-glyphs">{guide.glyphsHeading}</h2>
      <p className="prose">{guide.glyphsIntro}</p>
      <ul className="glyph-list">
        {FACES.map((face) => (
          <li key={face} className="tag" data-state={face}>
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
      <p className="prose">{guide.suitsIntro}</p>
      <p className="cluster">
        <SuitTag suit="game" />
        <SuitTag suit="studio" />
      </p>
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

function PaperControls() {
  return (
    <section className="section" aria-labelledby="guide-buttons">
      <h2 id="guide-buttons">{guide.buttonsHeading}</h2>
      <Controls />
      <p className="caption">{guide.primaryNote}</p>
    </section>
  );
}

function PaperRows() {
  return (
    <section className="section" aria-labelledby="guide-paper-rows">
      <h2 id="guide-paper-rows">{guide.rowsHeading}</h2>
      <SampleShipped ground="paper" />
      <SampleRows />
      <p className="caption">
        {guide.rowsIntro} <Sample />
      </p>
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

/** One sample card in a list the demo can reach, with the demo's Play button over it. */
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
  const card = { ...FACE_CARDS.open, id: `sample-open-deal-${round}` };
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
        <CardFace key={card.id} card={card} snapshot={sampleSnapshot([card], { [card.id]: 2 })} mode="sample" />
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

function PaperBand() {
  return (
    <div className="band">
      <FaceGallery />
      <Bars />
      <Coin />
      <Glyphs />
      <Suits />
      <PaperControls />
      <PaperRows />
      <States />
      <Colour />
      <section className="section" aria-labelledby="guide-motion">
        <h2 id="guide-motion">{guide.motionHeading}</h2>
        <p className="prose">{guide.motionIntro}</p>
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

// ---------------------------------------------------------------- band 3: ink

function InkBand({ studio }: { studio: ReturnType<typeof useStudio> }) {
  const roles = studio.state === 'ready' ? teamStrip(studio.snapshot) : [];
  return (
    <div className="band">
      <section className="section" aria-labelledby="guide-ink">
        <h2 id="guide-ink">{guide.onInk}</h2>
        <p className="prose">{guide.onInkIntro}</p>
        <Controls />
        <p className="caption">
          {guide.primaryNote} {guide.outlineNote}
        </p>
        <SampleShipped ground="ink" />
        <SampleRows />
        <p className="caption">
          {guide.inkRowsNote} <Sample />
        </p>
      </section>
      <section className="section" aria-labelledby="guide-team">
        <h2 id="guide-team">{guide.teamHeading}</h2>
        <p className="prose">
          {guide.teamIntro} {guide.castNote}
        </p>
        {roles.length === 0 ? (
          <p className="muted" aria-busy={studio.state === 'loading' ? 'true' : undefined}>
            {studio.state === 'loading' ? copy.team.loading : guide.teamEmpty}
          </p>
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

/** The design guide: three bands, the signal plate, paper and ink, so the footer follows on paper. */
export function Guide() {
  useNoIndex();
  const studio = useStudio();
  return (
    <main className="wide guide">
      <SignalBand />
      <PaperBand />
      <InkBand studio={studio} />
    </main>
  );
}
