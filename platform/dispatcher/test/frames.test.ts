// The frames a card's gate drew (src/frames.ts, docs/specs/design-review.md): the passing gate run's
// design-frames artifact downloaded without the token leaving api.github.com and unpacked; none when
// the run uploaded none; an infrastructure error for a listed frame that is missing, a file that is
// not a PNG, a file the frames job does not write, no changed.txt, or no passing run.
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fetchFrames, framePair, FramesError, isPng, unpackFrames } from '../src/frames.js';
import { mockFetch } from './helpers/mock-fetch.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_B = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);
const GITHUB = 'https://api.github.com/repos/owner/repo';
const STORAGE = 'https://results.blob.example/design-frames.zip?sig=abc';
const SHA = 'a'.repeat(40);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-frames-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function zip(files: Record<string, Uint8Array | string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, typeof bytes === 'string' ? strToU8(bytes) : bytes])));
}

const GOOD = {
  'site/changed.txt': 'home-375.png\nteam-1440.png\n',
  'site/home-375.before.png': PNG,
  'site/home-375.after.png': PNG_B,
  // A frame the base did not draw has no before file.
  'site/team-1440.after.png': PNG,
  'game/changed.txt': '',
};

describe('unpackFrames', () => {
  it('unpacks the pairs and lists the changed frames by side, in changed.txt order', async () => {
    const frames = await unpackFrames(zip(GOOD), dir);
    expect(frames).toEqual({ dir, changed: ['site/home-375.png', 'site/team-1440.png'] });
    expect(await readFile(path.join(dir, 'site', 'home-375.after.png'))).toEqual(Buffer.from(PNG_B));
    expect(existsSync(path.join(dir, 'site', 'team-1440.before.png'))).toBe(false);
    expect(framePair('site/home-375.png')).toEqual({ before: 'site/home-375.before.png', after: 'site/home-375.after.png' });
  });

  it('lists nothing when no frame differs from the base', async () => {
    expect((await unpackFrames(zip({ 'site/changed.txt': '', 'game/changed.txt': '' }), dir)).changed).toEqual([]);
  });

  it.each<[string, Record<string, Uint8Array | string>, RegExp]>([
    ['a listed frame with no after file', { 'site/changed.txt': 'home-375.png\n', 'site/home-375.before.png': PNG }, /home-375\.after\.png is missing/],
    ['a frame that is not a PNG', { 'site/changed.txt': 'home-375.png\n', 'site/home-375.after.png': 'not a png' }, /not a PNG/],
    ['a before file that is not a PNG', { 'site/changed.txt': 'home-375.png\n', 'site/home-375.after.png': PNG, 'site/home-375.before.png': 'GIF89a' }, /not a PNG/],
    ['a file the frames job does not write', { ...GOOD, 'site/notes.md': 'hello' }, /does not write: site\/notes\.md/],
    ['a path that climbs out of the folder', { ...GOOD, '../escape.png': PNG }, /does not write/],
    ['a changed.txt line that is not a frame name', { 'site/changed.txt': '../../etc/passwd\n' }, /not a frame name/],
    ['no changed.txt at all', { 'site/home-375.after.png': PNG }, /no changed\.txt/],
  ])('refuses %s', async (_name, files, message) => {
    const error = await unpackFrames(zip(files), dir).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FramesError);
    expect((error as Error).message).toMatch(message);
  });

  it('refuses bytes that are not a zip', async () => {
    await expect(unpackFrames(new Uint8Array([1, 2, 3, 4]), dir)).rejects.toThrow(FramesError);
  });

  it('knows a PNG by its signature', () => {
    expect(isPng(PNG)).toBe(true);
    expect(isPng(new Uint8Array([0x89, 0x50]))).toBe(false);
  });
});

describe('fetchFrames', () => {
  const run = (over: Record<string, unknown> = {}) => ({ id: 77, path: '.github/workflows/gate.yml', status: 'completed', conclusion: 'success', html_url: 'https://github.com/owner/repo/actions/runs/77', ...over });

  function github(runs: unknown[], artifacts: unknown[], body: Uint8Array = zip(GOOD)) {
    const storage: Array<{ auth: string | null }> = [];
    const mock = mockFetch((method, url) => {
      if (method === 'GET' && url === `${GITHUB}/actions/runs?head_sha=${SHA}&per_page=50`) return { status: 200, json: { workflow_runs: runs } };
      if (method === 'GET' && url === `${GITHUB}/actions/runs/77/artifacts?per_page=100`) return { status: 200, json: { total_count: artifacts.length, artifacts } };
      return undefined;
    });
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === `${GITHUB}/actions/artifacts/9/zip`) {
        expect(init?.redirect).toBe('manual');
        return new Response(null, { status: 302, headers: { location: STORAGE } });
      }
      if (url === STORAGE) {
        storage.push({ auth: new Headers(init?.headers).get('authorization') });
        return new Response(body, { status: 200 });
      }
      return mock.fetchFn(input, init);
    }) as typeof fetch;
    return { fetchFn, storage, calls: mock.calls };
  }

  it('is null when the passing run uploaded no design-frames', async () => {
    const { fetchFn } = github([run()], [{ id: 5, name: 'something-else', expired: false, size_in_bytes: 10 }]);
    expect(await fetchFrames({ token: 't', repo: 'owner/repo', fetchFn }, SHA, dir)).toBeNull();
  });

  it("downloads the newest passing run's design-frames through the 302, without the token at the storage address", async () => {
    const { fetchFn, storage } = github(
      [run({ id: 12, conclusion: 'failure' }), run(), run({ id: 3 }), run({ id: 99, path: '.github/workflows/other.yml' })],
      [{ id: 9, name: 'design-frames', expired: false, size_in_bytes: 1000 }],
    );
    const frames = await fetchFrames({ token: 'secret-token', repo: 'owner/repo', fetchFn }, SHA, dir);
    expect(frames?.changed).toEqual(['site/home-375.png', 'site/team-1440.png']);
    expect(storage).toEqual([{ auth: null }]);
  });

  it('refuses when no gate run passed on the sha, or the artifact expired', async () => {
    const none = github([run({ conclusion: 'failure' })], []);
    await expect(fetchFrames({ token: 't', repo: 'owner/repo', fetchFn: none.fetchFn }, SHA, dir)).rejects.toThrow(FramesError);
    const expired = github([run()], [{ id: 9, name: 'design-frames', expired: true, size_in_bytes: 1000 }]);
    await expect(fetchFrames({ token: 't', repo: 'owner/repo', fetchFn: expired.fetchFn }, SHA, dir)).rejects.toThrow(/expired/);
  });

  it('refuses a malformed artifact', async () => {
    const { fetchFn } = github([run()], [{ id: 9, name: 'design-frames', expired: false, size_in_bytes: 1000 }], zip({ 'site/changed.txt': 'home-375.png\n' }));
    await expect(fetchFrames({ token: 't', repo: 'owner/repo', fetchFn }, SHA, dir)).rejects.toThrow(/home-375\.after\.png is missing/);
  });
});
