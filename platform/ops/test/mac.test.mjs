// Tests for the Mac host (docs/specs/mac-host.md): run-dispatcher.sh's exit-code mapping, restart delay
// and start limit; run-job.sh's UTC schedule; the LaunchAgent templates as install.sh renders them;
// backup-mac.sh's dumps and refusals; the read-only check; the dispatcher's dotenv reading the env
// file make-dispatcher-env.sh writes; and make-jobs-env.sh writing the Mac's env files. Every tool the
// scripts call that would reach a service or sleep (node for the dispatcher, caffeinate, curl, the
// Postgres tools, age, sleep) is a fake on PATH that records what it was asked. Nothing here loads a
// LaunchAgent, touches ~/peanutgallery-host or reaches a service. ops.test.mjs imports this file, so
// `pnpm test:ops` runs it. Every value in the fixtures is made up.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MAC_JOBS, parseEnvFile } from '../jobs/lib.mjs';

const OPS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAC_DIR = path.join(OPS_DIR, 'mac');
const REPO_ROOT = path.resolve(OPS_DIR, '..', '..');
const read = (relative) => readFileSync(path.join(REPO_ROOT, relative), 'utf8');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'peanutgallery-mac-test-'));
after(() => {
  spawnSync('chmod', ['-R', 'u+w', scratch]);
  rmSync(scratch, { recursive: true, force: true });
});
// The LaunchAgents run /bin/bash, which is bash 3.2 on macOS; the scripts are tested with it.
const BASH = existsSync('/bin/bash') ? '/bin/bash' : 'bash';
const AGE = `age1${'q'.repeat(58)}`;
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const HOSTNAME = spawnSync('sh', ['-c', 'hostname -s 2> /dev/null || hostname'], { encoding: 'utf8' }).stdout.trim();

let serial = 0;
const fresh = (name) => mkdtempSync(path.join(scratch, `${name}-${(serial += 1)}-`));
const fake = (bin, name, body) => writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

// A curl that records the config file it was handed, and a sleep that records its length and only
// really waits for the short polls.
function commonFakes(bin, log) {
  fake(bin, 'curl', `config=""; while [ $# -gt 0 ]; do [ "$1" = -K ] && config="$2"; shift; done; { echo "curl"; cat "$config"; } >> "${log}"; exit \${FAKE_CURL_STATUS:-0}`);
  fake(bin, 'sleep', `echo "sleep $1" >> "${log}"; case "$1" in 0* | 1 | 5) /bin/sleep 0.05 ;; esac; exit 0`);
}

// Sources a script's functions without running it and runs a body; returns the spawn result.
function sourced(script, guard, body, env = {}) {
  return spawnSync(BASH, ['-c', `set -euo pipefail; ${guard}=1 . "$1"; ${body}`, 'mac-test', path.join(MAC_DIR, script)], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    encoding: 'utf8',
  });
}

// ---------------------------------------------------------------- run-dispatcher.sh

// A host folder as install.sh leaves it, with a fake node that records how it was run and exits with
// the code in the node-exit file.
function dispatcherHost() {
  const root = fresh('dispatcher');
  const host = path.join(root, 'host');
  const code = path.join(host, 'code');
  const work = path.join(host, 'work');
  mkdirSync(path.join(code, 'platform', 'dispatcher', 'src'), { recursive: true });
  mkdirSync(path.join(code, 'node_modules'));
  writeFileSync(path.join(code, 'platform', 'dispatcher', 'src', 'main.ts'), '');
  writeFileSync(path.join(code, '.env'), 'AGENT_MODE=unattended\n');
  mkdirSync(work, { recursive: true });
  spawnSync('git', ['init', '-q', work], { env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  spawnSync('git', ['-C', work, 'remote', 'add', 'origin', 'https://github.com/AlreadyKyle/peanutgallery.git'], { env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  mkdirSync(path.join(host, 'env'));
  writeFileSync(path.join(host, 'env', 'ntfy.url'), 'https://ntfy.sh/fixture-topic\n');
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const log = path.join(root, 'calls.log');
  const exitFile = path.join(root, 'node-exit');
  writeFileSync(exitFile, '0');
  commonFakes(bin, log);
  fake(bin, 'caffeinate', `echo "caffeinate $*" >> "${log}"; exit 0`);
  fake(
    bin,
    'node',
    [
      `{ echo "node $*"; echo "node cwd $(pwd -P)"; env | grep -E '^(DISPATCHER_|TSX_|FIXTURE_)' | sort | sed 's/^/node env /'; } >> "${log}"`,
      `if [ -f "${root}/node-waits" ]; then trap 'echo "node got TERM" >> "${log}"; exit 0' TERM; echo started > "${root}/node-started"; while :; do /bin/sleep 0.05; done; fi`,
      `exit "$(cat "${exitFile}")"`,
    ].join('\n'),
  );
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME, PEANUTGALLERY_HOST: host, FIXTURE_SECRET: 'fixture-parent-secret' };
  const run = () => {
    const result = spawnSync(BASH, [path.join(MAC_DIR, 'run-dispatcher.sh')], { env, encoding: 'utf8' });
    return { ...result, calls: lines(log), log: existsSync(path.join(host, 'logs', 'dispatcher.log')) ? readFileSync(path.join(host, 'logs', 'dispatcher.log'), 'utf8') : '' };
  };
  const reset = () => rmSync(log, { force: true });
  return { root, host, code, work, env, run, reset, setExit: (code_) => writeFileSync(exitFile, String(code_)), state: path.join(host, 'state') };
}

const delays = (calls) => calls.filter((line) => /^sleep \d+$/.test(line)).map((line) => Number(line.split(' ')[1])).filter((seconds) => seconds >= 30);
const posts = (calls) => calls.filter((line) => line.startsWith('data-binary = '));

describe('run-dispatcher.sh', () => {
  test('restart_delay doubles from 30 seconds to 30 minutes over 6 steps, as dispatcher.service does', () => {
    const run = sourced('run-dispatcher.sh', 'RUN_DISPATCHER_SOURCE_ONLY', 'for n in 1 2 3 4 5 6 7 8 20; do restart_delay "$n"; done');
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.stdout.trim().split('\n').map(Number), [30, 60, 120, 240, 480, 960, 1800, 1800, 1800]);
    const unit = read('platform/ops/dispatcher.service');
    assert.match(unit, /^RestartSec=30s$/m);
    assert.match(unit, /^RestartSteps=6$/m);
    assert.match(unit, /^RestartMaxDelaySec=30min$/m);
    assert.match(unit, /^StartLimitBurst=8$/m);
    assert.match(unit, /^StartLimitIntervalSec=6h$/m);
    const script = read('platform/ops/mac/run-dispatcher.sh');
    assert.match(script, /^START_LIMIT_BURST=8$/m);
    assert.match(script, /^START_LIMIT_INTERVAL_SECONDS=21600$/m);
    assert.match(script, /^EXIT_FATAL=78$/m);
  });

  test('runs the dispatcher from the code clone as the entrypoint does, read-only required, with none of its own environment', () => {
    const host = dispatcherHost();
    const result = host.run();
    const real = (folder) => spawnSync('sh', ['-c', 'cd "$1" && pwd -P', 'x', folder], { encoding: 'utf8' }).stdout.trim();
    assert.ok(result.calls.includes('node --import tsx src/main.ts'), result.calls.join('\n'));
    assert.ok(result.calls.includes(`node cwd ${real(path.join(host.code, 'platform', 'dispatcher'))}`), result.calls.join('\n'));
    for (const line of [
      `node env DISPATCHER_CODE_READONLY=required`,
      `node env DISPATCHER_CODE_ROOT=${real(host.code)}`,
      `node env DISPATCHER_REPO_ROOT=${path.join(host.host, 'work')}`,
      `node env DISPATCHER_WORKTREE_ROOT=${path.join(host.host, 'work-worktrees')}`,
      'node env TSX_DISABLE_CACHE=1',
    ]) {
      assert.ok(result.calls.includes(line), `${line}\n${result.calls.join('\n')}`);
    }
    assert.ok(!result.calls.some((line) => line.includes('FIXTURE_SECRET')), 'the dispatcher gets none of the wrapper environment beyond PATH, HOME and the roots');
    assert.ok(result.calls.some((line) => /^caffeinate -i -s -w \d+$/.test(line)), 'caffeinate is held for the wrapper');
    assert.match(result.log, /^run-dispatcher: start \d+$/m);
  });

  test('exit 78 posts the fatal alert and exits 0, so launchd does not restart it', () => {
    const host = dispatcherHost();
    host.setExit(78);
    const result = host.run();
    assert.equal(result.status, 0, result.log);
    assert.deepEqual(posts(result.calls), [`data-binary = "Peanut Gallery dispatcher stopped on ${HOSTNAME}: fatal startup error"`]);
    assert.ok(result.calls.includes('url = "https://ntfy.sh/fixture-topic"'), 'the topic reaches curl in its config file');
    assert.deepEqual(delays(result.calls), []);
    assert.match(result.log, /^run-dispatcher: stopped: fatal startup error: the dispatcher exited 78/m);
    assert.ok(!existsSync(path.join(host.state, 'dispatcher-failures')));
  });

  test('any other exit waits 30 seconds, doubling at each failure in a row, and exits 1 for launchd to restart', () => {
    const host = dispatcherHost();
    host.setExit(1);
    const first = host.run();
    assert.equal(first.status, 1, first.log);
    assert.deepEqual(delays(first.calls), [30]);
    assert.equal(readFileSync(path.join(host.state, 'dispatcher-failures'), 'utf8').trim(), '1');
    assert.deepEqual(posts(first.calls), [], 'a restart is not an alert');
    host.reset();
    const second = host.run();
    assert.equal(second.status, 1);
    assert.deepEqual(delays(second.calls), [60]);
    writeFileSync(path.join(host.state, 'dispatcher-failures'), '6\n');
    host.reset();
    assert.deepEqual(delays(host.run().calls), [1800]);
    // An exit 0 nobody asked for is restarted too, as Restart=always does.
    host.setExit(0);
    host.reset();
    const clean = host.run();
    assert.equal(clean.status, 1);
    assert.deepEqual(delays(clean.calls), [1800]);
  });

  test('the ninth start in 6 hours is refused with an alert and exit 0; starts older than that do not count', () => {
    const host = dispatcherHost();
    mkdirSync(host.state, { recursive: true });
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(path.join(host.state, 'dispatcher-starts'), `${Array.from({ length: 8 }, (_, index) => now - 60 * index).join('\n')}\n`);
    const refused = host.run();
    assert.equal(refused.status, 0);
    assert.ok(!refused.calls.some((line) => line.startsWith('node ')), 'the dispatcher is not started');
    assert.deepEqual(posts(refused.calls), [`data-binary = "Peanut Gallery dispatcher stopped on ${HOSTNAME}: 8 starts in 6 hours"`]);
    writeFileSync(path.join(host.state, 'dispatcher-starts'), `${Array.from({ length: 8 }, (_, index) => now - 21601 - index).join('\n')}\n`);
    host.reset();
    const allowed = host.run();
    assert.ok(allowed.calls.includes('node --import tsx src/main.ts'));
    assert.equal(lines(path.join(host.state, 'dispatcher-starts')).length, 1, 'the old starts are dropped');
  });

  test('a layout check that fails is a fatal startup error: no dispatcher, one alert, exit 0', () => {
    for (const breakIt of [
      (host) => rmSync(path.join(host.code, 'node_modules'), { recursive: true }),
      (host) => rmSync(path.join(host.code, '.env')),
      (host) => spawnSync('git', ['-C', host.work, 'remote', 'set-url', 'origin', 'git@github.com:AlreadyKyle/peanutgallery.git'], { env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }),
    ]) {
      const host = dispatcherHost();
      breakIt(host);
      const result = host.run();
      assert.equal(result.status, 0, result.log);
      assert.ok(!result.calls.some((line) => line.startsWith('node ')), result.calls.join('\n'));
      assert.equal(posts(result.calls).length, 1);
      assert.match(result.log, /^run-dispatcher: stopped: fatal startup error: /m);
    }
  });

  test('a stop from launchd reaches the dispatcher, and the wrapper exits 0', async () => {
    const host = dispatcherHost();
    writeFileSync(path.join(host.root, 'node-waits'), '');
    const child = spawn(BASH, [path.join(MAC_DIR, 'run-dispatcher.sh')], { env: host.env, stdio: 'ignore' });
    const deadline = Date.now() + 10_000;
    while (!existsSync(path.join(host.root, 'node-started')) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(existsSync(path.join(host.root, 'node-started')), 'the fake dispatcher started');
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    child.kill('SIGTERM');
    assert.equal(await exited, 0);
    const calls = lines(path.join(host.root, 'calls.log'));
    assert.ok(calls.includes('node got TERM'), calls.join('\n'));
    assert.deepEqual(delays(calls), []);
    assert.match(readFileSync(path.join(host.host, 'logs', 'dispatcher.log'), 'utf8'), /^run-dispatcher: stopped by launchd; the dispatcher exited 0$/m);
  });
});

// ---------------------------------------------------------------- run-job.sh

describe('run-job.sh', () => {
  const timerTime = (job) => /^OnCalendar=\*-\*-\* (\d{2}:\d{2}):00 UTC$/m.exec(read(`platform/ops/peanutgallery-${job}.timer`))?.[1];

  test("runs each job at its systemd timer's UTC time, and launchd wakes it at that minute", () => {
    for (const job of ['backup', 'controller', 'quota']) {
      const time = sourced('run-job.sh', 'RUN_JOB_SOURCE_ONLY', `job_time ${job}`).stdout.trim();
      assert.equal(time, timerTime(job), job);
      const minute = spawnSync(BASH, ['-c', `. "$1"; job_minute ${job}`, 'x', path.join(MAC_DIR, 'lib.sh')], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } }).stdout.trim();
      assert.equal(Number(minute), Number(time.split(':')[1]), job);
    }
    assert.deepEqual(MAC_JOBS, ['backup-mac', 'controller', 'quota']);
  });

  test('is_due runs a job once per UTC day, at the first wake at or after its time', () => {
    const due = (args) => sourced('run-job.sh', 'RUN_JOB_SOURCE_ONLY', `is_due ${args}`).status;
    assert.equal(due('controller 2026-09-23 07:06 ""'), 1, 'before its time');
    assert.equal(due('controller 2026-09-23 07:07 ""'), 0, 'at its time');
    assert.equal(due('controller 2026-09-23 23:59 2026-09-22'), 0, 'a day the Mac slept through its time is made up at the first wake');
    assert.equal(due('controller 2026-09-23 12:07 2026-09-23'), 1, 'once a day');
    assert.equal(due('backup 2026-09-24 06:17 2026-09-23'), 0);
    assert.equal(due('backup 2026-09-24 00:17 2026-09-23'), 1);
    assert.equal(due('nothing 2026-09-24 23:00 ""'), 1);
  });

  // A host folder with a code clone that holds the jobs' entry points, and a fake node.
  function jobHost() {
    const root = fresh('job');
    const host = path.join(root, 'host');
    mkdirSync(path.join(host, 'code', 'platform', 'ops', 'jobs'), { recursive: true });
    mkdirSync(path.join(host, 'env'), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(host, 'env', 'ntfy.url'), 'https://ntfy.sh/fixture-topic\n');
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    const log = path.join(root, 'calls.log');
    commonFakes(bin, log);
    fake(bin, 'node', `echo "node $*" >> "${log}"; exit "$(cat "${root}/node-exit" 2> /dev/null || echo 0)"`);
    const run = (...args) => {
      const result = spawnSync(BASH, [path.join(MAC_DIR, 'run-job.sh'), ...args], { env: { PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME, PEANUTGALLERY_HOST: host }, encoding: 'utf8' });
      return { ...result, calls: lines(log) };
    };
    return { root, host, run, log };
  }

  test('checks the env file, then runs the job with node --env-file from the code clone, once a day', () => {
    const job = jobHost();
    const file = path.join(job.host, 'env', 'controller.env');
    writeFileSync(file, 'SUPABASE_URL=https://fixture.supabase.local\n');
    chmodSync(file, 0o600);
    const first = job.run('controller', '--now');
    assert.equal(first.status, 0, first.stderr);
    const code = spawnSync('sh', ['-c', 'cd "$1" && pwd -P', 'x', path.join(job.host, 'code')], { encoding: 'utf8' }).stdout.trim();
    assert.deepEqual(
      first.calls.filter((line) => line.startsWith('node ')),
      [`node ${code}/platform/ops/jobs/check-env.mjs controller ${file}`, `node --env-file=${file} ${code}/platform/ops/jobs/main.mjs controller`],
    );
    assert.equal(readFileSync(path.join(job.host, 'state', 'job-controller.last'), 'utf8').trim(), new Date().toISOString().slice(0, 10));
    rmSync(job.log);
    const again = job.run('controller');
    assert.equal(again.status, 0);
    assert.deepEqual(again.calls, [], 'the day has had its run');
    assert.ok(!existsSync(path.join(job.host, 'state', 'job-controller.lock')), 'the lock is released');
  });

  test('a job that cannot run posts "Peanut Gallery job <job> failed on <host>" to ntfy', () => {
    const job = jobHost();
    const missing = job.run('quota', '--now');
    assert.equal(missing.status, 1);
    assert.deepEqual(posts(missing.calls), [`data-binary = "Peanut Gallery job quota failed on ${HOSTNAME}; see ${path.join(job.host, 'logs', 'quota.log')}"`]);
    assert.ok(!missing.calls.some((line) => line.startsWith('node ')));
    const file = path.join(job.host, 'env', 'quota.env');
    writeFileSync(file, 'SUPABASE_URL=https://fixture.supabase.local\n');
    chmodSync(file, 0o644);
    rmSync(job.log);
    const open = job.run('quota', '--now');
    assert.equal(open.status, 1);
    assert.match(readFileSync(path.join(job.host, 'logs', 'quota.log'), 'utf8'), /quota\.env must be yours with mode 0600/);
    chmodSync(file, 0o600);
    writeFileSync(path.join(job.root, 'node-exit'), '1');
    rmSync(job.log);
    const failed = job.run('quota', '--now');
    assert.equal(failed.status, 1);
    assert.equal(posts(failed.calls).length, 1);
    assert.equal(job.run('nightly').status, 2);
  });
});

// ---------------------------------------------------------------- the LaunchAgents

describe('the LaunchAgent templates', () => {
  const HOST = '/Users/board/peanutgallery-host';
  const PATH_VALUE = '/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  const render = (template, job = '', host = HOST, pathValue = PATH_VALUE) => {
    const out = path.join(fresh('plist'), 'out.plist');
    const run = spawnSync(BASH, ['-c', '. "$1"; render_plist "$2" "$3" "$4" "$5"', 'x', path.join(MAC_DIR, 'lib.sh'), path.join(MAC_DIR, template), out, pathValue, job], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, PEANUTGALLERY_HOST: host },
      encoding: 'utf8',
    });
    return { ...run, out, text: existsSync(out) ? readFileSync(out, 'utf8') : '' };
  };
  // The plist as JSON through plutil where this is a Mac; else the few values the tests read, taken
  // from the XML.
  const asJson = (file, text) => {
    const plutil = spawnSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' });
    if (plutil.status === 0) return JSON.parse(plutil.stdout);
    const value = (key) => new RegExp(`<key>${key}</key>\\s*<(string|integer|true|false)/?>([^<]*)`).exec(text);
    const scalar = (key) => {
      const match = value(key);
      if (!match) return undefined;
      if (match[1] === 'true' || match[1] === 'false') return match[1] === 'true';
      return match[1] === 'integer' ? Number(match[2]) : match[2];
    };
    return {
      Label: scalar('Label'),
      ProgramArguments: [...(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text)?.[1] ?? '').matchAll(/<string>([^<]*)<\/string>/g)].map((match) => match[1]),
      EnvironmentVariables: { PATH: scalar('PATH'), PEANUTGALLERY_HOST: scalar('PEANUTGALLERY_HOST') },
      RunAtLoad: scalar('RunAtLoad'),
      KeepAlive: { SuccessfulExit: scalar('SuccessfulExit') },
      ThrottleInterval: scalar('ThrottleInterval'),
      ExitTimeOut: scalar('ExitTimeOut'),
      StartCalendarInterval: value('Minute') ? { Minute: scalar('Minute') } : undefined,
      StandardOutPath: scalar('StandardOutPath'),
    };
  };

  test("the dispatcher's runs run-dispatcher.sh from the code clone at login, restarts only a failed exit, and gives the dispatcher its stop", () => {
    const run = render('studio.peanutgallery.dispatcher.plist');
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.doesNotMatch(run.text, /@[A-Z_]+@/);
    if (spawnSync('sh', ['-c', 'command -v plutil']).status === 0) assert.equal(spawnSync('plutil', ['-lint', '-s', run.out]).status, 0);
    const plist = asJson(run.out, run.text);
    assert.equal(plist.Label, 'studio.peanutgallery.dispatcher');
    assert.deepEqual(plist.ProgramArguments, ['/bin/bash', `${HOST}/code/platform/ops/mac/run-dispatcher.sh`]);
    assert.deepEqual(plist.EnvironmentVariables, { PATH: PATH_VALUE, PEANUTGALLERY_HOST: HOST });
    assert.equal(plist.RunAtLoad, true);
    assert.deepEqual(plist.KeepAlive, { SuccessfulExit: false });
    assert.equal(plist.ThrottleInterval, 30);
    assert.equal(plist.ExitTimeOut, 90, 'longer than the dispatcher waits for running cards');
    assert.equal(plist.StandardOutPath, `${HOST}/logs/launchd-dispatcher.log`);
    assert.match(read('platform/dispatcher/src/main.ts'), /const SHUTDOWN_GRACE_MS = 50_000;/);
  });

  test("each job's wakes run-job.sh every hour at the job's minute and never at load", () => {
    for (const [job, minute] of [
      ['backup', 17],
      ['controller', 7],
      ['quota', 37],
    ]) {
      const run = render('studio.peanutgallery.job.plist', job);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.doesNotMatch(run.text, /@[A-Z_]+@/);
      const plist = asJson(run.out, run.text);
      assert.equal(plist.Label, `studio.peanutgallery.${job}`);
      assert.deepEqual(plist.ProgramArguments, ['/bin/bash', `${HOST}/code/platform/ops/mac/run-job.sh`, job]);
      assert.deepEqual(plist.StartCalendarInterval, { Minute: minute });
      assert.equal(plist.RunAtLoad, false);
    }
    assert.equal(render('studio.peanutgallery.job.plist', 'nightly').status, 1);
  });

  test('refuses a host folder or PATH a plist or sed would need escaped', () => {
    for (const [host, pathValue] of [
      ['/Users/board/My Host', PATH_VALUE],
      ['/Users/board/a&b', PATH_VALUE],
      ['relative/host', PATH_VALUE],
      [HOST, '/usr/bin:/bin|x'],
      [HOST, '/usr/bin:<tag>'],
    ]) {
      const run = render('studio.peanutgallery.dispatcher.plist', '', host, pathValue);
      assert.equal(run.status, 1, `${host} ${pathValue}`);
      assert.match(run.stdout, /cannot carry/);
    }
  });
});

// ---------------------------------------------------------------- backup-mac.sh

describe('backup-mac.sh', () => {
  const DB_URL = 'postgresql://peanutgallery_backup.fixtureref:fixture-password@aws-0-ca-central-1.pooler.supabase.com:5432/postgres';
  const IDENTITY = '{"holds": true, "lines": [{"left": 0, "name": "I1", "drift": 0, "holds": true, "right": 0}]}';
  const setup = ({ env = {}, server = '170006', dumpall = 0, mode = 0o600 } = {}) => {
    const root = fresh('backup-mac');
    const bin = path.join(root, 'bin');
    const pg = path.join(root, 'pg');
    const drive = path.join(root, 'Google Drive', 'peanutgallery-backups');
    mkdirSync(bin);
    mkdirSync(pg);
    mkdirSync(drive, { recursive: true });
    const log = path.join(root, 'calls.log');
    commonFakes(bin, log);
    fake(bin, 'age', `echo "age $1 $2 $3 $4 $5" >> "${log}"; { echo AGE-ENCRYPTED; cat "$5"; } > "$4"`);
    // Each Postgres tool records its arguments and what its service file holds, never the password.
    const record = `echo "$(basename "$0") $*" >> "${log}"; echo "service $PGSERVICE $( [ -f "$PGSERVICEFILE" ] && grep -c '^password=fixture-password$' "$PGSERVICEFILE") $(grep -c '^sslmode=require$' "$PGSERVICEFILE") $(grep '^user=' "$PGSERVICEFILE")" >> "${log}"; [ -z "\${PGPASSWORD:-}" ] || echo "PGPASSWORD set" >> "${log}"`;
    fake(pg, 'psql', `${record}\ncase "$*" in *server_version_num*) echo ${server} ;; *ledger_identity*) echo '${IDENTITY}' ;; esac`);
    fake(
      pg,
      'pg_dump',
      `[ "$1" = --version ] && { echo "pg_dump (PostgreSQL) 18.6"; exit 0; }\n${record}\nout=""; for arg in "$@"; do case "$arg" in --file=*) out=\${arg#--file=} ;; esac; done\nif [ -n "$out" ]; then echo "-- data $*" > "$out"; else printf 'CREATE SCHEMA "public";\\n-- schema %s\\n' "$*"; fi`,
    );
    fake(
      pg,
      'pg_dumpall',
      `${record}\n[ ${dumpall} = 0 ] || { echo "pg_dumpall: error: permission denied" >&2; exit 1; }\nprintf 'CREATE ROLE "anon";\\nALTER ROLE "anon" WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION NOBYPASSRLS;\\nCREATE ROLE "peanutgallery_backup";\\nALTER ROLE "peanutgallery_backup" WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION BYPASSRLS CONNECTION LIMIT 4;\\n'`,
    );
    const values = {
      BACKUP_DB_URL: DB_URL,
      BACKUP_AGE_RECIPIENT: AGE,
      BACKUP_DIR: drive,
      BACKUP_HEALTHCHECK_URL: 'https://hc-ping.com/fixture-backup',
      ...env,
    };
    const envFile = path.join(root, 'backup-mac.env');
    writeFileSync(envFile, `${Object.entries(values).filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
    chmodSync(envFile, mode);
    const state = path.join(root, 'state');
    const run = () => {
      const result = spawnSync(BASH, [path.join(MAC_DIR, 'backup-mac.sh')], {
        env: { PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME, BACKUP_ENV_FILE: envFile, BACKUP_STATE_DIR: state, BACKUP_PG_BIN: pg, TMPDIR: root },
        encoding: 'utf8',
      });
      const calls = lines(log);
      return { ...result, calls, output: `${result.stdout}${result.stderr}`, left: existsSync(state) ? readdirSync(state) : [], stored: readdirSync(drive) };
    };
    return { root, drive, run };
  };
  const pgCalls = (calls) => calls.filter((line) => /^(psql|pg_dump|pg_dumpall) /.test(line));

  test('dumps as the backup login through a service file, encrypts to the board key, writes the folder and pings the check', () => {
    const { drive, run } = setup();
    const result = run();
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(
      pgCalls(result.calls),
      [
        'psql -X -At --no-password -c show server_version_num',
        'pg_dumpall --no-password --roles-only --no-role-passwords --quote-all-identifiers --no-comments',
        'pg_dump --no-password --schema-only --quote-all-identifiers --schema=public --schema=money',
        `pg_dump --no-password --data-only --quote-all-identifiers --schema=public --schema=money --file=${pgCalls(result.calls)[3].split('--file=')[1]}`,
        `pg_dump --no-password --data-only --quote-all-identifiers --schema=auth --file=${pgCalls(result.calls)[4].split('--file=')[1]}`,
        'pg_dump --no-password --schema-only --quote-all-identifiers --schema=supabase_migrations',
        `pg_dump --no-password --data-only --quote-all-identifiers --schema=supabase_migrations --file=${pgCalls(result.calls)[6].split('--file=')[1]}`,
        'psql -X -At --no-password -c select public.ledger_identity()',
      ],
    );
    for (const line of result.calls.filter((call) => call.startsWith('service '))) {
      assert.equal(line, 'service peanutgallery_backup 1 1 user=peanutgallery_backup.fixtureref', 'every Postgres call signs in through the service file as the backup login');
    }
    assert.ok(!result.calls.some((line) => /^(psql|pg_dump|pg_dumpall) /.test(line) && line.includes('fixture-password')), 'the password is on no command line');
    assert.ok(!result.calls.includes('PGPASSWORD set'));
    assert.ok(!result.output.includes('fixture-password'));
    assert.match(result.calls.join('\n'), /^age -r age1q{58} -o \S+\/peanutgallery-\d{8}T\d{6}Z\.tar\.age \S+\/peanutgallery-\d{8}T\d{6}Z\.tar$/m);
    assert.equal(result.stored.length, 1);
    const [stored] = result.stored;
    assert.match(stored, /^peanutgallery-\d{8}T\d{6}Z\.tar\.age$/);
    assert.equal(statSync(path.join(drive, stored)).mode & 0o777, 0o600);
    assert.deepEqual(result.left, [], 'no plaintext and no service file is left in the run folder');
    assert.match(result.calls.join('\n'), /^url = "https:\/\/hc-ping\.com\/fixture-backup"\nrequest = "POST"/m);
    assert.match(result.stdout, /the live ledger identity holds: true/);
    // The archive, with the fake age's marker line taken off: roles.sql keeps the backup login and
    // comments out Supabase's own roles, without the attributes a non-superuser owner may not set.
    const archive = path.join(fresh('archive'), 'backup.tar');
    writeFileSync(archive, readFileSync(path.join(drive, stored)).subarray('AGE-ENCRYPTED\n'.length));
    const roles = spawnSync('tar', ['-xOf', archive, `${stored.replace('.tar.age', '')}/roles.sql`], { encoding: 'utf8' });
    assert.equal(roles.status, 0, roles.stderr);
    assert.match(roles.stdout, /^-- CREATE ROLE "anon";$/m);
    assert.match(roles.stdout, /^-- ALTER ROLE "anon"/m);
    assert.match(roles.stdout, /^CREATE ROLE "peanutgallery_backup";$/m);
    assert.match(roles.stdout, /^ALTER ROLE "peanutgallery_backup" WITH INHERIT NOCREATEROLE NOCREATEDB LOGIN BYPASSRLS CONNECTION LIMIT 4;$/m);
    const listing = spawnSync('tar', ['-tf', archive], { encoding: 'utf8' }).stdout;
    for (const file of ['roles.sql', 'schema.sql', 'data.sql', 'auth.sql', 'history_schema.sql', 'history_data.sql', 'identity.json']) assert.match(listing, new RegExp(`/${file.replace('.', '\\.')}$`, 'm'), file);
    const schema = spawnSync('tar', ['-xOf', archive, `${stored.replace('.tar.age', '')}/schema.sql`], { encoding: 'utf8' }).stdout;
    assert.match(schema, /^CREATE SCHEMA IF NOT EXISTS "public";$/m);
  });

  // pg_dump --schema dumps nothing a named schema depends on. The public views and money functions
  // call the money schema's helpers, so a schema.sql without it fails at its first such view and the
  // documented --single-transaction restore rolls back whole.
  test('schema.sql and data.sql name public and every schema a migration creates', () => {
    const migrations = path.join(REPO_ROOT, 'platform', 'supabase', 'migrations');
    const created = new Set(['public']);
    for (const name of readdirSync(migrations).filter((file) => file.endsWith('.sql'))) {
      for (const match of readFileSync(path.join(migrations, name), 'utf8').matchAll(/^\s*create\s+schema\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gim)) {
        created.add(match[1].toLowerCase());
      }
    }
    assert.ok(created.has('money'), 'the money-logic migration creates the money schema');
    const script = read('platform/ops/mac/backup-mac.sh');
    const schemaLine = /^\s*"\$PG_BIN\/pg_dump" --no-password --schema-only [^\n]*\\\n[^\n]*> "\$dir\/schema\.sql"$/m.exec(script)?.[0];
    const dataLine = /^\s*"\$PG_BIN\/pg_dump" --no-password --data-only [^\n]*--file="\$dir\/data\.sql"$/m.exec(script)?.[0];
    for (const [file, line] of [['schema.sql', schemaLine], ['data.sql', dataLine]]) {
      assert.ok(line, `backup-mac.sh writes ${file} with one pg_dump`);
      const named = [...line.matchAll(/--schema=(\w+)/g)].map((match) => match[1]).sort();
      assert.deepEqual(named, [...created].sort(), `${file} dumps exactly public and the schemas the migrations create`);
    }
  });

  // No dump carries pg_cron's jobs, so the restore runbook schedules each one the migrations schedule.
  test('the restore runbook schedules every pg_cron job a migration schedules, and checks cron.job', () => {
    const migrations = path.join(REPO_ROOT, 'platform', 'supabase', 'migrations');
    const jobs = readdirSync(migrations)
      .filter((file) => file.endsWith('.sql'))
      .flatMap((name) => [...readFileSync(path.join(migrations, name), 'utf8').matchAll(/cron\.schedule\(('[^']+', '[^']+', '[^']+')\)/g)].map((match) => match[1]));
    for (const name of ['credit-held-contributions', 'waterfall-sweep']) assert.ok(jobs.some((job) => job.startsWith(`'${name}'`)), `the migrations schedule ${name}`);
    const readme = read('platform/ops/README.md');
    const macRestore = /^### Restore a Mac backup\n[\s\S]*?(?=^### )/m.exec(readme)?.[0] ?? '';
    for (const job of jobs) assert.ok(macRestore.includes(`--command "select cron.schedule(${job})"`), `Restore a Mac backup schedules ${job}`);
    assert.match(macRestore, /`select jobname, schedule from cron\.job order by jobname` must list every job step 4 scheduled/);
    const serverRestore = /^## Restore the database\n[\s\S]*?(?=^## )/m.exec(readme)?.[0] ?? '';
    assert.match(serverRestore, /The pg_cron jobs are not in the dumps: schedule them as \[Restore a Mac backup\]\(#restore-a-mac-backup\), step 4, does\./);
  });

  test("never holds the owner's login, under any name, and leaves the auth dump out with BACKUP_SKIP_AUTH=1", () => {
    for (const owner of [
      'postgresql://postgres.fixtureref:fixture-owner@aws-0-ca-central-1.pooler.supabase.com:5432/postgres',
      'postgres://postgres:fixture-owner@db.fixtureref.supabase.co:5432/postgres',
    ]) {
      const { run } = setup({ env: { SOME_OWNER_URL: owner } });
      const refused = run();
      assert.equal(refused.status, 1, refused.output);
      assert.ok(refused.stderr.includes("SOME_OWNER_URL signs in as the database owner; no job may hold the owner's password, under any name"), refused.output);
      assert.deepEqual(pgCalls(refused.calls), []);
      assert.ok(!refused.output.includes('fixture-owner'));
    }
    const { run } = setup({ env: { BACKUP_SKIP_AUTH: '1' } });
    const result = run();
    assert.equal(result.status, 0, result.output);
    assert.ok(!pgCalls(result.calls).some((line) => line.includes('--schema=auth')));
    assert.match(result.stdout, /the auth schema is not dumped \(BACKUP_SKIP_AUTH=1\)/);
  });

  test('refuses a Stripe secret key, another login, a missing key or folder, a relative folder and an env file others can read', () => {
    for (const [options, message] of [
      [{ env: { OTHER_KEY: 'sk_live_fixture' } }, 'OTHER_KEY holds a Stripe secret key; no job may hold one, under any name'],
      [{ env: { BACKUP_DB_URL: 'postgresql://postgres.fixtureref:owner@aws-0-ca-central-1.pooler.supabase.com:5432/postgres' } }, 'BACKUP_DB_URL must be the Session pooler (port 5432) as peanutgallery_backup.<project ref>'],
      [{ env: { BACKUP_DB_URL: DB_URL.replace(':5432/', ':6543/') } }, 'BACKUP_DB_URL must be the Session pooler (port 5432)'],
      [{ env: { BACKUP_AGE_RECIPIENT: null } }, 'BACKUP_AGE_RECIPIENT is missing or empty'],
      [{ env: { BACKUP_DIR: null } }, 'BACKUP_DIR is missing or empty'],
      [{ env: { BACKUP_DIR: 'Google Drive/backups' } }, 'BACKUP_DIR must be an absolute path to a folder'],
      [{ env: { BACKUP_DIR: '/nonexistent/peanutgallery-backups' } }, 'BACKUP_DIR is not a folder this user can write to'],
      [{ env: { BACKUP_KEEP_DAYS: 'forever' } }, 'BACKUP_KEEP_DAYS must be a whole number above zero'],
      [{ mode: 0o644 }, 'must be yours with mode 0600'],
    ]) {
      const { run } = setup(options);
      const result = run();
      assert.equal(result.status, 1, message);
      assert.ok(result.stderr.includes(message), `${message}\n${result.output}`);
      assert.deepEqual(pgCalls(result.calls), []);
      assert.ok(!result.output.includes('sk_live_fixture') && !result.output.includes('fixture-password'));
    }
  });

  test('stops on a pg_dump older than the server and on a refused role dump, pings /fail, and leaves nothing behind', () => {
    const old = setup({ server: '190002' });
    const tooOld = old.run();
    assert.equal(tooOld.status, 1);
    assert.match(tooOld.stderr, /pg_dump 18 is older than the server's Postgres 19/);
    assert.match(tooOld.calls.join('\n'), /^url = "https:\/\/hc-ping\.com\/fixture-backup\/fail"/m);
    assert.deepEqual(tooOld.stored, []);
    const refused = setup({ dumpall: 1 }).run();
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /pg_dumpall --roles-only was refused to the backup login/);
    assert.deepEqual(refused.stored, []);
    assert.deepEqual(refused.left, []);
  });

  test('deletes backups older than BACKUP_KEEP_DAYS, always keeping the newest 7, and nothing it did not write', () => {
    const { drive, run } = setup({ env: { BACKUP_KEEP_DAYS: '30' } });
    const stamp = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const old = Array.from({ length: 10 }, (_, index) => `peanutgallery-${stamp(40 + index)}.tar.age`);
    for (const name of old) writeFileSync(path.join(drive, name), 'old');
    writeFileSync(path.join(drive, 'notes.txt'), 'the board keeps this');
    const result = run();
    assert.equal(result.status, 0, result.output);
    const kept = result.stored.filter((name) => name.endsWith('.tar.age'));
    assert.equal(kept.length, 7, kept.join('\n'));
    assert.ok(result.stored.includes('notes.txt'));
    const sortedOld = [...old].sort();
    for (const name of sortedOld.slice(0, 4)) assert.ok(!kept.includes(name), `${name} is deleted`);
    for (const name of sortedOld.slice(4)) assert.ok(kept.includes(name), `${name} is kept as one of the newest 7`);
  });
});

// ---------------------------------------------------------------- install.sh's checks

describe('install.sh and deploy.sh on the Mac', () => {
  test("check_readonly passes a clone with its write bits removed and names a folder that is still writable, as the dispatcher's startup check would", { skip: IS_ROOT ? 'root can write anywhere' : false }, () => {
    const host = path.join(fresh('readonly'), 'host');
    const code = path.join(host, 'code');
    const startup = read('platform/dispatcher/src/startup.ts');
    const paths = JSON.parse(`[${/export const CODE_PATHS: readonly string\[\] = \[([^\]]+)\];/.exec(startup)[1].replace(/'/g, '"')}]`);
    const listed = /^CODE_PATHS="([^"]+)"$/m.exec(read('platform/ops/mac/lib.sh'))[1].split(' ');
    assert.deepEqual(listed, paths, 'lib.sh checks the folders the dispatcher checks');
    for (const relative of paths) mkdirSync(path.join(code, relative), { recursive: true });
    const check = () =>
      spawnSync(BASH, ['-c', '. "$1"; check_readonly', 'x', path.join(MAC_DIR, 'lib.sh')], { env: { PATH: process.env.PATH, HOME: process.env.HOME, PEANUTGALLERY_HOST: host }, encoding: 'utf8' });
    const writable = check();
    assert.equal(writable.status, 1);
    assert.match(writable.stdout, /^\. is writable$/m);
    spawnSync('chmod', ['-R', 'a-w', code]);
    const locked = check();
    assert.equal(locked.status, 0, locked.stdout);
    chmodSync(path.join(code, 'platform', 'dispatcher', 'src'), 0o755);
    const one = check();
    assert.equal(one.status, 1);
    assert.equal(one.stdout.trim(), 'platform/dispatcher/src is writable');
  });

  test('lines_since_start and wait_for_start count only this start, and stop at once when the wrapper stopped for good', () => {
    const root = fresh('probe');
    const host = path.join(root, 'host');
    mkdirSync(path.join(host, 'logs'), { recursive: true });
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    commonFakes(bin, path.join(root, 'calls.log'));
    const logFile = path.join(host, 'logs', 'dispatcher.log');
    const readonlyLine = '{"ts":"t","level":"info","scope":"startup","msg":"code root is read-only"}';
    const probeLine = '{"ts":"t","level":"info","scope":"probe","msg":"startup probe passed"}';
    const wait = (since) =>
      spawnSync(BASH, ['-c', '. "$1"; PROBE_WAIT_SECONDS=1; wait_for_start "$2"', 'x', path.join(MAC_DIR, 'lib.sh'), String(since)], {
        env: { PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME, PEANUTGALLERY_HOST: host },
        encoding: 'utf8',
      });
    writeFileSync(logFile, ['run-dispatcher: start 100', readonlyLine, probeLine, 'run-dispatcher: stopped by launchd; the dispatcher exited 0', 'run-dispatcher: start 200', readonlyLine].join('\n'));
    assert.equal(wait(150).status, 1, 'the old start passed, this one has not');
    writeFileSync(logFile, ['run-dispatcher: start 100', readonlyLine, probeLine, 'run-dispatcher: start 200', readonlyLine, probeLine].join('\n'));
    const passed = wait(150);
    assert.equal(passed.status, 0, passed.stdout);
    assert.equal(passed.stdout.trim().split('\n').length, 2);
    writeFileSync(logFile, ['run-dispatcher: start 200', probeLine, readonlyLine].join('\n'));
    assert.equal(wait(150).status, 1, 'the read-only line must come first');
    writeFileSync(logFile, ['run-dispatcher: start 200', 'run-dispatcher: stopped: fatal startup error: the dispatcher exited 78'].join('\n'));
    const stopped = wait(150);
    assert.equal(stopped.status, 1);
    assert.match(stopped.stdout, /will not restart/);
  });

  test("check_dotenv reads the env file make-dispatcher-env.sh writes with the dispatcher's own dotenv, PRICE_TABLE_JSON included", () => {
    const dispatcherDotenv = createRequire(path.join(REPO_ROOT, 'platform', 'dispatcher', 'package.json'))('dotenv');
    const root = fresh('dotenv');
    const host = path.join(root, 'host');
    const code = path.join(host, 'code');
    mkdirSync(path.join(code, 'platform'), { recursive: true });
    symlinkSync(path.join(REPO_ROOT, 'platform', 'dispatcher'), path.join(code, 'platform', 'dispatcher'));
    const table = { 'claude-opus-5-5': { input: 4, output: 20, cache_read: 0.2, cache_write_5m: 5, cache_write_1h: 8 } };
    const dotenvFile = path.join(root, 'source.env');
    writeFileSync(
      dotenvFile,
      [
        'STUDIO_ANTHROPIC_API_KEY=fixture-studio-key',
        'GITHUB_TOKEN=fixture-mac-token',
        'GITHUB_REPO=AlreadyKyle/peanutgallery',
        'NETLIFY_AUTH_TOKEN=fixture-netlify',
        'NETLIFY_SITE_ID_SEED=fixture-seed',
        'NETLIFY_SITE_ID_PLATFORM=fixture-platform',
        'SUPABASE_URL=https://fixture.supabase.local',
        'SUPABASE_SECRET_KEY=sb_secret_fixture',
        'MODEL_BUILDER=claude-opus-5-5',
        'MANAGED_AGENT_ID=agent_fixture',
        'MANAGED_AGENT_VERSION=3',
        'MANAGED_ENVIRONMENT_ID=env_fixture',
        `PRICE_TABLE_JSON='${JSON.stringify(table, null, 2)}'`,
      ].join('\n'),
    );
    const out = path.join(code, '.env');
    const made = spawnSync('bash', [path.join(OPS_DIR, 'make-dispatcher-env.sh'), out], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DOTENV: dotenvFile,
        VPS_GITHUB_TOKEN: 'github_pat_-fixture-host',
        GITHUB_READ_TOKEN: 'github_pat_-fixture-read',
        HEALTHCHECK_URL: 'https://hc-ping.com/fixture-check',
        NTFY_TOPIC_URL: 'https://ntfy.sh/fixture-topic',
      },
      encoding: 'utf8',
    });
    assert.equal(made.status, 0, made.stderr);
    const written = readFileSync(out, 'utf8');
    const parsed = dispatcherDotenv.parse(written);
    assert.deepEqual(parsed, { ...parseEnvFile(written) }, 'dotenv reads every line as written');
    assert.deepEqual(JSON.parse(parsed.PRICE_TABLE_JSON), table);
    const check = () => spawnSync(BASH, ['-c', '. "$1"; check_dotenv', 'x', path.join(MAC_DIR, 'lib.sh')], { env: { PATH: process.env.PATH, HOME: process.env.HOME, PEANUTGALLERY_HOST: host }, encoding: 'utf8' });
    const ok = check();
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /^the dispatcher reads all \d+ keys of \.env as written$/m);
    writeFileSync(out, `${written}NETLIFY_SITE_ID_SEED=fixture #cut\n`);
    const cut = check();
    assert.equal(cut.status, 1);
    assert.match(cut.stdout, /NETLIFY_SITE_ID_SEED does not read back as written/);
    assert.ok(!cut.stdout.includes('fixture'), 'key names only');
  });

  test('deploy.sh rolls back only to a commit on origin/main that has the Mac host files', () => {
    const gitEnv = { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=Ops test', '-c', 'user.email=ops@test.local', ...args], { cwd, env: gitEnv, encoding: 'utf8' });
    const host = path.join(fresh('rollback'), 'host');
    const repo = path.join(host, 'code');
    mkdirSync(path.join(repo, 'platform', 'ops', 'mac'), { recursive: true });
    git(repo, 'init', '-q', '--initial-branch=main');
    writeFileSync(path.join(repo, 'README.md'), 'before\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'before the Mac host');
    const before = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    for (const file of ['run-dispatcher.sh', 'run-job.sh', 'backup-mac.sh', 'studio.peanutgallery.dispatcher.plist', 'studio.peanutgallery.job.plist']) writeFileSync(path.join(repo, 'platform', 'ops', 'mac', file), '');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'the Mac host');
    const withMac = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    git(repo, 'update-ref', 'refs/remotes/origin/main', withMac);
    git(repo, 'checkout', '-q', '-b', 'side');
    writeFileSync(path.join(repo, 'side.txt'), 'side\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'not on main');
    const side = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    const check = (sha) => sourced('deploy.sh', 'MAC_DEPLOY_SOURCE_ONLY', `check_ref_mac ${sha}`, { ...gitEnv, PEANUTGALLERY_HOST: host });
    assert.equal(check(withMac).status, 0, check(withMac).stdout + check(withMac).stderr);
    assert.match(check(before).stdout, /older than the Mac host/);
    assert.match(check(side).stdout, /is not a commit on origin\/main/);
  });

  test('deploy.sh checks, confirms, unlocks, moves, installs and locks the code clone in that order, and never leaves it writable', () => {
    const script = read('platform/ops/mac/deploy.sh');
    const order = [
      'agent_loaded "$DISPATCHER_LABEL" || die',
      'check_quiet "$studio" "$cards"',
      'reason=$(check_clean)',
      'reason=$(check_code_clone)',
      'unlock_code',
      'fetch_main "$ENV_FILE"',
      'reason=$(check_gate "$target")',
      'review_target "$old" "$target"',
      'reason=$(confirm_target "$target" "$confirm")',
      'code_git merge --ff-only --quiet "$target"',
      'run_pnpm_install',
      'lock_code\n',
      'reason=$(check_readonly)',
      'check_dotenv ||',
      'launchctl kickstart -k',
      'wait_for_start "$since"',
    ];
    let at = -1;
    for (const step of order) {
      const next = script.indexOf(step, at + 1);
      assert.ok(next > at, `${step} comes after the step before it`);
      at = next;
    }
    assert.match(script, /trap 'rm -rf "\$WORK"; if code_writable; then lock_code; fi' EXIT/);
    const install = read('platform/ops/mac/install.sh');
    assert.match(install, /trap 'rm -rf "\$WORK"; if \[ -d "\$CODE_DIR" \] && code_writable; then lock_code; fi' EXIT/);
    assert.match(install, /launchctl disable "\$\(gui_target\)\/\$label"/, 'the dispatcher is installed disabled until the cutover');
    assert.match(install, /"unattended "\*\) ;;/, 'install.sh --start waits for /board to show unattended');
  });

  test('every git call in the Mac scripts turns fsmonitor and hooks off', () => {
    for (const script of readdirSync(MAC_DIR).filter((name) => name.endsWith('.sh'))) {
      const text = read(`platform/ops/mac/${script}`)
        .split('\n')
        .filter((line) => !/^\s*#/.test(line));
      for (const line of text) {
        if (!/(^|[\s;(|&!])git\s+(-C|-c|clone|fetch|status|remote)/.test(line)) continue;
        assert.match(line, /core\.hooksPath=\/dev\/null/, `${script}: ${line.trim()}`);
        assert.match(line, /core\.fsmonitor=false/, `${script}: ${line.trim()}`);
      }
    }
  });
});

// ---------------------------------------------------------------- the Mac's env files

describe("make-jobs-env.sh for the Mac host", () => {
  const DOTENV = {
    GITHUB_REPO: 'AlreadyKyle/peanutgallery',
    SUPABASE_URL: 'https://fixture.supabase.local',
    SUPABASE_SECRET_KEY: 'sb_secret_fixture',
    STRIPE_READ_KEY: 'rk_live_fixture',
    BACKUP_DB_URL: 'postgresql://peanutgallery_backup.fixtureref:fixture-password@aws-0-ca-central-1.pooler.supabase.com:5432/postgres',
    BACKUP_AGE_RECIPIENT: AGE,
    BACKUP_DIR: '/Users/board/Library/CloudStorage/GoogleDrive-board/My Drive/peanutgallery-backups',
    BACKUP_KEEP_DAYS: '45',
  };
  const OPERATOR = { NTFY_TOPIC_URL: 'https://ntfy.sh/fixture-topic', BACKUP_HEALTHCHECK_URL: 'https://hc-ping.com/fixture-backup', VPS_GITHUB_TOKEN: 'github_pat_-fixture-host' };
  const make = (dir, args, dotenv = DOTENV) => {
    const dotenvFile = path.join(fresh('jobs-dotenv'), '.env');
    writeFileSync(dotenvFile, Object.entries(dotenv).map(([key, value]) => `${key}=${value}`).join('\n'));
    return spawnSync('bash', [path.join(OPS_DIR, 'make-jobs-env.sh'), ...args], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: fresh('jobs-tmp'), DOTENV: dotenvFile, JOBS_ENV_DIR: dir, ...OPERATOR },
      encoding: 'utf8',
    });
  };

  test('writes backup-mac.env, controller.env and quota.env into JOBS_ENV_DIR, each passing check-env.mjs and read by node --env-file as written', () => {
    const dir = fresh('env');
    chmodSync(dir, 0o700);
    const run = make(dir, ['backup-mac', 'controller', 'quota']);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.deepEqual(readdirSync(dir).sort(), ['backup-mac.env', 'controller.env', 'quota.env']);
    const backup = parseEnvFile(readFileSync(path.join(dir, 'backup-mac.env'), 'utf8'));
    assert.deepEqual(Object.keys(backup), ['BACKUP_DB_URL', 'BACKUP_AGE_RECIPIENT', 'BACKUP_DIR', 'BACKUP_HEALTHCHECK_URL', 'BACKUP_KEEP_DAYS']);
    assert.ok(!`${run.stdout}${run.stderr}`.includes('fixture-password'));
    for (const job of ['backup-mac', 'controller', 'quota']) {
      const file = path.join(dir, `${job}.env`);
      assert.equal(statSync(file).mode & 0o777, 0o600, job);
      const check = spawnSync(process.execPath, [path.join(OPS_DIR, 'jobs', 'check-env.mjs'), job, file], { encoding: 'utf8' });
      assert.equal(check.stdout, 'valid\n', `${job}: ${check.stdout}`);
      // run-job.sh hands the file to node --env-file; each value must arrive exactly as written.
      const loaded = spawnSync(process.execPath, [`--env-file=${file}`, '-e', 'process.stdout.write(JSON.stringify(process.env))'], { env: {}, encoding: 'utf8' });
      assert.equal(loaded.status, 0, loaded.stderr);
      const environment = JSON.parse(loaded.stdout);
      for (const [key, value] of Object.entries(parseEnvFile(readFileSync(file, 'utf8')))) assert.equal(environment[key], value, `${job}: ${key}`);
    }
  });

  test('refuses a JOBS_ENV_DIR others can open, and a relative BACKUP_DIR', () => {
    const open = fresh('env-open');
    chmodSync(open, 0o755);
    const refused = make(open, ['controller']);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /JOBS_ENV_DIR must be open to its owner only/);
    assert.deepEqual(readdirSync(open), []);
    const dir = fresh('env-relative');
    chmodSync(dir, 0o700);
    const relative = make(dir, ['backup-mac'], { ...DOTENV, BACKUP_DIR: 'My Drive/backups' });
    assert.equal(relative.status, 1);
    assert.match(relative.stderr, /BACKUP_DIR must be an absolute path to a folder/);
  });
});
