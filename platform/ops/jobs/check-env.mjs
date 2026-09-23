// check-env.mjs: the check of one job's env file, by provision.sh on a server and by
// platform/ops/mac/run-job.sh on the Mac host (docs/specs/money-safety.md, docs/specs/mac-host.md).
// It prints one line per problem, naming keys and line numbers only, never a value, and exits 1 when
// there is any; else it prints "valid" and exits 0.
//   node platform/ops/jobs/check-env.mjs controller|quota|backup|backup-mac <env file>
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JOB_KEYS, jobEnvProblems, jobKeys, parseEnvFile } from './lib.mjs';

export function envFileProblems(job, text) {
  if (!JOB_KEYS[job]) return [`unknown job ${job}`];
  const problems = [];
  const seen = new Set();
  const allowed = new Set(jobKeys(job));
  text.split('\n').forEach((line, index) => {
    if (line === '' || line.startsWith('#')) return;
    const number = index + 1;
    if (line.includes('\r')) return problems.push(`line ${number} ends in a carriage return`);
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) return problems.push(`line ${number} is not KEY=value (no spaces, no export)`);
    const [, key, value] = match;
    if (seen.has(key)) problems.push(`${key} is set more than once`);
    seen.add(key);
    if (!allowed.has(key)) problems.push(`${key} is not a ${job} key; the ${job} env file holds only ${[...allowed].join(', ')}`);
    if (value.startsWith('"') || value.startsWith("'")) problems.push(`${key} starts with a quote, which docker would keep as part of the value`);
  });
  return [...problems, ...jobEnvProblems(job, parseEnvFile(text))];
}

function main(argv) {
  const [job, file] = argv;
  if (!job || !file || argv.length !== 2) {
    process.stderr.write('usage: node platform/ops/jobs/check-env.mjs controller|quota|backup|backup-mac <env file>\n');
    return 2;
  }
  const problems = envFileProblems(job, readFileSync(file, 'utf8'));
  if (problems.length > 0) {
    process.stdout.write(`${problems.join('\n')}\n`);
    return 1;
  }
  process.stdout.write('valid\n');
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
