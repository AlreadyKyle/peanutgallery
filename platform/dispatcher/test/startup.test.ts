import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { DispatcherConfig } from '../src/config.js';
import { StartupError, exitCodeFor } from '../src/exit-code.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable, priceUsage, type TurnUsage } from '../src/pricing.js';
import type { ProbeOptions, ProbeResult } from '../src/probe-core.js';
import { checkMode, startupChecks, startupProbe, type StartupDeps } from '../src/startup.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { FakeDb } from './helpers/fake-db.js';

const PRICE_TABLE = parsePriceTable(JSON.stringify({ 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } }));
const silent = createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() }));
const USAGE: TurnUsage = { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 200 };
const ZERO: TurnUsage = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };

const config: DispatcherConfig = {
  repoRoot: '/repo',
  agentMode: 'unattended',
  supabaseUrl: 'https://db.local',
  supabaseServiceRoleKey: 'service-role',
  githubToken: 'github-token',
  githubRepo: 'owner/repo',
  netlifyAuthToken: 'netlify-token',
  netlifySiteIdSeed: 'site-seed',
  netlifySiteIdPlatform: 'site-platform',
  modelBuilder: 'builder-class',
  priceTable: PRICE_TABLE,
  poolDailyCapUsd: 100,
  cardMaxUsd: 25,
  sessionMaxTurns: 60,
  agentHourlyRateUsd: 5,
  tickMs: 60_000,
  worktreeRoot: '/repo/.worktrees',
  maxConcurrency: 1,
  schedulerEnabled: true,
  claudeBin: 'claude',
  boardSessionTtlMin: 3,
  studioAnthropicApiKey: 'studio-key',
  healthcheckUrl: null,
  ntfyTopicUrl: null,
};

function probeResult(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    ok: true,
    reason: null,
    fatal: false,
    tools: ['Glob', 'Grep', 'Read'],
    apiKeySource: 'ANTHROPIC_API_KEY',
    model: 'builder-class',
    costUsd: 0.006,
    usage: USAGE,
    turns: 1,
    exitCode: 0,
    ...overrides,
  };
}

// A probe runner that never touches git or claude: it records its calls and returns the result.
function fakeRunner(result: ProbeResult) {
  const calls: ProbeOptions[] = [];
  const runProbe = async (_adapter: unknown, options: ProbeOptions) => {
    calls.push(options);
    return result;
  };
  return { calls, runProbe };
}

function unattendedDb(): FakeDb {
  const db = new FakeDb();
  db.studio.agent_mode = 'unattended';
  return db;
}

function deps(db: FakeDb, result: ProbeResult, overrides: Partial<StartupDeps> = {}) {
  const runner = fakeRunner(result);
  const adapter = new FakeAdapter(async () => {}, { mode: config.agentMode });
  const built: StartupDeps = { db, adapter, config, log: silent, runProbe: runner.runProbe, ...overrides };
  return { deps: built, calls: runner.calls };
}

describe('checkMode', () => {
  it('rejects when studio_state.agent_mode differs from AGENT_MODE', async () => {
    const db = new FakeDb();
    await expect(checkMode(db, config)).rejects.toThrow(
      'studio_state.agent_mode is attended but AGENT_MODE is unattended; set the mode from /board or start the dispatcher in the matching mode',
    );
    db.studio.agent_mode = '';
    await expect(checkMode(db, config)).rejects.toThrow('studio_state.agent_mode is unset but AGENT_MODE is unattended');
  });

  it('is a startup error that exits 1, so the process retries once the board fixes the mode', async () => {
    const error = await checkMode(new FakeDb(), config).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StartupError);
    expect(exitCodeFor(error)).toBe(1);
  });

  it('resolves when the modes agree', async () => {
    await expect(checkMode(unattendedDb(), config)).resolves.toBeUndefined();
  });
});

describe('startupChecks', () => {
  it('checks the mode before any probe call, so a mismatched process runs no probe', async () => {
    const db = new FakeDb();
    const { deps: startup, calls } = deps(db, probeResult());
    await expect(startupChecks(startup)).rejects.toThrow('studio_state.agent_mode is attended but AGENT_MODE is unattended');
    expect(calls).toHaveLength(0);
    expect(db.ledger).toHaveLength(0);
  });

  it('runs the probe in unattended mode with the configured repo, worktree root and model', async () => {
    const db = unattendedDb();
    const { deps: startup, calls } = deps(db, probeResult());
    await startupChecks(startup);
    expect(calls).toEqual([{ repoRoot: '/repo', worktreeRoot: '/repo/.worktrees', model: 'builder-class' }]);
  });

  it('runs no probe in attended mode', async () => {
    const db = new FakeDb();
    const { deps: startup, calls } = deps(db, probeResult(), { config: { ...config, agentMode: 'attended', studioAnthropicApiKey: null } });
    await startupChecks(startup);
    expect(calls).toHaveLength(0);
    expect(db.ledger).toHaveLength(0);
  });
});

describe('startupProbe metering', () => {
  it('writes one ledger row with no card and no role, priced at list price', async () => {
    const db = unattendedDb();
    await startupProbe(deps(db, probeResult()).deps);
    const priced = priceUsage(PRICE_TABLE, 'builder-class', USAGE);
    expect(db.ledger).toEqual([{ id: 'ledger-1', billed_to: 'studio', card_id: null, role_id: null, ...priced }]);
    expect(db.ledger[0]!.usd).toBe(0.006);
  });

  it('writes the ledger row for a failing probe and then rejects', async () => {
    const db = unattendedDb();
    const failing = probeResult({ ok: false, fatal: true, reason: 'apiKeySource is none; unattended mode bills ANTHROPIC_API_KEY and nothing else', apiKeySource: 'none' });
    await expect(startupProbe(deps(db, failing).deps)).rejects.toThrow(
      'startup probe failed: apiKeySource is none; unattended mode bills ANTHROPIC_API_KEY and nothing else',
    );
    expect(db.ledger).toHaveLength(1);
    expect(db.ledger[0]).toMatchObject({ card_id: null, role_id: null, usd: priceUsage(PRICE_TABLE, 'builder-class', USAGE).usd });
  });

  it('exits 78 for a probe failure that cannot change on retry and 1 for one that can', async () => {
    const wrongAccount = probeResult({ ok: false, fatal: true, reason: 'apiKeySource is none; unattended mode bills ANTHROPIC_API_KEY and nothing else', apiKeySource: 'none' });
    const fatalError = await startupProbe(deps(unattendedDb(), wrongAccount).deps).catch((caught: unknown) => caught);
    expect(fatalError).toEqual(new StartupError('startup probe failed: apiKeySource is none; unattended mode bills ANTHROPIC_API_KEY and nothing else', true));
    expect(exitCodeFor(fatalError)).toBe(78);

    const noStream = probeResult({ ok: false, fatal: false, reason: 'claude produced no stream output', usage: ZERO });
    const transientError = await startupProbe(deps(unattendedDb(), noStream).deps).catch((caught: unknown) => caught);
    expect(transientError).toEqual(new StartupError('startup probe failed: claude produced no stream output', false));
    expect(exitCodeFor(transientError)).toBe(1);
  });

  it('exits 1 when claude cannot be spawned', async () => {
    const db = unattendedDb();
    const failingRunner = async () => {
      throw new Error('claude could not start: spawn claude ENOENT');
    };
    const error = await startupChecks(deps(db, probeResult(), { runProbe: failingRunner }).deps).catch((caught: unknown) => caught);
    expect(error).toEqual(new Error('claude could not start: spawn claude ENOENT'));
    expect(exitCodeFor(error)).toBe(1);
    expect(db.ledger).toHaveLength(0);
  });

  it('writes no ledger row when the probe reported no usage', async () => {
    const db = unattendedDb();
    await startupProbe(deps(db, probeResult({ usage: ZERO })).deps);
    expect(db.ledger).toHaveLength(0);
  });

  it('refuses an unknown model the way a card turn does: no ledger row at zero, and it stops', async () => {
    const db = unattendedDb();
    const error = await startupProbe(deps(db, probeResult({ model: 'mystery-model' })).deps).catch((caught: unknown) => caught);
    expect(error).toEqual(new StartupError('no price for model mystery-model', true));
    // The model is missing from the price table on every start, and every start spends on a probe.
    expect(exitCodeFor(error)).toBe(78);
    expect(db.ledger).toHaveLength(0);
    expect(db.pool.balance_usd).toBe(50);
  });
});
