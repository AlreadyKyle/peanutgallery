// The replay eval set in the gate (docs/specs/agent-upkeep.md, platform/agents/evals/README.md). The
// replay result is advisory, not a merge gate (docs/PLAN.md §10 decision 66, amending decision 52;
// docs/specs/unattended-roles.md, PR5): it runs only on the founder's login, and the studio must not
// wait on it. A change to a role prompt, a rubric, a schema or the managed agent definition under
// platform/agents/ that adds no result file in platform/agents/evals/results/, or one below
// baseline.json, or before any baseline exists, passes, and the gate log reports what is missing. The
// change is the diff against the gate's base (EVAL_BASE, which gate.yml and scripts/local-gate.sh set
// to the commit they compare with), or origin/main's merge base locally. A baseline still moves only
// in a board pull request that gives the reason, and one that moves without it fails.
// Run from the repository root: node --test platform/agents/evals.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVALS = 'platform/agents/evals';
export const GUARDED = /^platform\/agents\/(prompts|rubrics|schemas|managed)\//;
export const RESULT = /^platform\/agents\/evals\/results\/[^/]+\.json$/;
export const BASELINE = `${EVALS}/baseline.json`;

/**
 * The rule on one change. changes: [{ status, path }] as git's --name-status gives them (A, M, D, R...);
 * read(path): the file's JSON at the change's head, or null when it has none.
 * A guarded change with no new result, a result below the baseline or no baseline yet passes with a
 * report, the advisory line the gate log prints; only a baseline that moves without its reason fails.
 * @returns {{ ok: boolean, reason: string, report?: string }}
 */
export function evalRule(changes, read) {
  const baselineChanged = changes.some((c) => c.path === BASELINE);
  if (baselineChanged) {
    const baseline = read(BASELINE);
    if (!baseline || typeof baseline.reason !== 'string' || baseline.reason.trim() === '') {
      return { ok: false, reason: `${BASELINE} changed without a reason: a baseline moves only in a board pull request that gives it` };
    }
  }
  const guarded = changes.filter((c) => GUARDED.test(c.path)).map((c) => c.path);
  if (guarded.length === 0) return { ok: true, reason: 'no prompt, rubric, schema or agent definition changed' };
  const advisory = (report) => ({ ok: true, reason: `advisory: ${report}`, report });
  const added = changes.filter((c) => c.status.startsWith('A') && RESULT.test(c.path)).map((c) => c.path).sort();
  if (added.length === 0) {
    return advisory(`${guarded.join(', ')} changed, and no replay result was added in ${EVALS}/results/: run pnpm eval:replay -- --set draft --k 3 at the Mac and commit its result`);
  }
  const baseline = read(BASELINE);
  if (!baseline || typeof baseline.sets !== 'object' || baseline.sets === null) {
    return advisory(`${guarded.join(', ')} changed, and ${BASELINE} does not exist yet: the board sets it from a first attended run`);
  }
  const newest = added.at(-1);
  const result = read(newest);
  if (!result || typeof result.sets !== 'object' || result.sets === null) return advisory(`${newest} holds no sets`);
  const below = Object.entries(baseline.sets).filter(([name, floor]) => !(typeof result.sets[name]?.pass_k === 'number' && result.sets[name].pass_k >= floor));
  if (below.length > 0) {
    return advisory(`${newest} is below ${BASELINE}: ${below.map(([name, floor]) => `${name} ${result.sets[name]?.pass_k ?? 'missing'} < ${floor}`).join('; ')}`);
  }
  return { ok: true, reason: `${newest} is at or above the baseline for every set` };
}

/**
 * The line the gate log prints for a verdict: the missing or lower replay result, marked advisory, or
 * null when there is nothing to report.
 * @param {{ report?: string }} verdict
 * @returns {string | null}
 */
export function gateReport(verdict) {
  return verdict.report ? `replay eval, advisory and not a merge gate (docs/PLAN.md §10 decision 66): ${verdict.report}` : null;
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function changesAgainst(base) {
  const mergeBase = git(['merge-base', base, 'HEAD']).trim();
  const out = git(['diff', '--no-renames', '--name-status', '-z', mergeBase, 'HEAD']);
  const parts = out.split('\0').filter((part) => part !== '');
  const changes = [];
  for (let i = 0; i + 1 < parts.length; i += 2) changes.push({ status: parts[i], path: parts[i + 1] });
  return changes;
}

function readAtHead(file) {
  const full = path.join(REPO_ROOT, file);
  return existsSync(full) ? JSON.parse(readFileSync(full, 'utf8')) : null;
}

describe('the eval rule on fixture changes', () => {
  const baseline = { sets: { draft: 0.75 }, reason: 'the first attended run' };
  const files = (extra = {}) => (p) => ({ [BASELINE]: baseline, ...extra })[p] ?? null;
  const prompt = { status: 'M', path: 'platform/agents/prompts/game-director.md' };
  const result = (name) => ({ status: 'A', path: `${EVALS}/results/${name}.json` });

  test('a change with no guarded file passes, with or without a result, and reports nothing', () => {
    const verdict = evalRule([{ status: 'M', path: 'platform/site/src/App.tsx' }, { status: 'M', path: 'platform/agents/janitor.json' }], files());
    assert.equal(verdict.ok, true);
    assert.equal(gateReport(verdict), null);
  });

  // docs/specs/unattended-roles.md, PR5: the replay result is advisory (PLAN.md §10 decision 66).
  for (const guarded of ['platform/agents/prompts/game-designer.md', 'platform/agents/rubrics/draft-game.md', 'platform/agents/schemas/card-draft.schema.json', 'platform/agents/managed/agent.yaml']) {
    test(`a change to ${guarded} with no new result passes, and the gate log reports the missing result`, () => {
      const verdict = evalRule([{ status: 'M', path: guarded }], files());
      assert.equal(verdict.ok, true);
      assert.equal(
        gateReport(verdict),
        `replay eval, advisory and not a merge gate (docs/PLAN.md §10 decision 66): ${guarded} changed, and no replay result was added in ${EVALS}/results/: run pnpm eval:replay -- --set draft --k 3 at the Mac and commit its result`,
      );
    });
  }

  test('a modified result file is not a new one: the change passes and the missing result is reported', () => {
    const verdict = evalRule([prompt, { status: 'M', path: `${EVALS}/results/20260926T120000Z.json` }], files());
    assert.equal(verdict.ok, true);
    assert.match(gateReport(verdict), /no replay result was added/);
  });

  test('a new result below the baseline passes, and the report names the set', () => {
    const verdict = evalRule([prompt, result('20260926T120000Z')], files({ [`${EVALS}/results/20260926T120000Z.json`]: { sets: { draft: { pass_k: 0.5 } } } }));
    assert.equal(verdict.ok, true);
    assert.match(gateReport(verdict), /is below platform\/agents\/evals\/baseline\.json: draft 0\.5 < 0\.75/);
  });

  test('a new result missing a set the baseline names passes, and the report names it missing', () => {
    const verdict = evalRule([prompt, result('20260926T120000Z')], files({ [`${EVALS}/results/20260926T120000Z.json`]: { sets: {} } }));
    assert.equal(verdict.ok, true);
    assert.match(gateReport(verdict), /draft missing < 0\.75/);
  });

  test('the same change passes with a new result at or above the baseline, and reports nothing', () => {
    for (const passK of [0.75, 1]) {
      const verdict = evalRule([prompt, result('20260926T120000Z')], files({ [`${EVALS}/results/20260926T120000Z.json`]: { sets: { draft: { pass_k: passK } } } }));
      assert.equal(verdict.ok, true, verdict.reason);
      assert.equal(gateReport(verdict), null);
    }
  });

  test('the newest of two new results is the one compared', () => {
    const verdict = evalRule([prompt, result('20260926T120000Z'), result('20260926T130000Z')], files({
      [`${EVALS}/results/20260926T120000Z.json`]: { sets: { draft: { pass_k: 1 } } },
      [`${EVALS}/results/20260926T130000Z.json`]: { sets: { draft: { pass_k: 0.5 } } },
    }));
    assert.equal(verdict.ok, true);
    assert.match(gateReport(verdict), /20260926T130000Z\.json is below/);
  });

  test('with no baseline yet a guarded change passes, and the report says the board sets it from a first run', () => {
    const verdict = evalRule([prompt, result('20260926T120000Z')], (p) => (p.endsWith('20260926T120000Z.json') ? { sets: { draft: { pass_k: 1 } } } : null));
    assert.equal(verdict.ok, true);
    assert.match(gateReport(verdict), /does not exist yet: the board sets it from a first attended run/);
  });

  test('a baseline that moves gives its reason', () => {
    const moved = { status: 'M', path: BASELINE };
    assert.equal(evalRule([moved], (p) => (p === BASELINE ? { sets: { draft: 0.5 } } : null)).ok, false);
    assert.equal(evalRule([moved], (p) => (p === BASELINE ? { sets: { draft: 0.5 }, reason: 'The Director model changed; the board accepts 0.5.' } : null)).ok, true);
  });
});

describe('the eval set in the repository', () => {
  test('every case file parses and names its kind', () => {
    const dir = path.join(REPO_ROOT, EVALS, 'cases', 'draft');
    const files = readdirSync(dir).filter((file) => file.endsWith('.json'));
    assert.ok(files.length >= 9, `${files.length} draft cases`);
    for (const file of files) {
      const c = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
      assert.equal(`${c.id}.json`, file, `${file} is named for its id`);
      assert.ok(['director', 'designer'].includes(c.kind), `${file} kind`);
    }
  });

  test('every result file names its commit, CLI version, model ids and pass^k per set', () => {
    const dir = path.join(REPO_ROOT, EVALS, 'results');
    const files = existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.json')) : [];
    for (const file of files) {
      assert.match(file, /^\d{8}T\d{6}Z\.json$/);
      const result = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
      assert.match(result.commit, /^[0-9a-f]{40}$/);
      assert.equal(typeof result.model_ids, 'object');
      for (const set of Object.values(result.sets)) assert.ok(set.pass_k >= 0 && set.pass_k <= 1);
    }
  });

  // The gate log carries the advisory line: test:agents prints it as this test's diagnostic.
  test("this change meets the rule against the gate's base, and the gate log reports a missing replay result", (t) => {
    const base = process.env.EVAL_BASE?.trim() || 'origin/main';
    const verdict = evalRule(changesAgainst(base), readAtHead);
    const report = gateReport(verdict);
    if (report) t.diagnostic(`${report} (compared with ${base})`);
    assert.equal(verdict.ok, true, `${verdict.reason} (compared with ${base})`);
  });
});
