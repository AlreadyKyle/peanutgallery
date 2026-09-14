import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USAGE } from '../bots/args';
import { loadConfigFromDir } from '../bots/config';
import { CONFIG_INVARIANT, RUN_INVARIANT, failureReport, formatReport, isFilesystemError, resolveConfigDir, runBot } from '../bots/report';
import { FIXTURE_CONFIG_DIR, PACKAGE_DIR } from './paths';

const REPORT_KEYS = ['ok', 'simulatedSeconds', 'invariants', 'unlocks', 'finalTotalDust', 'stateHash'];
const testsDir = join(PACKAGE_DIR, 'tests');
const tsxCli = createRequire(join(PACKAGE_DIR, 'package.json')).resolve('tsx/cli');

function runCli(args: string[], initCwd: string = PACKAGE_DIR) {
  const result = spawnSync(process.execPath, [tsxCli, 'bots/cli.ts', ...args], {
    cwd: PACKAGE_DIR,
    encoding: 'utf8',
    env: { ...process.env, INIT_CWD: initCwd },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('report module', () => {
  const config = loadConfigFromDir(FIXTURE_CONFIG_DIR);

  it('resolves a relative config directory against the given base', () => {
    expect(resolveConfigDir('fixtures/config', testsDir)).toBe(FIXTURE_CONFIG_DIR);
    expect(resolveConfigDir(FIXTURE_CONFIG_DIR, testsDir)).toBe(FIXTURE_CONFIG_DIR);
  });

  it('runs the bot and reports the documented shape', () => {
    const report = runBot(config, { configDir: FIXTURE_CONFIG_DIR, hours: 1, seed: 20260914, realSeconds: null, json: true });
    expect(Object.keys(report)).toEqual(REPORT_KEYS);
    expect(report.ok).toBe(true);
    expect(report.simulatedSeconds).toBe(3600);
    expect(report.invariants.map((result) => result.name)).toEqual([
      'no-negative-resource',
      'finite-state',
      'unlock-every-hour',
      'deterministic-hash',
    ]);
    expect(report.unlocks[0]).toEqual({ id: 'cart', atSeconds: 67 });
    expect(report.stateHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('formats a passing report with a PASS first line', () => {
    const report = runBot(config, { configDir: FIXTURE_CONFIG_DIR, hours: 1, seed: 20260914, realSeconds: null, json: false });
    const lines = formatReport(report).split('\n');
    expect(lines[0]).toBe('PASS: 4 of 4 invariants hold over 3600 simulated seconds');
    expect(lines[1]).toBe('ok   no-negative-resource: dust never fell below zero (minimum 0)');
    expect(lines).toContain('unlock cart at 67 s');
    expect(lines.at(-1)).toBe(`state hash ${report.stateHash}`);
  });

  it('shapes a config failure like a failed run', () => {
    const report = failureReport(CONFIG_INVARIANT, 'unlocks: "unlocks" must be a non-empty array');
    expect(Object.keys(report)).toEqual(REPORT_KEYS);
    expect(report.ok).toBe(false);
    expect(report.invariants).toEqual([{ name: CONFIG_INVARIANT, ok: false, detail: 'unlocks: "unlocks" must be a non-empty array' }]);
    expect(formatReport(report).split('\n')[0]).toBe('FAIL: 0 of 1 invariants hold over 0 simulated seconds');
  });

  it('names a run failure separately from a config failure', () => {
    const report = failureReport(RUN_INVARIANT, 'Unknown unit "kiln"');
    expect(RUN_INVARIANT).not.toBe(CONFIG_INVARIANT);
    expect(report.invariants).toEqual([{ name: 'bot-run', ok: false, detail: 'Unknown unit "kiln"' }]);
    expect(formatReport(report).split('\n')[1]).toBe('fail bot-run: Unknown unit "kiln"');
  });

  it('tells a file error from a parse error by its code', () => {
    expect(isFilesystemError(Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }))).toBe(true);
    expect(isFilesystemError(new SyntaxError('Unexpected end of JSON input'))).toBe(false);
    expect(isFilesystemError(new Error('unlocks: must be an object'))).toBe(false);
    expect(isFilesystemError('ENOENT')).toBe(false);
  });
});

describe('bot command line', () => {
  let brokenDir = '';

  beforeAll(() => {
    brokenDir = mkdtempSync(join(tmpdir(), 'seed-1-broken-config-'));
    writeFileSync(join(brokenDir, 'spawn-table.json'), readFileSync(join(FIXTURE_CONFIG_DIR, 'spawn-table.json')));
    writeFileSync(join(brokenDir, 'unlocks.json'), '{"unlocks":[]}\n');
  });

  afterAll(() => {
    rmSync(brokenDir, { recursive: true, force: true });
  });

  it('exits 0 with the documented JSON keys for the fixture config', () => {
    const run = runCli(['--config-dir', FIXTURE_CONFIG_DIR, '--hours', '1', '--seed', '20260914', '--json']);
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    const report = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(Object.keys(report)).toEqual(REPORT_KEYS);
    expect(report['ok']).toBe(true);
    expect(report['simulatedSeconds']).toBe(3600);
  });

  it('prints a PASS first line without --json', () => {
    const run = runCli(['--config-dir', FIXTURE_CONFIG_DIR, '--hours', '1', '--seed', '20260914']);
    expect(run.status).toBe(0);
    expect(run.stdout.split('\n')[0]).toMatch(/^PASS: /);
  });

  it('resolves --config-dir against INIT_CWD', () => {
    const run = runCli(['--config-dir', 'fixtures/config', '--hours', '0.1', '--seed', '1', '--json'], testsDir);
    expect(run.status).toBe(0);
    expect((JSON.parse(run.stdout) as { simulatedSeconds: number }).simulatedSeconds).toBe(360);
  });

  it('exits 2 with the usage line when no arguments are given', () => {
    const run = runCli([]);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('--config-dir is required');
    expect(run.stderr.trim().endsWith(USAGE)).toBe(true);
  });

  it('exits 2 with the usage line when the config directory does not exist', () => {
    const missing = join(brokenDir, 'missing');
    const run = runCli(['--config-dir', missing, '--hours', '1', '--seed', '1']);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain(missing);
    expect(run.stderr.trim().endsWith(USAGE)).toBe(true);
  });

  it('exits 1 with a FAIL report when a config file does not validate', () => {
    const text = runCli(['--config-dir', brokenDir, '--hours', '1', '--seed', '1']);
    expect(text.status).toBe(1);
    expect(text.stderr).toBe('');
    expect(text.stdout.split('\n')[0]).toBe('FAIL: 0 of 1 invariants hold over 0 simulated seconds');
    expect(text.stdout).toContain('non-empty array');

    const json = runCli(['--config-dir', brokenDir, '--hours', '1', '--seed', '1', '--json']);
    expect(json.status).toBe(1);
    const report = JSON.parse(json.stdout) as { ok: boolean; invariants: { name: string; ok: boolean }[] };
    expect(report.ok).toBe(false);
    expect(report.invariants).toHaveLength(1);
    expect(report.invariants[0]?.name).toBe(CONFIG_INVARIANT);
  });
});
