import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createAdapter } from '../src/adapters/factory.js';
import { ManagedAdapter } from '../src/adapters/managed.js';
import { UnattendedAdapter } from '../src/adapters/unattended.js';
import type { DispatcherConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable } from '../src/pricing.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb } from './helpers/fake-db.js';
import { AGENT_ID, CODE_ROOT, ENVIRONMENT_ID, FakeManagedClient } from './helpers/fake-managed.js';

const base: DispatcherConfig = {
  codeRoot: '/repo',
  codeReadonly: false,
  repoRoot: '/repo',
  supabaseUrl: 'https://db.local',
  supabaseServiceRoleKey: 'service-role',
  githubToken: 'github-token',
  githubRepo: 'owner/repo',
  netlifyAuthToken: 'netlify-token',
  netlifySiteIdSeed: 'site-seed',
  netlifySiteIdPlatform: 'site-platform',
  modelBuilder: 'builder-class',
  modelDirector: null,
  modelDesigner: null,
  modelHost: null,
  priceTable: parsePriceTable(JSON.stringify({ 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } })),
  poolDailyCapUsd: 100,
  cardMaxUsd: 25,
  visualReviewMaxUsd: 1,
  draftSessionMaxUsd: 0.75,
  sessionMaxTurns: 60,
  sessionMaxMinutes: 60,
  agentHourlyRateUsd: 5,
  tickMs: 60_000,
  worktreeRoot: '/repo/.worktrees',
  maxConcurrency: 1,
  claudeBin: 'claude',
  studioAnthropicApiKey: null,
  healthcheckUrl: null,
  ntfyTopicUrl: null,
  discordWebhookShips: null,
  discordWebhookWeekly: null,
  publicSiteUrl: 'https://site.test',
};

describe('createAdapter', () => {
  const managed = { agentId: AGENT_ID, agentVersion: 3, environmentId: ENVIRONMENT_ID, readToken: 'github_pat_-fixture-read' };
  const unattended: DispatcherConfig = { ...base, codeRoot: CODE_ROOT, studioAnthropicApiKey: 'studio-key', managed };
  const adapterDeps = () => ({ db: new FakeDb(), alert: new RecordingAlerter(), log: createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() })), patches: null, client: new FakeManagedClient() });

  // docs/specs/unattended-roles.md, PR5: the dispatcher has one mode; only the hand-run tools build the
  // attended adapter.
  it('builds the managed adapter, reading the agent and environment files from the code root, whatever CLAUDE_BIN says', () => {
    const adapter = createAdapter({ ...unattended, claudeBin: '/nowhere/claude' }, adapterDeps());
    expect(adapter).toBeInstanceOf(UnattendedAdapter);
    expect(adapter).toBeInstanceOf(ManagedAdapter);
    expect(adapter.mode).toBe('unattended');
    expect(adapter.managed).toBe(adapter);
  });

  it('refuses a configuration without the studio key or the managed ids, as a hand-run tool loads one, rather than build an attended adapter', () => {
    expect(() => createAdapter({ ...unattended, studioAnthropicApiKey: null }, adapterDeps())).toThrow('STUDIO_ANTHROPIC_API_KEY is required: the dispatcher runs unattended only');
    expect(() => createAdapter({ ...unattended, managed: null }, adapterDeps())).toThrow('GITHUB_READ_TOKEN and the managed agent and environment ids are required: the dispatcher runs unattended only');
    expect(() => createAdapter(base, adapterDeps())).toThrow('STUDIO_ANTHROPIC_API_KEY is required');
  });

  // docs/specs/launch-managed.md, Decisions: the startup probe proves the key, the agent, the
  // environment and the metering, so it runs on the cheapest priced model, as the credit probe does.
  // The toolchain check and every role keep their own model.
  it('runs the startup probe on the cheapest priced model and the toolchain check on MODEL_BUILDER', async () => {
    const rates = (input: number, output: number) => ({ input, output, cache_read: input / 10, cache_write_5m: input * 1.25, cache_write_1h: input * 2 });
    const priceTable = parsePriceTable(JSON.stringify({ 'builder-class': rates(4, 20), 'small-class': rates(1, 5), 'middle-class': rates(3, 15) }));
    const deps = adapterDeps();
    const client = deps.client;
    client.react = (session, event) => {
      if (event.type !== 'user.message') return;
      if (session.params.metadata?.purpose === 'toolchain') client.addOutput(session.id, 'toolchain.txt', Buffer.from('node=v22.11.0\npnpm=11.0.9\ninstall_exit=0\nbot_exit=0\n'));
      session.emit(
        { type: 'session.status_running' },
        { type: 'agent.message', content: [{ type: 'text', text: 'ready' }] },
        { type: 'span.model_request_end', id: `sevt_${session.id}`, is_error: false, model_request_start_id: 'x', model_usage: { input_tokens: 4700, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
        { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
      );
    };
    const adapter = createAdapter({ ...unattended, modelBuilder: 'builder-class', priceTable }, deps);
    await adapter.probe();
    const probe = client.last;
    expect(probe.params.metadata).toMatchObject({ purpose: 'probe' });
    expect((probe.params.agent as { model: { id: string } }).model).toEqual({ id: 'small-class', speed: 'standard' });
    // 4,700 input and 5 output tokens at 1 and 5 USD per million, not at the builder's 4 and 20.
    expect(deps.db.ledger.find((row) => row.request_id === `sevt_${probe.id}`)?.usd).toBe(0.0047);
    const report = await adapter.toolchain('a'.repeat(40));
    expect(report.ok).toBe(true);
    expect(client.last.params.metadata).toMatchObject({ purpose: 'toolchain' });
    expect((client.last.params.agent as { model: { id: string } }).model).toEqual({ id: 'builder-class', speed: 'standard' });
  });
});
