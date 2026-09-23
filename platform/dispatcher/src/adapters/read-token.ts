// The read-only GitHub token Managed Agents sessions clone with (GITHUB_READ_TOKEN). The agent's git
// runs through Anthropic's git proxy, which injects this token and also forwards GitHub REST calls
// against the mounted repository, and main has no branch protection. So a token that can write would
// let an agent push to main past the gate. Before any unattended start, and before every session is
// created, the dispatcher proves the token can read the repository and cannot write it, with a request
// that changes nothing whatever the answer: creating a ref at the all-zero sha. A token without
// Contents write is refused with a 403; a token with it gets a 422 from validation.
import { requestSignal } from '../github.js';

export const PROBE_REF = 'refs/heads/_read-token-probe';
export const ZERO_SHA = '0000000000000000000000000000000000000000';
const API_BASE = 'https://api.github.com';
const PERMISSION_DENIED = /resource not accessible by (personal access token|integration)/i;

export interface ReadTokenOptions {
  token: string;
  repo: string;
  fetchFn?: typeof fetch;
  apiBase?: string;
  timeoutMs?: number;
}

// ok, or why not and whether a retry could change it: a rate limit, a 5xx or a network error is
// transient; every other answer is the same on the next try.
export type ReadTokenVerdict = { ok: true } | { ok: false; fatal: boolean; reason: string };

function rateLimited(response: Response): boolean {
  return response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0' || response.headers.get('retry-after') !== null;
}

async function message(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const json: unknown = JSON.parse(text);
    if (typeof json === 'object' && json !== null && typeof (json as { message?: unknown }).message === 'string') return (json as { message: string }).message;
  } catch {
    // Not JSON; the status says enough.
  }
  return '';
}

export async function checkReadToken(opts: ReadTokenOptions): Promise<ReadTokenVerdict> {
  const fetchFn = opts.fetchFn ?? fetch;
  const base = opts.apiBase ?? API_BASE;
  const headers = {
    Authorization: `Bearer ${opts.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'backseat-dispatcher',
  };
  let read: Response;
  try {
    read = await fetchFn(`${base}/repos/${opts.repo}`, { method: 'GET', headers, signal: requestSignal(opts.timeoutMs, undefined) });
  } catch (error) {
    return { ok: false, fatal: false, reason: `GITHUB_READ_TOKEN check could not reach GitHub: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (read.status !== 200) {
    const why = await message(read);
    if (rateLimited(read) || read.status >= 500) return { ok: false, fatal: false, reason: `GITHUB_READ_TOKEN could not be checked: GET the repository returned ${read.status}` };
    return { ok: false, fatal: true, reason: `GITHUB_READ_TOKEN cannot read ${opts.repo}: GET returned ${read.status}${why ? ` (${why})` : ''}` };
  }
  let write: Response;
  try {
    write = await fetchFn(`${base}/repos/${opts.repo}/git/refs`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: PROBE_REF, sha: ZERO_SHA }),
      signal: requestSignal(opts.timeoutMs, undefined),
    });
  } catch (error) {
    return { ok: false, fatal: false, reason: `GITHUB_READ_TOKEN write check could not reach GitHub: ${error instanceof Error ? error.message : String(error)}` };
  }
  const why = await message(write);
  // A rate-limited answer, a 403 among them, says nothing about the token's permissions.
  if (rateLimited(write)) return { ok: false, fatal: false, reason: `GITHUB_READ_TOKEN write check was rate limited (${write.status}); it proves nothing` };
  if (write.status === 403) {
    const accepted = write.headers.get('x-accepted-github-permissions') ?? '';
    if (PERMISSION_DENIED.test(why) || /contents=write/.test(accepted)) return { ok: true };
    return { ok: false, fatal: true, reason: `GITHUB_READ_TOKEN write check got a 403 that is not a permission denial (${why || 'no message'})` };
  }
  if (write.status >= 500) return { ok: false, fatal: false, reason: `GITHUB_READ_TOKEN write check returned ${write.status}` };
  if (write.status === 422) {
    return { ok: false, fatal: true, reason: `GITHUB_READ_TOKEN can write to ${opts.repo}: creating a ref was refused only on validation (422). Replace it with a token that has Contents read and nothing else` };
  }
  return { ok: false, fatal: true, reason: `GITHUB_READ_TOKEN write check returned ${write.status}${why ? ` (${why})` : ''}; only a 403 permission denial proves the token cannot write` };
}
