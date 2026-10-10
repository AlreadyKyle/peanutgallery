import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  boardStudioState,
  cancelCard,
  DISPATCHER_STALE_MS,
  dispatcherStatus,
  fetchCardEvents,
  fileCard,
  findingsFrom,
  isCardRole,
  jobsFrom,
  PAUSE_REASONS,
  recordCreditPurchase,
  resumeCard,
  runJobNow,
  setPaused,
  studioStateFrom,
  supplyFrom,
  supplyLine,
  type Role,
} from './board';
import { BOARD_AUTH_OPTIONS } from './supabase';

function role(title: string, overrides: Partial<Role> = {}): Role {
  return { id: title, title, write_access: true, state: 'active', ...overrides };
}

/** A client that records every RPC and answers each from results. */
function recording(results: Record<string, unknown> = {}) {
  const calls: { name: string; args: Record<string, unknown> | undefined }[] = [];
  const rpc = (name: string, args?: Record<string, unknown>) => {
    calls.push({ name, args });
    return Promise.resolve({ data: results[name] ?? null, error: null });
  };
  return { calls, client: { rpc } as unknown as SupabaseClient };
}

describe('which roles build cards', () => {
  it('offers the builders, QA and the Platform Builder as executors, never a retired role or one without write access', () => {
    const roster = ['Studio Head', 'Game Director', 'Builder A', 'Builder B', 'Platform Builder', 'QA', 'Host'].map((title) => role(title));
    expect(roster.filter(isCardRole).map((r) => r.title)).toEqual(['Builder A', 'Builder B', 'Platform Builder', 'QA']);
    expect(isCardRole(role('Builder A', { state: 'retired' }))).toBe(false);
    expect(isCardRole(role('Builder B', { write_access: false }))).toBe(false);
    expect(isCardRole(role('toString'))).toBe(false);
  });
});

describe('the board client', () => {
  it('keeps its session: persisted, refreshed and read from the magic link', () => {
    expect(BOARD_AUTH_OPTIONS).toEqual({ persistSession: true, autoRefreshToken: true, detectSessionInUrl: true });
  });
});

describe('the studio state', () => {
  it('reads the caps, null for those it does not return, and the pause reason only while paused', () => {
    const base = { paused: false, daily_cap_usd: '100', card_max_usd: 25 };
    expect(studioStateFrom(base, 'incident')).toMatchObject({
      paused: false,
      pause_reason: null,
      daily_cap_usd: 100,
      agent_hourly_rate_usd: null,
      monthly_cap_usd: null,
      anthropic_tier_cap_usd: null,
      platform_lane_open: false,
    });
    expect(studioStateFrom({ ...base, paused: true, anthropic_tier_cap_usd: '100.0000', platform_lane_open: true }, 'incident')).toMatchObject({
      pause_reason: 'incident',
      anthropic_tier_cap_usd: 100,
      platform_lane_open: true,
    });
    expect(() => studioStateFrom(null)).toThrow('board_studio_state returned no state');
    expect(() => studioStateFrom({ paused: false, card_max_usd: 1 })).toThrow('board_studio_state returned no daily_cap_usd');
  });

  it('reads the pause reason from public_studio beside board_studio_state', async () => {
    const view = { select: () => view, limit: () => view, returns: () => Promise.resolve({ data: [{ pause_reason: 'spend_limit' }], error: null }) };
    const client = {
      rpc: () => Promise.resolve({ data: { paused: true, daily_cap_usd: 1, card_max_usd: 1 }, error: null }),
      from: (table: string) => {
        expect(table).toBe('public_studio');
        return view;
      },
    } as unknown as SupabaseClient;
    expect((await boardStudioState(client)).pause_reason).toBe('spend_limit');
  });

  it('says the dispatcher is seen within the stale window, stale after it, and never seen with no heartbeat', () => {
    const now = new Date('2026-10-10T12:00:00Z');
    expect(dispatcherStatus(null, now)).toEqual({ kind: 'never' });
    expect(dispatcherStatus('not a date', now)).toEqual({ kind: 'never' });
    expect(dispatcherStatus('2026-10-10T11:59:30Z', now)).toEqual({ kind: 'seen', agoMs: 30_000 });
    const old = new Date(now.getTime() - DISPATCHER_STALE_MS - 1).toISOString();
    expect(dispatcherStatus(old, now)).toEqual({ kind: 'stale', seenAt: old });
  });

  it('reads card_supply, and writes the line the board reads', () => {
    const raw = { open: 6, big: 0, small: 6, floor_open: 6, floor_big: 1, floor_small: 1, big_min_usd: '5.0000', small_max_usd: '2.0000' };
    const supply = supplyFrom(raw);
    expect(supplyLine(supply)).toBe('Open cards: 6 of a floor of 6 · $5 or more: 0 of 1 · under $2: 6 of 1');
    expect(supplyLine({ ...supply, big_min_usd: 7.5, small_max_usd: 2.25 })).toBe('Open cards: 6 of a floor of 6 · $7.50 or more: 0 of 1 · under $2.25: 6 of 1');
    expect(() => supplyFrom(null)).toThrow('card_supply returned nothing');
    expect(() => supplyFrom({ ...raw, floor_big: undefined })).toThrow('card_supply returned no floor_big');
  });
});

describe('activity', () => {
  it('flattens board_jobs into the job names and the newest runs across them', () => {
    const jobs = jobsFrom(
      [
        { name: 'tidy_up', runs: [{ id: 'a', origin: 'schedule', status: 'skipped', reason: 'role_paused', created_at: '2026-10-09T00:00:00Z' }] },
        { name: 'weekly_report', runs: [{ id: 'b', origin: 'board', status: 'succeeded', reason: null, created_at: '2026-10-10T00:00:00Z' }, { id: 'c', origin: 'event', status: 'failed', created_at: '2026-10-08T00:00:00Z' }] },
        { name: 'no_runs' },
      ],
      2,
    );
    expect(jobs.names).toEqual(['tidy_up', 'weekly_report', 'no_runs']);
    expect(jobs.runs).toEqual([
      { id: 'b', job: 'weekly_report', origin: 'board', status: 'succeeded', reason: null, created_at: '2026-10-10T00:00:00Z' },
      { id: 'a', job: 'tidy_up', origin: 'schedule', status: 'skipped', reason: 'role_paused', created_at: '2026-10-09T00:00:00Z' },
    ]);
    expect(jobsFrom(null)).toEqual({ names: [], runs: [] });
  });

  it('keeps only well-formed findings, oldest first, with their flat detail', () => {
    const findings = findingsFrom([
      { fingerprint: 'b', kind: 'model', subject: 'Second', detail: { model: 'x', gone: null, nested: { a: 1 } }, opened_at: '2026-10-09T00:00:00Z' },
      { fingerprint: 'a', kind: 'schema', subject: 'First', detail: null, opened_at: '2026-10-08T00:00:00Z', last_seen_at: '2026-10-09T00:00:00Z' },
      { fingerprint: 'c', kind: 'rumour', subject: 'Not a kind', opened_at: '2026-10-08T00:00:00Z' },
      { kind: 'scan', subject: 'No fingerprint', opened_at: '2026-10-08T00:00:00Z' },
    ]);
    expect(findings.map((f) => [f.fingerprint, f.last_seen_at])).toEqual([
      ['a', '2026-10-09T00:00:00Z'],
      ['b', '2026-10-09T00:00:00Z'],
    ]);
    expect(findings[1]?.detail).toEqual([
      ['model', 'x'],
      ['nested', '{"a":1}'],
    ]);
    expect(findingsFrom('nothing')).toEqual([]);
  });

  it("reads one card's public agent events by its id, newest first, at most 50", async () => {
    const steps: string[] = [];
    const builder = {
      select: (columns: string) => (steps.push(`select ${columns}`), builder),
      eq: (column: string, value: string) => (steps.push(`eq ${column} ${value}`), builder),
      order: (column: string, options: { ascending: boolean }) => (steps.push(`order ${column} ${options.ascending}`), builder),
      limit: (n: number) => (steps.push(`limit ${n}`), builder),
      returns: () => Promise.resolve({ data: [{ id: 'e1', type: 'message', created_at: '2026-10-10T00:00:00Z', step: 'dealt', line_key: '' }], error: null }),
    };
    const client = { from: (table: string) => (steps.push(table), builder) } as unknown as SupabaseClient;
    expect(await fetchCardEvents(client, 'c1')).toEqual([{ id: 'e1', type: 'message', created_at: '2026-10-10T00:00:00Z', step: 'dealt', line_key: null }]);
    expect(steps).toEqual(['public_agent_events', 'select id,card_id,type,created_at,step,line_key', 'eq card_id c1', 'order created_at false', 'limit 50']);
  });
});

describe('actions', () => {
  it('sends p_reason only with a pause that is not the default, and never with a resume', async () => {
    const { calls, client } = recording();
    await setPaused(client, true);
    await setPaused(client, true, 'spend_limit');
    await setPaused(client, false, 'incident');
    expect(calls.map((call) => call.args)).toEqual([{ p_paused: true }, { p_paused: true, p_reason: 'spend_limit' }, { p_paused: false }]);
    expect(PAUSE_REASONS.map((r) => r.value)).toEqual(['board', 'incident', 'awaiting_credit', 'spend_limit']);
  });

  it('returns how much unspent money a cancellation moved, and 0 when it names none', async () => {
    expect(await cancelCard(recording({ cancel_card: { moved_usd: 2.5 } }).client, 'x', 'why')).toBe(2.5);
    expect(await cancelCard(recording({ cancel_card: { card_id: 'x' } }).client, 'x', 'why')).toBe(0);
    expect(await cancelCard(recording().client, 'x', 'why')).toBe(0);
  });

  it('files a card as proposed, and calls resume_card, record_credit_purchase and enqueue_manual_job with the contract arguments', async () => {
    const { calls, client } = recording({ file_card: 'card-1', enqueue_manual_job: 'run-1' });
    const card = { bucket: 'game', lane: 'config', folder: 'seed-1', title: 'T', summary: 'S', intent: 'I', acceptance_test: 'check: x', funding_target_usd: 2, executor_role_id: 'r', board_reason: '', horizon: 'now' as const };
    expect(await fileCard(client, card)).toBe('card-1');
    await resumeCard(client, 'card-1', 0.8, 'Topped up');
    await recordCreditPurchase(client, { amount_usd: 10, stripe_payout_id: 'po_1', reason: 'Payout' });
    expect(await runJobNow(client, 'tidy_up', 'Debug')).toBe('run-1');
    expect(calls).toEqual([
      {
        name: 'file_card',
        args: {
          p_bucket: 'game',
          p_lane: 'config',
          p_folder: 'seed-1',
          p_title: 'T',
          p_summary: 'S',
          p_intent: 'I',
          p_acceptance_test: 'check: x',
          p_funding_target_usd: 2,
          p_stage: 'proposed',
          p_executor_role_id: 'r',
          p_board_reason: '',
          p_horizon: 'now',
        },
      },
      { name: 'resume_card', args: { p_card: 'card-1', p_estimate_usd: 0.8, p_reason: 'Topped up' } },
      { name: 'record_credit_purchase', args: { p_amount_usd: 10, p_stripe_payout_id: 'po_1', p_reason: 'Payout' } },
      { name: 'enqueue_manual_job', args: { p_job: 'tidy_up', p_card: null, p_reason: 'Debug', p_input: {} } },
    ]);
  });

  it('throws when file_card or enqueue_manual_job returns no id', async () => {
    const { client } = recording();
    await expect(runJobNow(client, 'tidy_up', 'x')).rejects.toThrow('enqueue_manual_job returned no run id');
  });
});
