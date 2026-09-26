// upkeep_merge, the dependency patch merge (docs/specs/agent-upkeep.md, R23). Hourly on pg_cron, code
// only. It skips while the studio is paused (the queue skips it too) or main's gate is red. It works
// through the open pull requests dependabot[bot] opened, oldest first, and merges at most one a run,
// only when every condition holds, checked in this order:
// - verified: GitHub verified the head commit;
// - files: the change touches only package.json files and pnpm-lock.yaml, each modified in place;
// - semver_patch: every package.json keeps its keys and changes only dependency version strings, each
//   a patch of the same major and minor; every version the lockfile adds is a patch of a version of
//   the same package it had;
// - new_package: the lockfile names no package it did not name before;
// - never_list: no changed package is one of the dispatcher's runtime dependencies, esbuild, vite or
//   pnpm;
// - release_age: every version the lockfile adds is at least seven days old on the npm registry;
// - base: the pull request is built on main's head; if not, it comments "@dependabot rebase" once for
//   that head commit and waits;
// - gate: the gate is green at the head sha, read once, so while Actions cannot run it fails closed at
//   once instead of polling.
// It then merges the head sha under the dispatcher's merge lock, and deploys and smoke-tests both
// sites the lockfile builds with the card path's own functions (netlify.ts waitForDeploy, smoke.ts
// runSmoke, github.ts revertMerge): a failed deploy or smoke, or no verdict, restores each site's last
// green deploy and reverts the merge on main, and a revert that fails pauses the studio. The gate's
// payment-host scan is what stops a patch that rewrites the payment link. Every decision, naming the
// condition that failed, is in the run's output; every other pull request waits for the board.
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
  requestSignal,
  revertMerge,
  waitForGate,
  type AuthorPull,
  type GitHubOptions,
} from '../github.js';
import type { JobContext, JobHandler } from '../jobs.js';
import { mergeLock } from '../lock.js';
import { errorMessage } from '../log.js';
import { restoreDeploy, siteUrl, waitForDeploy, type NetlifyOptions } from '../netlify.js';
import { runSmoke } from '../smoke.js';
import { retry } from '../time.js';
import { requireUpkeep, UPKEEP_TIMINGS, type UpkeepDeps } from './upkeep.js';

export const DEPENDABOT = 'dependabot[bot]';
export const LOCKFILE = 'pnpm-lock.yaml';
export const REBASE_COMMENT = '@dependabot rebase';
export const RELEASE_AGE_MS = 7 * 24 * 60 * 60_000;
export const NEVER_ALWAYS: readonly string[] = ['esbuild', 'vite', 'pnpm'];
export const DISPATCHER_PACKAGE = 'platform/dispatcher/package.json';
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;
// Both sites a lockfile change builds that the dispatcher deploys and smoke-tests (the board's site
// builds too, and is kernel).
export const UPKEEP_FOLDERS: readonly CardFolder[] = ['platform', 'seed-1'];

export type Condition = 'verified' | 'files' | 'semver_patch' | 'new_package' | 'never_list' | 'release_age' | 'base' | 'gate';

export type Decision =
  | { pr: number; result: 'refused'; condition: Condition; detail: string }
  | { pr: number; result: 'rebase_requested' | 'waiting_for_rebase'; detail: string }
  | { pr: number; result: 'main_moved'; detail: string }
  | { pr: number; result: 'merged'; sha: string; detail: string }
  | { pr: number; result: 'rolled_back'; sha: string; detail: string; revert_sha: string | null; problems: string[] }
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

// A lockfile's packages, as name to versions. A v9 key is name@version; a scoped name starts with @.
export function lockPackages(text: string): Map<string, Set<string>> {
  const doc = parseYaml(text) as { packages?: Record<string, unknown> } | null;
  const out = new Map<string, Set<string>>();
  for (const key of Object.keys(doc?.packages ?? {})) {
    const bare = key.replace(/\(.*$/, '');
    const at = bare.lastIndexOf('@');
    if (at <= 0) continue;
    const name = bare.slice(0, at);
    const version = bare.slice(at + 1);
    if (!out.has(name)) out.set(name, new Set());
    out.get(name)!.add(version);
  }
  return out;
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
  if (range.files.some((f) => f.path === LOCKFILE)) {
    const result = lockfileChanges(await read(LOCKFILE, mergeBase), await read(LOCKFILE, pull.headSha));
    if (!result.ok) return refuse(result.condition, result.detail);
    lock = result.change;
  }

  const dispatcherPackage = JSON.parse(await read(DISPATCHER_PACKAGE, mergeBase)) as { dependencies?: Record<string, string> };
  const never = new Set([...Object.keys(dispatcherPackage.dependencies ?? {}), ...NEVER_ALWAYS]);
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
    const asked = comments.some((c) => c.body.trim() === REBASE_COMMENT && Date.parse(c.createdAt) >= since);
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

// Deploys and smoke-tests each site at the merge sha, then records it green, or rolls the merge back.
async function verifyMerge(context: JobContext, deps: UpkeepDeps, github: GitHubOptions, pull: AuthorPull, sha: string): Promise<Decision> {
  const t = { ...UPKEEP_TIMINGS, ...deps.timings };
  const netlify: NetlifyOptions = { token: deps.config.netlifyAuthToken, fetchFn: deps.fetchFn };
  const verified: Array<{ folder: CardFolder; deployId: string; summary: string }> = [];
  const published = new Set<CardFolder>();
  let failure: string | null = null;
  for (const folder of UPKEEP_FOLDERS) {
    try {
      const deploy = await waitForDeploy(netlify, siteId(deps, folder), sha, { timeoutMs: t.deployTimeoutMs, intervalMs: t.deployIntervalMs, signal: context.stopSignal });
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
        await context.db.insertDeploy({ folder, sha, netlify_deploy_id: deploy.deploy.id, is_green: false, smoke_result: smoke.summary }).catch(() => undefined);
        failure = `${folder} smoke failed: ${smoke.summary}`;
        break;
      }
      verified.push({ folder, deployId: deploy.deploy.id, summary: smoke.summary });
    } catch (error) {
      failure = `${folder} could not be verified after the merge: ${errorMessage(error)}`;
      break;
    }
  }
  if (failure === null) {
    for (const v of verified) {
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

export const upkeepMerge: JobHandler = async (context) => {
  const deps = requireUpkeep(context);
  const github: GitHubOptions = { token: deps.config.githubToken, repo: deps.config.githubRepo, fetchFn: deps.fetchFn };
  const studio = await context.db.getStudioState();
  if (studio.paused) return { skipped: 'studio_paused', decisions: [] };
  const main = await deps.mainGate();
  if (main.status.state === 'fail' && !isInfrastructureConclusion(main.status.conclusion)) return { skipped: 'main_red', main: main.sha, decisions: [] };

  const decisions: Decision[] = [];
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
      const merged = await mergePullRequest(github, pull.number, pull.headSha, {
        title: `${pull.title} (#${pull.number})`,
        message: `Merged by upkeep_merge (job run ${context.run.id}): a Dependabot patch update that passed every condition of the merge policy (docs/specs/agent-upkeep.md).`,
      });
      if (!merged.ok) return { pr: pull.number, result: 'merge_refused', detail: `GitHub refused the merge (${merged.status}): ${merged.reason}` };
      return verifyMerge(context, deps, github, pull, merged.sha);
    });
    decisions.push(decision);
    break;
  }
  context.log.info('upkeep_merge', 'dependency pull requests checked', { main: main.sha, decisions: decisions.map((d) => `${d.pr}:${d.result}`) });
  return { main: main.sha, decisions };
};
