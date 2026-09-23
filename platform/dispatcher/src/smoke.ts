// Production smoke test after a deploy. It runs no card code: the headless bot no longer runs on the
// VPS, so agent-written code is never executed beside the dispatcher's secrets
// (docs/specs/launch-managed.md). Four checks, in order:
// 1. the served build carries the merge sha (the page's build-sha meta and /version.json);
// 2. every acceptance check line on a served config path holds on the served file;
// 3. for seed-1, every file under seed-1/config and seed-1/content at the merge commit is served at
//    /config/... and /content/... byte for byte (the build copies them unchanged), compared by git
//    blob id, so what players get is exactly the data the gate's bot ran on;
// 4. the gate check from GitHub Actions concluded success at the merge sha: gate.yml runs on the
//    push to main, bot included, on the merged tree.
// A failed check is a verdict and the pipeline rolls the merge back. A page that never answers, a
// merge commit git cannot read, or a gate still running when the wait ends is no verdict: runSmoke
// throws and the pipeline decides.
import { createHash } from 'node:crypto';
import { evaluateCheck, type ConfigCheck } from './acceptance.js';
import type { CardFolder } from './adapters/types.js';
import { requestSignal, type GateStatus } from './github.js';
import { retry } from './time.js';
import { fetchMain, git } from './worktree.js';

// How long the smoke test waits for the gate at the merge sha. The push run starts at the merge, as
// the deploy does, and has run for as long as the deploy took when the wait begins.
export const SMOKE_GATE_TIMEOUT_MS = 12 * 60_000;
// The seed folders the build copies into dist/ byte for byte (seed-1/scripts/postbuild.mjs).
export const SERVED_FOLDERS: readonly string[] = ['seed-1/config', 'seed-1/content'];

// A file at the merge commit and the route it is served at.
export interface MergedFile {
  path: string;
  route: string;
  mode: string;
  blob: string;
}

export interface SmokeInput {
  baseUrl: string;
  sha: string;
  folder: CardFolder;
  checks: readonly ConfigCheck[];
  // The files under SERVED_FOLDERS at the merge commit (seed-1 only).
  mergedFiles: () => Promise<MergedFile[]>;
  // The gate at the merge sha, waited on; pending or missing means it did not finish.
  gate: () => Promise<GateStatus>;
  fetchFn?: typeof fetch;
  // Per request; a page with no answer by then throws.
  timeoutMs?: number;
  // The first wait before a page request is tried again.
  retryDelayMs?: number;
}

export interface SmokeResult {
  ok: boolean;
  summary: string;
}

// seed-1/config/x.json is served at /config/x.json; platform files have no served path.
export function servedPath(folder: CardFolder, file: string): string | null {
  if (folder !== 'seed-1') return null;
  if (file.startsWith('seed-1/config/') || file.startsWith('seed-1/content/')) return `/${file.slice('seed-1/'.length)}`;
  return null;
}

// The id git gives a blob with these bytes: sha1 (or sha256, for a repository in that object format)
// over "blob <length>\0" and the bytes.
export function gitBlobId(bytes: Uint8Array, length: 40 | 64 = 40): string {
  const hash = createHash(length === 64 ? 'sha256' : 'sha1');
  hash.update(`blob ${bytes.byteLength}\0`);
  hash.update(bytes);
  return hash.digest('hex');
}

// `ls-tree -r -z` output: "<mode> <type> <object>\t<path>", each ended by NUL.
export function parseLsTree(output: string): Array<{ mode: string; type: string; object: string; path: string }> {
  return output
    .split('\0')
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const tab = entry.indexOf('\t');
      const [mode = '', type = '', object = ''] = entry.slice(0, tab).split(' ');
      return { mode, type, object, path: entry.slice(tab + 1) };
    });
}

// Fetches main so the merge commit is local, then lists the served files it holds.
export async function mergedServedFiles(repoRoot: string, mergeSha: string, authEnv: NodeJS.ProcessEnv): Promise<MergedFile[]> {
  await fetchMain(repoRoot, authEnv);
  const listed = parseLsTree(await git(['ls-tree', '-r', '-z', `${mergeSha}^{commit}`, '--', ...SERVED_FOLDERS], repoRoot));
  return listed.map((entry) => ({ path: entry.path, route: servedPath('seed-1', entry.path) ?? '', mode: entry.mode, blob: entry.object }));
}

async function getText(fetchFn: typeof fetch, url: string): Promise<{ status: number; body: string }> {
  const response = await fetchFn(url, { headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'backseat-dispatcher' } });
  return { status: response.status, body: await response.text() };
}

async function getBytes(fetchFn: typeof fetch, url: string): Promise<{ status: number; bytes: Uint8Array }> {
  const response = await fetchFn(url, { headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'backseat-dispatcher' } });
  return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
}

function parseJson(body: string): { ok: true; doc: unknown } | { ok: false } {
  try {
    return { ok: true, doc: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

async function checkBuild(fetchFn: typeof fetch, baseUrl: string, sha: string): Promise<string | null> {
  const page = await getText(fetchFn, `${baseUrl}/`);
  if (page.status !== 200) return `GET / returned ${page.status}`;
  if (!page.body.includes('build-sha')) return 'GET / has no build-sha meta';
  const version = await getText(fetchFn, `${baseUrl}/version.json`);
  if (version.status !== 200) return `GET /version.json returned ${version.status}`;
  const parsed = parseJson(version.body);
  if (!parsed.ok) return 'GET /version.json is not JSON';
  const servedSha = typeof parsed.doc === 'object' && parsed.doc !== null ? (parsed.doc as Record<string, unknown>).sha : undefined;
  if (servedSha !== sha) return `version.json sha ${String(servedSha)} differs from merge sha ${sha}`;
  return null;
}

async function checkConfig(fetchFn: typeof fetch, baseUrl: string, folder: CardFolder, checks: readonly ConfigCheck[]): Promise<string | null> {
  for (const check of checks) {
    const route = servedPath(folder, check.file);
    if (!route) continue;
    const served = await getText(fetchFn, `${baseUrl}${route}`);
    if (served.status !== 200) return `GET ${route} returned ${served.status}`;
    const parsed = parseJson(served.body);
    if (!parsed.ok) return `GET ${route} is not JSON`;
    if (!evaluateCheck(check, parsed.doc)) return `served ${route} does not satisfy ${check.line}`;
  }
  return null;
}

async function checkServedBytes(fetchFn: typeof fetch, baseUrl: string, files: readonly MergedFile[], sha: string): Promise<string | null> {
  if (files.length === 0) return `the merge commit ${sha.slice(0, 8)} has no files under ${SERVED_FOLDERS.join(' or ')}`;
  for (const file of files) {
    if (file.mode !== '100644' && file.mode !== '100755') return `${file.path} at the merge commit is not a regular file (mode ${file.mode})`;
    const served = await getBytes(fetchFn, `${baseUrl}${file.route}`);
    if (served.status !== 200) return `GET ${file.route} returned ${served.status}`;
    const id = gitBlobId(served.bytes, file.blob.length === 64 ? 64 : 40);
    if (id !== file.blob) return `served ${file.route} differs from ${file.path} at the merge commit ${sha.slice(0, 8)}`;
  }
  return null;
}

export const SMOKE_TRIES = 3;

class ServerErrorAnswer extends Error {
  readonly response: Response;
  constructor(response: Response) {
    super(`http ${response.status}`);
    this.response = response;
  }
}

// Every page request carries its own timeout and is tried up to three times, with a doubling wait,
// when it throws or answers 5xx: a CDN blip is not a verdict on the build. A 5xx on the last try is
// the answer; a throw on the last try makes runSmoke throw, which is no verdict, and the pipeline
// decides what follows.
function smokeFetch(fetchFn: typeof fetch, timeoutMs: number | undefined, retryDelayMs: number): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    try {
      return await retry(
        async () => {
          const response = await fetchFn(url, { ...init, signal: requestSignal(timeoutMs, init?.signal ?? undefined) });
          if (response.status >= 500) throw new ServerErrorAnswer(response);
          return response;
        },
        SMOKE_TRIES,
        retryDelayMs,
      );
    } catch (error) {
      if (error instanceof ServerErrorAnswer) return error.response;
      throw error;
    }
  }) as typeof fetch;
}

export async function runSmoke(input: SmokeInput): Promise<SmokeResult> {
  const fetchFn = smokeFetch(input.fetchFn ?? fetch, input.timeoutMs, input.retryDelayMs ?? 1000);
  const build = await checkBuild(fetchFn, input.baseUrl, input.sha);
  if (build) return { ok: false, summary: `fail: ${build}` };
  const config = await checkConfig(fetchFn, input.baseUrl, input.folder, input.checks);
  if (config) return { ok: false, summary: `fail: ${config}` };
  let served = '';
  if (input.folder === 'seed-1') {
    const files = await input.mergedFiles();
    const bytes = await checkServedBytes(fetchFn, input.baseUrl, files, input.sha);
    if (bytes) return { ok: false, summary: `fail: ${bytes}` };
    served = `; ${input.checks.length} config check(s) hold; ${files.length} served file(s) match the merge commit`;
  }
  const gate = await input.gate();
  if (gate.state === 'fail') return { ok: false, summary: `fail: the gate at the merge sha concluded ${gate.conclusion}` };
  if (gate.state !== 'pass') throw new Error(`the gate at the merge sha ${input.sha.slice(0, 8)} was still ${gate.state} when the smoke wait ended`);
  return { ok: true, summary: `pass: build ${input.sha.slice(0, 8)} served${served}; gate green at the merge sha` };
}
