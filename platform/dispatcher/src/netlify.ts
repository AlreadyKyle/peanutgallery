// Netlify: wait for the production deploy of a merge sha, restore a previous deploy, and read
// the site URL for smoke tests.
import { sleep } from './time.js';

export interface NetlifyOptions {
  token: string;
  fetchFn?: typeof fetch;
  apiBase?: string;
}

export interface NetlifyDeploy {
  id: string;
  state: string;
  commitRef: string | null;
  context: string | null;
  skipped: boolean;
  errorMessage: string | null;
}

const API_BASE = 'https://api.netlify.com/api/v1';
// The deploy object carries a `skipped` boolean (set when the build ignore command stops the
// build) and a free-form `state`; a cancelled build reports state error with an error_message.
const FAILED_STATES = new Set(['error', 'failed', 'rejected']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function request(opts: NetlifyOptions, method: string, route: string): Promise<{ status: number; json: unknown }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const response = await fetchFn(`${opts.apiBase ?? API_BASE}${route}`, {
    method,
    headers: { Authorization: `Bearer ${opts.token}`, 'User-Agent': 'backseat-dispatcher' },
  });
  const body = await response.text();
  let json: unknown = null;
  if (body.length > 0) {
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
  }
  return { status: response.status, json };
}

function toDeploy(json: Record<string, unknown>): NetlifyDeploy {
  return {
    id: String(json.id ?? ''),
    state: String(json.state ?? ''),
    commitRef: typeof json.commit_ref === 'string' ? json.commit_ref : null,
    context: typeof json.context === 'string' ? json.context : null,
    skipped: json.skipped === true,
    errorMessage: typeof json.error_message === 'string' && json.error_message.length > 0 ? json.error_message : null,
  };
}

export async function findDeploy(opts: NetlifyOptions, siteId: string, sha: string): Promise<NetlifyDeploy | null> {
  const result = await request(opts, 'GET', `/sites/${siteId}/deploys?per_page=20`);
  if (result.status !== 200 || !Array.isArray(result.json)) {
    throw new Error(`netlify deploys: http ${result.status}`);
  }
  const match = result.json.filter(isRecord).map(toDeploy).find((deploy) => deploy.commitRef === sha && deploy.context === 'production');
  return match ?? null;
}

export type DeployWait = { ok: true; deploy: NetlifyDeploy } | { ok: false; reason: string; deploy: NetlifyDeploy | null };

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}

export async function waitForDeploy(opts: NetlifyOptions, siteId: string, sha: string, wait: WaitOptions = {}): Promise<DeployWait> {
  const timeoutMs = wait.timeoutMs ?? 10 * 60_000;
  const intervalMs = wait.intervalMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const deploy = await findDeploy(opts, siteId, sha);
    // A skipped deploy never built this commit, whatever state it reports.
    if (deploy?.skipped) return { ok: false, reason: `deploy ${deploy.id} was skipped by the build ignore rule (state ${deploy.state})`, deploy };
    if (deploy?.state === 'ready') return { ok: true, deploy };
    if (deploy && FAILED_STATES.has(deploy.state)) {
      const detail = deploy.errorMessage ? `: ${deploy.errorMessage}` : '';
      return { ok: false, reason: `deploy ${deploy.id} ended in state ${deploy.state}${detail}`, deploy };
    }
    if (wait.signal?.aborted) return { ok: false, reason: 'dispatcher stopping', deploy };
    if (Date.now() >= deadline) {
      const reason = deploy
        ? `deploy ${deploy.id} still ${deploy.state} after ${timeoutMs / 1000} s`
        : `no production deploy for ${sha} after ${timeoutMs / 1000} s`;
      return { ok: false, reason, deploy };
    }
    await sleep(intervalMs, wait.signal);
  }
}

export async function restoreDeploy(opts: NetlifyOptions, siteId: string, deployId: string): Promise<void> {
  const result = await request(opts, 'POST', `/sites/${siteId}/deploys/${deployId}/restore`);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`netlify restore ${deployId}: http ${result.status}`);
  }
}

export async function siteUrl(opts: NetlifyOptions, siteId: string): Promise<string> {
  const result = await request(opts, 'GET', `/sites/${siteId}`);
  if (result.status !== 200 || !isRecord(result.json)) {
    throw new Error(`netlify site ${siteId}: http ${result.status}`);
  }
  const url = typeof result.json.ssl_url === 'string' ? result.json.ssl_url : typeof result.json.url === 'string' ? result.json.url : '';
  if (!url) throw new Error(`netlify site ${siteId}: no url in response`);
  return url.replace(/\/+$/, '');
}
