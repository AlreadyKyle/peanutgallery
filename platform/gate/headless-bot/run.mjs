#!/usr/bin/env node
// run.mjs: the headless playtest step of the gate. It shells out to the seed bot command line and
// reads its JSON report; it never imports from seed-1.
//
// usage: node run.mjs --config-dir <dir> --hours <n> --seed <n> [--real-seconds <n>] [--repo-root <dir>]
//                     [--report-file <path>]
//
// Runs `pnpm --filter @backseat/seed-1 bot -- <args> --json` from the repository root. Prints
// PASS: headless-bot ... when the bot exits 0 with every invariant holding, else FAIL: headless-bot
// with the failing invariants on the following lines. Exit 0 pass, 1 fail, 2 usage.
//
// --report-file writes the same verdict to a file the caller names, a fresh path per run (the gate
// puts a random nonce in it). The file must not exist beforehand, and it is created only once the
// bot has exited; a file someone else created in between fails the run. A caller reads the verdict
// there, so a stray line on this process's output cannot stand in for it. It is not containment: the
// bot imports the card's sim code into its own process, and code running there can do what this
// file does. It catches a confused agent's regressions, not a malicious one.
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: node run.mjs --config-dir <dir> --hours <n> --seed <n> [--real-seconds <n>] [--repo-root <dir>] [--report-file <path>]';
const SEED_PACKAGE = '@backseat/seed-1';
const FLAGS = ['--config-dir', '--hours', '--seed', '--real-seconds', '--repo-root', '--report-file'];

function parseArgs(argv) {
  const values = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!FLAGS.includes(flag)) throw new Error(`unknown argument ${flag}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    values.set(flag, value);
  }
  for (const required of ['--config-dir', '--hours', '--seed']) {
    if (!values.has(required)) throw new Error(`${required} is required`);
  }
  for (const numeric of ['--hours', '--seed', '--real-seconds']) {
    if (values.has(numeric) && !(Number.isFinite(Number(values.get(numeric))) && Number(values.get(numeric)) >= 0)) {
      throw new Error(`${numeric} must be a number of at least 0`);
    }
  }
  return values;
}

function lastJsonLine(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('{'));
  if (lines.length === 0) return null;
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

// The verdict lines and the exit code for one bot run.
function verdict(child) {
  if (child.error) return { code: 1, lines: [`FAIL: headless-bot could not start pnpm: ${child.error.message}`] };
  const report = lastJsonLine(child.stdout ?? '');
  if (report === null) return { code: 1, lines: [`FAIL: headless-bot no JSON report from the bot (exit ${child.status})`] };
  const invariants = Array.isArray(report.invariants) ? report.invariants : [];
  const failed = invariants.filter((item) => item && item.ok === false);
  if (child.status !== 0 || report.ok !== true || failed.length > 0) {
    const lines = [`FAIL: headless-bot exit=${child.status} ok=${report.ok === true} failed=${failed.length}`];
    for (const item of failed) lines.push(`invariant ${item.name}: ${item.detail}`);
    return { code: 1, lines };
  }
  const unlocks = Array.isArray(report.unlocks) ? report.unlocks.length : 0;
  return {
    code: 0,
    lines: [`PASS: headless-bot simulatedSeconds=${report.simulatedSeconds} unlocks=${unlocks} finalTotalDust=${report.finalTotalDust} stateHash=${report.stateHash}`],
  };
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
    return 2;
  }
  const gateDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = args.has('--repo-root') ? resolve(args.get('--repo-root')) : resolve(gateDir, '..', '..', '..');
  const configDir = resolve(args.get('--config-dir'));
  if (!existsSync(configDir)) {
    process.stderr.write(`config directory not found: ${configDir}\n${USAGE}\n`);
    return 2;
  }
  const reportFile = args.has('--report-file') ? resolve(args.get('--report-file')) : null;
  if (reportFile !== null && (existsSync(reportFile) || !existsSync(dirname(reportFile)))) {
    process.stderr.write(`the report file must be a new file in a folder that exists: ${reportFile}\n${USAGE}\n`);
    return 2;
  }
  const botArgs = ['--config-dir', configDir, '--hours', args.get('--hours'), '--seed', args.get('--seed')];
  if (args.has('--real-seconds')) botArgs.push('--real-seconds', args.get('--real-seconds'));
  botArgs.push('--json');
  const child = spawnSync('pnpm', ['--filter', SEED_PACKAGE, 'bot', '--', ...botArgs], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  let result = verdict(child);
  if (reportFile !== null) {
    try {
      // wx: create the file, and fail when it already exists.
      writeFileSync(reportFile, `${result.lines.join('\n')}\n`, { flag: 'wx' });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
      const why = code === 'EEXIST' ? 'another process created it during the run' : `the write failed with ${code}`;
      result = { code: 1, lines: [`FAIL: headless-bot could not write the report file: ${why}`] };
    }
  }
  process.stdout.write(`${result.lines.join('\n')}\n`);
  return result.code;
}

process.exitCode = main(process.argv.slice(2));
