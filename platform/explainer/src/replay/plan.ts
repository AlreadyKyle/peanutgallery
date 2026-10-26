// A shipped card's replay (docs/specs/replays.md): a 24 second clip of Dust before and after the card,
// drawn by seed-1's capture tool from the same seed, states and camera, then the card's timeline from
// its public document (/api/card/:id). This module is the plan, pure and imported by
// scripts/replay.mjs under Node's type stripping, so it imports nothing.

/** The site's tokens this clip uses (theme.ts C; replay.test.ts holds them equal). */
export const INK = '#111111';
export const PAPER = '#ffffff';
export const MUTED = '#5c5c5c';
export const LIVE = '#16701f';
export const SUIT = '#b0226a';

export const FPS = 30;
export const MIN_SECONDS = 20;
export const MAX_SECONDS = 30;

export type ReplayFacts = {
  cardId: string;
  title: string;
  fundedUsd: number;
  contributors: number;
  startedAt: string | null;
  gateAt: string | null;
  gate: 'passed' | 'failed' | null;
  liveAt: string | null;
  costUsd: number;
};

type Doc = Record<string, unknown>;
const isDoc = (v: unknown): v is Doc => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const textOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The facts a replay states, from a card's public document. Throws unless the card is live. */
export function factsFrom(value: unknown): ReplayFacts {
  if (!isDoc(value) || !isDoc(value.card) || !isDoc(value.milestones)) throw new Error('not a card document: no card or milestones');
  const card = value.card;
  const m = value.milestones;
  if (card.stage !== 'live' || textOrNull(m.live_at) === null) throw new Error(`card ${String(card.id)} is not live, so it has no replay`);
  const funding = isDoc(value.funding) ? value.funding : null;
  return {
    cardId: String(card.id),
    title: String(card.title),
    fundedUsd: num(card.funded_usd),
    contributors: funding === null ? 0 : num(funding.contributors),
    startedAt: textOrNull(m.started_at),
    gateAt: textOrNull(m.gate_at),
    gate: m.gate === 'passed' || m.gate === 'failed' ? m.gate : null,
    liveAt: textOrNull(m.live_at),
    costUsd: num(value.spent_usd),
  };
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** A length of time in plain words: "40 minutes", "2 hours 5 minutes", "3 days". */
export function span(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (minutes < 48 * 60) {
    const h = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `${h} hour${h === 1 ? '' : 's'}${rest === 0 ? '' : ` ${rest} minute${rest === 1 ? '' : 's'}`}`;
  }
  const d = Math.round(minutes / (24 * 60));
  return `${d} days`;
}

export type Row = { label: string; value: string };

/**
 * The timeline, a row for each step the card's document records, in order: funded (only when players
 * put money on it), built (from the agent starting to the checks), checked, live and what the work
 * cost. A step the document does not record has no row; nothing is guessed.
 */
export function timelineRows(f: ReplayFacts): Row[] {
  const rows: Row[] = [];
  if (f.fundedUsd > 0 && f.contributors > 0) {
    rows.push({ label: 'Funded', value: `${usd.format(f.fundedUsd)} from ${f.contributors} player${f.contributors === 1 ? '' : 's'}` });
  }
  if (f.startedAt !== null && f.gateAt !== null) {
    rows.push({ label: 'Built', value: `by an AI agent in ${span(Date.parse(f.gateAt) - Date.parse(f.startedAt))}` });
  }
  if (f.gate === 'passed') rows.push({ label: 'Checked', value: 'passed every check' });
  if (f.liveAt !== null) rows.push({ label: 'Live', value: day.format(new Date(f.liveAt)) });
  if (f.costUsd > 0) rows.push({ label: 'Cost', value: `${usd.format(f.costUsd)} of agent work` });
  return rows;
}

/** What a capture folder's capture.json says (seed-1/scripts/capture.ts). */
export type Capture = { commit: string | null; states: number[]; sizes: { width: number; height: number }[]; files: string[] };

/** The page picture for a state at a width, as capture.ts names it. */
export const shotName = (seconds: number, width: number) => `dust-${seconds}s-${width}.png`;

/**
 * The states the clip shows: those whose page picture differs between the two captures, at most two,
 * earliest first. Captures from different seeds, states or widths are refused, and so is a pair where
 * nothing differs, since a before and after that look the same says nothing.
 */
export function chooseStates(before: Capture, after: Capture, width: number, differs: (seconds: number) => boolean): number[] {
  for (const [name, c] of [['before', before], ['after', after]] as const) {
    if (!c.sizes.some((s) => s.width === width)) throw new Error(`the ${name} capture has no ${width} px pictures`);
  }
  const shared = before.states.filter((s) => after.states.includes(s));
  if (shared.length === 0) throw new Error('the captures share no state');
  const changed = shared.filter(differs).sort((a, b) => a - b);
  if (changed.length === 0) throw new Error('no picture differs between the captures: nothing to show before and after');
  return changed.slice(0, 2);
}

export type Slide =
  | { kind: 'title'; seconds: number }
  | { kind: 'before' | 'after'; seconds: number; state: number }
  | { kind: 'timeline'; seconds: number }
  | { kind: 'end'; seconds: number };

/**
 * The clip, 24 seconds: the title (3 s), before and after twice (3 s each; one changed state is shown
 * twice, so the change flips in and out), the timeline (6 s) and the address (3 s).
 */
export function slides(states: number[]): Slide[] {
  if (states.length === 0) throw new Error('no states to show');
  const shown = states.length === 1 ? [states[0]!, states[0]!] : states.slice(0, 2);
  return [
    { kind: 'title', seconds: 3 },
    ...shown.flatMap((state) => [
      { kind: 'before' as const, seconds: 3, state },
      { kind: 'after' as const, seconds: 3, state },
    ]),
    { kind: 'timeline', seconds: 6 },
    { kind: 'end', seconds: 3 },
  ];
}

export const totalSeconds = (list: Slide[]) => list.reduce((sum, s) => sum + s.seconds, 0);

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * One slide as a page of the given size. `font` is the site's font as a data URL; `picture` is the
 * state's page picture as a data URL, for a before or after slide.
 */
export function slideHtml(slide: Slide, f: ReplayFacts, size: { width: number; height: number }, font: string, picture?: string): string {
  const base = `@font-face{font-family:'Atkinson Hyperlegible Next';src:url(${font}) format('woff2');font-weight:400 700}
*{box-sizing:border-box;margin:0}
body{width:${size.width}px;height:${size.height}px;overflow:hidden;background:${PAPER};color:${INK};font-family:'Atkinson Hyperlegible Next',Arial,sans-serif}
.plate{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 96px;gap:20px}
.kicker{font-size:26px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${SUIT}}
h1{font-size:64px;line-height:1.1;font-weight:700;max-width:22ch}
.rows{display:grid;grid-template-columns:max-content 1fr;gap:18px 40px;font-size:38px;align-items:baseline}
.rows dt{font-weight:700}
.rows dd{color:${MUTED}}
.rows dd.live{color:${LIVE};font-weight:700}
.shot{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.pill{position:absolute;top:24px;left:50%;transform:translateX(-50%);padding:10px 28px;border:3px solid ${INK};border-radius:999px;font-size:34px;font-weight:700;background:${PAPER};color:${INK}}
.pill.after{background:${SUIT};color:${PAPER}}`;
  let body: string;
  if (slide.kind === 'title') {
    body = `<div class="plate"><p class="kicker">Shipped in Dust</p><h1>${escape(f.title)}</h1></div>`;
  } else if (slide.kind === 'before' || slide.kind === 'after') {
    if (picture === undefined) throw new Error(`the ${slide.kind} slide needs its picture`);
    body = `<img class="shot" src="${picture}" alt=""><p class="pill ${slide.kind}">${slide.kind === 'before' ? 'Before' : 'After'}</p>`;
  } else if (slide.kind === 'timeline') {
    const rows = timelineRows(f)
      .map((r) => `<dt>${escape(r.label)}</dt><dd${r.label === 'Live' ? ' class="live"' : ''}>${escape(r.value)}</dd>`)
      .join('');
    body = `<div class="plate"><h1>${escape(f.title)}</h1><dl class="rows">${rows}</dl></div>`;
  } else {
    body = `<div class="plate"><p class="kicker">Mob Machine</p><h1>Fund the card you want built next.</h1><p class="rows"><span>mobmachine.games</span></p></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${base}</style></head><body>${body}</body></html>`;
}

/** The ffmpeg concat list for the rendered slides: each file held for its slide's seconds. */
export function concatList(files: { path: string; seconds: number }[]): string {
  const quote = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;
  const lines = files.flatMap((file) => [`file ${quote(file.path)}`, `duration ${file.seconds}`]);
  // The concat demuxer ignores the last entry's duration unless the file is listed once more.
  const last = files[files.length - 1];
  if (last !== undefined) lines.push(`file ${quote(last.path)}`);
  return `${lines.join('\n')}\n`;
}

/** ffmpeg's arguments: the list to a 30 fps H.264 file a browser plays inline, with no sound. */
export function ffmpegArgs(list: string, out: string): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-an', '-movflags', '+faststart', out];
}
