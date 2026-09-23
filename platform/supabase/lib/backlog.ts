// docs/BACKLOG.md as data (docs/specs/launch-db.md). Pure: no I/O.
//
// The file's format, which docs/BACKLOG.md follows and this parser enforces:
// free prose and "##" headings are ignored, and so is anything inside a fenced
// code block. Each card is a level-3 heading "### <title>", followed (after
// optional blank lines) by exactly these six bullet lines, in this order:
//   - bucket: game | platform | qa | studio | budget | agents
//   - folder: seed-1 | platform
//   - horizon: next | later
//   - rank: a whole number, lower is sooner, unique within its horizon
//   - summary: one line, at most 200 characters, sentence case, no em dash
//   - intent: one paragraph on one line: what it is, why, and that it is not built yet
// Titles are at most 80 characters and unique; the title is the upsert key.
// Any other heading at level 3, key, order or value fails the parse.

export const BUCKETS = ["game", "platform", "qa", "studio", "budget", "agents"] as const;
export const FOLDERS = ["seed-1", "platform"] as const;
export const HORIZONS = ["next", "later"] as const;
export const KEYS = ["bucket", "folder", "horizon", "rank", "summary", "intent"] as const;

export const TITLE_MAX = 80;
export const SUMMARY_MAX = 200;

export type Bucket = (typeof BUCKETS)[number];
export type Folder = (typeof FOLDERS)[number];
export type BacklogHorizon = (typeof HORIZONS)[number];

export interface BacklogEntry {
  title: string;
  bucket: Bucket;
  folder: Folder;
  horizon: BacklogHorizon;
  rank: number;
  summary: string;
  intent: string;
  /** 1-based line of the heading, for messages. */
  line: number;
}

export class BacklogError extends Error {
  constructor(readonly problems: string[]) {
    super(`docs/BACKLOG.md does not parse:\n${problems.map((p) => `  ${p}`).join("\n")}`);
    this.name = "BacklogError";
  }
}

const EM_DASH = "—";
const HEADING = /^###\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;

function oneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

/** Every card in the file, in file order; throws BacklogError listing every problem found. */
export function parseBacklog(text: string): BacklogEntry[] {
  const lines = text.split(/\r?\n/);
  const problems: string[] = [];
  const entries: BacklogEntry[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = HEADING.exec(raw);
    if (!heading) continue;

    const at = i + 1;
    const title = heading[1]!.trim();
    if (title === "") problems.push(`line ${at}: a card heading needs a title`);
    if (title.length > TITLE_MAX) problems.push(`line ${at}: the title "${title}" is longer than ${TITLE_MAX} characters`);
    if (title.includes(EM_DASH)) problems.push(`line ${at}: the title "${title}" uses an em dash`);

    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === "") j += 1;
    const values: Partial<Record<(typeof KEYS)[number], string>> = {};
    let complete = true;
    for (const key of KEYS) {
      const line = lines[j];
      const match = line === undefined ? null : new RegExp(`^- ${key}: (.*)$`).exec(line);
      if (!match) {
        problems.push(`line ${j + 1}: "${title}" needs "- ${key}: <value>" here, found ${line === undefined ? "the end of the file" : `"${line}"`}`);
        complete = false;
        break;
      }
      values[key] = match[1]!.trim();
      j += 1;
    }
    if (complete && j < lines.length && /^- [a-z_]+:/.test(lines[j]!)) {
      problems.push(`line ${j + 1}: "${title}" has a key after intent: "${lines[j]}"`);
    }
    i = j - 1;
    if (!complete) continue;

    const { bucket, folder, horizon, rank, summary, intent } = values as Record<(typeof KEYS)[number], string>;
    const where = `line ${at} "${title}"`;
    if (!oneOf(bucket, BUCKETS)) problems.push(`${where}: bucket "${bucket}" is not one of ${BUCKETS.join(", ")}`);
    if (!oneOf(folder, FOLDERS)) problems.push(`${where}: folder "${folder}" is not one of ${FOLDERS.join(", ")}`);
    if (!oneOf(horizon, HORIZONS)) problems.push(`${where}: horizon "${horizon}" is not next or later`);
    if (!/^\d+$/.test(rank)) problems.push(`${where}: rank "${rank}" is not a whole number`);
    if (summary === "") problems.push(`${where}: the summary is empty`);
    if (summary.length > SUMMARY_MAX) problems.push(`${where}: the summary is longer than ${SUMMARY_MAX} characters`);
    if (/^[a-z]/.test(summary)) problems.push(`${where}: the summary starts with a lower-case letter`);
    if (summary.includes(EM_DASH)) problems.push(`${where}: the summary uses an em dash`);
    if (intent === "") problems.push(`${where}: the intent is empty`);
    if (intent.includes(EM_DASH)) problems.push(`${where}: the intent uses an em dash`);

    entries.push({
      title,
      bucket: bucket as Bucket,
      folder: folder as Folder,
      horizon: horizon as BacklogHorizon,
      rank: Number(rank),
      summary,
      intent,
      line: at,
    });
  }
  if (inFence) problems.push("a fenced code block is never closed");

  const titles = new Map<string, number>();
  const ranks = new Map<string, number>();
  for (const entry of entries) {
    const seen = titles.get(entry.title);
    if (seen !== undefined) problems.push(`line ${entry.line}: the title "${entry.title}" is also on line ${seen}`);
    else titles.set(entry.title, entry.line);
    const key = `${entry.horizon} ${entry.rank}`;
    const ranked = ranks.get(key);
    if (ranked !== undefined) problems.push(`line ${entry.line}: rank ${entry.rank} on ${entry.horizon} is also on line ${ranked}`);
    else ranks.set(key, entry.line);
  }
  if (entries.length === 0 && problems.length === 0) problems.push("no card headings found");
  if (problems.length > 0) throw new BacklogError(problems);
  return entries;
}

/** A card already in the table with a backlog title. */
export interface ExistingCard {
  id: string;
  title: string;
  stage: string;
  horizon: string;
  rank: number | null;
  bucket: string;
  folder: string;
  summary: string | null;
  intent: string | null;
}

/** The row file-backlog inserts: a board goal card, proposed, off now, with no target, executor or acceptance test yet. */
export interface BacklogInsert {
  bucket: Bucket;
  source: "board";
  shape: "goal";
  lane: "code";
  folder: Folder;
  title: string;
  summary: string;
  intent: string;
  stage: "proposed";
  horizon: BacklogHorizon;
  rank: number;
  funding_target_usd: 0;
  estimate_usd: 0;
  priority: 100;
  confidence: "low";
}

export type BacklogPatch = Partial<Pick<BacklogInsert, "bucket" | "folder" | "horizon" | "rank" | "summary" | "intent">>;

export interface BacklogPlan {
  insert: BacklogInsert[];
  update: { id: string; title: string; patch: BacklogPatch }[];
  unchanged: string[];
  skipped: { title: string; reason: string }[];
}

function insertRow(entry: BacklogEntry): BacklogInsert {
  return {
    bucket: entry.bucket,
    source: "board",
    shape: "goal",
    // A planned card has no lane yet; the board sets it with set_card_horizon when the card moves to now.
    lane: "code",
    folder: entry.folder,
    title: entry.title,
    summary: entry.summary,
    intent: entry.intent,
    stage: "proposed",
    horizon: entry.horizon,
    rank: entry.rank,
    funding_target_usd: 0,
    estimate_usd: 0,
    priority: 100,
    confidence: "low",
  };
}

/**
 * What an apply would do, matching cards by title. A title with no card is
 * inserted. A backlog card with the title (proposed, on next or later) is
 * updated where the file differs. A title held only by a card the board has
 * moved on (on now, or at any stage past proposed) is skipped, so a promoted
 * or cancelled entry is never pulled back to the backlog.
 */
export function planBacklog(entries: readonly BacklogEntry[], existing: readonly ExistingCard[]): BacklogPlan {
  const plan: BacklogPlan = { insert: [], update: [], unchanged: [], skipped: [] };
  for (const entry of entries) {
    const matches = existing.filter((card) => card.title === entry.title);
    if (matches.length === 0) {
      plan.insert.push(insertRow(entry));
      continue;
    }
    const backlog = matches.find((card) => card.stage === "proposed" && card.horizon !== "now");
    if (!backlog) {
      const first = matches[0]!;
      plan.skipped.push({ title: entry.title, reason: `card ${first.id} is at stage ${first.stage} on ${first.horizon}` });
      continue;
    }
    const want = insertRow(entry);
    const patch: BacklogPatch = {};
    if (backlog.bucket !== want.bucket) patch.bucket = want.bucket;
    if (backlog.folder !== want.folder) patch.folder = want.folder;
    if (backlog.horizon !== want.horizon) patch.horizon = want.horizon;
    if (backlog.rank !== want.rank) patch.rank = want.rank;
    if (backlog.summary !== want.summary) patch.summary = want.summary;
    if (backlog.intent !== want.intent) patch.intent = want.intent;
    if (Object.keys(patch).length === 0) plan.unchanged.push(entry.title);
    else plan.update.push({ id: backlog.id, title: entry.title, patch });
  }
  return plan;
}

/** Entry counts by horizon and by folder, for the dry run to quote against the file. */
export function backlogCounts(entries: readonly BacklogEntry[]): { horizon: Record<BacklogHorizon, number>; folder: Record<Folder, number> } {
  const horizon: Record<BacklogHorizon, number> = { next: 0, later: 0 };
  const folder: Record<Folder, number> = { "seed-1": 0, platform: 0 };
  for (const entry of entries) {
    horizon[entry.horizon] += 1;
    folder[entry.folder] += 1;
  }
  return { horizon, folder };
}
