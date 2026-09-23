// jobs-env.mjs: the transform behind make-jobs-env.sh. It reads the repository .env and the values the
// operator exports, and writes one docker env file per VPS job (docs/specs/money-safety.md), each with
// only that job's keys, so no job holds a secret it does not use:
//   backup.env      the read-only backup login, the board's age public key, the bucket's write-only
//                   pre-authenticated request and the backup healthcheck;
//   controller.env  the Supabase service key and the restricted Stripe read key;
//   quota.env       the Supabase service key and the dispatcher's GitHub token for its Plan read;
//   backup-mac.env  on the Mac host, the backup login, the board's age public key, the folder the
//                   backups go to and the backup healthcheck (docs/specs/mac-host.md). Written only
//                   when asked for by name.
// No value is ever printed; every message names keys only. A job whose keys are not all there yet is
// refused and named, and the others are still written.
//
// usage: node platform/ops/jobs-env.mjs <dotenv-file> <output-folder> [backup|backup-mac|controller|quota ...]
import { chmodSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { JOB_KEYS, VPS_JOBS, jobEnvProblems, jobKeys } from './jobs/lib.mjs';

// Exported by the operator in the Mac shell (from .env.vps), never read from .env.
export const JOB_OPERATOR_KEYS = ['NTFY_TOPIC_URL', 'BACKUP_HEALTHCHECK_URL', 'VPS_GITHUB_TOKEN', 'CONTROLLER_HEALTHCHECK_URL', 'QUOTA_HEALTHCHECK_URL'];

// Each job's entries, in the order jobKeys gives, from .env and the operator's values.
export function jobEnvEntries(job, dotenvText, operator) {
  const dotenv = parseEnv(dotenvText);
  const fromDotenv = (key) => (dotenv[key] ?? '').trim();
  const fromOperator = (key) => (operator[key] ?? '').trim();
  const owner = fromDotenv('GITHUB_REPO').split('/')[0] ?? '';
  const source = {
    SUPABASE_URL: fromDotenv('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: fromDotenv('SUPABASE_SECRET_KEY') || fromDotenv('SUPABASE_SERVICE_ROLE_KEY'),
    STRIPE_READ_KEY: fromDotenv('STRIPE_READ_KEY'),
    NTFY_TOPIC_URL: fromOperator('NTFY_TOPIC_URL'),
    CONTROLLER_HEALTHCHECK_URL: fromOperator('CONTROLLER_HEALTHCHECK_URL'),
    QUOTA_HEALTHCHECK_URL: fromOperator('QUOTA_HEALTHCHECK_URL'),
    GITHUB_BILLING_TOKEN: fromOperator('VPS_GITHUB_TOKEN'),
    GITHUB_BILLING_USER: owner,
    DATABASE_ALERT_MB: fromDotenv('DATABASE_ALERT_MB'),
    ACTIONS_MINUTES_INCLUDED: fromDotenv('ACTIONS_MINUTES_INCLUDED'),
    ACTIONS_MINUTES_FLOOR: fromDotenv('ACTIONS_MINUTES_FLOOR'),
    BACKUP_DB_URL: fromDotenv('BACKUP_DB_URL'),
    BACKUP_SKIP_AUTH: fromDotenv('BACKUP_SKIP_AUTH'),
    BACKUP_AGE_RECIPIENT: fromDotenv('BACKUP_AGE_RECIPIENT'),
    BACKUP_PAR_URL: fromDotenv('BACKUP_PAR_URL'),
    BACKUP_BUCKET: fromDotenv('BACKUP_BUCKET'),
    BACKUP_HEALTHCHECK_URL: fromOperator('BACKUP_HEALTHCHECK_URL'),
    RESTORE_CHECK_WEEKDAY: fromDotenv('RESTORE_CHECK_WEEKDAY'),
    BACKUP_DIR: fromDotenv('BACKUP_DIR'),
    BACKUP_KEEP_DAYS: fromDotenv('BACKUP_KEEP_DAYS'),
  };
  const entries = jobKeys(job)
    .map((key) => [key, source[key] ?? ''])
    .filter(([key, value]) => value !== '' || JOB_KEYS[job].required.includes(key));
  const problems = jobEnvProblems(job, Object.fromEntries(entries));
  for (const [key, value] of entries) {
    if (/[\r\n]/.test(value)) problems.push(`${key} spans more than one line`);
    if (value.startsWith('"') || value.startsWith("'")) problems.push(`${key} starts with a quote, which docker would keep as part of the value`);
  }
  return { entries, problems };
}

export function jobEnvText(job, entries) {
  const lines = [`# Peanut Gallery ${job} job. Written by platform/ops/make-jobs-env.sh; docker --env-file format.`];
  for (const [key, value] of entries) lines.push(`${key}=${value}`);
  return `${lines.join('\n')}\n`;
}

function main(argv) {
  if (argv.length < 2) {
    process.stderr.write('usage: node platform/ops/jobs-env.mjs <dotenv-file> <output-folder> [backup|backup-mac|controller|quota ...]\n');
    return 2;
  }
  const [dotenvFile, outDir, ...asked] = argv;
  const jobs = asked.length > 0 ? asked : VPS_JOBS;
  let dotenvText;
  try {
    dotenvText = readFileSync(dotenvFile, 'utf8');
  } catch {
    process.stderr.write(`could not read ${dotenvFile}\n`);
    return 1;
  }
  let refused = 0;
  for (const job of jobs) {
    if (!JOB_KEYS[job]) {
      process.stderr.write(`unknown job ${job}\n`);
      refused += 1;
      continue;
    }
    const { entries, problems } = jobEnvEntries(job, dotenvText, process.env);
    if (problems.length > 0) {
      process.stderr.write(`${job}.env not written:\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n`);
      refused += 1;
      continue;
    }
    const file = path.join(outDir, `${job}.env`);
    writeFileSync(file, jobEnvText(job, entries), { mode: 0o600 });
    chmodSync(file, 0o600);
    process.stdout.write(`wrote ${file} (mode 0600) with ${entries.length} keys: ${entries.map(([key]) => key).join(', ')}\n`);
  }
  return refused > 0 ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
