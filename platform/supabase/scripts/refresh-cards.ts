// Refreshes the production cards for launch (docs/specs/launch-cards.md) from
// seed/launch-cards.json. Pass exactly one of --dry-run or --apply:
//   pnpm --filter @backseat/supabase exec tsx scripts/refresh-cards.ts --dry-run
//   pnpm --filter @backseat/supabase exec tsx scripts/refresh-cards.ts --apply
//
// The file has four lists:
// - live: shipped cards whose title and summary are rewritten in plain words.
//   Nothing else on them changes: stage, money, commits, live_at and the
//   board's reason for filing them are history.
// - open: cards still open to funding, rewritten, moved to horizon now with a
//   rank and a target, and given the board's reason.
// - retire: open cards the board stops, with its reason (cancel_card's
//   stages, and only while the card holds no money).
// - new: cards filed on horizon now, found by title.
//
// Existing cards are updated by id and new ones inserted by title, so a second
// run changes nothing. Every card moved to now must meet the definition of
// ready (docs/PLAN.md): title, summary, intent, an acceptance test with check:
// lines, a lane, a folder, an active executor and a target above zero; the
// platform code lane is closed at launch; and the dispatcher's pre-check must
// pass against the repository's seed-1 files. The whole plan is checked before
// anything is written; one refusal writes nothing. Each update is conditional
// on the stage the plan read, so a card that moved in between stops the run.
//
// board_role() is null under the service role, so the script cannot call the
// board's RPCs (set_card_horizon, cancel_card, file_card). It applies their
// refusals itself and writes the same fields with the service role key.
// Needs cards.horizon and cards.rank (migration 20260922000300_backlog).

import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AcceptanceGrammarError, parseChecks } from "../../dispatcher/src/acceptance.ts";
import { loadRepoEnv, REPO_ROOT, serviceClient } from "../lib/client.js";
import { preCheckRejection } from "../lib/pre-check.js";

export const SEED_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "seed", "launch-cards.json");

/** Stages a supporter can still fund (apply_contribution). */
export const OPEN_STAGES: readonly string[] = ["proposed", "designing", "voted"];
/** Stages cancel_card accepts. */
export const RETIRABLE_STAGES: readonly string[] = ["proposed", "designing", "voted", "funded", "paused"];
export const TITLE_MAX = 80;
export const SUMMARY_MAX = 200;

/** The line rule file_card applies to an acceptance test. */
const CHECK_LINE = /(^|\n)\s*check:\s/;
const EM_DASH = "\u2014";

export type Lane = "config" | "code";
export type Folder = "seed-1" | "platform";
export type Horizon = "now" | "next" | "later";
export type Section = "live" | "open" | "retire" | "new";

export interface LiveEntry {
  id: string;
  /** The title the card had when this file was written. */
  was: string;
  title: string;
  summary: string;
  reason: string;
}

/** The definition-of-ready fields a card on horizon now carries. */
export interface ReadyEntry {
  title: string;
  summary: string;
  /** Paragraphs joined by a blank line. */
  intent: string;
  /** Lines joined by a newline. */
  acceptance_test: string;
  lane: Lane;
  folder: Folder;
  /** roles.name, resolved to executor_role_id. */
  executor: string;
  funding_target_usd: number;
  rank: number;
  reason: string;
}

export interface OpenEntry extends ReadyEntry {
  id: string;
  was: string;
}

export interface RetireEntry {
  id: string;
  was: string;
  reason: string;
}

export interface NewEntry extends ReadyEntry {
  bucket: string;
  stage: "proposed" | "voted";
}

export interface LaunchCards {
  live: LiveEntry[];
  open: OpenEntry[];
  retire: RetireEntry[];
  new: NewEntry[];
}

/** A cards row as the script reads it. */
export interface CardRow {
  id: string;
  title: string;
  summary: string | null;
  intent: string | null;
  acceptance_test: string | null;
  bucket: string;
  source: string;
  shape: string;
  lane: Lane;
  folder: Folder;
  executor_role_id: string | null;
  funding_target_usd: number;
  funded_usd: number;
  estimate_usd: number;
  stage: string;
  board_reason: string | null;
  horizon: Horizon;
  rank: number | null;
}

export interface RoleRow {
  id: string;
  name: string;
  state: string;
}

export type CardPatch = Partial<
  Pick<
    CardRow,
    | "title"
    | "summary"
    | "intent"
    | "acceptance_test"
    | "lane"
    | "folder"
    | "executor_role_id"
    | "funding_target_usd"
    | "estimate_usd"
    | "stage"
    | "board_reason"
    | "horizon"
    | "rank"
  >
>;

/** The row file_card inserts, plus the horizon and rank. */
export interface NewCardRow {
  bucket: string;
  source: "board";
  shape: "goal";
  lane: Lane;
  priority: 100;
  board_reason: string;
  folder: Folder;
  executor_role_id: string;
  title: string;
  summary: string;
  intent: string;
  acceptance_test: string;
  funding_target_usd: number;
  funded_usd: 0;
  estimate_usd: number;
  confidence: "low";
  proposer_role_id: null;
  stage: "proposed" | "voted";
  horizon: "now";
  rank: number;
}

/** What the script reads and writes; Supabase in production, memory in the tests. */
export interface CardStore {
  cardsById(ids: readonly string[]): Promise<CardRow[]>;
  cardsByTitle(titles: readonly string[]): Promise<CardRow[]>;
  rolesByName(names: readonly string[]): Promise<RoleRow[]>;
  /** Updates the card only while it is still at expectedStage; false when no row matched. */
  updateCard(id: string, expectedStage: string, patch: CardPatch): Promise<boolean>;
  /** Inserts the card and returns its id. */
  insertCard(row: NewCardRow): Promise<string>;
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export type Step =
  | {
      action: "update";
      section: Section;
      id: string;
      title: string;
      expectedStage: string;
      patch: CardPatch;
      changes: FieldChange[];
      reason: string;
    }
  | { action: "insert"; section: "new"; title: string; executor: string; row: NewCardRow; reason: string }
  | { action: "none"; section: Section; id: string | null; title: string; note: string };

export interface Refusal {
  section: Section;
  title: string;
  why: string;
}

export interface Plan {
  steps: Step[];
  refusals: Refusal[];
}

export class UsageError extends Error {}

// Parsing the seed file ------------------------------------------------------

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(entry: Json, key: string, where: string): string {
  const value = entry[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${where}.${key} must be a non-empty string`);
  if (value !== value.trim()) throw new Error(`${where}.${key} has leading or trailing spaces`);
  if (value.includes(EM_DASH)) throw new Error(`${where}.${key} has an em dash; use a full stop or a comma (docs/COPY.md)`);
  return value;
}

/** A list of non-empty strings joined by the separator. */
function joined(entry: Json, key: string, where: string, separator: string): string {
  const value = entry[key];
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${where}.${key} must be a non-empty list of strings`);
  return value
    .map((part, i) => {
      if (typeof part !== "string" || part.trim() === "" || part !== part.trim()) {
        throw new Error(`${where}.${key}[${i}] must be a non-empty string without leading or trailing spaces`);
      }
      if (part.includes(EM_DASH)) throw new Error(`${where}.${key}[${i}] has an em dash`);
      return part;
    })
    .join(separator);
}

function oneOf<T extends string>(entry: Json, key: string, where: string, allowed: readonly T[]): T {
  const value = entry[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`${where}.${key} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function titleAndSummary(entry: Json, where: string): { title: string; summary: string } {
  const title = text(entry, "title", where);
  if (title.length > TITLE_MAX) throw new Error(`${where}.title is ${title.length} characters; the most is ${TITLE_MAX}`);
  // A new card is found by its title through a PostgREST in() filter, which quotes a value in double quotes.
  if (/["\\]/.test(title)) throw new Error(`${where}.title must not contain a double quote or a backslash`);
  const summary = text(entry, "summary", where);
  if (summary.length > SUMMARY_MAX) throw new Error(`${where}.summary is ${summary.length} characters; the most is ${SUMMARY_MAX}`);
  return { title, summary };
}

function readyFields(entry: Json, where: string): ReadyEntry {
  const target = entry["funding_target_usd"];
  if (typeof target !== "number" || !Number.isFinite(target) || target <= 0) {
    throw new Error(`${where}.funding_target_usd must be a number above zero`);
  }
  const rank = entry["rank"];
  if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1) throw new Error(`${where}.rank must be a whole number from 1`);
  return {
    ...titleAndSummary(entry, where),
    intent: joined(entry, "intent", where, "\n\n"),
    acceptance_test: joined(entry, "acceptance_test", where, "\n"),
    lane: oneOf(entry, "lane", where, ["config", "code"] as const),
    folder: oneOf(entry, "folder", where, ["seed-1", "platform"] as const),
    executor: text(entry, "executor", where),
    funding_target_usd: target,
    rank,
    reason: text(entry, "reason", where),
  };
}

function list(raw: Json, key: Section): Json[] {
  const value = raw[key];
  if (!Array.isArray(value)) throw new Error(`"${key}" must be a list`);
  return value.map((entry, i) => {
    if (!isRecord(entry)) throw new Error(`${key}[${i}] must be an object`);
    return entry;
  });
}

/** Validates the seed file's shape and copy rules; throws naming the first bad field. */
export function parseLaunchCards(raw: unknown): LaunchCards {
  if (!isRecord(raw)) throw new Error("the launch cards file must be an object");
  const live = list(raw, "live").map((e, i): LiveEntry => {
    const where = `live[${i}]`;
    return { id: text(e, "id", where), was: text(e, "was", where), ...titleAndSummary(e, where), reason: text(e, "reason", where) };
  });
  const open = list(raw, "open").map((e, i): OpenEntry => {
    const where = `open[${i}]`;
    return { id: text(e, "id", where), was: text(e, "was", where), ...readyFields(e, where) };
  });
  const retire = list(raw, "retire").map((e, i): RetireEntry => {
    const where = `retire[${i}]`;
    return { id: text(e, "id", where), was: text(e, "was", where), reason: text(e, "reason", where) };
  });
  const fresh = list(raw, "new").map((e, i): NewEntry => {
    const where = `new[${i}]`;
    return {
      ...readyFields(e, where),
      bucket: oneOf(e, "bucket", where, ["game", "platform", "qa", "studio", "budget", "agents"] as const),
      stage: oneOf(e, "stage", where, ["proposed", "voted"] as const),
    };
  });

  const ids = [...live, ...open, ...retire].map((e) => e.id);
  const duplicateId = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicateId !== undefined) throw new Error(`card ${duplicateId} is listed twice`);
  const titles = [...live.map((e) => e.title), ...open.map((e) => e.title), ...retire.map((e) => e.was), ...fresh.map((e) => e.title)];
  const duplicateTitle = titles.find((t, i) => titles.indexOf(t) !== i);
  if (duplicateTitle !== undefined) throw new Error(`the title "${duplicateTitle}" is used twice`);
  const ranks = [...open, ...fresh].map((e) => e.rank);
  const duplicateRank = ranks.find((r, i) => ranks.indexOf(r) !== i);
  if (duplicateRank !== undefined) throw new Error(`rank ${duplicateRank} is used twice on horizon now`);

  return { live, open, retire, new: fresh };
}

export function loadLaunchCards(path: string = SEED_PATH): LaunchCards {
  return parseLaunchCards(JSON.parse(readFileSync(path, "utf8")));
}

// Planning -------------------------------------------------------------------

function sameMoney(a: number, b: number): boolean {
  return Math.round(a * 10000) === Math.round(b * 10000);
}

function same(before: unknown, after: unknown): boolean {
  if (typeof before === "number" && typeof after === "number") return sameMoney(before, after);
  return before === after;
}

/** The fields of want that differ from the card, as a patch and a readable list. */
function diff(card: CardRow, want: CardPatch, names: ReadonlyMap<string, string>): { patch: CardPatch; changes: FieldChange[] } {
  const patch: CardPatch = {};
  const changes: FieldChange[] = [];
  for (const [field, after] of Object.entries(want) as [keyof CardPatch, unknown][]) {
    const before = card[field];
    if (same(before, after)) continue;
    (patch as Record<string, unknown>)[field] = after;
    if (field === "executor_role_id") {
      changes.push({
        field: "executor",
        before: typeof before === "string" ? (names.get(before) ?? before) : before,
        after: typeof after === "string" ? (names.get(after) ?? after) : after,
      });
    } else {
      changes.push({ field, before, after });
    }
  }
  return { patch, changes };
}

/**
 * The definition of ready, as set_card_horizon and file_card refuse it, for a
 * card moving to horizon now. Null when the card is ready.
 */
export function readinessRefusal(entry: ReadyEntry, role: RoleRow | undefined): string | null {
  if (entry.title.trim() === "") return "A title is required";
  if (entry.summary.trim() === "") return "A public summary is required";
  if (entry.summary.trim().length > SUMMARY_MAX) return `The public summary must be ${SUMMARY_MAX} characters or fewer`;
  if (entry.intent.trim() === "") return "An intent is required";
  if (entry.lane === "config" && entry.folder !== "seed-1") return "The config lane exists only for seed-1";
  if (entry.lane === "code" && entry.folder === "platform") return "The platform code lane is closed at launch";
  if (!CHECK_LINE.test(entry.acceptance_test)) return "The acceptance test needs a check: line";
  try {
    parseChecks(entry.acceptance_test);
  } catch (error) {
    if (error instanceof AcceptanceGrammarError) return `A check: line does not parse: ${error.message}`;
    throw error;
  }
  if (role === undefined) return `The executor "${entry.executor}" is not a role`;
  if (role.state !== "active") return `The executor "${entry.executor}" must be an active role`;
  if (!(entry.funding_target_usd > 0)) return "The funding target must be above zero";
  return null;
}

/** The fields a ready card is written with, on horizon now. */
function readyPatch(entry: ReadyEntry, executorId: string): CardPatch {
  return {
    title: entry.title,
    summary: entry.summary,
    intent: entry.intent,
    acceptance_test: entry.acceptance_test,
    lane: entry.lane,
    folder: entry.folder,
    executor_role_id: executorId,
    funding_target_usd: entry.funding_target_usd,
    // file_card's rule: the dispatcher checks the pool against the estimate before it starts a card.
    estimate_usd: entry.funding_target_usd,
    horizon: "now",
    rank: entry.rank,
    board_reason: entry.reason,
  };
}

async function readyRefusal(entry: ReadyEntry, role: RoleRow | undefined, repoRoot: string): Promise<string | null> {
  const refusal = readinessRefusal(entry, role);
  if (refusal !== null) return refusal;
  const rejection = await preCheckRejection(entry.acceptance_test, repoRoot);
  return rejection === null ? null : `The dispatcher's pre-check rejects it: ${rejection.failingCheck} (${rejection.detail})`;
}

/**
 * Reads the cards and roles the file names and works out every write. Nothing
 * is written. repoRoot is where the seed-1 files for the pre-check are read.
 */
export async function planRefresh(seed: LaunchCards, store: CardStore, repoRoot: string): Promise<Plan> {
  const steps: Step[] = [];
  const refusals: Refusal[] = [];
  const refuse = (section: Section, title: string, why: string) => refusals.push({ section, title, why });

  const byId = new Map((await store.cardsById([...seed.live, ...seed.open, ...seed.retire].map((e) => e.id))).map((c) => [c.id, c]));
  const byTitle = await store.cardsByTitle(seed.new.map((e) => e.title));
  const executorNames = [...new Set([...seed.open, ...seed.new].map((e) => e.executor))];
  const roles = await store.rolesByName(executorNames);
  const roleByName = new Map(roles.map((r) => [r.name, r]));
  const nameById = new Map(roles.map((r) => [r.id, r.name]));

  // The card an entry names, when it exists, carries the expected title and is at an allowed stage.
  function found(section: Section, id: string, was: string, titles: readonly string[], stages: readonly string[]): CardRow | null {
    const card = byId.get(id);
    if (card === undefined) {
      refuse(section, was, `card ${id} does not exist`);
      return null;
    }
    if (!titles.includes(card.title)) {
      refuse(section, was, `card ${id} is titled "${card.title}" now, which this file does not expect; check it before rerunning`);
      return null;
    }
    if (!stages.includes(card.stage)) {
      refuse(section, was, `card ${id} is at stage ${card.stage}; this list takes ${stages.join(", ")}`);
      return null;
    }
    return card;
  }

  for (const entry of seed.live) {
    const card = found("live", entry.id, entry.was, [entry.was, entry.title], ["live"]);
    if (card === null) continue;
    // Only the words change. The board's reason on a live card says why it was built, which is history.
    const { patch, changes } = diff(card, { title: entry.title, summary: entry.summary }, nameById);
    steps.push(
      changes.length === 0
        ? { action: "none", section: "live", id: card.id, title: entry.title, note: "already as written" }
        : { action: "update", section: "live", id: card.id, title: entry.title, expectedStage: card.stage, patch, changes, reason: entry.reason },
    );
  }

  const planReady = async (section: "open" | "new", entry: ReadyEntry, card: CardRow) => {
    if (card.shape !== "goal") {
      refuse(section, entry.title, `card ${card.id} is a ${card.shape} card; only goal cards take contributions`);
      return;
    }
    const role = roleByName.get(entry.executor);
    const refusal = await readyRefusal(entry, role, repoRoot);
    if (refusal !== null) {
      refuse(section, entry.title, refusal);
      return;
    }
    const { patch, changes } = diff(card, readyPatch(entry, role!.id), nameById);
    if (changes.some((c) => c.field === "funding_target_usd") && card.funded_usd > 0) {
      refuse(section, entry.title, `card ${card.id} holds ${card.funded_usd.toFixed(4)} on its bar; change its target from /board`);
      return;
    }
    steps.push(
      changes.length === 0
        ? { action: "none", section, id: card.id, title: entry.title, note: "already as written" }
        : { action: "update", section, id: card.id, title: entry.title, expectedStage: card.stage, patch, changes, reason: entry.reason },
    );
  };

  for (const entry of seed.open) {
    const card = found("open", entry.id, entry.was, [entry.was, entry.title], OPEN_STAGES);
    if (card !== null) await planReady("open", entry, card);
  }

  for (const entry of seed.retire) {
    const card = byId.get(entry.id);
    if (card !== undefined && card.stage === "rejected" && card.title === entry.was) {
      steps.push({ action: "none", section: "retire", id: card.id, title: entry.was, note: "already retired" });
      continue;
    }
    const open = found("retire", entry.id, entry.was, [entry.was], RETIRABLE_STAGES);
    if (open === null) continue;
    if (open.funded_usd > 0) {
      refuse("retire", entry.was, `card ${open.id} holds ${open.funded_usd.toFixed(4)} on its bar; cancel it from /board so the money rules apply`);
      continue;
    }
    const { patch, changes } = diff(open, { stage: "rejected", board_reason: entry.reason }, nameById);
    steps.push({ action: "update", section: "retire", id: open.id, title: entry.was, expectedStage: open.stage, patch, changes, reason: entry.reason });
  }

  for (const entry of seed.new) {
    const matches = byTitle.filter((c) => c.title === entry.title && c.stage !== "rejected");
    if (matches.length > 1) {
      refuse("new", entry.title, `${matches.length} cards already carry this title: ${matches.map((c) => c.id).join(", ")}`);
      continue;
    }
    const existing = matches[0];
    if (existing !== undefined) {
      if (OPEN_STAGES.includes(existing.stage)) {
        await planReady("new", entry, existing);
      } else {
        steps.push({ action: "none", section: "new", id: existing.id, title: entry.title, note: `filed before and now at stage ${existing.stage}; left alone` });
      }
      continue;
    }
    const role = roleByName.get(entry.executor);
    const refusal = await readyRefusal(entry, role, repoRoot);
    if (refusal !== null) {
      refuse("new", entry.title, refusal);
      continue;
    }
    steps.push({
      action: "insert",
      section: "new",
      title: entry.title,
      executor: entry.executor,
      reason: entry.reason,
      row: {
        bucket: entry.bucket,
        source: "board",
        shape: "goal",
        lane: entry.lane,
        priority: 100,
        board_reason: entry.reason,
        folder: entry.folder,
        executor_role_id: role!.id,
        title: entry.title,
        summary: entry.summary,
        intent: entry.intent,
        acceptance_test: entry.acceptance_test,
        funding_target_usd: entry.funding_target_usd,
        funded_usd: 0,
        estimate_usd: entry.funding_target_usd,
        confidence: "low",
        proposer_role_id: null,
        stage: entry.stage,
        horizon: "now",
        rank: entry.rank,
      },
    });
  }

  return { steps, refusals };
}

// Output and apply -----------------------------------------------------------

function show(value: unknown): string {
  return JSON.stringify(value);
}

/** The plan as printed lines: every write with each field before and after, and the board's reason. */
export function describePlan(plan: Plan): string[] {
  const lines: string[] = [];
  for (const step of plan.steps) {
    if (step.action === "none") {
      lines.push(`unchanged ${step.section} ${step.id ?? ""} ${show(step.title)}: ${step.note}`.replace(/\s+/g, " "));
      continue;
    }
    if (step.action === "update") {
      lines.push(`update ${step.section} ${step.id} ${show(step.title)} (stage ${step.expectedStage})`);
      for (const change of step.changes) lines.push(`  ${change.field}: ${show(change.before)} -> ${show(change.after)}`);
    } else {
      const r = step.row;
      lines.push(
        `insert new ${show(step.title)} (${r.folder} ${r.lane}, ${step.executor}, stage ${r.stage}, target ${r.funding_target_usd.toFixed(4)}, horizon ${r.horizon}, rank ${r.rank})`,
      );
      lines.push(`  summary: ${show(r.summary)}`);
      lines.push(`  intent: ${show(r.intent)}`);
      lines.push(`  acceptance_test: ${show(r.acceptance_test)}`);
    }
    // A live card keeps the board's reason for building it, so the reason for a rewrite is printed, not written.
    const written = step.action === "insert" || "board_reason" in step.patch;
    lines.push(`  reason: ${show(step.reason)}${written ? "" : " (printed only; the card keeps its board reason)"}`);
  }
  for (const refusal of plan.refusals) lines.push(`refused ${refusal.section} ${show(refusal.title)}: ${refusal.why}`);
  return lines;
}

export function countPlan(plan: Plan): { updates: number; inserts: number; unchanged: number } {
  return {
    updates: plan.steps.filter((s) => s.action === "update").length,
    inserts: plan.steps.filter((s) => s.action === "insert").length,
    unchanged: plan.steps.filter((s) => s.action === "none").length,
  };
}

/**
 * Writes the plan in order, updates first. A plan with refusals writes
 * nothing. An update whose card moved stage since the plan stops the run;
 * the writes before it stand, and a rerun plans from there.
 */
export async function applyPlan(plan: Plan, store: CardStore, log: (line: string) => void = () => {}): Promise<{ updated: number; inserted: string[] }> {
  if (plan.refusals.length > 0) throw new Error(`${plan.refusals.length} refusal(s) in the plan; nothing written`);
  let updated = 0;
  const inserted: string[] = [];
  for (const step of plan.steps) {
    if (step.action !== "update") continue;
    if (!(await store.updateCard(step.id, step.expectedStage, step.patch))) {
      throw new Error(`card ${step.id} is no longer at stage ${step.expectedStage}; stopped after ${updated} update(s), rerun to plan again`);
    }
    updated += 1;
    log(`updated ${step.section} ${step.id} ${show(step.title)}`);
  }
  for (const step of plan.steps) {
    if (step.action !== "insert") continue;
    const id = await store.insertCard(step.row);
    inserted.push(id);
    log(`inserted ${id} ${show(step.title)}`);
  }
  return { updated, inserted };
}

// Supabase -------------------------------------------------------------------

const CARD_COLUMNS =
  "id,title,summary,intent,acceptance_test,bucket,source,shape,lane,folder,executor_role_id,funding_target_usd,funded_usd,estimate_usd,stage,board_reason,horizon,rank";

type Result<T> = { data: T; error: null } | { data: null; error: { message: string } };

function check<T>(label: string, result: Result<T>): T {
  if (result.error !== null) {
    const message = result.error.message;
    if (/(horizon|rank)/.test(message) && /does not exist/.test(message)) {
      throw new Error(`${label}: ${message}. cards.horizon and cards.rank come from migration 20260922000300_backlog; apply it first`);
    }
    throw new Error(`${label}: ${message}`);
  }
  return result.data;
}

function toCard(row: CardRow): CardRow {
  return {
    ...row,
    funding_target_usd: Number(row.funding_target_usd),
    funded_usd: Number(row.funded_usd),
    estimate_usd: Number(row.estimate_usd),
  };
}

export function supabaseStore(db: SupabaseClient): CardStore {
  return {
    async cardsById(ids) {
      if (ids.length === 0) return [];
      return check("cards read", await db.from("cards").select(CARD_COLUMNS).in("id", [...ids]).returns<CardRow[]>()).map(toCard);
    },
    async cardsByTitle(titles) {
      if (titles.length === 0) return [];
      return check("cards read", await db.from("cards").select(CARD_COLUMNS).in("title", [...titles]).returns<CardRow[]>()).map(toCard);
    },
    async rolesByName(names) {
      if (names.length === 0) return [];
      return check("roles read", await db.from("roles").select("id,name,state").in("name", [...names]).returns<RoleRow[]>());
    },
    async updateCard(id, expectedStage, patch) {
      const rows = check(
        "cards update",
        await db.from("cards").update(patch).eq("id", id).eq("stage", expectedStage).select("id").returns<{ id: string }[]>(),
      );
      return rows.length === 1;
    },
    async insertCard(row) {
      return check("cards insert", await db.from("cards").insert(row).select("id").single<{ id: string }>()).id;
    },
  };
}

// Command line ---------------------------------------------------------------

export function parseArgs(argv: readonly string[]): { apply: boolean } {
  let mode: "dry-run" | "apply" | null = null;
  for (const arg of argv) {
    // pnpm passes the "--" separator through to the script.
    if (arg === "--") continue;
    if (arg !== "--dry-run" && arg !== "--apply") throw new UsageError(`Unknown argument ${arg}; pass --dry-run or --apply`);
    const next = arg === "--apply" ? "apply" : "dry-run";
    if (mode !== null && mode !== next) throw new UsageError("Pass --dry-run or --apply, not both");
    mode = next;
  }
  if (mode === null) throw new UsageError("Pass --dry-run to print the changes or --apply to write them");
  return { apply: mode === "apply" };
}

async function main(): Promise<void> {
  const { apply } = parseArgs(process.argv.slice(2));
  const seed = loadLaunchCards();
  const store = supabaseStore(serviceClient(loadRepoEnv()));
  const plan = await planRefresh(seed, store, REPO_ROOT);
  const mode = apply ? "apply" : "dry run";
  console.log(`${mode}: ${seed.live.length} live, ${seed.open.length} open, ${seed.retire.length} to retire, ${seed.new.length} new`);
  for (const line of describePlan(plan)) console.log(line);
  const counts = countPlan(plan);
  if (plan.refusals.length > 0) {
    throw new Error(`${plan.refusals.length} card(s) refused; nothing written`);
  }
  if (!apply) {
    console.log(`dry run: ${counts.updates} update(s), ${counts.inserts} insert(s), ${counts.unchanged} unchanged; nothing written, pass --apply to write`);
    return;
  }
  const result = await applyPlan(plan, store, (line) => console.log(line));
  console.log(`done: ${result.updated} updated, ${result.inserted.length} inserted, ${counts.unchanged} unchanged`);
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`refresh-cards failed: ${message}`);
    process.exit(err instanceof UsageError ? 2 : 1);
  });
}
