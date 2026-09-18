// dispatcher-env.mjs: the transform behind make-dispatcher-env.sh. It reads the repository .env and
// three variables the operator exports, and writes the VPS dispatcher's docker env file: KEY=value
// lines, no quotes, no export, JSON on one line (docs/specs/vps.md). No value is ever printed; every
// message names keys only.
//
// usage: node platform/ops/dispatcher-env.mjs <dotenv-file> <output-file>
import { chmodSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

// Exported by the operator in the Mac shell, never read from .env: the VPS has its own GitHub token,
// and its own healthchecks.io check and ntfy topic.
export const OPERATOR_KEYS = ['VPS_GITHUB_TOKEN', 'HEALTHCHECK_URL', 'NTFY_TOPIC_URL'];

// Copied from .env when set: the optional settings loadConfig reads (platform/dispatcher/src/config.ts).
export const OPTIONAL_KEYS = [
  'POOL_DAILY_CAP_USD',
  'CARD_MAX_USD',
  'SESSION_MAX_TURNS',
  'SESSION_MAX_MINUTES',
  'AGENT_HOURLY_RATE_USD',
  'DISPATCHER_TICK_MS',
  'DISPATCHER_MAX_CONCURRENCY',
  'DISPATCHER_SCHEDULER',
  'BOARD_SESSION_TTL_MIN',
  'MODEL_DIRECTOR',
  'MODEL_HOST',
];

// Optional models that, when set, need a row in PRICE_TABLE_JSON, as loadConfig requires.
export const PRICED_OPTIONAL_MODELS = ['MODEL_DIRECTOR', 'MODEL_HOST'];

// Read by loadConfig but never copied from the Mac's .env, with the reason.
export const NOT_COPIED = {
  ANTHROPIC_API_KEY: "the founder's key; the VPS bills the studio key only",
  CLAUDE_BIN: 'the image sets /usr/local/bin/claude; a path on the Mac does not exist on the VPS',
  DISPATCHER_WORKTREE_ROOT: 'dispatcher.service sets /srv/peanutgallery-worktrees; a path on the Mac does not exist on the VPS',
  DISPATCHER_CODE_ROOT: 'dispatcher.service sets /opt/peanutgallery, the read-only code clone',
  DISPATCHER_REPO_ROOT: 'dispatcher.service sets /srv/peanutgallery, the work clone',
  DISPATCHER_CODE_READONLY: 'dispatcher.service sets required',
};

// Never in the VPS env file (provision.sh refuses a file that has one).
export const FORBIDDEN_KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SUPABASE_ACCESS_TOKEN', 'ANTHROPIC_API_KEY'];

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
    ['NETLIFY_AUTH_TOKEN', required('NETLIFY_AUTH_TOKEN', fromDotenv('NETLIFY_AUTH_TOKEN'), '.env')],
    ['NETLIFY_SITE_ID_SEED', required('NETLIFY_SITE_ID_SEED', fromDotenv('NETLIFY_SITE_ID_SEED'), '.env')],
    ['NETLIFY_SITE_ID_PLATFORM', required('NETLIFY_SITE_ID_PLATFORM', fromDotenv('NETLIFY_SITE_ID_PLATFORM'), '.env')],
    ['SUPABASE_URL', required('SUPABASE_URL', fromDotenv('SUPABASE_URL'), '.env')],
    ['SUPABASE_SERVICE_ROLE_KEY', supabaseKey],
    ['PRICE_TABLE_JSON', priceTable],
    ['MODEL_BUILDER', model],
    ['HEALTHCHECK_URL', alertUrl('HEALTHCHECK_URL')],
    ['NTFY_TOPIC_URL', alertUrl('NTFY_TOPIC_URL')],
  ];
  for (const key of OPTIONAL_KEYS) {
    const value = fromDotenv(key);
    if (value) entries.push([key, value]);
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
  const lines = ['# Peanut Gallery dispatcher on the VPS. Written by platform/ops/make-dispatcher-env.sh; docker --env-file format.'];
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
