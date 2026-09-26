// The replay eval set's gate rule (docs/specs/agent-upkeep.md, platform/agents/evals/README.md): a
// change to a role prompt, a rubric, a schema or the managed agent definition under platform/agents/
// must add a result file in platform/agents/evals/results/ whose every set is at or above
// baseline.json. The change is the diff against the gate's base (EVAL_BASE, which gate.yml and
// scripts/local-gate.sh set to the commit they compare with), or origin/main's merge base locally.
// A baseline moves only in a board pull request that gives the reason.
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
 * @returns {{ ok: boolean, reason: string }}
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
  const added = changes.filter((c) => c.status.startsWith('A') && RESULT.test(c.path)).map((c) => c.path).sort();
  if (added.length === 0) {
    return { ok: false, reason: `${guarded.join(', ')} changed, and no result file was added in ${EVALS}/results/: run pnpm eval:replay -- --set draft --k 3 at the Mac and commit its result` };
  }
  const baseline = read(BASELINE);
  if (!baseline || typeof baseline.sets !== 'object' || baseline.sets === null) {
    return { ok: false, reason: `${guarded.join(', ')} changed, and ${BASELINE} does not exist yet: the board sets it from a first attended run` };
  }
  const newest = added.at(-1);
  const result = read(newest);
  if (!result || typeof result.sets !== 'object' || result.sets === null) return { ok: false, reason: `${newest} holds no sets` };
  const below = Object.entries(baseline.sets).filter(([name, floor]) => !(typeof result.sets[name]?.pass_k === 'number' && result.sets[name].pass_k >= floor));
  if (below.length > 0) {
    return { ok: false, reason: `${newest} is below ${BASELINE}: ${below.map(([name, floor]) => `${name} ${result.sets[name]?.pass_k ?? 'missing'} < ${floor}`).join('; ')}` };
  }
  return { ok: true, reason: `${newest} is at or above the baseline for every set` };
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

  test('a change with no guarded file passes, with or without a result', () => {
    assert.equal(evalRule([{ status: 'M', path: 'platform/site/src/App.tsx' }, { status: 'M', path: 'platform/agents/janitor.json' }], files()).ok, true);
  });

  for (const guarded of ['platform/agents/prompts/game-designer.md', 'platform/agents/rubrics/draft-game.md', 'platform/agents/schemas/card-draft.schema.json', 'platform/agents/managed/agent.yaml']) {
    test(`a change to ${guarded} with no new result fails`, () => {
      const verdict = evalRule([{ status: 'M', path: guarded }], files());
      assert.equal(verdict.ok, false);
      assert.match(verdict.reason, /no result file was added/);
    });
  }

  test('a modified result file is not a new one', () => {
    assert.equal(evalRule([prompt, { status: 'M', path: `${EVALS}/results/20260926T120000Z.json` }], files()).ok, false);
  });

  test('a new result below the baseline fails, naming the set', () => {
    const verdict = evalRule([prompt, result('20260926T120000Z')], files({ [`${EVALS}/results/20260926T120000Z.json`]: { sets: { draft: { pass_k: 0.5 } } } }));
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /draft 0\.5 < 0\.75/);
  });

  test('a new result missing a set the baseline names fails', () => {
    assert.equal(evalRule([prompt, result('20260926T120000Z')], files({ [`${EVALS}/results/20260926T120000Z.json`]: { sets: {} } })).ok, false);
  });

  test('the same change passes with a new result at or above the baseline', () => {
    for (const passK of [0.75, 1]) {
      const verdict = evalRule([prompt, result('20260926T120000Z')], files({ [`${EVALS}/results/20260926T120000Z.json`]: { sets: { draft: { pass_k: passK } } } }));
      assert.equal(verdict.ok, true, verdict.reason);
    }
  });

  test('the newest of two new results is the one compared', () => {
    const verdict = evalRule([prompt, result('20260926T120000Z'), result('20260926T130000Z')], files({
      [`${EVALS}/results/20260926T120000Z.json`]: { sets: { draft: { pass_k: 1 } } },
      [`${EVALS}/results/20260926T130000Z.json`]: { sets: { draft: { pass_k: 0.5 } } },
    }));
    assert.equal(verdict.ok, false);
  });

  test('with no baseline yet a guarded change fails, and the board sets it from a first run', () => {
    const verdict = evalRule([prompt, result('20260926T120000Z')], (p) => (p.endsWith('20260926T120000Z.json') ? { sets: { draft: { pass_k: 1 } } } : null));
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /does not exist yet/);
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

  test("this change meets the rule against the gate's base", () => {
    const base = process.env.EVAL_BASE?.trim() || 'origin/main';
    const verdict = evalRule(changesAgainst(base), readAtHead);
    assert.equal(verdict.ok, true, `${verdict.reason} (compared with ${base})`);
  });
});
