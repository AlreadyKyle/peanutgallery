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
import { FORBIDDEN_KEYS, MANAGED_KEYS, NOT_COPIED, OPERATOR_KEYS, OPTIONAL_KEYS } from '../dispatcher-env.mjs';
import { VPS_JOBS } from '../jobs/lib.mjs';
// The jobs' own tests (the Controller, the quota check and their env rules) and the Mac host's
// (docs/specs/mac-host.md) run with these.
import './jobs.test.mjs';
import './mac.test.mjs';

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
  CLAUDE_BIN: '/Users/board/.local/bin/claude',
  BOARD_SESSION_TTL_MIN: '',
  MANAGED_AGENT_ID: 'agent_fixture',
  MANAGED_AGENT_VERSION: '3',
  MANAGED_ENVIRONMENT_ID: 'env_fixture',
};
const OPERATOR = {
  VPS_GITHUB_TOKEN: 'github_pat_-fixture-vps',
  GITHUB_READ_TOKEN: 'github_pat_-fixture-read',
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
  OPERATOR.GITHUB_READ_TOKEN,
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
      ['GITHUB_TOKEN', 'github_pat_-fixture-vps'],
      ['GITHUB_READ_TOKEN', 'github_pat_-fixture-read'],
      ['NETLIFY_AUTH_TOKEN', 'fixture-netlify-token'],
      ['NETLIFY_SITE_ID_SEED', 'fixture-site-seed'],
      ['NETLIFY_SITE_ID_PLATFORM', 'fixture-site-platform'],
      ['SUPABASE_URL', 'https://fixture.supabase.local'],
      ['SUPABASE_SERVICE_ROLE_KEY', 'fixture-supabase-secret-key'],
      ['PRICE_TABLE_JSON', JSON.stringify(PRICE_TABLE)],
      ['MODEL_BUILDER', 'builder-class'],
      ['MANAGED_AGENT_ID', 'agent_fixture'],
      ['MANAGED_AGENT_VERSION', '3'],
      ['MANAGED_ENVIRONMENT_ID', 'env_fixture'],
      ['HEALTHCHECK_URL', 'https://hc-ping.com/fixture-check'],
      ['NTFY_TOPIC_URL', 'https://ntfy.sh/fixture-topic'],
      ['POOL_DAILY_CAP_USD', '100'],
      ['CARD_MAX_USD', '25'],
      ['SESSION_MAX_TURNS', '60'],
      ['AGENT_HOURLY_RATE_USD', '5'],
      ['DISPATCHER_TICK_MS', '60000'],
      ['DISPATCHER_MAX_CONCURRENCY', '1'],
    ]);
    for (const value of SECRET_VALUES) assert.ok(!run.output.includes(value), 'the output names keys only');
    assert.match(run.stdout, /with 23 keys: AGENT_MODE, STUDIO_ANTHROPIC_API_KEY/);
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
      [{ ...OPERATOR, GITHUB_READ_TOKEN: '' }, 'GITHUB_READ_TOKEN is not set in the operator environment'],
      [{ ...OPERATOR, GITHUB_READ_TOKEN: OPERATOR.VPS_GITHUB_TOKEN }, 'GITHUB_READ_TOKEN equals a token that can write'],
      [{ ...OPERATOR, GITHUB_READ_TOKEN: MAC_DOTENV.GITHUB_TOKEN }, 'GITHUB_READ_TOKEN equals a token that can write'],
      [{ ...OPERATOR, GITHUB_READ_TOKEN: 'ghp_classic_fixture' }, 'GITHUB_READ_TOKEN is not a fine-grained personal access token'],
      [{ ...OPERATOR, VPS_GITHUB_TOKEN: 'gho_oauth_fixture' }, 'VPS_GITHUB_TOKEN is not a fine-grained personal access token'],
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
      [dotenvText({ ...MAC_DOTENV, MANAGED_AGENT_ID: '' }), 'MANAGED_AGENT_ID is not set in .env'],
      [dotenvText({ ...MAC_DOTENV, MANAGED_ENVIRONMENT_ID: '' }), 'MANAGED_ENVIRONMENT_ID is not set in .env'],
      [dotenvText({ ...MAC_DOTENV, MANAGED_AGENT_VERSION: 'latest' }), 'MANAGED_AGENT_VERSION must be a positive integer'],
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
      [good.replace('GITHUB_READ_TOKEN=github_pat_-fixture-read', 'GITHUB_READ_TOKEN=github_pat_-fixture-vps'), 'GITHUB_READ_TOKEN equals GITHUB_TOKEN'],
      [good.replace('GITHUB_READ_TOKEN=github_pat_-fixture-read', 'GITHUB_READ_TOKEN=ghp_classic_fixture'), 'GITHUB_READ_TOKEN is not a fine-grained personal access token'],
      [good.replace(/^MANAGED_ENVIRONMENT_ID=.*\n/m, ''), 'MANAGED_ENVIRONMENT_ID is missing or empty'],
      [good.replace('MANAGED_AGENT_VERSION=3', 'MANAGED_AGENT_VERSION=v3'), 'MANAGED_AGENT_VERSION must be a positive integer'],
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
    assert.deepEqual(OPERATOR_KEYS, ['VPS_GITHUB_TOKEN', 'GITHUB_READ_TOKEN', 'HEALTHCHECK_URL', 'NTFY_TOPIC_URL']);
    for (const name of MANAGED_KEYS) assert.ok(written.has(name), `${name} is copied from .env`);
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

// Every shell script under platform/ops, as a path relative to it.
const SHELL_SCRIPTS = readdirSync(OPS_DIR, { recursive: true }).filter((name) => name.endsWith('.sh') && !name.startsWith('test/'));

describe('shell scripts', () => {
  test('parse with bash -n (the entrypoint with sh -n too)', () => {
    assert.deepEqual(SHELL_SCRIPTS.sort(), [
      'backup/backup.sh',
      'deploy.sh',
      'dispatcher-entrypoint.sh',
      'mac/backup-mac.sh',
      'mac/deploy.sh',
      'mac/install.sh',
      'mac/lib.sh',
      'mac/run-dispatcher.sh',
      'mac/run-job.sh',
      'mac/uninstall.sh',
      'make-dispatcher-env.sh',
      'make-jobs-env.sh',
      'oracle-launch.sh',
      'provision.sh',
    ]);
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
    const modes = new Map(run.stdout.trim().split('\n').filter(Boolean).map((line) => [path.relative('platform/ops', line.split('\t')[1]), line.split(' ')[0]]));
    for (const script of SHELL_SCRIPTS) {
      if (modes.has(script)) assert.equal(modes.get(script), '100755', `${script} is committed without the executable bit`);
    }
  });
});

describe('values that must agree across files', () => {
  test('the image pins the root pnpm version', () => {
    const dockerfile = read('platform/ops/Dockerfile.dispatcher');
    const packageManager = JSON.parse(read('package.json')).packageManager;
    assert.equal(`pnpm@${/^ARG PNPM_VERSION=(.+)$/m.exec(dockerfile)?.[1]}`, packageManager);
    assert.match(dockerfile, /^ARG NODE_IMAGE=node:22-bookworm-slim$/m);
    assert.match(dockerfile, /^ENTRYPOINT \["\/usr\/bin\/tini", "--", "\/usr\/local\/bin\/dispatcher-entrypoint\.sh"\]$/m);
    const instructions = dockerfile.split('\n').filter((line) => !line.startsWith('#')).join('\n');
    assert.doesNotMatch(instructions, /NODE_ENV|corepack|^COPY \. /m);
    assert.match(dockerfile, /pnpm_config_store_dir=\/opt\/peanutgallery\/\.pnpm-store/);
  });

  test('the build context admits only the entrypoint', () => {
    const rules = read('platform/ops/Dockerfile.dispatcher.dockerignore').split('\n').filter((line) => line && !line.startsWith('#'));
    assert.deepEqual(rules, ['*', '!dispatcher-entrypoint.sh']);
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
    assert.deepEqual(listing.stdout.trim().split('\n').sort(), ['Dockerfile.dispatcher', 'dispatcher.service']);

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
    refused((repo) => symlinkSync('missing', path.join(repo, 'platform', 'ops', 'dangling')), /dangling is a symlink that does not resolve/);
    const setuid = fixtureRepo();
    chmodSync(path.join(setuid, 'platform', 'ops', 'Dockerfile.dispatcher'), 0o4755);
    if ((statSync(path.join(setuid, 'platform', 'ops', 'Dockerfile.dispatcher')).mode & 0o4000) !== 0) {
      const run = sourced('deploy.sh', setuid, 'check_code_clone');
      assert.equal(run.status, 1);
      assert.match(run.stdout, /Dockerfile\.dispatcher is setuid or setgid/);
    }
  });

  // I3: a roll back stays on main, at or after the floor, and keeps the read-only code mount.
  test('check_ref refuses a roll back with no floor, below the floor, off main, without the read-only code mount or without the jobs', () => {
    const repo = fixtureRepo();
    const ops = path.join(repo, 'platform', 'ops');
    const unit = path.join(ops, 'dispatcher.service');
    const readOnly = '[Service]\nExecStart=/usr/bin/docker run --rm \\\n  --volume /srv/peanutgallery-code:/opt/peanutgallery:ro \\\n  peanutgallery/dispatcher:current\n';
    const below = hostGit(repo, 'rev-parse', 'HEAD').stdout.trim();
    writeFileSync(unit, readOnly);
    // Every file deploy.sh installs from the target.
    const units = /^UNITS="([^"]+)"$/m.exec(read('platform/ops/deploy.sh'))[1].split(' ');
    for (const name of units.filter((name) => name !== 'dispatcher.service')) writeFileSync(path.join(ops, name), '[Unit]\n');
    mkdirSync(path.join(ops, 'backup'));
    writeFileSync(path.join(ops, 'backup', 'backup.sh'), '#!/bin/sh\n');
    hostGit(repo, 'add', '-A');
    hostGit(repo, 'commit', '-q', '-m', 'the floor');
    const floor = hostGit(repo, 'rev-parse', 'HEAD').stdout.trim();
    writeFileSync(unit, readOnly.replace('run --rm', 'run --rm --name peanutgallery-dispatcher'));
    hostGit(repo, 'commit', '-q', '-am', 'after the floor');
    const after = hostGit(repo, 'rev-parse', 'HEAD').stdout.trim();
    hostGit(repo, 'rm', '-q', 'platform/ops/backup/backup.sh');
    hostGit(repo, 'commit', '-q', '-m', 'no backup script');
    const noBackup = hostGit(repo, 'rev-parse', 'HEAD').stdout.trim();
    hostGit(repo, 'rm', '-q', 'platform/ops/peanutgallery-quota.timer');
    hostGit(repo, 'commit', '-q', '-m', 'no quota timer');
    const noTimer = hostGit(repo, 'rev-parse', 'HEAD').stdout.trim();
    writeFileSync(unit, readOnly.replace(':ro', ''));
    hostGit(repo, 'commit', '-q', '-am', 'code clone mounted writable');
    const writable = hostGit(repo, 'rev-parse', 'HEAD').stdout.trim();
    hostGit(repo, 'update-ref', 'refs/remotes/origin/main', writable);
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
    assert.match(check(writable).stdout, /dispatcher\.service does not mount the code clone read-only/);
    assert.match(check(noBackup).stdout, new RegExp(`^${noBackup} has no platform/ops/backup/backup\\.sh, so it is older than the jobs`));
    assert.match(check(noTimer).stdout, /has no platform\/ops\/peanutgallery-quota\.timer, so it is older than the jobs/);
    assert.equal(check(noTimer).status, 1);
    assert.match(check('0'.repeat(40)).stdout, /is not a commit in/);
    assert.match(read('platform/ops/dispatcher.service'), /--volume \/srv\/peanutgallery-code:\/opt\/peanutgallery:ro/);
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
    assert.doesNotMatch(commands, /claude/);
  });

  // docs/specs/launch-managed.md: no agent runs on the VPS, so the image carries no claude CLI, no
  // sandbox tools and no Claude Code settings.
  test('the image installs no claude CLI, no sandbox tools and no Claude Code settings', () => {
    const dockerfile = read('platform/ops/Dockerfile.dispatcher');
    const instructions = dockerfile.split('\n').filter((line) => !line.startsWith('#')).join('\n');
    const apt = /apt-get install -y --no-install-recommends ([^\n&]+)/.exec(dockerfile)?.[1].trim().split(/\s+/).filter((word) => word !== '\\');
    assert.deepEqual(apt, ['git', 'ca-certificates', 'tini']);
    assert.doesNotMatch(instructions, /claude|bubblewrap|socat|managed-settings|CLAUDE_/i);
    assert.equal(existsSync(path.join(OPS_DIR, 'managed-settings.json')), false);
  });
});

// The read-only token check provision.sh makes, with the answers GitHub gives.
describe('provision.sh read_token_verdict', () => {
  const verdict = (read, write, body) => {
    const file = path.join(scratch, `write-body-${runs++}.json`);
    writeFileSync(file, body);
    return callFunction('provision.sh', 'PROVISION_SOURCE_ONLY', 'read_token_verdict "$READ" "$WRITE" "$BODY"', { READ: read, WRITE: write, BODY: file });
  };

  test('passes a token that reads the repository and is refused a ref write for want of permission', () => {
    const ok = verdict('200', '403', '{"message":"Resource not accessible by personal access token"}');
    assert.equal(ok.status, 0, ok.stdout);
    assert.equal(ok.stdout, '');
  });

  test('refuses a token that can write, cannot read, or got any other answer', () => {
    assert.match(verdict('200', '422', '{"message":"Object does not exist"}').stdout, /GITHUB_READ_TOKEN can write to AlreadyKyle\/peanutgallery/);
    assert.match(verdict('404', '403', '{}').stdout, /cannot read AlreadyKyle\/peanutgallery \(GET returned 404\)/);
    assert.match(verdict('200', '403', '{"message":"API rate limit exceeded"}').stdout, /only a 403 permission denial proves/);
    assert.match(verdict('200', '000', '').stdout, /write check returned 000/);
    assert.match(read('platform/ops/provision.sh'), /^ {2}check_env_file\n {2}check_read_token\n/m);
  });
});

// The CI audit (docs/specs/launch-managed.md): card code runs in the gate workflow, so no job there may
// hold a credential. The workflow reads contents only, persists no checkout credential, names no
// secret and runs on no trigger that carries a privileged token.
describe('the CI workflows that run card code', () => {
  const workflows = readdirSync(path.join(REPO_ROOT, '.github', 'workflows')).filter((file) => /\.ya?ml$/.test(file));
  // Each step that uses actions/checkout, as the step's lines.
  const checkoutSteps = (text) => {
    const lines = text.split('\n');
    const steps = [];
    lines.forEach((line, index) => {
      const match = /^(\s*)- uses: actions\/checkout@/.exec(line);
      if (!match) return;
      const indent = match[1].length;
      const step = [line];
      for (const next of lines.slice(index + 1)) {
        if (next.trim() === '') continue;
        if (next.length - next.trimStart().length <= indent) break;
        step.push(next);
      }
      steps.push(step.join('\n'));
    });
    return steps;
  };

  test('gate.yml is among them', () => {
    assert.ok(workflows.includes('gate.yml'), workflows.join(', '));
  });

  for (const file of ['gate.yml']) {
    test(`${file} reads contents only, persists no checkout credential and uses no secret`, () => {
      const text = read(`.github/workflows/${file}`);
      assert.match(text, /^permissions:\n {2}contents: read\n(?! )/m, 'top-level permissions are contents: read and nothing else');
      for (const block of text.match(/^\s+permissions:[^\n]*(\n\s{6,}[^\n]+)*/gm) ?? []) {
        assert.doesNotMatch(block, /write/, `a job widens its permissions: ${block.trim()}`);
      }
      const steps = checkoutSteps(text);
      assert.ok(steps.length > 0, 'the workflow checks out the repository');
      for (const step of steps) assert.match(step, /persist-credentials: false/, `a checkout keeps its credential:\n${step}`);
      assert.doesNotMatch(text, /secrets\./, 'no secret is referenced');
      assert.doesNotMatch(text, /github\.token|GITHUB_TOKEN/, 'the job token is never handed to a step');
      assert.doesNotMatch(text, /pull_request_target|workflow_run/, 'no trigger that runs with a privileged token');
    });
  }
});

// docs/specs/money-safety.md: the backup, the Controller and the quota check on the VPS.
describe('the jobs on the VPS', () => {
  const JOB_UNITS = [
    'peanutgallery-job-alert@.service',
    'peanutgallery-backup.service',
    'peanutgallery-backup.timer',
    'peanutgallery-controller.service',
    'peanutgallery-controller.timer',
    'peanutgallery-quota.service',
    'peanutgallery-quota.timer',
  ];
  const listed = (script, name) => new RegExp(`^${name}="([^"]+)"$`, 'm').exec(read(`platform/ops/${script}`))?.[1].split(' ');

  test('provision.sh and deploy.sh install every unit file in platform/ops, and verify all but the alert template', () => {
    const files = readdirSync(OPS_DIR).filter((name) => name.endsWith('.service') || name.endsWith('.timer')).sort();
    assert.deepEqual(files, ['dispatcher-alert.service', 'dispatcher.service', ...JOB_UNITS].sort());
    for (const script of ['provision.sh', 'deploy.sh']) {
      assert.deepEqual([...listed(script, 'UNITS')].sort(), files, script);
      assert.deepEqual([...listed(script, 'VERIFY_UNITS')].sort(), files.filter((name) => !name.includes('@')), script);
      assert.match(read(`platform/ops/${script}`), /^JOB_LIB=\/usr\/local\/lib\/peanutgallery$/m);
      assert.match(read(`platform/ops/${script}`), /verify_units \|\| die "systemd-analyze verify failed on/);
    }
    // The backup script root runs comes from the commit, like the units.
    assert.match(read('platform/ops/provision.sh'), /unit_text "\$sha" backup\/backup\.sh > "\$text"\n {2}install_file "\$JOB_LIB\/backup\.sh" 0755 < "\$text"/);
    assert.match(read('platform/ops/deploy.sh'), /unit_text "\$new" backup\/backup\.sh > "\$WORK\/backup\.sh"/);
    assert.match(read('platform/ops/provision.sh'), /^ {2}install_units\n {2}install_jobs\n/m);
    assert.deepEqual([...listed('provision.sh', 'JOBS')].sort(), [...VPS_JOBS].sort());
    assert.match(read('platform/ops/provision.sh'), /for pkg in git ufw unattended-upgrades curl jq ca-certificates age; do/);
    assert.match(read('platform/ops/provision.sh'), /^SUPABASE_CLI_VERSION=\d+\.\d+\.\d+$/m);
  });

  // systemd-analyze verify fails a unit whose ExecStart is not on the host, so on a fresh VPS the
  // backup script must be in place before the units are verified, or provision.sh stops there and never
  // enables the dispatcher or a timer.
  test('provision.sh installs the backup script before it verifies the units, so a fresh host gets through', () => {
    const root = mkdtempSync(path.join(scratch, 'install-units-'));
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    const log = path.join(root, 'calls.log');
    const lib = path.join(root, 'lib');
    writeFileSync(
      path.join(bin, 'systemd-analyze'),
      `#!/bin/bash\necho "systemd-analyze $1" >> "${log}"\n[ -x "${lib}/backup.sh" ] || { echo "Command ${lib}/backup.sh is not executable: No such file or directory" >&2; exit 1; }\n`,
      { mode: 0o755 },
    );
    writeFileSync(path.join(bin, 'systemctl'), `#!/bin/bash\necho "systemctl $*" >> "${log}"\n[ "$1" = is-enabled ] && exit 1\nexit 0\n`, { mode: 0o755 });
    const body = [
      `JOB_LIB="${lib}"`,
      'code_git() { echo fixture-sha; }',
      'unit_text() { echo "# $2 at $1"; }',
      // Writes only the backup script, under the test folder; a unit is logged, not written.
      `install_file() { cat > /dev/null; echo "install $1" >> "${log}"; if [ "$1" = "$JOB_LIB/backup.sh" ]; then mkdir -p "$JOB_LIB"; printf '#!/bin/sh\\n' > "$1"; chmod 0755 "$1"; fi; WROTE=1; }`,
      'install_units',
    ].join('\n');
    const run = callFunction('provision.sh', 'PROVISION_SOURCE_ONLY', body, { PATH: `${bin}:${process.env.PATH}` });
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    const script = calls.indexOf(`install ${lib}/backup.sh`);
    const verify = calls.indexOf('systemd-analyze verify');
    assert.ok(script >= 0 && verify > script, calls.join('\n'));
    assert.ok(calls.includes('systemctl enable dispatcher'), calls.join('\n'));
    assert.equal(calls.filter((call) => call.startsWith('install /etc/systemd/system/')).length, listed('provision.sh', 'UNITS').length);
  });

  test('each job runs as a oneshot, only once its env file exists, and tells the board when it fails', () => {
    for (const job of ['backup', 'controller', 'quota']) {
      const unit = read(`platform/ops/peanutgallery-${job}.service`);
      assert.match(unit, /^Type=oneshot$/m, job);
      assert.match(unit, new RegExp(`^ConditionPathExists=/etc/peanutgallery/${job}\\.env$`, 'm'), job);
      assert.match(unit, /^OnFailure=peanutgallery-job-alert@%n\.service$/m, job);
      assert.doesNotMatch(unit, /^EnvironmentFile=/m, job);
      const timer = read(`platform/ops/peanutgallery-${job}.timer`);
      assert.match(timer, /^OnCalendar=\*-\*-\* \d{2}:\d{2}:00 UTC$/m, job);
      assert.match(timer, /^Persistent=true$/m, job);
      assert.match(timer, /^WantedBy=timers\.target$/m, job);
    }
    assert.match(read('platform/ops/peanutgallery-backup.service'), /^ExecStart=\/usr\/local\/lib\/peanutgallery\/backup\.sh$/m);
    const alert = read('platform/ops/peanutgallery-job-alert@.service');
    assert.match(alert, /f=\/etc\/peanutgallery\/ntfy\.url; \[ -s "\$\$f" \] \|\| exit 0/);
  });

  test('the Controller and the quota check run from the read-only code clone, as nobody, with their own env file and nothing else', () => {
    for (const job of ['controller', 'quota']) {
      const unit = read(`platform/ops/peanutgallery-${job}.service`);
      for (const flag of [
        '--pull never',
        `--env-file /etc/peanutgallery/${job}.env`,
        '--user 65534:65534',
        '--read-only',
        '--cap-drop ALL',
        '--security-opt no-new-privileges',
        '--volume /srv/peanutgallery-code:/opt/peanutgallery:ro',
        '--entrypoint node',
        'peanutgallery/dispatcher:current',
        `/opt/peanutgallery/platform/ops/jobs/main.mjs ${job}`,
      ]) {
        assert.ok(unit.includes(flag), `${job}: ${flag}`);
      }
      const mounts = [...unit.matchAll(/--volume (\S+)/g)].map((match) => match[1]);
      assert.deepEqual(mounts, ['/srv/peanutgallery-code:/opt/peanutgallery:ro'], job);
      assert.doesNotMatch(unit, /dispatcher\.env|\/srv\/peanutgallery:|worktrees/, job);
    }
  });

  test('provision.sh checks each job env file in the image, as nobody, with no network, from stdin', () => {
    const text = logicalLinesOf(read('platform/ops/provision.sh'));
    const check = /docker run --rm -i --pull never --network none --user 65534:65534[^\n]*check-env\.mjs" "\$job" \/dev\/stdin < "\$file"/.exec(text)?.[0];
    assert.ok(check, 'the job env check runs in a container');
    assert.match(check, /--cap-drop ALL/);
    assert.match(check, /--volume "\$CODE_DIR:\$CODE_MOUNT:ro"/);
    assert.match(text, /\[ "\$\(stat -c '%U:%G %a' "\$file"\)" = "root:root 600" \] \|\| die/);
    assert.match(text, /if check_job_env "\$job" && ! systemctl is-enabled --quiet "\$timer"; then\n {6}systemctl enable --now "\$timer"/);
  });

  test("the dispatcher's env file may hold none of the jobs' secrets", () => {
    for (const key of ['STRIPE_READ_KEY', 'BACKUP_DB_URL', 'SUPABASE_DB_PASSWORD']) assert.ok(FORBIDDEN_KEYS.includes(key), key);
    const made = makeEnv();
    const file = path.join(scratch, `with-read-key-${runs++}.env`);
    writeFileSync(file, `${readFileSync(made.out, 'utf8')}STRIPE_READ_KEY=rk_live_fixture\n`);
    const check = callFunction('provision.sh', 'PROVISION_SOURCE_ONLY', 'check_env_lines "$ENV_TO_CHECK"', { ENV_TO_CHECK: file });
    assert.equal(check.status, 1);
    assert.match(check.stdout, /STRIPE_READ_KEY must not be in the dispatcher's env file/);
    for (const secret of ['sk_live_fixture', 'sk_test_fixture']) {
      const renamed = path.join(scratch, `with-secret-${runs++}.env`);
      writeFileSync(renamed, `${readFileSync(made.out, 'utf8')}SOME_OTHER_NAME=${secret}\n`);
      const refused = callFunction('provision.sh', 'PROVISION_SOURCE_ONLY', 'check_env_lines "$ENV_TO_CHECK"', { ENV_TO_CHECK: renamed });
      assert.equal(refused.status, 1, secret);
      assert.match(refused.stdout, /SOME_OTHER_NAME holds a Stripe secret key; nothing on the VPS may hold one, under any name/);
      assert.ok(!refused.stdout.includes(secret));
    }
  });
});

function logicalLinesOf(text) {
  return text
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

describe('make-jobs-env.sh', () => {
  const AGE = `age1${'q'.repeat(58)}`;
  const DOTENV = {
    GITHUB_REPO: 'AlreadyKyle/peanutgallery',
    SUPABASE_URL: 'https://fixture.supabase.local',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role-key',
    SUPABASE_SECRET_KEY: 'sb_secret_fixture',
    STRIPE_SECRET_KEY: 'fixture-stripe-key',
    STRIPE_READ_KEY: 'rk_live_fixture',
    ANTHROPIC_API_KEY: 'fixture-founder-key',
    BACKUP_DB_URL: 'postgresql://peanutgallery_backup.fixtureref:fixture-password@aws-0-ca-central-1.pooler.supabase.com:5432/postgres',
    BACKUP_AGE_RECIPIENT: AGE,
    BACKUP_PAR_URL: 'https://objectstorage.ca-toronto-1.oraclecloud.com/p/fixture-par/n/fixturens/b/peanutgallery-backups/o/',
    BACKUP_BUCKET: 'peanutgallery-backups',
  };
  const JOB_OPERATOR = {
    NTFY_TOPIC_URL: 'https://ntfy.sh/fixture-topic',
    BACKUP_HEALTHCHECK_URL: 'https://hc-ping.com/fixture-backup',
    VPS_GITHUB_TOKEN: 'github_pat_-fixture-vps',
  };
  const makeJobs = (dotenv = DOTENV, operator = JOB_OPERATOR, args = []) => {
    runs += 1;
    const dotenvFile = path.join(scratch, `jobs-${runs}.env`);
    writeFileSync(dotenvFile, Object.entries(dotenv).map(([key, value]) => `${key}=${value}`).join('\n'));
    const tmp = mkdtempSync(path.join(scratch, 'jobs-tmp-'));
    const result = spawnSync('bash', [path.join(OPS_DIR, 'make-jobs-env.sh'), ...args], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmp, DOTENV: dotenvFile, ...operator },
      encoding: 'utf8',
    });
    const dir = readdirSync(tmp).map((name) => path.join(tmp, name))[0] ?? null;
    const files = dir ? Object.fromEntries(readdirSync(dir).map((name) => [name, parseEnvFile(readFileSync(path.join(dir, name), 'utf8'))])) : {};
    return { ...result, dir, files, output: `${result.stdout}${result.stderr}` };
  };

  test("writes each job's env file with its own keys only, at mode 0600, printing no value", () => {
    const run = makeJobs();
    assert.equal(run.status, 0, run.output);
    assert.deepEqual(run.files['backup.env'], [
      ['BACKUP_DB_URL', DOTENV.BACKUP_DB_URL],
      ['BACKUP_AGE_RECIPIENT', AGE],
      ['BACKUP_PAR_URL', DOTENV.BACKUP_PAR_URL],
      ['BACKUP_BUCKET', 'peanutgallery-backups'],
      ['BACKUP_HEALTHCHECK_URL', 'https://hc-ping.com/fixture-backup'],
    ]);
    assert.deepEqual(run.files['controller.env'], [
      ['SUPABASE_URL', 'https://fixture.supabase.local'],
      ['SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_fixture'],
      ['STRIPE_READ_KEY', 'rk_live_fixture'],
      ['NTFY_TOPIC_URL', 'https://ntfy.sh/fixture-topic'],
    ]);
    assert.deepEqual(run.files['quota.env'], [
      ['SUPABASE_URL', 'https://fixture.supabase.local'],
      ['SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_fixture'],
      ['GITHUB_BILLING_TOKEN', 'github_pat_-fixture-vps'],
      ['GITHUB_BILLING_USER', 'AlreadyKyle'],
      ['NTFY_TOPIC_URL', 'https://ntfy.sh/fixture-topic'],
    ]);
    for (const name of Object.keys(run.files)) assert.equal(statSync(path.join(run.dir, name)).mode & 0o777, 0o600, name);
    for (const value of [...Object.values(DOTENV), ...Object.values(JOB_OPERATOR)].filter((value) => /fixture/.test(value))) {
      assert.ok(!run.output.includes(value), 'the output names keys only');
    }
    // Every file it writes passes the check provision.sh runs on the VPS.
    for (const job of ['backup', 'controller', 'quota']) {
      const check = spawnSync(process.execPath, [path.join(OPS_DIR, 'jobs', 'check-env.mjs'), job, path.join(run.dir, `${job}.env`)], { encoding: 'utf8' });
      assert.equal(check.status, 0, `${job}: ${check.stdout}`);
      assert.equal(check.stdout, 'valid\n');
    }
  });

  test('refuses a job whose keys are not all set, names it, and still writes the others', () => {
    const { STRIPE_READ_KEY: _unused, ...withoutReadKey } = DOTENV;
    const run = makeJobs(withoutReadKey);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /controller\.env not written:\n {2}- STRIPE_READ_KEY is missing or empty/);
    assert.deepEqual(Object.keys(run.files).sort(), ['backup.env', 'quota.env']);
  });

  test('refuses a Stripe secret key as the read key, and writes nothing when every job asked for is refused', () => {
    const run = makeJobs({ ...DOTENV, STRIPE_READ_KEY: 'sk_live_fixture' }, JOB_OPERATOR, ['controller']);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /STRIPE_READ_KEY holds a Stripe secret key; no job may hold one, under any name/);
    assert.ok(!run.output.includes('sk_live_fixture'));
    assert.equal(run.dir, null, 'the empty temporary folder is removed');
    assert.equal(makeJobs(DOTENV, JOB_OPERATOR, ['stripe']).status, 2);
  });
});

// backup.sh with every tool it calls replaced by a fake on PATH that records its arguments: supabase
// writes each file it is asked for, age copies its input with a marker, docker answers the restore
// check, curl reads its config file, and date and id answer as the VPS would.
describe('backup.sh', () => {
  // The restore check's query answers "<top-level holds>|<identity json>", as psql -At -F '|' prints it.
  const HOLDING = 'true|{"holds": true, "lines": [{"name": "I1", "drift": 0, "holds": true}, {"name": "I2", "drift": 0, "holds": true}, {"name": "I3", "drift": 0, "holds": true}]}';
  const setup = ({ env = {}, identity = HOLDING, weekday } = {}) => {
    const root = mkdtempSync(path.join(scratch, 'backup-'));
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    const log = path.join(root, 'calls.log');
    const fake = (name, body) => writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    fake('id', 'echo 0');
    fake('stat', 'echo "root:root 600"');
    fake('supabase', `echo "supabase $*" >> "${log}"; while [ $# -gt 0 ]; do if [ "$1" = -f ]; then echo "-- dump of $*" > "$2"; fi; shift; done`);
    fake('age', `echo "age $1 $2 $3 $4 $5" >> "${log}"; { echo AGE-ENCRYPTED; cat "$5"; } > "$4"`);
    fake('curl', `config=""; while [ $# -gt 0 ]; do [ "$1" = -K ] && config="$2"; shift; done; { echo "curl"; cat "$config"; } >> "${log}"; exit \${FAKE_CURL_STATUS:-0}`);
    fake('docker', `echo "docker $*" >> "${log}"; case "$1 $2" in "image ls") echo "public.ecr.aws/supabase/postgres:17.6.1.011";; "exec "*) case "$*" in *ledger_identity*) echo '${identity}';; esac;; esac; exit 0`);
    const today = ((new Date().getUTCDay() + 6) % 7) + 1;
    const envFile = path.join(root, 'backup.env');
    const values = {
      BACKUP_DB_URL: 'postgresql://peanutgallery_backup.fixtureref:fixture-password@aws-0-ca-central-1.pooler.supabase.com:5432/postgres',
      BACKUP_AGE_RECIPIENT: `age1${'q'.repeat(58)}`,
      BACKUP_PAR_URL: 'https://objectstorage.ca-toronto-1.oraclecloud.com/p/fixture-par/n/fixturens/b/peanutgallery-backups/o/',
      BACKUP_BUCKET: 'peanutgallery-backups',
      BACKUP_HEALTHCHECK_URL: 'https://hc-ping.com/fixture-backup',
      RESTORE_CHECK_WEEKDAY: String(weekday ?? (today % 7) + 1),
      ...env,
    };
    writeFileSync(envFile, `${Object.entries(values).filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
    const state = path.join(root, 'state');
    const run = (args = [], extra = {}) => {
      const result = spawnSync('bash', [path.join(OPS_DIR, 'backup', 'backup.sh'), ...args], {
        env: { PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME, BACKUP_ENV_FILE: envFile, BACKUP_STATE_DIR: state, TMPDIR: root, ...extra },
        encoding: 'utf8',
      });
      const calls = existsSync(log) ? readFileSync(log, 'utf8') : '';
      return { ...result, calls, output: `${result.stdout}${result.stderr}`, left: existsSync(state) ? readdirSync(state) : [] };
    };
    return { run };
  };

  test('dumps the six files as the read-only login, encrypts them to the board key, uploads through the request and pings the check', () => {
    const { run } = setup();
    const result = run();
    assert.equal(result.status, 0, result.output);
    const dumps = result.calls.split('\n').filter((line) => line.startsWith('supabase '));
    assert.deepEqual(
      dumps.map((line) => line.replace(/--db-url \S+ -f \S+\//, '')),
      [
        'supabase db dump roles.sql --role-only',
        'supabase db dump schema.sql',
        'supabase db dump data.sql --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes',
        'supabase db dump auth.sql --schema auth --use-copy --data-only',
        'supabase db dump history_schema.sql --schema supabase_migrations',
        'supabase db dump history_data.sql --use-copy --data-only --schema supabase_migrations',
      ],
    );
    for (const line of dumps) assert.match(line, /--db-url postgresql:\/\/peanutgallery_backup\.fixtureref:/);
    assert.match(result.calls, /^age -r age1q{58} -o \S+\/peanutgallery-\d{8}T\d{6}Z\.tar\.age \S+\/peanutgallery-\d{8}T\d{6}Z\.tar$/m);
    assert.match(result.calls, /^url = "https:\/\/objectstorage\.ca-toronto-1\.oraclecloud\.com\/p\/fixture-par\/n\/fixturens\/b\/peanutgallery-backups\/o\/peanutgallery-\d{8}T\d{6}Z\.tar\.age"\nupload-file = /m);
    assert.match(result.calls, /^url = "https:\/\/hc-ping\.com\/fixture-backup"\nrequest = "POST"/m);
    assert.doesNotMatch(result.calls, /\/fail"/);
    assert.doesNotMatch(result.calls, /^docker (run|exec)/m, 'not the restore check day');
    assert.deepEqual(result.left, [], 'nothing, plaintext or encrypted, is left on the host');
    assert.match(result.stdout, /backup: uploaded peanutgallery-\d{8}T\d{6}Z\.tar\.age to peanutgallery-backups/);
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
      assert.doesNotMatch(refused.calls, /^supabase /m);
      assert.ok(!refused.output.includes('fixture-owner'));
    }
    const { run } = setup({ env: { BACKUP_SKIP_AUTH: '1' } });
    const result = run();
    assert.equal(result.status, 0, result.output);
    const dumps = result.calls.split('\n').filter((line) => line.startsWith('supabase '));
    assert.deepEqual(dumps.map((line) => /-f \S+\/(\w+)\.sql/.exec(line)[1]), ['roles', 'schema', 'data', 'history_schema', 'history_data']);
    for (const line of dumps) assert.match(line, /--db-url postgresql:\/\/peanutgallery_backup\.fixtureref:/);
    assert.match(result.stdout, /the auth schema is not dumped \(BACKUP_SKIP_AUTH=1\)/);
    const { run: other } = setup({ env: { BACKUP_SKIP_AUTH: 'yes' } });
    assert.ok(other().stderr.includes('BACKUP_SKIP_AUTH must be 1 or absent'));
  });

  test('on its weekday, restores the plaintext into a scratch container with no network and checks the ledger identity before encrypting', () => {
    const today = ((new Date().getUTCDay() + 6) % 7) + 1;
    const { run } = setup({ weekday: today });
    const result = run();
    assert.equal(result.status, 0, result.output);
    assert.match(result.stdout, /PASS: restore check: the restored copy's ledger identity holds/);
    const docker = result.calls.split('\n').filter((line) => line.startsWith('docker '));
    const started = docker.find((line) => line.startsWith('docker run -d'));
    assert.match(started, /--network none -e POSTGRES_PASSWORD --volume \S+:\/restore:ro public\.ecr\.aws\/supabase\/postgres:17\.6\.1\.011$/);
    assert.ok(docker.some((line) => /psql -h localhost -U supabase_admin -d postgres -q --single-transaction -v ON_ERROR_STOP=1 -f \/restore\/roles\.sql -f \/restore\/schema\.sql -c SET session_replication_role = replica -f \/restore\/data\.sql/.test(line)));
    assert.ok(result.calls.indexOf('select public.ledger_identity()') < result.calls.indexOf('age -r'), 'checked before encrypting');
    assert.ok(!started.includes('fixture-password'));
  });

  // ledger_identity() gives each line its own "holds", so only the top-level field may decide: here I1
  // holds and I2 does not, and the copy must fail.
  test('stops before uploading when the restored copy does not hold, even with lines that do, pings /fail and leaves no plaintext', () => {
    for (const identity of [
      'false|{"holds": false, "lines": [{"name": "I1", "drift": 0, "holds": true}, {"name": "I2", "drift": 1, "holds": false}, {"name": "I3", "drift": 0, "holds": true}]}',
      '',
    ]) {
      const { run } = setup({ identity });
      const result = run(['--restore-check']);
      assert.equal(result.status, 1, result.output);
      assert.match(result.stdout, /FAIL: restore check/);
      assert.doesNotMatch(result.stdout, /PASS/);
      assert.match(result.stderr, /the restore check failed; nothing was uploaded/);
      assert.doesNotMatch(result.calls, /objectstorage/);
      assert.match(result.calls, /^url = "https:\/\/hc-ping\.com\/fixture-backup\/fail"/m);
      assert.deepEqual(result.left, []);
    }
    assert.match(read('platform/ops/backup/backup.sh'), /-c "select i->>'holds', i::text from \(select public\.ledger_identity\(\) as i\) s"/);
    assert.match(read('platform/ops/README.md'), /select public\.ledger_identity\(\)->>'holds'"` must print exactly `true`/);
  });

  // A write-only request can still write to a name that exists, and backup names are predictable, so
  // the bucket keeps versions: a replaced backup stays as a previous version.
  test('the runbook makes the bucket versioned and restores from the oldest version of a name', () => {
    const readme = read('platform/ops/README.md');
    assert.match(readme, /oci os bucket create [^`]*--name peanutgallery-backups --public-access-type NoPublicAccess --versioning Enabled`/);
    assert.match(readme, /oci os bucket update [^`]*--bucket-name peanutgallery-backups --versioning Enabled`/);
    assert.match(readme, /oci os object list-object-versions /);
    assert.match(readme, /--version-id <version>/);
    assert.doesNotMatch(readme, /cannot read, list or delete any\.(?! It can write to a name that already exists)/);
    assert.match(read('platform/ops/backup/backup.sh'), /the bucket keeps object versions/);
  });

  test('pings /fail when the upload fails', () => {
    const { run } = setup();
    const result = run([], { FAKE_CURL_STATUS: '22' });
    assert.equal(result.status, 22);
    assert.match(result.calls, /\/fail"/);
    assert.deepEqual(result.left, []);
  });

  test('refuses a Stripe secret key under any name, a login other than the backup one and a request for another bucket', () => {
    for (const [env, message] of [
      [{ OTHER_KEY: 'sk_live_fixture' }, 'OTHER_KEY holds a Stripe secret key; no job may hold one, under any name'],
      [{ BACKUP_DB_URL: 'postgresql://postgres.fixtureref:owner@aws-0-ca-central-1.pooler.supabase.com:5432/postgres' }, 'BACKUP_DB_URL must sign in as peanutgallery_backup.<project ref>'],
      [{ BACKUP_BUCKET: 'another-bucket' }, 'BACKUP_PAR_URL must be a pre-authenticated request for BACKUP_BUCKET'],
      [{ BACKUP_AGE_RECIPIENT: null }, 'BACKUP_AGE_RECIPIENT is missing or empty'],
    ]) {
      const { run } = setup({ env });
      const result = run();
      assert.equal(result.status, 1, message);
      assert.ok(result.stderr.includes(message), `${message}\n${result.output}`);
      assert.doesNotMatch(result.calls, /^supabase /m);
      assert.ok(!result.output.includes('sk_live_fixture') && !result.output.includes('fixture-password'));
    }
  });
});

describe('the Oracle instance', () => {
  test('asks for no more than the Always Free Ampere allowance, 2 OCPUs and 12 GB', () => {
    const script = read('platform/ops/oracle-launch.sh');
    const shape = JSON.parse(/^SHAPE_CONFIG='([^']+)'$/m.exec(script)?.[1] ?? 'null');
    assert.ok(shape.ocpus <= 2 && shape.memoryInGBs <= 12, JSON.stringify(shape));
    assert.deepEqual(shape, { ocpus: 2, memoryInGBs: 12 });
    // The dispatcher container's memory cap fits inside it.
    assert.match(read('platform/ops/dispatcher.service'), /--memory 3g/);
    for (const doc of ['platform/ops/README.md', 'docs/specs/vps.md', 'docs/specs/oracle-launch.md', 'platform/ops/oracle-launch.sh']) {
      assert.doesNotMatch(read(doc), /\b4 OCPUs|\b24 GB|\b4 cores|\b4 arm64 cores/, doc);
    }
  });

  test('retries a start that finds no capacity the same way the launch does', () => {
    const script = read('platform/ops/oracle-launch.sh');
    assert.match(script, /until out=\$\(oci_ compute instance action --instance-id "\$INSTANCE" --action START --wait-for-state RUNNING 2>&1\); do\n {6}if ! is_capacity_error "\$out"; then die "start failed: \$out"; fi/);
    assert.match(script, /if ! is_capacity_error "\$out"; then die "launch failed: \$out"; fi/);
  });

  test('the runbook says how to start a stopped instance from a phone, without the laptop', () => {
    const readme = read('platform/ops/README.md');
    assert.match(readme, /cloud\.oracle\.com/);
    assert.match(readme, /Compute, Instances, `peanutgallery-dispatcher`, Start/);
    assert.doesNotMatch(readme, /Pay As You Go ends reclaims/);
  });
});

describe('the backups repository template', () => {
  test('lives outside .github, needs no token, uses only its own secrets and checks the CLI it installs', () => {
    const workflow = read('platform/ops/backups-repo/workflows/backup.yml');
    assert.match(workflow, /^permissions: \{\}$/m);
    assert.deepEqual([...new Set([...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map((match) => match[1]))].sort(), ['BACKUP_DB_URL', 'BACKUP_PAR_URL']);
    // Every dump signs in as the backup login; the owner's password is never a secret there.
    assert.equal([...workflow.matchAll(/supabase db dump --db-url "\$BACKUP_DB_URL"/g)].length, 6);
    assert.doesNotMatch(workflow, /OWNER|postgres\./);
    assert.match(workflow, /sha256sum -c -/);
    assert.match(workflow, /^ {4}- cron: '\d+ \d+ \* \* \d'$/m);
    assert.doesNotMatch(workflow, /uses: /, 'no third-party action');
    assert.doesNotMatch(workflow, /pull_request/);
    const workflows = readdirSync(path.join(REPO_ROOT, '.github', 'workflows'));
    assert.ok(!workflows.includes('backup.yml'), 'the template is not a workflow of this repository');
    assert.match(read('platform/ops/backups-repo/README.md'), /never in the studio repository/);
  });
});
