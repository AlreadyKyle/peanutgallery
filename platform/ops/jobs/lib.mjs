// Shared pieces of the VPS jobs (docs/specs/money-safety.md): the env checks, read-only Stripe and
// GitHub requests, the Supabase calls and the alerts. No dependency beyond Node 22: the jobs run from
// the read-only code clone in the dispatcher image with no node_modules of their own.
import { readFileSync } from 'node:fs';

// Every key a job's env file may hold, by job. provision.sh refuses a file with any other key, so a
// job never holds a secret it does not use.
export const JOB_KEYS = {
  controller: {
    required: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_READ_KEY', 'NTFY_TOPIC_URL'],
    optional: ['CONTROLLER_HEALTHCHECK_URL'],
  },
  quota: {
    required: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GITHUB_BILLING_TOKEN', 'GITHUB_BILLING_USER', 'NTFY_TOPIC_URL'],
    optional: ['QUOTA_HEALTHCHECK_URL', 'DATABASE_ALERT_MB', 'ACTIONS_MINUTES_INCLUDED', 'ACTIONS_MINUTES_FLOOR'],
  },
  backup: {
    required: ['BACKUP_DB_URL', 'BACKUP_AGE_RECIPIENT', 'BACKUP_PAR_URL', 'BACKUP_BUCKET', 'BACKUP_HEALTHCHECK_URL'],
    // Every dump runs as the read-only login; the database owner's password never reaches the VPS
    // (docs/specs/money-safety.md). BACKUP_SKIP_AUTH=1 is set only when that login was refused the
    // auth schema, and leaves the auth dump out.
    optional: ['RESTORE_CHECK_WEEKDAY', 'BACKUP_SKIP_AUTH'],
  },
};

// A Postgres connection string that signs in as the database owner, pooled (postgres.<ref>) or direct.
// The owner can drop the append-only triggers, so no job holds one under any name.
const OWNER_DB_URL = /^postgres(ql)?:\/\/postgres[.:@]/;

// Keys whose value must be an https URL.
export const URL_KEYS = ['SUPABASE_URL', 'NTFY_TOPIC_URL', 'CONTROLLER_HEALTHCHECK_URL', 'QUOTA_HEALTHCHECK_URL', 'BACKUP_PAR_URL', 'BACKUP_HEALTHCHECK_URL'];

// Stripe secret keys can move money. No job holds one under any name; the Controller reads Stripe
// only with a restricted live key.
export const STRIPE_SECRET_PREFIXES = ['sk_live_', 'sk_test_'];
export const STRIPE_READ_PREFIX = 'rk_live_';

export class JobEnvError extends Error {
  constructor(job, problems) {
    super(`${job} env refused:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'JobEnvError';
    this.problems = problems;
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

// The problems with one job's environment, naming keys only, never values.
export function jobEnvProblems(job, env) {
  const spec = JOB_KEYS[job];
  if (!spec) return [`unknown job ${job}`];
  const problems = [];
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && STRIPE_SECRET_PREFIXES.some((prefix) => value.trim().startsWith(prefix))) {
      problems.push(`${key} holds a Stripe secret key; no job may hold one, under any name`);
    }
    if (typeof value === 'string' && OWNER_DB_URL.test(value.trim())) {
      problems.push(`${key} signs in as the database owner; no job may hold the owner's password, under any name`);
    }
  }
  for (const key of spec.required) {
    if (!(env[key] ?? '').trim()) problems.push(`${key} is missing or empty`);
  }
  for (const key of URL_KEYS) {
    const value = (env[key] ?? '').trim();
    if (value && !isHttpsUrl(value)) problems.push(`${key} must be an https URL`);
  }
  const read = (env.STRIPE_READ_KEY ?? '').trim();
  if (read && !read.startsWith(STRIPE_READ_PREFIX)) problems.push(`STRIPE_READ_KEY must be a restricted live key (${STRIPE_READ_PREFIX}...)`);
  const recipient = (env.BACKUP_AGE_RECIPIENT ?? '').trim();
  if (recipient && !/^age1[0-9a-z]{58}$/.test(recipient)) problems.push('BACKUP_AGE_RECIPIENT must be one age public key (age1...)');
  const dbUrl = (env.BACKUP_DB_URL ?? '').trim();
  if (dbUrl && !/^postgres(ql)?:\/\/peanutgallery_backup\.[a-z0-9]+:[^@/]+@[a-z0-9.-]+\.pooler\.supabase\.com:5432\/postgres(\?.*)?$/.test(dbUrl)) {
    problems.push('BACKUP_DB_URL must be the Session pooler (port 5432) as peanutgallery_backup.<project ref>');
  }
  const skipAuth = (env.BACKUP_SKIP_AUTH ?? '').trim();
  if (skipAuth && skipAuth !== '1') problems.push('BACKUP_SKIP_AUTH must be 1 or absent');
  const par = (env.BACKUP_PAR_URL ?? '').trim();
  const bucket = (env.BACKUP_BUCKET ?? '').trim();
  if (par) {
    const match = /^https:\/\/objectstorage\.[a-z0-9-]+\.oraclecloud\.com\/p\/[^/]+\/n\/[^/]+\/b\/([^/]+)\/o\/$/.exec(par);
    if (!match) problems.push('BACKUP_PAR_URL must be an Object Storage pre-authenticated request for a bucket, ending in /o/');
    else if (bucket && match[1] !== bucket) problems.push('BACKUP_PAR_URL names another bucket than BACKUP_BUCKET');
  }
  for (const key of ['DATABASE_ALERT_MB', 'ACTIONS_MINUTES_INCLUDED', 'ACTIONS_MINUTES_FLOOR']) {
    const value = (env[key] ?? '').trim();
    if (value && !/^[1-9][0-9]*$/.test(value)) problems.push(`${key} must be a whole number above zero`);
  }
  const weekday = (env.RESTORE_CHECK_WEEKDAY ?? '').trim();
  if (weekday && !/^[1-7]$/.test(weekday)) problems.push('RESTORE_CHECK_WEEKDAY must be 1 (Monday) to 7 (Sunday)');
  const user = (env.GITHUB_BILLING_USER ?? '').trim();
  if (user && !/^[A-Za-z0-9-]+$/.test(user)) problems.push('GITHUB_BILLING_USER must be a GitHub user name');
  const token = (env.GITHUB_BILLING_TOKEN ?? '').trim();
  if (token && !token.startsWith('github_pat_')) problems.push('GITHUB_BILLING_TOKEN must be a fine-grained personal access token (github_pat_...)');
  return problems;
}

// The keys an env file may hold for the job, in the order they are written.
export function jobKeys(job) {
  const spec = JOB_KEYS[job];
  return [...spec.required, ...spec.optional];
}

// Parses a docker env file (KEY=value, no quotes).
export function parseEnvFile(text) {
  const env = {};
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at > 0) env[line.slice(0, at)] = line.slice(at + 1);
  }
  return env;
}

// The Stripe API version the webhook pins, read from its one definition so the two never drift.
export function stripeApiVersion(file = new URL('../../supabase/functions/_shared/stripe_api_version.ts', import.meta.url)) {
  const version = /STRIPE_API_VERSION = "([^"]+)"/.exec(readFileSync(file, 'utf8'))?.[1];
  if (!version) throw new Error('STRIPE_API_VERSION not found');
  return version;
}

async function readJson(response, what) {
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const message = json?.error?.message ?? json?.message ?? text.slice(0, 200);
    const error = new Error(`${what}: http ${response.status} ${message}`.trim());
    error.status = response.status;
    throw error;
  }
  return json;
}

// A read-only Stripe client: GET only, with the restricted key. Lists page through with
// starting_after up to maxPages pages of 100; a list longer than that is reported as truncated.
export function stripeReader({ key, fetchFn = fetch, version, maxPages = 50 }) {
  if (!key.startsWith(STRIPE_READ_PREFIX)) throw new Error(`the Stripe reader takes only a restricted live key (${STRIPE_READ_PREFIX}...)`);
  const headers = { Authorization: `Bearer ${key}`, 'Stripe-Version': version };
  const get = async (path, params = {}) => {
    const url = new URL(`https://api.stripe.com/v1/${path}`);
    for (const [name, value] of Object.entries(params)) {
      for (const one of Array.isArray(value) ? value : [value]) url.searchParams.append(name, String(one));
    }
    const response = await fetchFn(url, { method: 'GET', headers, signal: AbortSignal.timeout(30_000) });
    return readJson(response, `stripe ${path}`);
  };
  return {
    get,
    async list(path, params = {}) {
      const items = [];
      let after = null;
      for (let page = 0; page < maxPages; page += 1) {
        const body = await get(path, { ...params, limit: 100, ...(after ? { starting_after: after } : {}) });
        const data = Array.isArray(body?.data) ? body.data : [];
        items.push(...data);
        if (!body?.has_more || data.length === 0) return { items, truncated: false };
        after = data.at(-1).id;
      }
      return { items, truncated: true };
    },
  };
}

// The Supabase calls the jobs make with the service key. A new-format secret key (sb_secret_) goes in
// apikey only; a legacy service role JWT also goes as the bearer, as supabase-js sends it.
export function supabaseClient({ url, key, fetchFn = fetch }) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  const base = url.replace(/\/+$/, '');
  return {
    async rpc(name, args = {}) {
      const response = await fetchFn(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(30_000) });
      return readJson(response, `supabase rpc ${name}`);
    },
    async insert(table, row) {
      const response = await fetchFn(`${base}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(row),
        signal: AbortSignal.timeout(30_000),
      });
      await readJson(response, `supabase insert ${table}`);
    },
  };
}

// The board's alerts: one ntfy post, and a healthchecks.io ping (success, or /fail).
export function alerter({ ntfyUrl, healthcheckUrl, fetchFn = fetch, title }) {
  return {
    async notify(message) {
      if (!ntfyUrl) return;
      const response = await fetchFn(ntfyUrl, { method: 'POST', headers: { Title: title }, body: message, signal: AbortSignal.timeout(20_000) });
      await response.body?.cancel();
    },
    async ping(ok) {
      if (!healthcheckUrl) return;
      const target = ok ? healthcheckUrl : `${healthcheckUrl.replace(/\/+$/, '')}/fail`;
      const response = await fetchFn(target, { method: 'POST', signal: AbortSignal.timeout(20_000) });
      await response.body?.cancel();
    },
  };
}

// Dollars to cents and back, and a four-decimal amount, so sums stay exact.
export const toCents = (usd) => Math.round(Number(usd) * 100);
export const round4 = (value) => Math.round(Number(value) * 10_000) / 10_000;
export const round2 = (value) => Math.round(Number(value) * 100) / 100;
export const floor2 = (value) => Math.floor(Number(value) * 100 + 1e-9) / 100;
