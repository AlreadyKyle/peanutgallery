import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { DispatcherConfig } from '../src/config.js';
import { StartupError, exitCodeFor } from '../src/exit-code.js';
import { createLogger } from '../src/log.js';
import type { MeterRow } from '../src/metering.js';
import { parsePriceTable, priceUsage, type TurnUsage } from '../src/pricing.js';
import type { ProbeOptions, ProbeResult } from '../src/probe-core.js';
import { FallbackPricedError, UnwrittenRowsError, checkMode, checkRoleModels, meterProbe, startupChecks, startupProbe, type StartupDeps } from '../src/startup.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { FakeDb, role } from './helpers/fake-db.js';

const PRICE_TABLE = parsePriceTable(JSON.stringify({ 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } }));
const silent = createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() }));
const USAGE: TurnUsage = { input_tokens: 1000, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 200 };
const ROW: MeterRow = { ...priceUsage(PRICE_TABLE, 'builder-class', USAGE), request_id: 'probe/test/turn/1' };
const NO_ROWS = { rows: [], basis: 'estimate' as const, fallbackModels: [], turnModels: [], overcountUsd: 0, mismatch: false, anomaly: false, zeroedFields: [] };
// The settle row for output the turn did not report.
const SETTLE_ROW: MeterRow = { model: 'builder-class', input_tokens: 0, cached_tokens: 0, output_tokens: 40, usd: 0.0006, request_id: 'probe/test/settle/1' };

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
  modelDirector: null,
  modelHost: null,
  priceTable: PRICE_TABLE,
  poolDailyCapUsd: 100,
  cardMaxUsd: 25,
  sessionMaxTurns: 60,
  sessionMaxMinutes: 60,
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
    costUsd: 0.009,
    metering: { rows: [ROW, SETTLE_ROW], basis: 'result', fallbackModels: [], turnModels: ['builder-class'], overcountUsd: 0, mismatch: false, anomaly: false, zeroedFields: [] },
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
    expect(calls).toEqual([{ repoRoot: '/repo', worktreeRoot: '/repo/.worktrees', model: 'builder-class', priceTable: PRICE_TABLE }]);
  });

  it('checks the role models before the probe, in either mode', async () => {
    for (const agentMode of ['attended', 'unattended'] as const) {
      const db = new FakeDb();
      db.studio.agent_mode = agentMode;
      db.roles = [role({ model: 'mystery-model' })];
      const { deps: startup, calls } = deps(db, probeResult(), { config: { ...config, agentMode } });
      await expect(startupChecks(startup)).rejects.toThrow('no price in PRICE_TABLE_JSON for Builder A (mystery-model)');
      expect(calls).toHaveLength(0);
    }
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
  it('writes the turn row and the settle row with no card and no role, priced at list price', async () => {
    const db = unattendedDb();
    await startupProbe(deps(db, probeResult()).deps);
    expect(db.ledger).toEqual([
      { id: 'ledger-1', billed_to: 'studio', card_id: null, role_id: null, ...ROW },
      { id: 'ledger-2', billed_to: 'studio', card_id: null, role_id: null, ...SETTLE_ROW },
    ]);
    expect(db.ledger[0]!.usd).toBe(0.006);
    expect(db.pool.balance_usd).toBe(49.9934);
  });

  it('writes the ledger row for a failing probe and then rejects', async () => {
    const db = unattendedDb();
    const failing = probeResult({ ok: false, fatal: true, reason: 'apiKeySource is none; unattended mode bills ANTHROPIC_API_KEY and nothing else', apiKeySource: 'none' });
    await expect(startupProbe(deps(db, failing).deps)).rejects.toThrow(
      'startup probe failed: apiKeySource is none; unattended mode bills ANTHROPIC_API_KEY and nothing else',
    );
    // The probe ran on another account, so its spend is the founder's and the pool keeps its money.
    expect(db.ledger).toHaveLength(2);
    expect(db.ledger[0]).toMatchObject({ billed_to: 'founder', card_id: null, role_id: null, usd: ROW.usd });
    expect(db.pool.balance_usd).toBe(50);
  });

  it('exits 78 for a probe failure that cannot change on retry and 1 for one that can', async () => {
    const wrongAccount = probeResult({ ok: false, fatal: true, reason: 'apiKeySource is none; unattended mode bills ANTHROPIC_API_KEY and nothing else', apiKeySource: 'none' });
    const fatalError = await startupProbe(deps(unattendedDb(), wrongAccount).deps).catch((caught: unknown) => caught);
    expect(fatalError).toEqual(new StartupError('startup probe failed: apiKeySource is none; unattended mode bills ANTHROPIC_API_KEY and nothing else', true));
    expect(exitCodeFor(fatalError)).toBe(78);

    const noStream = probeResult({ ok: false, fatal: false, reason: 'claude produced no stream output', metering: { ...NO_ROWS } });
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
    await startupProbe(deps(db, probeResult({ metering: { ...NO_ROWS } })).deps);
    expect(db.ledger).toHaveLength(0);
  });

  it('records an unknown model at the fallback rates the way a card turn does, and then stops', async () => {
    const db = unattendedDb();
    const fallbackRow = { ...ROW, model: 'mystery-model' };
    const metering = { ...NO_ROWS, rows: [fallbackRow], basis: 'result' as const, fallbackModels: ['mystery-model'], turnModels: ['mystery-model'] };
    const error = await startupProbe(deps(db, probeResult({ metering })).deps).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FallbackPricedError);
    expect(error).toMatchObject({ message: 'no price for model mystery-model', fatal: true, models: ['mystery-model'] });
    // The model is missing from the price table on every start, and every start spends on a probe.
    expect(exitCodeFor(error)).toBe(78);
    expect(db.ledger).toEqual([{ id: 'ledger-1', billed_to: 'studio', card_id: null, role_id: null, ...fallbackRow }]);
  });

  it('meters a side model priced at fallback rates without stopping', async () => {
    const db = unattendedDb();
    const sideRow = { model: 'side-model', input_tokens: 100, cached_tokens: 0, output_tokens: 10, usd: 0.0008, request_id: 'probe/test/settle/2' };
    const metering = { ...NO_ROWS, rows: [ROW, sideRow], basis: 'result' as const, fallbackModels: ['side-model'], turnModels: ['builder-class'] };
    await expect(startupProbe(deps(db, probeResult({ metering })).deps)).resolves.toBeUndefined();
    expect(db.ledger.map((row) => row.model)).toEqual(['builder-class', 'side-model']);
  });

  it('tries a ledger write three times before it gives up', async () => {
    let failures = 2;
    class FlakyDb extends FakeDb {
      override async recordUsage(...args: Parameters<FakeDb['recordUsage']>) {
        if (failures > 0) {
          failures -= 1;
          throw new Error('db record_usage: connection reset');
        }
        return super.recordUsage(...args);
      }
    }
    const db = Object.assign(new FlakyDb(), { studio: { ...new FakeDb().studio, agent_mode: 'unattended' } });
    await meterProbe(db, config, probeResult(), silent, 1);
    expect(db.ledger).toHaveLength(2);
    failures = 3;
    await expect(meterProbe(new FlakyDb(), config, probeResult(), silent, 1)).rejects.toThrow('connection reset');
  });

  it('writes every row it can, then stops for good, naming the rows the ledger refused', async () => {
    class RefusingDb extends FakeDb {
      override async recordUsage(...args: Parameters<FakeDb['recordUsage']>) {
        if (args[0].request_id === SETTLE_ROW.request_id) throw new Error('db record_usage: connection reset');
        return super.recordUsage(...args);
      }
    }
    const db = new RefusingDb();
    const last: MeterRow = { ...SETTLE_ROW, output_tokens: 10, usd: 0.0002, request_id: 'probe/test/settle/2' };
    const error = await meterProbe(db, config, probeResult({ metering: { ...NO_ROWS, basis: 'result', turnModels: ['builder-class'], rows: [ROW, SETTLE_ROW, last] } }), silent, 1).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(UnwrittenRowsError);
    expect(exitCodeFor(error)).toBe(78);
    expect((error as Error).message).toBe('the ledger refused probe rows: probe/test/settle/1 builder-class 0.0006 USD (db record_usage: connection reset)');
    expect(db.ledger.map((row) => row.request_id)).toEqual(['probe/test/turn/1', 'probe/test/settle/2']);
  });
});

describe('checkRoleModels', () => {
  it('passes when every role with write access has a priced model, falling back to MODEL_BUILDER', async () => {
    const db = new FakeDb();
    db.roles = [role(), role({ id: 'role-2', name: 'Builder B', model: '' }), role({ id: 'role-host', name: 'Host', model: 'host-only-model', write_access: false })];
    await expect(checkRoleModels(db, config)).resolves.toBeUndefined();
  });

  it('refuses to start, exit 78, naming every writing role whose model has no price', async () => {
    const db = new FakeDb();
    db.roles = [role({ model: 'mystery-model' }), role({ id: 'role-2', name: 'Game Director', model: 'other-model' })];
    const error = await checkRoleModels(db, config).catch((caught: unknown) => caught);
    expect(error).toEqual(new StartupError('no price in PRICE_TABLE_JSON for Builder A (mystery-model), Game Director (other-model)', true));
    expect(exitCodeFor(error)).toBe(78);
    const unpricedBuilder = await checkRoleModels(Object.assign(new FakeDb(), { roles: [role({ model: '' })] }), { ...config, modelBuilder: 'unpriced-builder' }).catch((caught: unknown) => caught);
    expect(unpricedBuilder).toEqual(new StartupError('no price in PRICE_TABLE_JSON for Builder A (unpriced-builder)', true));
  });
});
