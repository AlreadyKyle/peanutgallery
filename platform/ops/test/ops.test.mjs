// Tests for the VPS ops files (docs/specs/vps.md): the env file transform end to end through
// make-dispatcher-env.sh, provision.sh's env file checks against its output, deploy.sh's refusal
// rule, bash -n and shellcheck on every script, and the values that must agree across files.
// Run from the repository root: node --test platform/ops/test/ops.test.mjs
// Every value in the fixtures is made up; none has the shape of a real credential.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_KEYS, NOT_COPIED, OPERATOR_KEYS, OPTIONAL_KEYS } from '../dispatcher-env.mjs';

const OPS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(OPS_DIR, '..', '..');
const read = (relative) => readFileSync(path.join(REPO_ROOT, relative), 'utf8');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'peanutgallery-ops-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const PRICE_TABLE = { 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } };

// The Mac's .env as the fixture has it: attended, with secrets the VPS must never receive and Mac
// paths it must not copy. PRICE_TABLE_JSON spans lines in single quotes, as dotenv allows.
const MAC_DOTENV = {
  ANTHROPIC_API_KEY: 'fixture-founder-key',
  AGENT_MODE: 'attended',
  STUDIO_ANTHROPIC_API_KEY: 'fixture-studio-key',
  SUPABASE_URL: 'https://fixture.supabase.local',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role-key',
  SUPABASE_SECRET_KEY: 'fixture-supabase-secret-key',
  SUPABASE_ACCESS_TOKEN: 'fixture-management-token',
  GITHUB_TOKEN: 'fixture-mac-github-token',
  GITHUB_REPO: 'AlreadyKyle/peanutgallery',
  NETLIFY_AUTH_TOKEN: 'fixture-netlify-token',
  NETLIFY_SITE_ID_SEED: 'fixture-site-seed',
  NETLIFY_SITE_ID_PLATFORM: 'fixture-site-platform',
  STRIPE_SECRET_KEY: 'fixture-stripe-key',
  STRIPE_WEBHOOK_SECRET: 'fixture-webhook-secret',
  BOARD_EMAILS: 'board@peanutgallery.games',
  POOL_DAILY_CAP_USD: '100',
  CARD_MAX_USD: '25',
  SESSION_MAX_TURNS: '60',
  AGENT_HOURLY_RATE_USD: '5',
  MODEL_BUILDER: 'builder-class',
  DISPATCHER_TICK_MS: '60000',
  DISPATCHER_WORKTREE_ROOT: '/Users/board/peanutgallery/.worktrees',
  DISPATCHER_MAX_CONCURRENCY: '1',
  DISPATCHER_SCHEDULER: 'on',
  CLAUDE_BIN: '/Users/board/.local/bin/claude',
  BOARD_SESSION_TTL_MIN: '',
};
const OPERATOR = {
  VPS_GITHUB_TOKEN: 'fixture-vps-github-token',
  HEALTHCHECK_URL: 'https://hc-ping.com/fixture-check',
  NTFY_TOPIC_URL: 'https://ntfy.sh/fixture-topic',
};

function dotenvText(values, priceTable = `'${JSON.stringify(PRICE_TABLE, null, 2)}'`) {
  const lines = ['# fixture .env'];
  for (const [key, value] of Object.entries(values)) lines.push(`${key}=${value}`);
  if (priceTable !== null) lines.push(`PRICE_TABLE_JSON=${priceTable}`);
  return `${lines.join('\n')}\n`;
}

let runs = 0;
// Runs make-dispatcher-env.sh with only PATH, HOME and the given operator values in its environment.
function makeEnv({ dotenv = dotenvText(MAC_DOTENV), operator = OPERATOR, args } = {}) {
  runs += 1;
  const dir = path.join(scratch, `run-${runs}`);
  const dotenvFile = path.join(scratch, `run-${runs}.env`);
  writeFileSync(dotenvFile, dotenv);
  const out = path.join(dir, 'dispatcher.env');
  mkdirSync(dir, { recursive: true });
  const result = spawnSync('bash', [path.join(OPS_DIR, 'make-dispatcher-env.sh'), ...(args ?? [out])], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch, DOTENV: dotenvFile, ...operator },
    encoding: 'utf8',
  });
  return { ...result, out, output: `${result.stdout}${result.stderr}` };
}

function parseEnvFile(text) {
  return text
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]);
}

const SECRET_VALUES = [
  ...Object.entries(MAC_DOTENV)
    .filter(([key]) => /KEY|TOKEN|SECRET/.test(key))
    .map(([, value]) => value),
  OPERATOR.VPS_GITHUB_TOKEN,
];

describe('make-dispatcher-env.sh', () => {
  test('writes exactly the dispatcher keys, unattended, at mode 0600, and prints no value', () => {
    const run = makeEnv();
    assert.equal(run.status, 0, run.output);
    assert.equal(statSync(run.out).mode & 0o777, 0o600);
    const entries = parseEnvFile(readFileSync(run.out, 'utf8'));
    assert.deepEqual(entries, [
      ['AGENT_MODE', 'unattended'],
      ['STUDIO_ANTHROPIC_API_KEY', 'fixture-studio-key'],
      ['GITHUB_REPO', 'AlreadyKyle/peanutgallery'],
      ['GITHUB_TOKEN', 'fixture-vps-github-token'],
      ['NETLIFY_AUTH_TOKEN', 'fixture-netlify-token'],
      ['NETLIFY_SITE_ID_SEED', 'fixture-site-seed'],
      ['NETLIFY_SITE_ID_PLATFORM', 'fixture-site-platform'],
      ['SUPABASE_URL', 'https://fixture.supabase.local'],
      ['SUPABASE_SERVICE_ROLE_KEY', 'fixture-supabase-secret-key'],
      ['PRICE_TABLE_JSON', JSON.stringify(PRICE_TABLE)],
      ['MODEL_BUILDER', 'builder-class'],
      ['HEALTHCHECK_URL', 'https://hc-ping.com/fixture-check'],
      ['NTFY_TOPIC_URL', 'https://ntfy.sh/fixture-topic'],
      ['POOL_DAILY_CAP_USD', '100'],
      ['CARD_MAX_USD', '25'],
      ['SESSION_MAX_TURNS', '60'],
      ['AGENT_HOURLY_RATE_USD', '5'],
      ['DISPATCHER_TICK_MS', '60000'],
      ['DISPATCHER_MAX_CONCURRENCY', '1'],
      ['DISPATCHER_SCHEDULER', 'on'],
    ]);
    for (const value of SECRET_VALUES) assert.ok(!run.output.includes(value), 'the output names keys only');
    assert.match(run.stdout, /with 20 keys: AGENT_MODE, STUDIO_ANTHROPIC_API_KEY/);
  });

  test('copies the director and host models and the session wall clock when .env sets them', () => {
    const run = makeEnv({ dotenv: dotenvText({ ...MAC_DOTENV, MODEL_DIRECTOR: 'builder-class', MODEL_HOST: 'builder-class', SESSION_MAX_MINUTES: '45' }) });
    assert.equal(run.status, 0, run.output);
    const written = new Map(parseEnvFile(readFileSync(run.out, 'utf8')));
    assert.equal(written.get('MODEL_DIRECTOR'), 'builder-class');
    assert.equal(written.get('MODEL_HOST'), 'builder-class');
    assert.equal(written.get('SESSION_MAX_MINUTES'), '45');
  });

  test('uses the service role key when .env has no secret key', () => {
    const { SUPABASE_SECRET_KEY: _unused, ...withoutSecretKey } = MAC_DOTENV;
    const run = makeEnv({ dotenv: dotenvText(withoutSecretKey) });
    assert.equal(run.status, 0, run.output);
    assert.equal(new Map(parseEnvFile(readFileSync(run.out, 'utf8'))).get('SUPABASE_SERVICE_ROLE_KEY'), 'fixture-service-role-key');
  });

  test('writes to a new temporary folder when no output file is named', () => {
    const run = makeEnv({ args: [] });
    assert.equal(run.status, 0, run.output);
    const written = /^wrote (\S+) \(mode 0600\)/m.exec(run.stdout)?.[1];
    assert.ok(written && written.startsWith(scratch) && existsSync(written), run.stdout);
    assert.equal(statSync(written).mode & 0o777, 0o600);
  });

  test('refuses, writing nothing, when an operator value is missing, the token is reused or a URL is not https', () => {
    const cases = [
      [{ ...OPERATOR, VPS_GITHUB_TOKEN: '' }, 'VPS_GITHUB_TOKEN is not set in the operator environment'],
      [{ ...OPERATOR, HEALTHCHECK_URL: '' }, 'HEALTHCHECK_URL is not set in the operator environment'],
      [{ ...OPERATOR, NTFY_TOPIC_URL: '' }, 'NTFY_TOPIC_URL is not set in the operator environment'],
      [{ ...OPERATOR, VPS_GITHUB_TOKEN: MAC_DOTENV.GITHUB_TOKEN }, "VPS_GITHUB_TOKEN equals .env's GITHUB_TOKEN"],
      [{ ...OPERATOR, NTFY_TOPIC_URL: 'http://ntfy.sh/fixture-topic' }, 'NTFY_TOPIC_URL must be an https URL'],
    ];
    for (const [operator, message] of cases) {
      const run = makeEnv({ operator });
      assert.equal(run.status, 1, message);
      assert.ok(run.stderr.includes(message), `${message}\n${run.output}`);
      assert.ok(!existsSync(run.out), 'nothing is written');
      for (const value of SECRET_VALUES) assert.ok(!run.output.includes(value), 'the refusal names keys only');
    }
  });

  test('refuses a .env the dispatcher could not run on', () => {
    const cases = [
      [dotenvText({ ...MAC_DOTENV, STUDIO_ANTHROPIC_API_KEY: '' }), 'STUDIO_ANTHROPIC_API_KEY is not set in .env'],
      [dotenvText({ ...MAC_DOTENV, STUDIO_ANTHROPIC_API_KEY: MAC_DOTENV.ANTHROPIC_API_KEY }), 'STUDIO_ANTHROPIC_API_KEY must differ from ANTHROPIC_API_KEY'],
      [dotenvText({ ...MAC_DOTENV, MODEL_BUILDER: 'unpriced-model' }), 'MODEL_BUILDER has no row in PRICE_TABLE_JSON'],
      [dotenvText({ ...MAC_DOTENV, MODEL_DIRECTOR: 'unpriced-model' }), 'MODEL_DIRECTOR has no row in PRICE_TABLE_JSON'],
      [dotenvText({ ...MAC_DOTENV, MODEL_HOST: 'unpriced-model' }), 'MODEL_HOST has no row in PRICE_TABLE_JSON'],
      [dotenvText(MAC_DOTENV, '{"builder-class":'), 'PRICE_TABLE_JSON in .env is not valid JSON'],
      [dotenvText(MAC_DOTENV, null), 'PRICE_TABLE_JSON is not set in .env'],
      [dotenvText({ ...MAC_DOTENV, NETLIFY_AUTH_TOKEN: "\"'quoted'\"" }), 'NETLIFY_AUTH_TOKEN starts with a quote'],
    ];
    for (const [dotenv, message] of cases) {
      const run = makeEnv({ dotenv });
      assert.equal(run.status, 1, message);
      assert.ok(run.stderr.includes(message), `${message}\n${run.output}`);
      assert.ok(!existsSync(run.out), 'nothing is written');
    }
  });
});

// Sources a script's functions without running it and calls one; returns the spawn result.
function callFunction(script, guard, body, env = {}) {
  return spawnSync('bash', ['-c', `set -euo pipefail; ${guard}=1 . "$1"; ${body}`, 'ops-test', path.join(OPS_DIR, script)], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    encoding: 'utf8',
  });
}

describe('provision.sh env file checks', () => {
  test('accept the file make-dispatcher-env.sh writes', () => {
    const made = makeEnv();
    assert.equal(made.status, 0, made.output);
    const check = callFunction('provision.sh', 'PROVISION_SOURCE_ONLY', 'check_env_lines "$ENV_TO_CHECK"', { ENV_TO_CHECK: made.out });
    assert.equal(check.status, 0, `${check.stdout}${check.stderr}`);
    assert.equal(check.stdout, '');
  });

  test('refuse quotes, export, duplicates, the wrong mode, missing keys, forbidden keys and another repository', () => {
    const made = makeEnv();
    const good = readFileSync(made.out, 'utf8');
    const variants = [
      [good.replace('NETLIFY_SITE_ID_SEED=fixture-site-seed', 'NETLIFY_SITE_ID_SEED="fixture-site-seed"'), 'NETLIFY_SITE_ID_SEED starts with a quote'],
      [good.replace('MODEL_BUILDER=', 'export MODEL_BUILDER='), 'is not KEY=value'],
      [`${good}CARD_MAX_USD=30\n`, 'CARD_MAX_USD is set more than once'],
      [good.replace('AGENT_MODE=unattended', 'AGENT_MODE=attended'), 'AGENT_MODE must be unattended'],
      [good.replace(/^NTFY_TOPIC_URL=.*\n/m, ''), 'NTFY_TOPIC_URL is missing or empty'],
      [`${good}ANTHROPIC_API_KEY=fixture-founder-key\n`, "ANTHROPIC_API_KEY must not be in the dispatcher's env file"],
      [`${good}STRIPE_SECRET_KEY=fixture-stripe-key\n`, "STRIPE_SECRET_KEY must not be in the dispatcher's env file"],
      [good.replace('GITHUB_REPO=AlreadyKyle/peanutgallery', 'GITHUB_REPO=someone/else'), 'GITHUB_REPO is not AlreadyKyle/peanutgallery'],
      [good.replace('HEALTHCHECK_URL=https://', 'HEALTHCHECK_URL=http://'), 'HEALTHCHECK_URL must be an https URL'],
      [good.replace('GITHUB_REPO=', 'GITHUB_REPO=AlreadyKyle/peanutgallery\r\nX='), 'carriage return'],
      [`${good}DISPATCHER_REPO_ROOT=/srv/elsewhere\n`, 'DISPATCHER_REPO_ROOT is set by dispatcher.service'],
      [`${good}DISPATCHER_CODE_READONLY=off\n`, 'DISPATCHER_CODE_READONLY is set by dispatcher.service'],
    ];
    for (const [text, message] of variants) {
      const file = path.join(scratch, `variant-${runs++}.env`);
      writeFileSync(file, text);
      const check = callFunction('provision.sh', 'PROVISION_SOURCE_ONLY', 'check_env_lines "$ENV_TO_CHECK"', { ENV_TO_CHECK: file });
      assert.equal(check.status, 1, message);
      assert.ok(check.stdout.includes(message), `${message}\n${check.stdout}${check.stderr}`);
      assert.ok(!check.stdout.includes('fixture-'), 'the checks name keys only');
    }
  });

  // The docker step runs this script on the VPS; here it runs on the local node with the same env.
  test('refuse a model with no row in PRICE_TABLE_JSON the way the dispatcher does', () => {
    const script = /docker run --rm --network none --env-file "\$ENV_FILE" "\$NODE_IMAGE" node -e '([^']+)'/.exec(read('platform/ops/provision.sh'))?.[1];
    assert.ok(script, 'the price table check is in provision.sh');
    const made = makeEnv({ dotenv: dotenvText({ ...MAC_DOTENV, MODEL_DIRECTOR: 'builder-class' }) });
    assert.equal(made.status, 0, made.output);
    const env = Object.fromEntries(parseEnvFile(readFileSync(made.out, 'utf8')));
    const check = (overrides) => spawnSync(process.execPath, ['-e', script], { env: { PATH: process.env.PATH, ...env, ...overrides }, encoding: 'utf8' });
    assert.equal(check({}).status, 0, check({}).stderr);
    for (const name of ['MODEL_BUILDER', 'MODEL_DIRECTOR', 'MODEL_HOST']) {
      const refused = check({ [name]: 'unpriced-model' });
      assert.equal(refused.status, 1, name);
      assert.equal(refused.stderr.trim(), `${name} has no row in PRICE_TABLE_JSON`);
    }
  });

  test('require the keys config.ts requires, plus the studio key and both alert URLs', () => {
    const config = read('platform/dispatcher/src/config.ts');
    const required = [...config.matchAll(/requireEnv\(env, '([A-Z_]+)'\)/g)].map((match) => match[1]);
    const studioKey = /const STUDIO_KEY = '([A-Z_]+)'/.exec(config)?.[1];
    const listed = /^REQUIRED_KEYS="([^"]+)"$/m.exec(read('platform/ops/provision.sh'))?.[1].split(' ');
    assert.ok(required.length >= 9 && studioKey === 'STUDIO_ANTHROPIC_API_KEY');
    assert.deepEqual([...listed].sort(), [...required, studioKey, 'HEALTHCHECK_URL', 'NTFY_TOPIC_URL'].sort());
    const forbidden = /^FORBIDDEN_KEYS="([^"]+)"$/m.exec(read('platform/ops/provision.sh'))?.[1].split(' ');
    assert.deepEqual(forbidden, FORBIDDEN_KEYS);
  });
});

describe('dispatcher-env.mjs key lists', () => {
  test('account for every variable config.ts reads', () => {
    const config = read('platform/dispatcher/src/config.ts');
    const read_ = new Set([
      ...[...config.matchAll(/(?:requireEnv|optionalEnv|numberEnv|positiveIntegerEnv|optionalHttpsUrlEnv)\(env, '([A-Z_]+)'/g)].map((match) => match[1]),
      ...[...config.matchAll(/const (?:STUDIO|FOUNDER)_KEY = '([A-Z_]+)'/g)].map((match) => match[1]),
    ]);
    const made = makeEnv();
    const written = new Set(parseEnvFile(readFileSync(made.out, 'utf8')).map(([key]) => key));
    const accounted = new Set([...written, ...OPTIONAL_KEYS, ...Object.keys(NOT_COPIED)]);
    for (const name of read_) assert.ok(accounted.has(name), `${name} is read by config.ts but neither written nor listed in NOT_COPIED`);
    for (const name of FORBIDDEN_KEYS) assert.ok(!written.has(name), `${name} is never written`);
    assert.deepEqual(OPERATOR_KEYS, ['VPS_GITHUB_TOKEN', 'HEALTHCHECK_URL', 'NTFY_TOPIC_URL']);
  });
});

describe('deploy.sh check_quiet', () => {
  const quiet = (studio, cards) => callFunction('deploy.sh', 'DEPLOY_SOURCE_ONLY', 'check_quiet "$STUDIO" "$CARDS"', { STUDIO: studio, CARDS: cards });

  test('passes only when the studio is paused and no card is building or gated', () => {
    const pass = quiet('[{"paused":true}]', '[]');
    assert.equal(pass.status, 0, `${pass.stdout}${pass.stderr}`);
    const cases = [
      ['[{"paused":false}]', '[]', 'the studio is not paused; pause from /board first'],
      ['[]', '[]', 'could not read studio_state.paused'],
      ['{"message":"JWT expired"}', '[]', 'could not read studio_state.paused'],
      ['not json', '[]', 'could not read studio_state.paused'],
      ['[{"paused":true}]', '[{"id":"card-1","stage":"building"},{"id":"card-2","stage":"gated"}]', 'cards are still building or gated: card-1 (building), card-2 (gated); wait for them to finish'],
      ['[{"paused":true}]', '{"message":"permission denied"}', 'could not read the building and gated cards'],
    ];
    for (const [studio, cards, message] of cases) {
      const run = quiet(studio, cards);
      assert.equal(run.status, 1, message);
      assert.equal(run.stdout.trim(), message);
    }
  });
});

describe('deploy.sh supabase_get', () => {
  // A curl stand-in on PATH that prints its arguments and the header file it was handed.
  const bin = path.join(scratch, 'fake-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    path.join(bin, 'curl'),
    '#!/bin/sh\nfor arg in "$@"; do case "$arg" in @*) echo "headers:"; cat "${arg#@}" ;; *) echo "arg: $arg" ;; esac; done\n',
    { mode: 0o755 },
  );
  const get = (serviceKey) => {
    const envFile = path.join(scratch, `deploy-${runs++}.env`);
    writeFileSync(envFile, `SUPABASE_URL=https://fixture.supabase.local/\nSUPABASE_SERVICE_ROLE_KEY=${serviceKey}\n`);
    return callFunction('deploy.sh', 'DEPLOY_SOURCE_ONLY', 'ENV_FILE="$FIXTURE_ENV"; WORK=$(mktemp -d); supabase_get "studio_state?id=eq.1&select=paused"', {
      FIXTURE_ENV: envFile,
      PATH: `${bin}:${process.env.PATH}`,
    });
  };

  test('sends a new-format secret key in apikey only, and never on the command line', () => {
    const run = get('sb_secret_fixture');
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^arg: https:\/\/fixture\.supabase\.local\/rest\/v1\/studio_state\?id=eq\.1&select=paused$/m);
    assert.match(run.stdout, /^apikey: sb_secret_fixture$/m);
    assert.doesNotMatch(run.stdout, /Authorization/);
    assert.doesNotMatch(run.stdout.split('headers:')[0], /sb_secret_fixture/);
  });

  test('sends a legacy service role key as apikey and bearer, as supabase-js does', () => {
    const run = get('legacy-service-role-fixture');
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^apikey: legacy-service-role-fixture$/m);
    assert.match(run.stdout, /^Authorization: Bearer legacy-service-role-fixture$/m);
  });
});

describe('deploy.sh wait_for_probe', () => {
  // systemctl reports the current invocation; journalctl prints the fixture log only for that
  // invocation's filter, so a line from any other start is never read. sleep returns at once.
  const bin = path.join(scratch, 'probe-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'systemctl'), '#!/bin/sh\necho "$CURRENT_INVOCATION"\n', { mode: 0o755 });
  writeFileSync(path.join(bin, 'journalctl'), '#!/bin/sh\n[ "$1" = "_SYSTEMD_INVOCATION_ID=invocation-new" ] && printf "%s\\n" "$PROBE_LOG"\nexit 0\n', { mode: 0o755 });
  writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const wait = (log, current = 'invocation-new') =>
    callFunction('deploy.sh', 'DEPLOY_SOURCE_ONLY', 'PROBE_WAIT_SECONDS=1; wait_for_probe invocation-old', {
      PROBE_LOG: log,
      CURRENT_INVOCATION: current,
      PATH: `${bin}:${process.env.PATH}`,
    });
  const exited = (restart) =>
    `{"level":"error","scope":"main","msg":"dispatcher exited with an error","error":"startup probe failed","exitCode":${restart ? 1 : 78},"restart":${restart}}`;
  const readonly = '{"ts":"t","level":"info","scope":"startup","msg":"code root is read-only","codeRoot":"/opt/peanutgallery"}';
  const passed = '{"ts":"t","level":"info","scope":"probe","msg":"startup probe passed","apiKeySource":"ANTHROPIC_API_KEY"}';

  test('returns when this start logs the read-only check and then the probe', () => {
    const run = wait(`${readonly}\n${passed}`);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /code root is read-only/);
    assert.match(run.stdout, /startup probe passed/);
  });

  test('does not accept a probe line without the read-only line first, or from the start before the restart', () => {
    for (const [log, current] of [
      [passed, 'invocation-new'],
      [`${passed}\n${readonly}`, 'invocation-new'],
      [`${readonly}\n${passed}`, 'invocation-old'],
    ]) {
      const run = wait(log, current);
      assert.equal(run.status, 1, `${current}: ${log}`);
      assert.match(run.stderr, /no 'code root is read-only' then 'startup probe passed' within 1 seconds/);
    }
  });

  test('keeps waiting through a retryable exit and stops at once on one systemd will not restart', () => {
    const retry = wait(exited(true));
    assert.equal(retry.status, 1);
    assert.match(retry.stderr, /within 1 seconds/);
    const fatal = wait(exited(false));
    assert.equal(fatal.status, 1);
    assert.match(fatal.stderr, /will not restart/);
  });
});

const SHELL_SCRIPTS = readdirSync(OPS_DIR).filter((name) => name.endsWith('.sh'));

describe('shell scripts', () => {
  test('parse with bash -n (the entrypoint with sh -n too)', () => {
    assert.deepEqual(SHELL_SCRIPTS.sort(), ['deploy.sh', 'dispatcher-entrypoint.sh', 'make-dispatcher-env.sh', 'provision.sh']);
    for (const script of SHELL_SCRIPTS) {
      const run = spawnSync('bash', ['-n', path.join(OPS_DIR, script)], { encoding: 'utf8' });
      assert.equal(run.status, 0, `${script}: ${run.stderr}`);
    }
    // The image's /bin/sh is dash; check with dash when this machine has it.
    for (const shell of ['sh', 'dash']) {
      if (spawnSync('sh', ['-c', `command -v ${shell}`]).status !== 0) continue;
      const posix = spawnSync(shell, ['-n', path.join(OPS_DIR, 'dispatcher-entrypoint.sh')], { encoding: 'utf8' });
      assert.equal(posix.status, 0, `${shell}: ${posix.stderr}`);
    }
  });

  test('pass shellcheck where it is installed', (t) => {
    const which = spawnSync('sh', ['-c', 'command -v shellcheck'], { encoding: 'utf8' });
    if (which.status !== 0) {
      t.skip('shellcheck is not installed');
      return;
    }
    const run = spawnSync('shellcheck', SHELL_SCRIPTS.map((script) => path.join(OPS_DIR, script)), { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout);
  });

  test('are executable in git', () => {
    const run = spawnSync('git', ['-C', REPO_ROOT, 'ls-files', '-s', 'platform/ops'], { encoding: 'utf8' });
    const modes = new Map(run.stdout.trim().split('\n').filter(Boolean).map((line) => [path.basename(line.split('\t')[1]), line.split(' ')[0]]));
    for (const script of SHELL_SCRIPTS) {
      if (modes.has(script)) assert.equal(modes.get(script), '100755', `${script} is committed without the executable bit`);
    }
  });
});

describe('values that must agree across files', () => {
  test('the image pins the claude CLI version the probe fixture recorded and the root pnpm version', () => {
    const dockerfile = read('platform/ops/Dockerfile.dispatcher');
    const fixture = read('platform/dispatcher/test/fixtures/probe.jsonl');
    const recorded = /"claude_code_version":"([^"]+)"/.exec(fixture)?.[1];
    assert.equal(recorded, '2.1.139');
    assert.equal(/^ARG CLAUDE_CODE_VERSION=(.+)$/m.exec(dockerfile)?.[1], recorded);
    const packageManager = JSON.parse(read('package.json')).packageManager;
    assert.equal(`pnpm@${/^ARG PNPM_VERSION=(.+)$/m.exec(dockerfile)?.[1]}`, packageManager);
    assert.match(dockerfile, /^ARG NODE_IMAGE=node:22-bookworm-slim$/m);
    assert.match(dockerfile, /^ENTRYPOINT \["\/usr\/bin\/tini", "--", "\/usr\/local\/bin\/dispatcher-entrypoint\.sh"\]$/m);
    const instructions = dockerfile.split('\n').filter((line) => !line.startsWith('#')).join('\n');
    assert.doesNotMatch(instructions, /NODE_ENV|corepack|^COPY \. /m);
    assert.match(dockerfile, /pnpm_config_store_dir=\/opt\/peanutgallery\/\.pnpm-store/);
  });

  test('the build context admits only the entrypoint and the managed settings', () => {
    const rules = read('platform/ops/Dockerfile.dispatcher.dockerignore').split('\n').filter((line) => line && !line.startsWith('#'));
    assert.deepEqual(rules, ['*', '!dispatcher-entrypoint.sh', '!managed-settings.json']);
  });

  test("the unit's no-restart exit status is the dispatcher's fatal exit code, and it has no EnvironmentFile", () => {
    const unit = read('platform/ops/dispatcher.service');
    const exitCodes = read('platform/dispatcher/src/exit-code.ts');
    const entrypoint = read('platform/ops/dispatcher-entrypoint.sh');
    const fatal = /export const EXIT_FATAL = (\d+);/.exec(exitCodes)?.[1];
    assert.equal(fatal, '78');
    assert.equal(/^RestartPreventExitStatus=(\d+)$/m.exec(unit)?.[1], fatal);
    assert.equal(/^EXIT_FATAL=(\d+)$/m.exec(entrypoint)?.[1], fatal);
    assert.doesNotMatch(unit, /^EnvironmentFile=/m);
    assert.match(unit, /^OnFailure=dispatcher-alert\.service$/m);
    for (const flag of ['--env-file /etc/peanutgallery/dispatcher.env', '--user 10001:10001', '--cap-drop ALL', '--pull never']) {
      assert.ok(unit.includes(flag), flag);
    }
  });

  test('every file under platform/ops is under a kernel path', () => {
    const kernel = read('platform/gate/kernel-paths.txt').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(relative);
        else files.push(relative);
      }
    };
    walk('platform/ops');
    for (const expected of ['platform/ops/provision.sh', 'platform/ops/deploy.sh', 'platform/ops/dispatcher-alert.service', 'platform/ops/test/ops.test.mjs']) {
      assert.ok(files.includes(expected), expected);
    }
    for (const file of files) assert.ok(kernel.some((entry) => file === entry || file.startsWith(`${entry}/`)), `${file} is not under a kernel path`);
  });
});

// docs/specs/ops-separation.md: the dispatcher runs from a root-owned code clone mounted read-only,
// git state lives in a work clone uid 10001 owns, and root never runs git or code from the work clone.
describe('the code clone and the work clone', () => {
  // A script's commands with continuation lines joined and comment lines dropped.
  const logicalLines = (text) =>
    text
      .replace(/\\\n\s*/g, ' ')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line));
  // Lines that run git, on the host or as a container's entrypoint: git is the first word of a
  // command once separators, keywords and leading VAR=value assignments are set aside.
  const runsGit = (line) =>
    /--entrypoint git\b/.test(line) ||
    line
      .split(/;|&&|\|\||\||\$\(|\(|`/)
      .some((segment) => /^(?:\s*(?:if|then|else|do|while|until|!|exec|command)\s)*\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*git\s/.test(segment));
  const gitLines = (script) => logicalLines(read(`platform/ops/${script}`)).filter(runsGit);

  // A committed repository to source the scripts' git functions against. Only the fixture's own
  // configuration applies: no global or system file.
  const gitEnv = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const hostGit = (cwd, ...args) =>
    spawnSync('git', ['-c', 'user.name=Ops test', '-c', 'user.email=ops@test.local', ...args], { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...gitEnv }, encoding: 'utf8' });
  function fixtureRepo() {
    const repo = mkdtempSync(path.join(scratch, 'code-clone-'));
    hostGit(repo, 'init', '-q', '--initial-branch=main');
    mkdirSync(path.join(repo, 'platform', 'ops'), { recursive: true });
    writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
    writeFileSync(path.join(repo, 'platform', 'ops', 'Dockerfile.dispatcher'), 'FROM scratch\n');
    writeFileSync(path.join(repo, 'platform', 'ops', 'dispatcher.service'), '[Service]\nExecStart=/bin/true\n');
    writeFileSync(path.join(repo, 'platform', 'ops', 'managed-settings.json'), '{}\n');
    hostGit(repo, 'add', '-A');
    const commit = hostGit(repo, 'commit', '-q', '-m', 'fixture');
    assert.equal(commit.status, 0, commit.stderr);
    return repo;
  }
  const sourced = (script, repo, body) =>
    callFunction(script, script === 'deploy.sh' ? 'DEPLOY_SOURCE_ONLY' : 'PROVISION_SOURCE_ONLY', `CODE_DIR="$FIXTURE_REPO"; ${body}`, { FIXTURE_REPO: repo, ...gitEnv });

  test('dispatcher.service mounts the code clone read-only and names the three roots', () => {
    const unit = read('platform/ops/dispatcher.service');
    for (const flag of [
      '--volume /srv/peanutgallery-code:/opt/peanutgallery:ro ',
      '--volume /srv/peanutgallery:/srv/peanutgallery ',
      '--volume /srv/peanutgallery-worktrees:/srv/peanutgallery-worktrees ',
      '--env DISPATCHER_CODE_ROOT=/opt/peanutgallery ',
      '--env DISPATCHER_REPO_ROOT=/srv/peanutgallery ',
      '--env DISPATCHER_WORKTREE_ROOT=/srv/peanutgallery-worktrees ',
      '--env DISPATCHER_CODE_READONLY=required ',
    ]) {
      assert.ok(unit.includes(flag), flag);
    }
    const mounts = [...unit.matchAll(/--volume (\S+)/g)].map((match) => match[1]);
    assert.deepEqual(mounts.filter((mount) => mount.startsWith('/srv/peanutgallery-code')), ['/srv/peanutgallery-code:/opt/peanutgallery:ro']);
    assert.equal(mounts.length, 3);
  });

  test('every git call in deploy.sh, provision.sh and the entrypoint turns fsmonitor and hooks off', () => {
    for (const script of ['deploy.sh', 'provision.sh', 'dispatcher-entrypoint.sh']) {
      const lines = gitLines(script);
      assert.ok(lines.length > 0, script);
      for (const line of lines) {
        assert.ok(line.includes('-c core.fsmonitor=false') && line.includes('-c core.hooksPath=/dev/null'), `${script}: ${line.trim()}`);
      }
    }
  });

  test('deploy.sh runs git only in the code clone, and root runs no git in the work clone', () => {
    // The one git command is code_git's; the other matches are the inspection commands its refusal prints.
    const deploy = gitLines('deploy.sh');
    const codeGit =
      'GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_NO_REPLACE_OBJECTS=1 GIT_PAGER=cat git -c safe.directory="$CODE_DIR" -c core.fsmonitor=false -c core.hooksPath=/dev/null -C "$CODE_DIR" "$@"';
    assert.equal(deploy.filter((line) => line.replace(/\s+/g, ' ').trim() === codeGit).length, 1);
    for (const line of deploy) assert.match(line, /-C "?\$CODE_DIR"? /, line);
    assert.doesNotMatch(read('platform/ops/deploy.sh'), /image_git|--entrypoint git|\$WORK_DIR:/);
    for (const line of gitLines('provision.sh')) {
      if (line.includes('--entrypoint git')) {
        assert.match(line, /--user "\$AGENT_UID:\$AGENT_UID"/, line);
        assert.match(line, /--volume "\$WORK_DIR:\$WORK_DIR"/, line);
      } else {
        assert.doesNotMatch(line, /WORK_DIR|WORKTREE_DIR/, line);
      }
    }
  });

  test('check_clean passes a clean code clone and refuses a dirty one, without running a planted fsmonitor', () => {
    for (const script of ['deploy.sh', 'provision.sh']) {
      const repo = fixtureRepo();
      mkdirSync(path.join(repo, 'node_modules'));
      writeFileSync(path.join(repo, 'node_modules', 'ignored.js'), '');
      const clean = sourced(script, repo, 'check_clean');
      assert.equal(clean.status, 0, `${script}: ${clean.stdout}${clean.stderr}`);
      assert.equal(clean.stdout, '');

      writeFileSync(path.join(repo, 'platform', 'ops', 'planted.sh'), 'echo planted\n');
      const untracked = sourced(script, repo, 'check_clean');
      assert.equal(untracked.status, 1, script);
      assert.match(untracked.stdout, /has uncommitted or untracked files/);
      assert.match(untracked.stdout, /platform\/ops\/planted\.sh/);
      rmSync(path.join(repo, 'platform', 'ops', 'planted.sh'));

      writeFileSync(path.join(repo, 'platform', 'ops', 'dispatcher.service'), '[Service]\nExecStart=/bin/false\n');
      const modified = sourced(script, repo, 'check_clean');
      assert.equal(modified.status, 1, script);
      assert.match(modified.stdout, /platform\/ops\/dispatcher\.service/);
      hostGit(repo, 'checkout', '--', 'platform/ops/dispatcher.service');

      const marker = `${repo}-fsmonitor-ran`;
      const monitor = `${repo}-monitor.sh`;
      writeFileSync(monitor, `#!/bin/sh\necho ran >> "${marker}"\nexit 1\n`, { mode: 0o755 });
      hostGit(repo, 'config', 'core.fsmonitor', monitor);
      hostGit(repo, 'status', '--porcelain');
      assert.ok(existsSync(marker), 'control: git without the switch runs the planted monitor');
      rmSync(marker);
      const planted = sourced(script, repo, 'check_clean');
      assert.equal(planted.status, 0, `${script}: ${planted.stdout}${planted.stderr}`);
      assert.ok(!existsSync(marker), `${script}: check_clean ran the planted fsmonitor`);
    }
  });

  test('units are read from the commit with git show, and the image is built from git archive', () => {
    const repo = fixtureRepo();
    const sha = hostGit(repo, 'rev-parse', 'HEAD').stdout.trim();
    writeFileSync(path.join(repo, 'platform', 'ops', 'dispatcher.service'), 'tampered in the working tree\n');
    const unit = sourced('deploy.sh', repo, `unit_text ${sha} dispatcher.service`);
    assert.equal(unit.status, 0, unit.stderr);
    assert.equal(unit.stdout, '[Service]\nExecStart=/bin/true\n');
    const listing = sourced('deploy.sh', repo, `build_context ${sha} | tar -tf -`);
    assert.equal(listing.status, 0, listing.stderr);
    assert.deepEqual(listing.stdout.trim().split('\n').sort(), ['Dockerfile.dispatcher', 'dispatcher.service', 'managed-settings.json']);

    for (const script of ['deploy.sh', 'provision.sh']) {
      const text = logicalLines(read(`platform/ops/${script}`)).join('\n');
      assert.match(text, /build_context "\$[a-z]+" \| docker build [^\n]*-f Dockerfile\.dispatcher [^\n]* -(; then)?$/m, script);
      assert.match(text, /code_git show "\$1:platform\/ops\/\$2"/, script);
      assert.match(text, /unit_text "\$[a-z]+" "\$unit"/, script);
      assert.doesNotMatch(text, /\$(REPO_DIR|CODE_DIR)\/platform\/ops\/(\$unit|Dockerfile)/, `${script} reads no unit or Dockerfile from the working tree`);
    }
  });

  test('deploy.sh fast-forwards to the fetched origin/main or checks out --ref, and installs node_modules in a throwaway container', () => {
    const text = logicalLines(read('platform/ops/deploy.sh')).join('\n');
    // S2: the fetch names the repository's URL, and the clone's origin and the env file's repository are checked.
    assert.match(text, /code_git fetch --quiet "\$REPO_URL" \+refs\/heads\/main:refs\/remotes\/origin\/main/);
    assert.match(read('platform/ops/deploy.sh'), /^REPO_URL=https:\/\/github\.com\/AlreadyKyle\/peanutgallery\.git$/m);
    assert.match(text, /\[ "\$\(code_git config --local --get remote\.origin\.url\)" = "\$REPO_URL" \]/);
    assert.match(text, /\[ "\$\(env_value GITHUB_REPO\)" = "\$REPO_SLUG" \]/);
    assert.doesNotMatch(text, /fetch --quiet origin/);
    assert.match(text, /code_git merge --ff-only --quiet "\$target"/);
    assert.match(text, /\[ "\$new" = "\$target" \]/);
    assert.match(text, /code_git checkout --quiet --detach "\$target"/);
    // I1: the install runs as the build uid with .git read-only over the code mount.
    const install = /docker run --rm [^\n]*pnpm install --frozen-lockfile[^\n]*/.exec(text)?.[0];
    assert.ok(install, 'pnpm install runs in a docker run --rm');
    for (const flag of ['--user "$BUILD_UID:$BUILD_UID"', '--cap-drop ALL', '--security-opt no-new-privileges', '--volume "$CODE_DIR:$CODE_MOUNT" --volume "$CODE_DIR/.git:$CODE_MOUNT/.git:ro"', '--entrypoint /usr/bin/env', ' -i ']) {
      assert.ok(install.includes(flag), flag);
    }
    assert.doesNotMatch(install, /--env-file|--user 0/);
    assert.match(text, /chown -hR 0:0 "\$CODE_DIR"/);
    assert.match(read('platform/ops/Dockerfile.dispatcher'), /useradd --uid 10002 --gid 10002 /);
    for (const script of ['deploy.sh', 'provision.sh']) {
      assert.match(read(`platform/ops/${script}`), /^CODE_DIR=\/srv\/peanutgallery-code$/m, script);
      assert.match(read(`platform/ops/${script}`), /^BUILD_UID=10002$/m, script);
    }

    const usage = callFunction('deploy.sh', 'DEPLOY_SOURCE_ONLY', 'main --ref not-a-sha');
    assert.equal(usage.status, 1);
    assert.match(usage.stderr, /--ref takes a full 40-character commit sha/);
    const unknown = callFunction('deploy.sh', 'DEPLOY_SOURCE_ONLY', 'main --force');
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /usage: deploy\.sh \[--ref <commit sha>\] \[--confirm/);
    const confirm = callFunction('deploy.sh', 'DEPLOY_SOURCE_ONLY', 'main --confirm abc');
    assert.equal(confirm.status, 1);
    assert.match(confirm.stderr, /--confirm takes the first 12 characters of the target sha/);
  });

  test('the code clone functions are identical in deploy.sh and provision.sh', () => {
    const block = (script) => {
      const text = read(`platform/ops/${script}`);
      const start = text.indexOf('# >>> code clone functions');
      const end = text.indexOf('# <<< code clone functions');
      assert.ok(start >= 0 && end > start, script);
      return text.slice(start, end);
    };
    assert.equal(block('provision.sh'), block('deploy.sh'));
    for (const name of ['code_git', 'check_clean', 'check_code_clone', 'prepare_install_dirs', 'run_install', 'unit_text', 'build_context']) {
      assert.match(block('deploy.sh'), new RegExp(`^${name}\\(\\) \\{$`, 'm'), name);
    }
  });

  // I1: the state an install container or a planted change could leave, each refused on its own.
  test('check_code_clone passes a fresh clone and refuses each kind of unexpected git state, setuid file and symlink', () => {
    for (const script of ['deploy.sh', 'provision.sh']) {
      const repo = fixtureRepo();
      mkdirSync(path.join(repo, 'node_modules', '.pnpm', 'pkg'), { recursive: true });
      symlinkSync('.pnpm/pkg', path.join(repo, 'node_modules', 'pkg'));
      symlinkSync('../package.json', path.join(repo, 'node_modules', 'up-one-inside'));
      writeFileSync(path.join(repo, 'package.json'), '{}\n');
      const clean = sourced(script, repo, 'check_code_clone');
      assert.equal(clean.status, 0, `${script}: ${clean.stdout}${clean.stderr}`);
      assert.equal(clean.stdout, '');
    }
    const refused = (setup, message, undo) => {
      const repo = fixtureRepo();
      setup(repo);
      const run = sourced('deploy.sh', repo, 'check_code_clone');
      assert.equal(run.status, 1, `${message}: ${run.stdout}${run.stderr}`);
      assert.match(run.stdout, message);
      undo?.(repo);
    };
    refused((repo) => hostGit(repo, 'update-index', '--assume-unchanged', 'platform/ops/dispatcher.service'), /marks platform\/ops\/dispatcher\.service with h/);
    refused((repo) => hostGit(repo, 'update-index', '--skip-worktree', 'platform/ops/dispatcher.service'), /marks platform\/ops\/dispatcher\.service with S/);
    refused((repo) => hostGit(repo, 'config', 'credential.helper', '!touch /tmp/pwned'), /\.git\/config sets credential\.helper/);
    refused((repo) => hostGit(repo, 'config', 'core.sshCommand', 'touch /tmp/pwned'), /\.git\/config sets core\.sshcommand/);
    for (const file of ['info/attributes', 'info/grafts', 'commondir', 'objects/info/alternates']) {
      refused((repo) => {
        mkdirSync(path.dirname(path.join(repo, '.git', file)), { recursive: true });
        writeFileSync(path.join(repo, '.git', file), '* filter=planted\n');
      }, new RegExp(`\\.git/${file.replace('/', '\\/')} exists`));
    }
    refused((repo) => symlinkSync('/etc', path.join(repo, 'platform', 'ops', 'absolute')), /absolute is an absolute symlink/);
    refused((repo) => symlinkSync('../../..', path.join(repo, 'platform', 'ops', 'escape')), /resolves outside it/);
    refused((repo) => symlinkSync('missing/deeper/target', path.join(repo, 'platform', 'ops', 'unresolved')), /a symlink that does not resolve/);
    const setuid = fixtureRepo();
    chmodSync(path.join(setuid, 'platform', 'ops', 'Dockerfile.dispatcher'), 0o4755);
    if ((statSync(path.join(setuid, 'platform', 'ops', 'Dockerfile.dispatcher')).mode & 0o4000) !== 0) {
      const run = sourced('deploy.sh', setuid, 'check_code_clone');
      assert.equal(run.status, 1);
      assert.match(run.stdout, /Dockerfile\.dispatcher is setuid or setgid/);
    }
  });

  // I3: a roll back stays on main, at or after the floor, and keeps the managed settings.
  test('check_ref refuses a roll back with no floor, below the floor, off main or without the managed settings', () => {
    const repo = fixtureRepo();
    hostGit(repo, 'rm', '-q', 'platform/ops/managed-settings.json');
    hostGit(repo, 'commit', '-q', '-m', 'before the floor');
    const below = hostGit(repo, 'rev-parse', 'HEAD').stdout.trim();
    writeFileSync(path.join(repo, 'platform', 'ops', 'managed-settings.json'), '{}\n');
    hostGit(repo, 'add', '-A');
    hostGit(repo, 'commit', '-q', '-m', 'the floor');
    const floor = hostGit(repo, 'rev-parse', 'HEAD').stdout.trim();
    writeFileSync(path.join(repo, 'platform', 'ops', 'dispatcher.service'), '[Service]\nExecStart=/bin/echo\n');
    hostGit(repo, 'commit', '-q', '-am', 'after the floor');
    const after = hostGit(repo, 'rev-parse', 'HEAD').stdout.trim();
    hostGit(repo, 'rm', '-q', 'platform/ops/managed-settings.json');
    hostGit(repo, 'commit', '-q', '-m', 'settings removed');
    const removed = hostGit(repo, 'rev-parse', 'HEAD').stdout.trim();
    hostGit(repo, 'update-ref', 'refs/remotes/origin/main', removed);
    hostGit(repo, 'checkout', '-q', '-b', 'side', after);
    writeFileSync(path.join(repo, 'platform', 'ops', 'side.txt'), 'side\n');
    hostGit(repo, 'add', '-A');
    hostGit(repo, 'commit', '-q', '-m', 'off main');
    const side = hostGit(repo, 'rev-parse', 'HEAD').stdout.trim();
    const check = (ref, withFloor = floor) => sourced('deploy.sh', repo, `ROLLBACK_FLOOR=${withFloor}; check_ref ${ref}`);

    const empty = check(after, '');
    assert.equal(empty.status, 1);
    assert.match(empty.stdout, /ROLLBACK_FLOOR in deploy\.sh is not set/);
    assert.match(read('platform/ops/deploy.sh'), /^ROLLBACK_FLOOR=""$/m);
    assert.equal(check(after).status, 0, check(after).stdout);
    assert.equal(check(floor).status, 0);
    assert.match(check(below).stdout, /is older than the rollback floor/);
    assert.match(check(side).stdout, /is not a commit on origin\/main/);
    assert.match(check(removed).stdout, /has no platform\/ops\/managed-settings\.json/);
    assert.match(check('0'.repeat(40)).stdout, /is not a commit in/);
  });

  // I4: the gate verdict, the review and the confirmation.
  test('gate_verdict reads only the latest gate run GitHub Actions created', () => {
    const run = (id, conclusion, extra = {}) => ({ id, name: 'gate', status: 'completed', conclusion, app: { slug: 'github-actions' }, ...extra });
    const verdict = (json) => callFunction('deploy.sh', 'DEPLOY_SOURCE_ONLY', 'gate_verdict "$RUNS"', { RUNS: typeof json === 'string' ? json : JSON.stringify(json) }).stdout.trim();
    assert.equal(verdict({ check_runs: [run(1, 'success')] }), 'success');
    assert.equal(verdict({ check_runs: [run(1, 'success'), run(2, 'failure')] }), 'failure');
    assert.equal(verdict({ check_runs: [run(1, 'failure'), run(2, 'success')] }), 'success');
    assert.equal(verdict({ check_runs: [run(1, null, { status: 'in_progress' })] }), 'pending');
    assert.equal(verdict({ check_runs: [run(1, 'success', { app: { slug: 'someone-else' } })] }), 'missing');
    assert.equal(verdict({ check_runs: [run(1, 'success', { name: 'platform' })] }), 'missing');
    assert.equal(verdict({ message: 'Bad credentials' }), 'unreadable');
    assert.equal(verdict('not json'), 'unreadable');
  });

  test('check_gate sends the token in a header file and refuses anything but success', () => {
    const bin = path.join(scratch, 'gate-bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nfor arg in "$@"; do case "$arg" in @*) cat "${arg#@}" >&2 ;; *) echo "arg: $arg" >&2 ;; esac; done\nprintf "%s" "$RUNS"\n', { mode: 0o755 });
    const envFile = path.join(scratch, `gate-${runs++}.env`);
    writeFileSync(envFile, 'GITHUB_TOKEN=fixture-gate-token\n');
    const gate = (runsJson) =>
      callFunction('deploy.sh', 'DEPLOY_SOURCE_ONLY', 'ENV_FILE="$FIXTURE_ENV"; WORK=$(mktemp -d); check_gate abc123', {
        FIXTURE_ENV: envFile,
        RUNS: JSON.stringify(runsJson),
        PATH: `${bin}:${process.env.PATH}`,
      });
    const ok = gate({ check_runs: [{ id: 1, name: 'gate', status: 'completed', conclusion: 'success', app: { slug: 'github-actions' } }] });
    assert.equal(ok.status, 0, ok.stdout);
    assert.match(ok.stderr, /^arg: https:\/\/api\.github\.com\/repos\/AlreadyKyle\/peanutgallery\/commits\/abc123\/check-runs\?check_name=gate/m);
    assert.match(ok.stderr, /^Authorization: Bearer fixture-gate-token$/m);
    assert.doesNotMatch(ok.stderr.split('\n').filter((line) => line.startsWith('arg:')).join('\n'), /fixture-gate-token/);
    const failed = gate({ check_runs: [{ id: 1, name: 'gate', status: 'completed', conclusion: 'failure', app: { slug: 'github-actions' } }] });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /the gate check on abc123 is failure, not success/);
  });

  test('review_target lists the commits and the diff stat without control characters, and confirm_target needs the sha prefix', () => {
    const repo = fixtureRepo();
    const old = hostGit(repo, 'rev-parse', 'HEAD').stdout.trim();
    writeFileSync(path.join(repo, 'platform', 'ops', 'dispatcher.service'), '[Service]\nExecStart=/bin/echo planted\n');
    writeFileSync(path.join(repo, 'README.md'), 'not reviewed\n');
    hostGit(repo, 'commit', '-q', '-am', 'Change the unit [2Jquietly');
    hostGit(repo, 'add', '-A');
    hostGit(repo, 'commit', '-q', '-m', 'Add a readme');
    const target = hostGit(repo, 'rev-parse', 'HEAD').stdout.trim();
    const review = sourced('deploy.sh', repo, `review_target ${old} ${target}`);
    assert.equal(review.status, 0, review.stderr);
    assert.match(review.stdout, /Change the unit \[2Jquietly/);
    assert.doesNotMatch(review.stdout, //);
    assert.match(review.stdout, /Add a readme/);
    assert.match(review.stdout, /platform\/ops\/dispatcher\.service \| 2 \+-/);
    assert.doesNotMatch(review.stdout, /README\.md \|/);

    const confirm = (given) => callFunction('deploy.sh', 'DEPLOY_SOURCE_ONLY', `CONFIRM_TTY=/nonexistent/tty; confirm_target ${target} "${given}"`);
    assert.equal(confirm(target.slice(0, 12)).status, 0);
    const wrong = confirm('0'.repeat(12));
    assert.equal(wrong.status, 1);
    assert.match(wrong.stdout, /is not the first 12 characters of the target/);
    const none = confirm('');
    assert.equal(none.status, 1);
    assert.match(none.stdout, /run deploy\.sh again with --confirm/);
  });

  // I2: deploy.sh runs from the operator's checkout over ssh, never from a file on the VPS.
  test('deploy.sh reads nothing from its own location and the runbook pipes it over ssh', () => {
    // awk's own $0 (the input line) is not the script's path.
    const commands = logicalLines(read('platform/ops/deploy.sh'))
      .map((line) => line.replace(/awk -v root="\$root" '[^']*'/, 'awk'))
      .join('\n');
    assert.doesNotMatch(commands, /BASH_SOURCE|\$0\b|\$\{0\}|^\s*(source|\.) /m);
    const readme = read('platform/ops/README.md');
    assert.doesNotMatch(readme, /bash \/srv\/[^\s']*deploy\.sh/);
    assert.match(readme, /ssh root@\$VPS_IP 'bash -s' < platform\/ops\/deploy\.sh/);
    assert.match(readme, /ssh root@\$VPS_IP 'bash -s -- --confirm <first 12 characters of the target sha>' < platform\/ops\/deploy\.sh/);
    assert.doesNotMatch(read('docs/specs/ops-separation.md'), /bash \/srv\/[^\s']*deploy\.sh/);
  });

  test('provision.sh creates both clones and the worktree folder with their owners, and accepts arm64', () => {
    const text = read('platform/ops/provision.sh');
    assert.match(text, /^WORK_DIR=\/srv\/peanutgallery$/m);
    assert.match(text, /^WORKTREE_DIR=\/srv\/peanutgallery-worktrees$/m);
    assert.match(text, /ensure_dir "\$CODE_DIR" 0 0755/);
    assert.match(text, /ensure_dir "\$WORK_DIR" "\$AGENT_UID" 0755/);
    assert.match(text, /ensure_dir "\$WORKTREE_DIR" "\$AGENT_UID" 0700/);
    assert.match(text, /agent_git clone --quiet "\$REPO_URL" "\$WORK_DIR"/);
    assert.match(text, /x86_64 \| aarch64\)/);
    assert.doesNotMatch(text, /\.worktrees/);
  });

  test('the entrypoint runs the dispatcher from the code clone and installs nothing', () => {
    const entrypoint = read('platform/ops/dispatcher-entrypoint.sh');
    const commands = logicalLines(entrypoint).join('\n');
    assert.doesNotMatch(commands, /pnpm/);
    assert.match(entrypoint, /^CODE=\$\{DISPATCHER_CODE_ROOT:-\/opt\/peanutgallery\}$/m);
    assert.match(entrypoint, /^REPO=\$\{DISPATCHER_REPO_ROOT:-\/srv\/peanutgallery\}$/m);
    assert.match(commands, /^cd "\$CODE\/platform\/dispatcher"/m);
    assert.match(commands, /^exec node --import tsx src\/main\.ts$/m);
    assert.match(commands, /git -C "\$REPO" /);
    assert.match(commands, /^export TSX_DISABLE_CACHE$/m);
  });

  test('the image installs the sandbox tools and root-owned managed settings', () => {
    const dockerfile = read('platform/ops/Dockerfile.dispatcher');
    const apt = /apt-get install -y --no-install-recommends ([^\n&]+)/.exec(dockerfile)?.[1].trim().split(/\s+/);
    for (const pkg of ['git', 'ca-certificates', 'tini', 'bubblewrap', 'socat']) assert.ok(apt?.includes(pkg), pkg);
    const copy = /^COPY --chmod=0644 managed-settings\.json \/etc\/claude-code\/managed-settings\.json$/m.exec(dockerfile);
    assert.ok(copy, 'the managed settings are copied to the path Claude Code reads on Linux');
    assert.ok(copy.index < dockerfile.indexOf('USER 10001:10001'), 'copied as root, before USER');
    assert.doesNotMatch(dockerfile, /--chown[^\n]*managed-settings/);
  });

  test('managed-settings.json turns hooks off and denies the reads and edits a session never needs', () => {
    const settings = JSON.parse(read('platform/ops/managed-settings.json'));
    assert.equal(settings.disableAllHooks, true);
    assert.deepEqual(settings.permissions.deny, [
      'Read(//proc/**)',
      'Read(//etc/peanutgallery/**)',
      'Read(//srv/peanutgallery/.env*)',
      'Read(//opt/peanutgallery/.env*)',
      'Read(~/.ssh/**)',
      'Read(~/.aws/**)',
      'Read(~/.config/**)',
      'Read(~/.claude/**)',
      'Read(~/.claude.json)',
      'Read(~/.netrc)',
      'Edit(//opt/peanutgallery/**)',
      'Edit(//srv/peanutgallery/**)',
    ]);
  });
});
