// Tests for the VPS ops files (docs/specs/vps.md): the env file transform end to end through
// make-dispatcher-env.sh, provision.sh's env file checks against its output, deploy.sh's refusal
// rule, bash -n and shellcheck on every script, and the values that must agree across files.
// Run from the repository root: node --test platform/ops/test/ops.test.mjs
// Every value in the fixtures is made up; none has the shape of a real credential.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
    assert.match(dockerfile, /pnpm_config_store_dir=\/srv\/peanutgallery\/\.pnpm-store/);
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
    for (const flag of ['--env-file /etc/peanutgallery/dispatcher.env', '--user 10001:10001', '--volume /srv/peanutgallery:/srv/peanutgallery', '--cap-drop ALL', '--pull never']) {
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
