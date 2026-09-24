// The quota check (docs/specs/money-safety.md): a daily job on the VPS, beside the Controller, that
// warns the board before a free-tier limit trips. It measures two things:
// - the database's size by SQL (ops_database_size), alerting at DATABASE_ALERT_MB, default 350 MB,
//   well before Supabase Free's 500 MB turns the database read-only and payments stop being credited;
// - this month's GitHub Actions minutes through the billing usage API, with the dispatcher's
//   fine-grained token and its Plan read permission, alerting when fewer than ACTIONS_MINUTES_FLOOR,
//   default 400, of the ACTIONS_MINUTES_INCLUDED, default 2,000 (GitHub Free), are left.
// Supabase egress and Netlify bandwidth and build minutes are not read here: they come from the
// providers' own usage emails to the board, so no account-wide token sits on the VPS.
import { alerter, jobEnvProblems, JobEnvError, supabaseClient } from './lib.mjs';

export const DEFAULTS = { DATABASE_ALERT_MB: 350, ACTIONS_MINUTES_INCLUDED: 2000, ACTIONS_MINUTES_FLOOR: 400 };
const MB = 1024 * 1024;

// This month's Actions minutes from a billing usage report: every usage item for the Actions product
// counted in minutes.
export function actionsMinutes(report) {
  const items = Array.isArray(report?.usageItems) ? report.usageItems : null;
  if (!items) throw new Error('the billing usage report has no usageItems');
  return items
    .filter((item) => String(item.product ?? '').toLowerCase() === 'actions' && /minute/i.test(String(item.unitType ?? '')))
    .reduce((total, item) => total + Number(item.quantity ?? item.grossQuantity ?? 0), 0);
}

export function evaluateQuota({ databaseBytes, minutesUsed, minutesError, settings }) {
  const alertBytes = settings.DATABASE_ALERT_MB * MB;
  const database = {
    name: 'database_size',
    ok: databaseBytes < alertBytes,
    detail: `${(databaseBytes / MB).toFixed(1)} MB of the ${settings.DATABASE_ALERT_MB} MB alert line`,
    items: databaseBytes < alertBytes ? [] : [{ database_mb: Math.round((databaseBytes / MB) * 10) / 10, alert_mb: settings.DATABASE_ALERT_MB, fix: 'Supabase Free stops at 500 MB: bound agent_events or move to Supabase Pro (a board decision)' }],
  };
  let actions;
  if (minutesError) {
    actions = { name: 'actions_minutes', ok: false, detail: 'the billing usage could not be read', items: [{ error: minutesError, fix: "check that the dispatcher's token has the Plan read permission" }] };
  } else {
    const left = settings.ACTIONS_MINUTES_INCLUDED - minutesUsed;
    actions = {
      name: 'actions_minutes',
      ok: left >= settings.ACTIONS_MINUTES_FLOOR,
      detail: `${minutesUsed} of ${settings.ACTIONS_MINUTES_INCLUDED} minutes used this month, ${left} left`,
      items: left >= settings.ACTIONS_MINUTES_FLOOR ? [] : [{ minutes_used: minutesUsed, minutes_left: left, floor: settings.ACTIONS_MINUTES_FLOOR, fix: 'when the minutes run out the gate stops starting and nothing merges: make the repository public or move the checks (docs/ROADMAP.md, Actions minutes)' }],
    };
  }
  const checks = [database, actions];
  const mismatches = checks.reduce((total, c) => total + c.items.length, 0);
  return { ok: mismatches === 0, mismatches, checks, figures: { database_bytes: databaseBytes, actions_minutes_used: minutesUsed, settings } };
}

export async function runQuota({ env, fetchFn = fetch, now = new Date(), dryRun = false, out = process.stdout }) {
  const problems = jobEnvProblems('quota', env);
  if (problems.length > 0) throw new JobEnvError('quota', problems);
  const settings = Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key, env[key] ? Number(env[key]) : value]));
  const db = supabaseClient({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, fetchFn });
  const alerts = alerter({ ntfyUrl: env.NTFY_TOPIC_URL, healthcheckUrl: env.QUOTA_HEALTHCHECK_URL, fetchFn, title: 'Mob Machine quotas' });

  const databaseBytes = Number(await db.rpc('ops_database_size'));
  let minutesUsed = 0;
  let minutesError = null;
  try {
    const url = new URL(`https://api.github.com/users/${env.GITHUB_BILLING_USER}/settings/billing/usage`);
    url.searchParams.set('year', String(now.getUTCFullYear()));
    url.searchParams.set('month', String(now.getUTCMonth() + 1));
    const response = await fetchFn(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${env.GITHUB_BILLING_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'peanutgallery-quota' },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`github billing usage: http ${response.status}`);
    minutesUsed = actionsMinutes(JSON.parse(text));
  } catch (error) {
    minutesError = error.message;
  }
  const result = evaluateQuota({ databaseBytes, minutesUsed, minutesError, settings });
  const row = { job: 'quota', started_at: now.toISOString(), ok: result.ok, mismatches: result.mismatches, checks: result.checks, figures: result.figures };
  if (!dryRun) {
    await db.insert('controller_runs', row);
    if (!result.ok) {
      await alerts.notify(`Quotas: ${result.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}. ${c.items.map((item) => item.fix).join(' ')}`).join('\n')}`);
    }
    await alerts.ping(result.ok);
  }
  out.write(`${result.ok ? 'PASS' : 'FAIL'}: quota ${result.checks.map((c) => `${c.name} ${c.detail}`).join('; ')}${dryRun ? ' (dry run: nothing written, nobody alerted)' : ''}\n`);
  out.write(`${JSON.stringify(row)}\n`);
  return row;
}
