import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyStoredPatch,
  createSupabasePatchStore,
  parseApplyReport,
  patchSha256,
  patchTextProblem,
  PATCH_MAX_BYTES,
  PATCH_MAX_FILES,
  reportProblem,
  storedPatch,
  validateAndApply,
  type PatchStore,
  type StoredPatch,
} from '../src/patch.js';
import { mockFetch } from './helpers/mock-fetch.js';
import { AGENT_EMAIL, git, lanePaths } from '../src/worktree.js';

const CONFIG_LANE = lanePaths('seed-1', 'config');
const CODE_LANE = lanePaths('seed-1', 'code');
const SPAWN = `${JSON.stringify({ rows: [{ id: 'gatherer', baseCost: 10 }] }, null, 2)}\n`;

let dir: string;
let repo: string;
let base: string;
const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };

function raw(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString();
}

// The patch the export command makes for a change: stage everything, diff against the base, then put
// the worktree back.
async function patchFor(change: () => Promise<void>, options: { renames?: boolean; binary?: boolean; staged?: boolean } = {}): Promise<Buffer> {
  await change();
  if (!options.staged) raw(['add', '-A']);
  const args = ['diff', '--cached', '--full-index', options.renames ? '-M' : '--no-renames', ...(options.binary ? ['--binary'] : []), base];
  const patch = execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  raw(['reset', '-q', '--hard', base]);
  raw(['clean', '-qfdx']);
  return patch;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-patch-'));
  process.env.GIT_CONFIG_GLOBAL = path.join(dir, 'gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  await writeFile(process.env.GIT_CONFIG_GLOBAL, '', 'utf8');
  repo = path.join(dir, 'repo');
  await git(['init', '-q', '--initial-branch=main', repo], dir);
  await mkdir(path.join(repo, 'seed-1', 'config'), { recursive: true });
  await mkdir(path.join(repo, 'seed-1', 'sim'), { recursive: true });
  await mkdir(path.join(repo, 'platform', 'site'), { recursive: true });
  await writeFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), SPAWN, 'utf8');
  await writeFile(path.join(repo, 'seed-1', 'config', 'unlocks.json'), '{"unlocks":[]}\n', 'utf8');
  await writeFile(path.join(repo, 'seed-1', 'sim', 'index.ts'), 'export const x = 1;\n', 'utf8');
  await writeFile(path.join(repo, 'seed-1', 'package.json'), '{"name":"@backseat/seed-1"}\n', 'utf8');
  await writeFile(path.join(repo, 'platform', 'site', 'page.html'), '<title>x</title>\n', 'utf8');
  await git(['add', '-A'], repo);
  await git(['-c', 'user.name=Dispatcher test', '-c', `user.email=${AGENT_EMAIL}`, 'commit', '-q', '-m', 'base'], repo);
  base = await git(['rev-parse', 'HEAD'], repo);
});

afterAll(async () => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  raw(['reset', '-q', '--hard', base]);
  raw(['clean', '-qfdx']);
});

const configEdit = () => patchFor(async () => writeFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), SPAWN.replace('10', '11'), 'utf8'));

describe('validateAndApply', () => {
  it('applies a lane patch that edits a file and adds a new one, and names the files', async () => {
    const patch = await patchFor(async () => {
      await writeFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), SPAWN.replace('10', '11'), 'utf8');
      await writeFile(path.join(repo, 'seed-1', 'config', 'new-table.json'), '{"rows":[]}\n', 'utf8');
    });
    const check = await validateAndApply(repo, patch, CONFIG_LANE);
    expect(check).toEqual({ ok: true, files: ['seed-1/config/new-table.json', 'seed-1/config/spawn-table.json'] });
    expect(await readFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), 'utf8')).toContain('"baseCost": 11');
    expect(await readFile(path.join(repo, 'seed-1', 'config', 'new-table.json'), 'utf8')).toBe('{"rows":[]}\n');
  });

  it('accepts an executable-bit change on a lane file in the code lane', async () => {
    const patch = await patchFor(async () => chmod(path.join(repo, 'seed-1', 'sim', 'index.ts'), 0o755));
    expect(patch.toString()).toContain('new mode 100755');
    expect(await validateAndApply(repo, patch, CODE_LANE)).toEqual({ ok: true, files: ['seed-1/sim/index.ts'] });
  });

  const refusals: Array<[string, () => Promise<Buffer>, readonly string[], RegExp]> = [
    ['a file outside the lane', () => patchFor(async () => writeFile(path.join(repo, 'platform', 'site', 'page.html'), '<title>y</title>\n', 'utf8')), CONFIG_LANE, /outside the lane or on a kernel path: platform\/site\/page\.html/],
    ['a kernel path inside the lane', () => patchFor(async () => writeFile(path.join(repo, 'seed-1', 'package.json'), '{"name":"x"}\n', 'utf8')), CODE_LANE, /kernel path: seed-1\/package\.json/],
    [
      'a symlink (mode 120000)',
      () => patchFor(async () => symlink('/etc/passwd', path.join(repo, 'seed-1', 'config', 'link.json'))),
      CONFIG_LANE,
      /file mode 120000/,
    ],
    [
      'a gitlink (mode 160000)',
      () => patchFor(async () => void raw(['update-index', '--add', '--cacheinfo', `160000,${base},seed-1/config/sub`]), { staged: true }),
      CONFIG_LANE,
      /file mode 160000/,
    ],
    [
      'a rename from outside the lane into it',
      async () => {
        const patch = await patchFor(async () => void raw(['mv', 'seed-1/sim/index.ts', 'seed-1/config/index.ts']), { renames: true });
        expect(patch.toString()).toContain('rename from seed-1/sim/index.ts');
        return patch;
      },
      CONFIG_LANE,
      /renames or copies a file/,
    ],
    ['a binary file', () => patchFor(async () => writeFile(path.join(repo, 'seed-1', 'config', 'blob.dat'), Buffer.from([0, 1, 2, 3])), { binary: true }), CONFIG_LANE, /binary file/],
    ['a binary file without --binary', () => patchFor(async () => writeFile(path.join(repo, 'seed-1', 'config', 'blob.dat'), Buffer.from([0, 1, 2, 3]))), CONFIG_LANE, /binary file/],
    ['a patch that does not apply at the base', async () => Buffer.from((await configEdit()).toString().replace('"baseCost": 10', '"baseCost": 7')), CONFIG_LANE, /does not apply at the base commit/],
    ['an empty patch', async () => Buffer.alloc(0), CONFIG_LANE, /empty/],
  ];

  for (const [name, make, lane, reason] of refusals) {
    it(`refuses ${name} and writes nothing to the worktree`, async () => {
      const patch = await make();
      const check = await validateAndApply(repo, patch, lane);
      expect(check.ok).toBe(false);
      expect(check.ok ? '' : check.reason).toMatch(reason);
      expect(raw(['status', '--porcelain', '--untracked-files=all'])).toBe('');
    });
  }

  it('refuses a path with a .. segment before git reads the patch', async () => {
    const patch = Buffer.from((await configEdit()).toString().replaceAll('seed-1/config/spawn-table.json', 'seed-1/config/../../etc/x.json'));
    const check = await validateAndApply(repo, patch, CONFIG_LANE);
    expect(check.ok).toBe(false);
    expect(existsSync(path.join(dir, 'etc'))).toBe(false);
  });

  it('never writes a symlink even if one slipped past the checks', async () => {
    // core.symlinks is off for the apply, so git writes the link text as a plain file.
    const patch = await patchFor(async () => symlink('/etc/passwd', path.join(repo, 'seed-1', 'config', 'link.json')));
    const tmp = path.join(dir, 'raw.patch');
    await writeFile(tmp, patch);
    raw(['-c', 'core.symlinks=false', 'apply', tmp]);
    expect(lstatSync(path.join(repo, 'seed-1', 'config', 'link.json')).isSymbolicLink()).toBe(false);
  });
});

describe('patchTextProblem and reportProblem', () => {
  it('refuses a patch over the size limit before git sees it', () => {
    expect(patchTextProblem(Buffer.alloc(PATCH_MAX_BYTES + 1, 'a'))).toMatch(/over the 1048576-byte limit/);
  });

  it('refuses bytes that are not valid UTF-8, which card_patches could not hold exactly', () => {
    const text = Buffer.from('diff --git a/seed-1/config/a.json b/seed-1/config/a.json\n+caf', 'utf8');
    expect(patchTextProblem(Buffer.concat([text, Buffer.from([0xe9, 0x0a])]))).toMatch(/not valid UTF-8/);
    expect(patchTextProblem(Buffer.from('diff --git a/seed-1/config/a.json b/seed-1/config/a.json\n+café\n', 'utf8'))).toBeNull();
  });

  it('refuses more files than the limit', () => {
    const report = { entries: Array.from({ length: PATCH_MAX_FILES + 1 }, (_, i) => ({ path: `seed-1/config/f${i}.json`, binary: false })), summary: [] };
    expect(reportProblem(report, CONFIG_LANE)).toMatch(/101 files, over the 100-file limit/);
  });

  it('refuses a .git segment and an unknown summary line', () => {
    expect(reportProblem({ entries: [{ path: 'seed-1/config/.git/config', binary: false }], summary: [] }, CONFIG_LANE)).toMatch(/unsafe paths/);
    expect(reportProblem({ entries: [{ path: 'seed-1/config/a.json', binary: false }], summary: ['rewrite seed-1/config/a.json (90%)'] }, CONFIG_LANE)).toMatch(/does not accept/);
  });

  it('parses numstat entries and summary lines from -z output', () => {
    const output = '1\t1\tseed-1/config/a.json\u0000-\t-\tseed-1/config/b.dat\u0000 create mode 100644 seed-1/config/b.dat\n mode change 100644 => 100755 seed-1/config/a.json';
    expect(parseApplyReport(output)).toEqual({
      entries: [
        { path: 'seed-1/config/a.json', binary: false },
        { path: 'seed-1/config/b.dat', binary: true },
      ],
      summary: ['create mode 100644 seed-1/config/b.dat', 'mode change 100644 => 100755 seed-1/config/a.json'],
    });
  });
});

class MemoryStore implements PatchStore {
  rows: StoredPatch[] = [];
  async save(patch: StoredPatch) {
    this.rows.push(patch);
  }
  async latest(cardId: string) {
    return [...this.rows].reverse().find((row) => row.cardId === cardId) ?? null;
  }
  async discard(cardId: string) {
    this.rows = this.rows.filter((row) => row.cardId !== cardId);
  }
}

describe('applyStoredPatch', () => {
  it('does nothing for a card with no stored patch', async () => {
    expect(await applyStoredPatch(new MemoryStore(), 'card-1', repo, CONFIG_LANE)).toEqual({ kind: 'none' });
  });

  it('re-applies the newest stored patch and names its sha256', async () => {
    const store = new MemoryStore();
    const patch = await configEdit();
    await store.save(storedPatch('card-1', base, patch, 'Gatherer base cost 10 to 11', 'sesn_test'));
    const outcome = await applyStoredPatch(store, 'card-1', repo, CONFIG_LANE);
    expect(outcome).toEqual({ kind: 'applied', sha256: patchSha256(patch), baseSha: base, files: ['seed-1/config/spawn-table.json'] });
    expect(store.rows).toHaveLength(1);
  });

  it('discards, without applying, a stored patch whose text does not hash to its recorded sha256', async () => {
    const store = new MemoryStore();
    const patch = await configEdit();
    await store.save({ ...storedPatch('card-1', base, patch, null, null), sha256: 'f'.repeat(64) });
    const outcome = await applyStoredPatch(store, 'card-1', repo, CONFIG_LANE);
    expect(outcome).toMatchObject({ kind: 'conflict', sha256: patchSha256(patch), detail: expect.stringMatching(/not the recorded f{64}/) });
    expect(store.rows).toEqual([]);
    expect(raw(['status', '--porcelain', '--untracked-files=all'])).toBe('');
  });

  it('discards, without applying, a stored patch whose base is not on main, as a visual revision stores against the card commit', async () => {
    for (const offMain of [raw(['commit-tree', `${base}^{tree}`, '-p', base, '-m', 'card commit']).trim(), 'a'.repeat(40), 'not-a-sha']) {
      const store = new MemoryStore();
      // The revision's hunks apply at main too, so only the base shows it is half the change.
      const patch = await configEdit();
      await store.save(storedPatch('card-1', offMain, patch, 'Gatherer base cost 10 to 11', 'sesn_revision'));
      const outcome = await applyStoredPatch(store, 'card-1', repo, CONFIG_LANE);
      expect(outcome).toMatchObject({ kind: 'conflict', sha256: patchSha256(patch), detail: expect.stringMatching(/is not on main/) });
      expect(store.rows).toEqual([]);
      expect(raw(['status', '--porcelain', '--untracked-files=all'])).toBe('');
    }
  });

  it('discards a stored patch that no longer applies, so the next claim runs a session', async () => {
    const store = new MemoryStore();
    const patch = await configEdit();
    await store.save(storedPatch('card-1', base, patch, 'Gatherer base cost 10 to 11', 'sesn_test'));
    await writeFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), SPAWN.replace('10', '12'), 'utf8');
    const outcome = await applyStoredPatch(store, 'card-1', repo, CONFIG_LANE);
    expect(outcome.kind).toBe('conflict');
    expect(store.rows).toEqual([]);
  });
});

describe('createSupabasePatchStore', () => {
  const URL_BASE = 'https://db.local';

  it('writes card_patches with the patch text, its sha256 and byte count, the summary and the session', async () => {
    const { fetchFn, calls } = mockFetch((method, url) => (method === 'POST' && url.startsWith(`${URL_BASE}/rest/v1/card_patches`) ? { status: 201, text: '' } : undefined));
    const patch = Buffer.from('diff --git a/seed-1/config/a.json b/seed-1/config/a.json\n', 'utf8');
    await createSupabasePatchStore(URL_BASE, 'service-key', fetchFn).save(storedPatch('card-1', base, patch, 'Raise a', 'sesn_1'));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ card_id: 'card-1', base_sha: base, patch: patch.toString('utf8'), sha256: patchSha256(patch), bytes: patch.byteLength, summary: 'Raise a', session_id: 'sesn_1' });
  });

  it('reads back the newest row for the card', async () => {
    const patch = 'diff --git a/seed-1/config/a.json b/seed-1/config/a.json\n';
    const row = { card_id: 'card-1', base_sha: base, patch, sha256: patchSha256(Buffer.from(patch)), bytes: patch.length, summary: null, session_id: 'sesn_1' };
    const { fetchFn, calls } = mockFetch((method, url) => (method === 'GET' && url.startsWith(`${URL_BASE}/rest/v1/card_patches`) ? { status: 200, json: [row] } : undefined));
    const stored = await createSupabasePatchStore(URL_BASE, 'service-key', fetchFn).latest('card-1');
    expect(stored).toEqual({ cardId: 'card-1', baseSha: base, patch, sha256: row.sha256, bytes: patch.length, summary: null, sessionId: 'sesn_1' });
    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.get('select')).toBe('card_id,base_sha,patch,sha256,bytes,summary,session_id');
    expect(url.searchParams.get('card_id')).toBe('eq.card-1');
    expect(url.searchParams.get('order')).toBe('created_at.desc');
  });
});
