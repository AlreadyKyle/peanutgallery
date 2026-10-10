// dispatcher-env.mjs: the transform behind make-dispatcher-env.sh. It reads the repository .env and
// four variables the operator exports, and writes the VPS dispatcher's docker env file: KEY=value
// lines, no quotes, no export, JSON on one line (docs/specs/vps.md, docs/specs/launch-managed.md). No
// value is ever printed; every message names keys only.
//
// usage: node platform/ops/dispatcher-env.mjs <dotenv-file> <output-file>
import { chmodSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

// Exported by the operator in the Mac shell, never read from .env: the VPS has its own GitHub token,
// the read-only token Managed Agents sessions clone with, and its own healthchecks.io check and ntfy
// topic.
export const OPERATOR_KEYS = ['VPS_GITHUB_TOKEN', 'GITHUB_READ_TOKEN', 'HEALTHCHECK_URL', 'NTFY_TOPIC_URL'];

// Copied from .env and required: the managed agent, its pinned version and the environment, as
// `pnpm --filter @backseat/dispatcher managed:apply` prints them. They are ids, not secrets.
export const MANAGED_KEYS = ['MANAGED_AGENT_ID', 'MANAGED_AGENT_VERSION', 'MANAGED_ENVIRONMENT_ID'];

// Fine-grained personal access tokens start with this; unattended mode refuses any other kind.
export const FINE_GRAINED_PREFIX = 'github_pat_';

// Copied from .env when set: the optional settings loadConfig reads (platform/dispatcher/src/config.ts).
export const OPTIONAL_KEYS = [
  'POOL_DAILY_CAP_USD',
  'CARD_MAX_USD',
  'VISUAL_REVIEW_MAX_USD',
  'SESSION_MAX_TURNS',
  'SESSION_MAX_MINUTES',
  'AGENT_HOURLY_RATE_USD',
  'DISPATCHER_TICK_MS',
  'DISPATCHER_MAX_CONCURRENCY',
  'BOARD_SESSION_TTL_MIN',
  'MODEL_DIRECTOR',
  'MODEL_HOST',
  'PUBLIC_SITE_URL',
];

// Copied from .env when set, and checked with the dispatcher's own pattern (config.ts): the Discord
// webhooks the outbound lane posts to (docs/specs/studio-reports.md). Unset, a lane is inert. Each
// address is a bearer secret, so a refusal names the key only.
export const DISCORD_KEYS = ['DISCORD_WEBHOOK_SHIPS', 'DISCORD_WEBHOOK_WEEKLY'];
export const DISCORD_WEBHOOK = /^https:\/\/((ptb|canary)[.])?discord(app)?[.]com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+$/;

// Optional models that, when set, need a row in PRICE_TABLE_JSON, as loadConfig requires.
export const PRICED_OPTIONAL_MODELS = ['MODEL_DIRECTOR', 'MODEL_HOST'];

// Read by loadConfig but never copied from the Mac's .env, with the reason.
export const NOT_COPIED = {
  ANTHROPIC_API_KEY: "the founder's key; the VPS bills the studio key only",
  CLAUDE_BIN: 'attended mode only; unattended mode runs Managed Agents sessions and no claude CLI',
  DISPATCHER_WORKTREE_ROOT: 'dispatcher.service sets /srv/peanutgallery-worktrees; a path on the Mac does not exist on the VPS',
  DISPATCHER_CODE_ROOT: 'dispatcher.service sets /opt/peanutgallery, the read-only code clone',
  DISPATCHER_REPO_ROOT: 'dispatcher.service sets /srv/peanutgallery, the work clone',
  DISPATCHER_CODE_READONLY: 'dispatcher.service sets required',
};

// Never in the VPS env file (provision.sh refuses a file that has one). The jobs' secrets (the Stripe
// read key and the backup login, docs/specs/money-safety.md) live in the jobs' own env files only; the
// database owner's password stays on the Mac.
export const FORBIDDEN_KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SUPABASE_ACCESS_TOKEN', 'ANTHROPIC_API_KEY', 'STRIPE_READ_KEY', 'BACKUP_DB_URL', 'SUPABASE_DB_PASSWORD'];

export class EnvFileError extends Error {
  constructor(problems) {
    super(`dispatcher env file not written:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'EnvFileError';
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

// The entries of the env file in order, as [key, value] pairs. Throws EnvFileError naming every
// problem found.
export function dispatcherEnvEntries(dotenvText, operator) {
  const dotenv = parseEnv(dotenvText);
  const problems = [];
  const fromDotenv = (key) => (dotenv[key] ?? '').trim();
  const required = (key, value, source) => {
    if (!value) problems.push(`${key} is not set in ${source}`);
    return value;
  };

  const studioKey = required('STUDIO_ANTHROPIC_API_KEY', fromDotenv('STUDIO_ANTHROPIC_API_KEY'), '.env');
  if (studioKey && studioKey === fromDotenv('ANTHROPIC_API_KEY')) problems.push('STUDIO_ANTHROPIC_API_KEY must differ from ANTHROPIC_API_KEY');

  const vpsToken = required('VPS_GITHUB_TOKEN', (operator.VPS_GITHUB_TOKEN ?? '').trim(), 'the operator environment (export it)');
  if (vpsToken && vpsToken === fromDotenv('GITHUB_TOKEN')) problems.push("VPS_GITHUB_TOKEN equals .env's GITHUB_TOKEN; create a separate fine-grained token for the VPS");

  const readToken = required('GITHUB_READ_TOKEN', (operator.GITHUB_READ_TOKEN ?? '').trim(), 'the operator environment (export it)');
  if (readToken && (readToken === vpsToken || readToken === fromDotenv('GITHUB_TOKEN'))) {
    problems.push('GITHUB_READ_TOKEN equals a token that can write; create a separate fine-grained token with Contents read only');
  }
  for (const [key, token] of [
    ['VPS_GITHUB_TOKEN', vpsToken],
    ['GITHUB_READ_TOKEN', readToken],
  ]) {
    if (token && !token.startsWith(FINE_GRAINED_PREFIX)) problems.push(`${key} is not a fine-grained personal access token (${FINE_GRAINED_PREFIX}...)`);
  }
  const managed = MANAGED_KEYS.map((key) => [key, required(key, fromDotenv(key), '.env (managed:apply prints it)')]);
  const version = fromDotenv('MANAGED_AGENT_VERSION');
  if (version && !/^[1-9][0-9]*$/.test(version)) problems.push('MANAGED_AGENT_VERSION must be a positive integer');

  const supabaseKey = fromDotenv('SUPABASE_SECRET_KEY') || fromDotenv('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseKey) problems.push('neither SUPABASE_SECRET_KEY nor SUPABASE_SERVICE_ROLE_KEY is set in .env');

  const model = required('MODEL_BUILDER', fromDotenv('MODEL_BUILDER'), '.env');
  let priceTable = '';
  const rawTable = fromDotenv('PRICE_TABLE_JSON');
  if (!rawTable) {
    problems.push('PRICE_TABLE_JSON is not set in .env');
  } else {
    let parsed = null;
    try {
      parsed = JSON.parse(rawTable);
    } catch {
      problems.push('PRICE_TABLE_JSON in .env is not valid JSON');
    }
    if (parsed !== null) {
      if (typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
        problems.push('PRICE_TABLE_JSON must be an object keyed by model id');
      } else {
        priceTable = JSON.stringify(parsed);
        if (model && !Object.hasOwn(parsed, model)) problems.push('MODEL_BUILDER has no row in PRICE_TABLE_JSON; the startup probe could not be metered');
        for (const key of PRICED_OPTIONAL_MODELS) {
          const optional = fromDotenv(key);
          if (optional && !Object.hasOwn(parsed, optional)) problems.push(`${key} has no row in PRICE_TABLE_JSON; the dispatcher would refuse to start`);
        }
      }
    }
  }

  const alertUrl = (key) => {
    const value = required(key, (operator[key] ?? '').trim(), 'the operator environment (export it)');
    if (value && !isHttpsUrl(value)) problems.push(`${key} must be an https URL`);
    return value;
  };

  const entries = [
    ['AGENT_MODE', 'unattended'],
    ['STUDIO_ANTHROPIC_API_KEY', studioKey],
    ['GITHUB_REPO', required('GITHUB_REPO', fromDotenv('GITHUB_REPO'), '.env')],
    ['GITHUB_TOKEN', vpsToken],
    ['GITHUB_READ_TOKEN', readToken],
    ['NETLIFY_AUTH_TOKEN', required('NETLIFY_AUTH_TOKEN', fromDotenv('NETLIFY_AUTH_TOKEN'), '.env')],
    ['NETLIFY_SITE_ID_SEED', required('NETLIFY_SITE_ID_SEED', fromDotenv('NETLIFY_SITE_ID_SEED'), '.env')],
    ['NETLIFY_SITE_ID_PLATFORM', required('NETLIFY_SITE_ID_PLATFORM', fromDotenv('NETLIFY_SITE_ID_PLATFORM'), '.env')],
    ['SUPABASE_URL', required('SUPABASE_URL', fromDotenv('SUPABASE_URL'), '.env')],
    ['SUPABASE_SERVICE_ROLE_KEY', supabaseKey],
    ['PRICE_TABLE_JSON', priceTable],
    ['MODEL_BUILDER', model],
    ...managed,
    ['HEALTHCHECK_URL', alertUrl('HEALTHCHECK_URL')],
    ['NTFY_TOPIC_URL', alertUrl('NTFY_TOPIC_URL')],
  ];
  for (const key of OPTIONAL_KEYS) {
    const value = fromDotenv(key);
    if (value) entries.push([key, value]);
  }
  for (const key of DISCORD_KEYS) {
    const value = fromDotenv(key);
    if (!value) continue;
    if (DISCORD_WEBHOOK.test(value)) entries.push([key, value]);
    else problems.push(`${key} must be a Discord webhook address (https://discord.com/api/webhooks/<id>/<token>)`);
  }

  // docker's env file has no quoting: a value is the rest of its line, taken literally.
  for (const [key, value] of entries) {
    if (/[\r\n]/.test(value)) problems.push(`${key} spans more than one line`);
    if (value.startsWith('"') || value.startsWith("'")) problems.push(`${key} starts with a quote, which docker would keep as part of the value`);
  }
  if (problems.length > 0) throw new EnvFileError(problems);
  return entries;
}

export function dispatcherEnvText(entries) {
  const lines = ['# Mob Machine dispatcher on the VPS. Written by platform/ops/make-dispatcher-env.sh; docker --env-file format.'];
  for (const [key, value] of entries) lines.push(`${key}=${value}`);
  return `${lines.join('\n')}\n`;
}

function main(argv) {
  if (argv.length !== 2) {
    process.stderr.write('usage: node platform/ops/dispatcher-env.mjs <dotenv-file> <output-file>\n');
    return 2;
  }
  const [dotenvFile, outputFile] = argv;
  let entries;
  try {
    entries = dispatcherEnvEntries(readFileSync(dotenvFile, 'utf8'), process.env);
  } catch (error) {
    process.stderr.write(`${error instanceof EnvFileError ? error.message : `could not read ${dotenvFile}`}\n`);
    return 1;
  }
  writeFileSync(outputFile, dispatcherEnvText(entries), { mode: 0o600 });
  chmodSync(outputFile, 0o600);
  process.stdout.write(`wrote ${outputFile} (mode 0600) with ${entries.length} keys: ${entries.map(([key]) => key).join(', ')}\n`);
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
