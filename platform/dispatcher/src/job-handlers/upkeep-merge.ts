// upkeep_merge, the dependency patch merge (docs/specs/agent-upkeep.md, R23). Hourly on pg_cron, code
// only. It first settles a merge an earlier run left pending (below), while the studio is paused too.
// It then merges nothing while the studio is paused or main's gate is red. Otherwise it works
// through the open pull requests dependabot[bot] opened, oldest first, and merges at most one a run,
// only when every condition holds, checked in this order:
// - verified: GitHub verified the head commit;
// - files: the change touches only package.json files and pnpm-lock.yaml, each modified in place;
// - semver_patch: every package.json keeps its keys and changes only dependency version strings, each
//   a patch of the same major and minor; every version the lockfile adds is a patch of a version of
//   the same package it had;
// - new_package: the lockfile names no package it did not name before;
// - never_list: no changed package is one the host runs with the dispatcher's secrets: anything in the
//   lockfile's dependency closure of the platform/dispatcher importer (dependencies and dev
//   dependencies, so tsx, its loader, is in), of @electric-sql/pglite (the daily check's schema
//   fingerprint), esbuild, vite or pnpm, in the lockfile before or after the change;
// - release_age: every version the lockfile adds is at least seven days old on the npm registry;
// - base: the pull request is built on main's head; if not, it comments "@dependabot rebase" once for
//   that head commit and waits;
// - gate: the gate is green at the head sha, read once, so while Actions cannot run it fails closed at
//   once instead of polling.
// It then merges the head sha under the dispatcher's merge lock, and deploys and smoke-tests both
// sites the lockfile builds with the card path's own functions (netlify.ts waitForDeploy, smoke.ts
// runSmoke, netlify.ts restoreDeploy, github.ts revertMerge): a failed deploy or smoke, or a check that
// could not run, restores each site's last green deploy and reverts the merge on main, and a revert
// that fails pauses the studio. A pseudo-card over pipeline.ts verifyMerged would need a cards row for
// its events and stages, which a Dependabot pull request does not have (the spec's Decisions).
// Pending, as the card path leaves a card gated: the run's output records the pull request before the
// merge request and the merge sha after it (db.noteJobRunOutput, which a stop or a crash keeps). A run
// that stops before a verdict (the dispatcher stopping, the Janitor paused), or a merge answer that was
// lost, rolls nothing back: the merge stays pending, the board is told, and the next run, or the run
// startup queues (queuePendingUpkeep), settles it first (settlePending). The gate's payment-host scan
// is what stops a patch that rewrites the payment link. Every decision, naming the condition that
// failed, is in the run's output; every other pull request waits for the board.
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CardFolder } from '../adapters/types.js';
import {
  commentOnPull,
  commitInfo,
  compareRange,
  COMPARE_FILE_LIMIT,
  fileAtRef,
  gateStatus,
  isInfrastructureConclusion,
  mainHead,
  mergePullRequest,
  openPullsByAuthor,
  pullComments,
  readPullRequest,
  requestSignal,
  revertMerge,
  waitForGate,
  type AuthorPull,
  type GitHubOptions,
} from '../github.js';
import type { Alerter } from '../alert.js';
import type { Db } from '../db.js';
import type { JobContext, JobHandler } from '../jobs.js';
import { mergeLock } from '../lock.js';
import { errorMessage, type Logger } from '../log.js';
import { restoreDeploy, siteUrl, waitForDeploy, type NetlifyOptions } from '../netlify.js';
import { runSmoke } from '../smoke.js';
import { retry } from '../time.js';
import { requireUpkeep, UPKEEP_TIMINGS, type UpkeepDeps } from './upkeep.js';

export const DEPENDABOT = 'dependabot[bot]';
export const LOCKFILE = 'pnpm-lock.yaml';
export const REBASE_COMMENT = '@dependabot rebase';
const WRITERS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
export const RELEASE_AGE_MS = 7 * 24 * 60 * 60_000;
export const NEVER_ALWAYS: readonly string[] = ['esbuild', 'vite', 'pnpm'];
// The lockfile importer the dispatcher runs from, and the packages the host runs beside it: the daily
// check runs PGlite through tsx (upkeep.ts migrationsFingerprintRunner).
export const DISPATCHER_IMPORTER = 'platform/dispatcher';
export const HOST_PACKAGES: readonly string[] = ['@electric-sql/pglite'];
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;
// Both sites a lockfile change builds that the dispatcher deploys and smoke-tests (the board's site
// builds too, and is kernel).
export const UPKEEP_FOLDERS: readonly CardFolder[] = ['platform', 'seed-1'];

export type Condition = 'verified' | 'files' | 'semver_patch' | 'new_package' | 'never_list' | 'release_age' | 'base' | 'gate';

export type Decision =
  | { pr: number; result: 'refused'; condition: Condition; detail: string }
  | { pr: number; result: 'rebase_requested' | 'waiting_for_rebase'; detail: string }
  | { pr: number; result: 'main_moved' | 'stopped'; detail: string }
  | { pr: number; result: 'merged'; sha: string; detail: string }
  | { pr: number; result: 'rolled_back'; sha: string; detail: string; revert_sha: string | null; problems: string[] }
  // Merged, or maybe merged, with no verdict yet; the next run settles it.
  | { pr: number; result: 'pending'; sha: string | null; detail: string }
  // A pending merge settled with no verdict: GitHub never merged it, or main moved before it was verified.
  | { pr: number; result: 'not_merged' | 'left_for_board'; sha: string | null; detail: string }
  | { pr: number; result: 'merge_refused' | 'unchecked'; detail: string };

// "^1.2.3" and "1.2.4" style versions: an optional range prefix, then major.minor.patch.
const VERSION = /^([~^]?)(\d+)\.(\d+)\.(\d+)$/;

// True when next is a later patch of prev with the same prefix, major and minor.
export function isPatchBump(prev: string, next: string): boolean {
  const a = VERSION.exec(prev);
  const b = VERSION.exec(next);
  if (!a || !b) return false;
  return a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && Number(b[4]) > Number(a[4]);
}

export interface PackageChange {
  name: string;
  from: string;
  to: string;
}

// The dependency version changes between two package.json texts, or the reason they are not only that.
export function packageJsonChanges(file: string, baseText: string, headText: string): { ok: true; changes: PackageChange[] } | { ok: false; detail: string } {
  let base: Record<string, unknown>;
  let head: Record<string, unknown>;
  try {
    base = JSON.parse(baseText) as Record<string, unknown>;
    head = JSON.parse(headText) as Record<string, unknown>;
  } catch {
    return { ok: false, detail: `${file} is not JSON` };
  }
  const keys = (value: Record<string, unknown>) => Object.keys(value).sort().join(',');
  if (keys(base) !== keys(head)) return { ok: false, detail: `${file} adds or removes a key` };
  const changes: PackageChange[] = [];
  for (const key of Object.keys(base)) {
    const fields: readonly string[] = DEPENDENCY_FIELDS;
    if (!fields.includes(key)) {
      if (JSON.stringify(base[key]) !== JSON.stringify(head[key])) return { ok: false, detail: `${file} changes ${key}, which is not a dependency version` };
      continue;
    }
    const was = base[key] as Record<string, unknown>;
    const now = head[key] as Record<string, unknown>;
    if (typeof was !== 'object' || was === null || typeof now !== 'object' || now === null || keys(was) !== keys(now)) {
      return { ok: false, detail: `${file} adds or removes a package in ${key}` };
    }
    for (const name of Object.keys(was)) {
      if (was[name] === now[name]) continue;
      if (typeof was[name] !== 'string' || typeof now[name] !== 'string' || !isPatchBump(was[name] as string, now[name] as string)) {
        return { ok: false, detail: `${file} moves ${name} from ${String(was[name])} to ${String(now[name])}, which is not a patch` };
      }
      changes.push({ name, from: was[name] as string, to: now[name] as string });
    }
  }
  return { ok: true, changes };
}

// A lockfile package or snapshot key's package name: name@version, then any (peer) suffix.
function keyName(key: string): string | null {
  const bare = key.replace(/\(.*$/, '');
  const at = bare.lastIndexOf('@');
  return at <= 0 ? null : bare.slice(0, at);
}

// A lockfile's packages, as name to versions. A v9 key is name@version; a scoped name starts with @.
export function lockPackages(text: string): Map<string, Set<string>> {
  const doc = parseYaml(text) as { packages?: Record<string, unknown> } | null;
  const out = new Map<string, Set<string>>();
  for (const key of Object.keys(doc?.packages ?? {})) {
    const name = keyName(key);
    if (name === null) continue;
    const version = key.replace(/\(.*$/, '').slice(name.length + 1);
    if (!out.has(name)) out.set(name, new Set());
    out.get(name)!.add(version);
  }
  return out;
}

type DependencyMap = Record<string, unknown>;
const LOCK_DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

// The never list from one lockfile: every package name in the dependency closure of the dispatcher's
// importer, its dev dependencies included, and of the host packages, plus NEVER_ALWAYS. A workspace
// link is followed into its importer. Throws when the lockfile names no dispatcher importer, so the
// caller refuses rather than merging with an empty list.
export function neverList(text: string): Set<string> {
  const doc = parseYaml(text) as { importers?: Record<string, DependencyMap | null>; snapshots?: Record<string, DependencyMap | null> } | null;
  const importers = doc?.importers ?? {};
  const snapshots = doc?.snapshots ?? {};
  if (!importers[DISPATCHER_IMPORTER]) throw new Error(`${LOCKFILE} names no ${DISPATCHER_IMPORTER} importer`);
  const names = new Set<string>(NEVER_ALWAYS);
  const seenKeys = new Set<string>();
  const seenImporters = new Set<string>();
  const keys: string[] = [];
  const importerQueue: string[] = [DISPATCHER_IMPORTER];
  // A dependency of an importer or a snapshot: name to version, or to an aliased name@version, or to
  // link:<path> for a workspace package.
  const follow = (from: string | null, name: string, version: unknown) => {
    names.add(name);
    if (typeof version !== 'string') return;
    if (version.startsWith('link:')) {
      if (from !== null) importerQueue.push(path.posix.normalize(path.posix.join(from, version.slice('link:'.length))));
      return;
    }
    const key = Object.hasOwn(snapshots, `${name}@${version}`) ? `${name}@${version}` : version;
    if (!Object.hasOwn(snapshots, key)) return;
    const real = keyName(key);
    if (real) names.add(real);
    keys.push(key);
  };
  const fields = (entry: DependencyMap | null | undefined, from: string | null) => {
    for (const field of LOCK_DEPENDENCY_FIELDS) {
      const deps = entry?.[field];
      if (typeof deps !== 'object' || deps === null) continue;
      for (const [name, value] of Object.entries(deps as DependencyMap)) {
        // An importer's entry is { specifier, version }; a snapshot's is the version itself.
        follow(from, name, typeof value === 'object' && value !== null ? (value as { version?: unknown }).version : value);
      }
    }
  };
  for (const key of Object.keys(snapshots)) {
    const name = keyName(key);
    if (name !== null && HOST_PACKAGES.includes(name)) {
      names.add(name);
      keys.push(key);
    }
  }
  while (importerQueue.length > 0 || keys.length > 0) {
    const importer = importerQueue.pop();
    if (importer !== undefined) {
      if (seenImporters.has(importer)) continue;
      seenImporters.add(importer);
      fields(importers[importer], importer);
      continue;
    }
    const key = keys.pop()!;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    fields(snapshots[key], null);
  }
  return names;
}

export interface LockChange {
  added: Array<{ name: string; version: string }>;
  changedNames: string[];
}

export function lockfileChanges(baseText: string, headText: string): { ok: true; change: LockChange } | { ok: false; condition: 'new_package' | 'semver_patch'; detail: string } {
  const base = lockPackages(baseText);
  const head = lockPackages(headText);
  const added: Array<{ name: string; version: string }> = [];
  const changed = new Set<string>();
  for (const [name, versions] of head) {
    const before = base.get(name);
    if (!before) return { ok: false, condition: 'new_package', detail: `${LOCKFILE} adds the package ${name}` };
    for (const version of versions) {
      if (before.has(version)) continue;
      if (![...before].some((was) => isPatchBump(was, version))) {
        return { ok: false, condition: 'semver_patch', detail: `${LOCKFILE} adds ${name}@${version}, which is not a patch of ${[...before].join(', ')}` };
      }
      added.push({ name, version });
      changed.add(name);
    }
  }
  for (const [name, versions] of base) {
    const after = head.get(name);
    if (!after || [...versions].some((version) => !after.has(version))) changed.add(name);
  }
  return { ok: true, change: { added, changedNames: [...changed].sort() } };
}

// When the registry published a version, or null when it does not list it.
async function publishedAt(fetchFn: typeof fetch, name: string, version: string, cache: Map<string, Record<string, unknown>>): Promise<number | null> {
  let times = cache.get(name);
  if (!times) {
    const path = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
    const response = await fetchFn(`https://registry.npmjs.org/${path}`, { method: 'GET', signal: requestSignal(undefined, undefined), headers: { Accept: 'application/json', 'User-Agent': 'backseat-dispatcher' } });
    const body = await response.text();
    if (response.status !== 200) throw new Error(`npm registry ${name}: http ${response.status}`);
    const doc = JSON.parse(body) as { time?: Record<string, unknown> };
    times = doc.time ?? {};
    cache.set(name, times);
  }
  const at = times[version];
  return typeof at === 'string' && Number.isFinite(Date.parse(at)) ? Date.parse(at) : null;
}

interface Evaluation {
  decision: Decision | null;
  // Set when every condition holds: the sha main must still be at.
  mainSha?: string;
}

async function evaluate(pull: AuthorPull, mainSha: string, deps: UpkeepDeps, github: GitHubOptions, now: Date): Promise<Evaluation> {
  const refuse = (condition: Condition, detail: string): Evaluation => ({ decision: { pr: pull.number, result: 'refused', condition, detail } });
  const fetchFn = deps.fetchFn ?? fetch;

  const commit = await commitInfo(github, pull.headSha);
  if (!commit.verified) return refuse('verified', `GitHub did not verify ${pull.headSha.slice(0, 8)} (${commit.reason ?? 'no reason given'})`);

  const range = await compareRange(github, mainSha, pull.headSha);
  if (range.mergeBaseSha === null) return refuse('files', 'the pull request shares no history with main');
  if (range.files.length === 0 || range.files.length >= COMPARE_FILE_LIMIT) return refuse('files', `the change lists ${range.files.length} files`);
  for (const file of range.files) {
    const isPackage = file.path === 'package.json' || file.path.endsWith('/package.json');
    if (!(isPackage || file.path === LOCKFILE) || file.status !== 'modified') {
      return refuse('files', `${file.path} (${file.status}) is not a package.json or ${LOCKFILE} changed in place`);
    }
  }
  const mergeBase = range.mergeBaseSha;
  const read = async (file: string, ref: string) => {
    const text = await fileAtRef(github, file, ref);
    if (text === null) throw new Error(`${file} is missing at ${ref.slice(0, 8)}`);
    return text;
  };

  const direct: PackageChange[] = [];
  for (const file of range.files.filter((f) => f.path !== LOCKFILE)) {
    const result = packageJsonChanges(file.path, await read(file.path, mergeBase), await read(file.path, pull.headSha));
    if (!result.ok) return refuse('semver_patch', result.detail);
    direct.push(...result.changes);
  }
  let lock: LockChange = { added: [], changedNames: [] };
  const lockChanged = range.files.some((f) => f.path === LOCKFILE);
  if (lockChanged) {
    const result = lockfileChanges(await read(LOCKFILE, mergeBase), await read(LOCKFILE, pull.headSha));
    if (!result.ok) return refuse(result.condition, result.detail);
    lock = result.change;
  }

  // The never list is read from the lockfile before and after the change, so a patch cannot move a
  // package into the dispatcher's closure and out of the list's reach.
  const never = new Set<string>();
  const lockTexts = [await read(LOCKFILE, mergeBase), ...(lockChanged ? [await read(LOCKFILE, pull.headSha)] : [])];
  for (const text of lockTexts) {
    let names: Set<string>;
    try {
      names = neverList(text);
    } catch (error) {
      return refuse('never_list', `the never list could not be read: ${errorMessage(error)}`);
    }
    for (const name of names) never.add(name);
  }
  const touched = [...new Set([...direct.map((c) => c.name), ...lock.changedNames])].sort();
  const forbidden = touched.filter((name) => never.has(name));
  if (forbidden.length > 0) return refuse('never_list', `${forbidden.join(', ')} ${forbidden.length === 1 ? 'is' : 'are'} on the never list`);

  const times = new Map<string, Record<string, unknown>>();
  for (const { name, version } of lock.added) {
    const at = await publishedAt(fetchFn, name, version, times);
    if (at === null) return refuse('release_age', `the npm registry does not list ${name}@${version}`);
    if (now.getTime() - at < RELEASE_AGE_MS) return refuse('release_age', `${name}@${version} was published ${new Date(at).toISOString()}, less than seven days ago`);
  }

  if (range.behindBy !== 0 || mergeBase !== mainSha) {
    const comments = await pullComments(github, pull.number);
    const since = commit.committedAt === null ? 0 : Date.parse(commit.committedAt);
    // Dependabot acts only on a command from someone who can write to the repository, and the
    // repository is public: a stranger's "@dependabot rebase" changes nothing, so it must not count as
    // the request this job is waiting on.
    const asked = comments.some((c) => c.body.trim() === REBASE_COMMENT && WRITERS.has(c.authorAssociation) && Date.parse(c.createdAt) >= since);
    if (asked) return { decision: { pr: pull.number, result: 'waiting_for_rebase', detail: `built on ${mergeBase.slice(0, 8)}, not main's ${mainSha.slice(0, 8)}; a rebase was asked for` } };
    await commentOnPull(github, pull.number, REBASE_COMMENT);
    return { decision: { pr: pull.number, result: 'rebase_requested', detail: `built on ${mergeBase.slice(0, 8)}, not main's ${mainSha.slice(0, 8)}; commented ${REBASE_COMMENT}` } };
  }

  const gate = await gateStatus(github, pull.headSha);
  if (gate.state !== 'pass') return refuse('gate', `the gate at ${pull.headSha.slice(0, 8)} is ${gate.state === 'fail' ? `failed (${gate.conclusion})` : gate.state}`);
  return { decision: null, mainSha };
}

function siteId(deps: UpkeepDeps, folder: CardFolder): string {
  return folder === 'seed-1' ? deps.config.netlifySiteIdSeed : deps.config.netlifySiteIdPlatform;
}

// A merge this job made and has not judged: written to the run's output before the merge request,
// with the merge sha once GitHub answers, and cleared at the verdict. Every run that reads it writes
// the output key `pending` again, so the newest run with that key holds the current state.
export interface PendingMerge {
  pr: number;
  title: string;
  head_sha: string;
  // Null until GitHub answered the merge; a lost answer leaves it null, and the pull request says.
  merge_sha: string | null;
  run: string;
}

const PENDING_KEY = 'pending';

function toPending(value: unknown): PendingMerge | null {
  if (value === null || value === undefined) return null;
  const p = value as Record<string, unknown>;
  if (typeof p !== 'object' || typeof p.pr !== 'number' || typeof p.title !== 'string' || typeof p.head_sha !== 'string' || !(p.merge_sha === null || typeof p.merge_sha === 'string') || typeof p.run !== 'string') {
    throw new Error(`the pending upkeep merge recorded in job_runs is malformed: ${JSON.stringify(value).slice(0, 200)}`);
  }
  return { pr: p.pr, title: p.title, head_sha: p.head_sha, merge_sha: p.merge_sha as string | null, run: p.run };
}

// The merge an earlier run left unverified, or null.
export async function readPending(db: Db, job = 'upkeep_merge'): Promise<PendingMerge | null> {
  return toPending((await db.latestJobRunOutput(job, PENDING_KEY))?.[PENDING_KEY]);
}

function stopReason(context: JobContext): string {
  return `the run stopped (${String(context.stopSignal.reason ?? 'stopped')})`;
}

// No verdict, because the run stopped (the dispatcher stopping, or the Janitor paused) or the merge's
// answer was lost: nothing is restored or reverted, as a card merged but not verified stays gated
// (pipeline.ts verifyMerged). The merge stays pending in the run's output; the next run, or the run
// startup queues, verifies it.
async function leavePending(context: JobContext, pull: { number: number; title: string }, sha: string | null, why: string): Promise<Decision> {
  const merged = sha === null ? 'may have merged' : `merged as ${sha.slice(0, 8)}`;
  context.log.warn('upkeep_merge', `pull request ${pull.number} left pending`, { sha, why });
  await context.alert.notify(
    `Upkeep ${merged} pull request #${pull.number} (${pull.title}), and ${why} before a verdict. Nothing was rolled back; the next upkeep_merge run verifies it, or leaves it for the board if main has moved.`,
  );
  return { pr: pull.number, result: 'pending', sha, detail: `${merged}; ${why}, so it is verified by the next run` };
}

// Deploys and smoke-tests each site at the merge sha, then records it green, or rolls the merge back.
// A run that stops before a verdict leaves the merge pending instead of rolling it back.
async function verifyMerge(context: JobContext, deps: UpkeepDeps, github: GitHubOptions, pull: { number: number; title: string }, sha: string): Promise<Decision> {
  const t = { ...UPKEEP_TIMINGS, ...deps.timings };
  const netlify: NetlifyOptions = { token: deps.config.netlifyAuthToken, fetchFn: deps.fetchFn };
  const verified: Array<{ folder: CardFolder; deployId: string; summary: string }> = [];
  const published = new Set<CardFolder>();
  let failure: string | null = null;
  for (const folder of UPKEEP_FOLDERS) {
    try {
      const deploy = await waitForDeploy(netlify, siteId(deps, folder), sha, { timeoutMs: t.deployTimeoutMs, intervalMs: t.deployIntervalMs, signal: context.stopSignal });
      if (context.stopSignal.aborted) return await leavePending(context, pull, sha, `${stopReason(context)} while the ${folder} deploy was running`);
      if (!deploy.ok) {
        // One that did not finish in time may still publish, so its site is restored too.
        if (deploy.timedOut) published.add(folder);
        await context.db.insertDeploy({ folder, sha, netlify_deploy_id: deploy.deploy?.id ?? null, is_green: false, smoke_result: `fail: ${deploy.reason}` }).catch(() => undefined);
        failure = `${folder} deploy ${deploy.timedOut ? 'did not finish' : 'failed'}: ${deploy.reason}`;
        break;
      }
      published.add(folder);
      const baseUrl = await retry(() => siteUrl(netlify, siteId(deps, folder)), 3, t.retryDelayMs);
      const smoke = await runSmoke({
        baseUrl,
        sha,
        folder,
        checks: [],
        mergedFiles: () => (folder === 'seed-1' ? deps.servedFiles(sha) : Promise.resolve([])),
        gate: () => waitForGate(github, sha, { timeoutMs: t.gateTimeoutMs, intervalMs: t.gateIntervalMs, signal: context.stopSignal }),
        fetchFn: deps.fetchFn,
        retryDelayMs: t.retryDelayMs,
      });
      if (!smoke.ok) {
        // A gate wait the stop cut short is no verdict.
        if (context.stopSignal.aborted) return await leavePending(context, pull, sha, `${stopReason(context)} while the ${folder} smoke test was running`);
        await context.db.insertDeploy({ folder, sha, netlify_deploy_id: deploy.deploy.id, is_green: false, smoke_result: smoke.summary }).catch(() => undefined);
        failure = `${folder} smoke failed: ${smoke.summary}`;
        break;
      }
      verified.push({ folder, deployId: deploy.deploy.id, summary: smoke.summary });
    } catch (error) {
      if (context.stopSignal.aborted) return await leavePending(context, pull, sha, `${stopReason(context)} while ${folder} was being verified`);
      failure = `${folder} could not be verified after the merge: ${errorMessage(error)}`;
      break;
    }
  }
  if (failure === null) {
    for (const v of verified) {
      const green = await context.db.lastGreen(v.folder).catch(() => null);
      if (green?.sha === sha) continue;
      await context.db.insertDeploy({ folder: v.folder, sha, netlify_deploy_id: v.deployId, is_green: true, smoke_result: v.summary }).catch((error: unknown) =>
        context.log.error('upkeep_merge', 'green deploys row write failed', { folder: v.folder, sha, error: errorMessage(error) }),
      );
    }
    await context.alert.notify(`Upkeep merged pull request #${pull.number} (${pull.title}) as ${sha.slice(0, 8)}; both sites deployed and passed smoke.`);
    return { pr: pull.number, result: 'merged', sha, detail: `merged, deployed and smoke-tested ${UPKEEP_FOLDERS.join(' and ')}` };
  }

  // Roll back: restore each site that may have published the change, then revert main.
  const problems: string[] = [];
  for (const folder of published) {
    try {
      const previous = await context.db.lastGreen(folder);
      if (!previous?.netlify_deploy_id) {
        problems.push(`no green ${folder} deploy exists to restore`);
        continue;
      }
      await retry(() => restoreDeploy(netlify, siteId(deps, folder), previous.netlify_deploy_id!), 3, t.retryDelayMs);
    } catch (error) {
      problems.push(`${folder} restore failed: ${errorMessage(error)}`);
    }
  }
  const revert = await retry(() => revertMerge(github, sha, `Revert upkeep merge of #${pull.number}: ${pull.title}\n\nReason: ${failure}\n`), 3, t.retryDelayMs).catch(
    (error: unknown) => ({ ok: false, reason: errorMessage(error) }) as const,
  );
  if (!revert.ok) {
    problems.push(`revert failed: ${revert.reason}`);
    await context.db.pauseStudio(`dispatcher: the revert of upkeep pull request #${pull.number} failed`, context.now(), 'incident').catch((error: unknown) => problems.push(`the studio could not be paused: ${errorMessage(error)}`));
  }
  await context.alert.notify(
    `Upkeep merged pull request #${pull.number} as ${sha.slice(0, 8)} and it failed: ${failure}. ${problems.length === 0 ? `It was reverted (${revert.ok ? revert.sha.slice(0, 8) : ''}) and the sites restored.` : `The rollback is incomplete: ${problems.join('; ')}. Check main and the live sites.`}`,
  );
  return { pr: pull.number, result: 'rolled_back', sha, detail: failure, revert_sha: revert.ok ? revert.sha : null, problems };
}

// A merge an earlier run left pending is settled before anything else, while the studio is paused
// too, as recovery.ts settles a card merged but not verified:
// - a lost merge answer: the pull request says whether it merged, and its sha; one that did not merge
//   is dropped (it is checked again like any open pull request);
// - both sites already recorded green at the merge: nothing more runs;
// - main still at the merge: its deploy and smoke test run again, with the rollback;
// - main moved since: nothing runs, the board is told, and it is dropped.
// A read that fails, or a run that stops again, leaves it pending.
async function settlePending(context: JobContext, deps: UpkeepDeps, github: GitHubOptions, pending: PendingMerge): Promise<Decision> {
  const pull = { number: pending.pr, title: pending.title };
  try {
    let sha = pending.merge_sha;
    if (sha === null) {
      const state = await readPullRequest(github, pending.pr);
      if (!state.merged || state.mergeCommitSha === null) {
        await context.alert.notify(`Upkeep's merge request for pull request #${pending.pr} (${pending.title}) was lost, and GitHub did not merge it; nothing was merged.`);
        return { pr: pending.pr, result: 'not_merged', sha: null, detail: 'the merge request was lost and GitHub did not merge the pull request' };
      }
      sha = state.mergeCommitSha;
    }
    const merged = sha;
    return await mergeLock.run(async (): Promise<Decision> => {
      const green = await Promise.all(UPKEEP_FOLDERS.map((folder) => context.db.lastGreen(folder)));
      if (green.every((row) => row?.sha === merged)) return { pr: pending.pr, result: 'merged', sha: merged, detail: 'already deployed and smoke-tested' };
      const head = await mainHead(github);
      if (head !== merged) {
        await context.alert.notify(
          `Upkeep merged pull request #${pending.pr} (${pending.title}) as ${merged.slice(0, 8)} and it was never verified, and main has moved to ${head.slice(0, 8)} since. No smoke test or rollback ran; check main and the live sites.`,
        );
        return { pr: pending.pr, result: 'left_for_board', sha: merged, detail: `main moved to ${head.slice(0, 8)} before the merge was verified; left for the board` };
      }
      return verifyMerge(context, deps, github, pull, merged);
    });
  } catch (error) {
    context.log.warn('upkeep_merge', `pending merge of pull request ${pending.pr} could not be settled`, { error: errorMessage(error) });
    return { pr: pending.pr, result: 'pending', sha: pending.merge_sha, detail: `could not be settled (${errorMessage(error).slice(0, 300)}); the next run tries again` };
  }
}

export const upkeepMerge: JobHandler = async (context) => {
  const deps = requireUpkeep(context);
  const github: GitHubOptions = { token: deps.config.githubToken, repo: deps.config.githubRepo, fetchFn: deps.fetchFn };
  const decisions: Decision[] = [];
  let pending = await readPending(context.db, context.job.name);
  // Every output from here carries the pending merge, or null.
  const output = (extra: Record<string, unknown> = {}) => ({ ...extra, decisions, [PENDING_KEY]: pending });
  const note = (extra: Record<string, unknown> = {}) => context.db.noteJobRunOutput(context.run.id, output(extra));

  if (pending) {
    const earlier = pending;
    const settled = await settlePending(context, deps, github, earlier);
    decisions.push(settled);
    if (settled.result === 'pending') {
      pending = { ...earlier, merge_sha: settled.sha ?? earlier.merge_sha };
      return output({ skipped: 'merge_pending' });
    }
    pending = null;
    await note().catch((error: unknown) => context.log.warn('upkeep_merge', 'the settled merge could not be noted; the run output records it', { error: errorMessage(error) }));
  }

  const studio = await context.db.getStudioState();
  if (studio.paused) return output({ skipped: 'studio_paused' });
  const main = await deps.mainGate();
  if (main.status.state === 'fail' && !isInfrastructureConclusion(main.status.conclusion)) return output({ skipped: 'main_red', main: main.sha });

  const pulls = await openPullsByAuthor(github, DEPENDABOT);
  for (const pull of pulls) {
    if (context.stopSignal.aborted) break;
    let evaluation: Evaluation;
    try {
      evaluation = await evaluate(pull, main.sha, deps, github, context.now());
    } catch (error) {
      decisions.push({ pr: pull.number, result: 'unchecked', detail: `could not be checked: ${errorMessage(error).slice(0, 300)}` });
      continue;
    }
    if (evaluation.decision) {
      decisions.push(evaluation.decision);
      continue;
    }
    // Every condition holds: merge that exact sha under the merge lock, then deploy and smoke.
    const decision = await mergeLock.run(async (): Promise<Decision> => {
      const head = await mainHead(github);
      if (head !== evaluation.mainSha) return { pr: pull.number, result: 'main_moved', detail: `main moved to ${head.slice(0, 8)} while the conditions were checked; the next run checks again` };
      if (context.stopSignal.aborted || (await context.db.getStudioState()).paused) {
        return { pr: pull.number, result: 'stopped', detail: 'the studio paused or the run stopped while the conditions were checked; nothing was merged' };
      }
      // The pending record is written before the merge request, so a crash after it is recovered.
      pending = { pr: pull.number, title: pull.title, head_sha: pull.headSha, merge_sha: null, run: context.run.id };
      try {
        await note({ main: main.sha });
      } catch (error) {
        pending = null;
        return { pr: pull.number, result: 'unchecked', detail: `not merged: the pending record could not be written (${errorMessage(error).slice(0, 200)})` };
      }
      const t = { ...UPKEEP_TIMINGS, ...deps.timings };
      const merged = await mergePullRequest(
        github,
        pull.number,
        pull.headSha,
        {
          title: `${pull.title} (#${pull.number})`,
          message: `Merged by upkeep_merge (job run ${context.run.id}): a Dependabot patch update that passed every condition of the merge policy (docs/specs/agent-upkeep.md).`,
        },
        { timeoutMs: t.mergeStateTimeoutMs, intervalMs: t.mergeStateIntervalMs, signal: context.stopSignal },
      );
      if (!merged.ok && merged.unknown) {
        // GitHub may still merge it: the next run reads the pull request and settles it.
        return leavePending(context, pull, null, `its merge answer was lost (${merged.reason})`);
      }
      if (!merged.ok) {
        pending = null;
        return { pr: pull.number, result: 'merge_refused', detail: `GitHub refused the merge (${merged.status}): ${merged.reason}` };
      }
      pending = { ...pending, merge_sha: merged.sha };
      await note({ main: main.sha }).catch((error: unknown) => context.log.warn('upkeep_merge', 'the merge sha could not be noted; the pending record names the pull request', { error: errorMessage(error) }));
      let verdict: Decision;
      try {
        verdict = await verifyMerge(context, deps, github, pull, merged.sha);
      } catch (error) {
        verdict = await leavePending(context, pull, merged.sha, `its verification failed unexpectedly (${errorMessage(error).slice(0, 200)})`);
      }
      if (verdict.result !== 'pending') pending = null;
      return verdict;
    });
    decisions.push(decision);
    break;
  }
  context.log.info('upkeep_merge', 'dependency pull requests checked', { main: main.sha, decisions: decisions.map((d) => `${d.pr}:${d.result}`) });
  return output({ main: main.sha });
};

// At startup: a merge a run left pending (the process stopped or died before its verdict) is named to
// the board and verified now by a queued run, not at the next hourly one.
export async function queuePendingUpkeep(db: Db, alert: Alerter, log: Logger): Promise<boolean> {
  try {
    const pending = await readPending(db);
    if (!pending) return false;
    await db.enqueueJobRun({ job: 'upkeep_merge', origin: 'event' });
    await alert.notify(
      `Upkeep ${pending.merge_sha === null ? 'may have merged' : `merged as ${pending.merge_sha.slice(0, 8)}`} pull request #${pending.pr} (${pending.title}) without a verdict before the dispatcher stopped. An upkeep_merge run is queued to verify it now.`,
    );
    log.warn('upkeep_merge', 'a pending merge was found at startup; a run is queued', { pr: pending.pr, sha: pending.merge_sha });
    return true;
  } catch (error) {
    log.warn('upkeep_merge', 'the pending merge could not be read at startup', { error: errorMessage(error) });
    return false;
  }
}
