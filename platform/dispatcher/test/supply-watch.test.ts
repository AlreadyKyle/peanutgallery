// The card supply's alert (src/supply-watch.ts, docs/specs/unattended-roles.md): while the supply is
// short and no draft can be queued for a reason that does not clear on its own, the board hears once
// per reason per New York day; a paused studio, a queued draft or a supply that is not short says
// nothing; the read runs at most every 20 minutes and a failed read never throws.
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';
import { SUPPLY_WATCH_MS, watchSupply, type SupplyWatchState } from '../src/supply-watch.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb, NOW } from './helpers/fake-db.js';

const FLOOR = { short_open: 2, short_big: 0, short_small: 1, big_min_usd: 5, small_max_usd: 2 };

function setup() {
  const db = new FakeDb();
  const alert = new RecordingAlerter();
  const state: SupplyWatchState = { lastAt: null };
  let clock = NOW.getTime();
  const watch = () => watchSupply({ db, alert, now: () => new Date(clock), log: createLogger(new Writable({ write: (_c, _e, cb) => cb() })), state });
  const later = (ms: number) => {
    clock += ms;
  };
  return { db, alert, watch, later };
}

describe('watchSupply', () => {
  it("tells the board once a New York day when the supply is short and today's draft runs are used, naming the shortfalls", async () => {
    const t = setup();
    t.db.supplyCheck = { short: true, reason: 'daily_limit', floor: FLOOR, runsToday: 4 };
    expect(await t.watch()).toEqual({ checked: true, short: true, reason: 'daily_limit', alerted: true });
    t.later(SUPPLY_WATCH_MS);
    await t.watch();
    expect(t.alert.messages).toEqual([
      "The card supply is short of the floor (2 open, 1 small) and no draft can be queued: today's draft runs are used (studio_state.draft_runs_per_day); drafting resumes after New York midnight.",
    ]);
    // The next New York day it is told again.
    t.later(24 * 60 * 60_000);
    await t.watch();
    expect(t.alert.messages).toHaveLength(2);
  });

  it('names a paused Game Designer or Game Director, and a disabled job', async () => {
    for (const [reason, words] of [
      ['role_paused', 'the Game Designer is paused'],
      ['grader_paused', 'the Game Director is paused'],
      ['job_disabled', 'the draft_card job is disabled'],
    ] as const) {
      const t = setup();
      t.db.supplyCheck = { short: true, reason, floor: FLOOR, runsToday: 0 };
      await t.watch();
      expect(t.alert.messages[0]).toContain(words);
    }
  });

  it('says nothing when the supply is not short, a draft may be or is queued, or the studio is paused', async () => {
    for (const check of [
      { short: false, reason: 'not_short', floor: {}, runsToday: 0 },
      { short: true, reason: null, floor: FLOOR, runsToday: 0 },
      { short: true, reason: 'already_queued', floor: FLOOR, runsToday: 1 },
      { short: true, reason: 'studio_paused', floor: FLOOR, runsToday: 0 },
      { short: false, reason: 'daily_limit', floor: {}, runsToday: 4 },
    ]) {
      const t = setup();
      t.db.supplyCheck = check;
      expect(await t.watch()).toMatchObject({ checked: true, alerted: false });
      expect(t.alert.messages).toEqual([]);
    }
  });

  it('reads at most every 20 minutes, and a failed read is logged, not thrown', async () => {
    const t = setup();
    await t.watch();
    expect(await t.watch()).toEqual({ checked: false });
    t.later(SUPPLY_WATCH_MS - 1);
    await t.watch();
    expect(t.db.supplyChecks).toBe(1);
    t.later(1);
    t.db.supplyCheckError = new Error('db supply_draft_check: connection reset');
    expect(await t.watch()).toEqual({ checked: false });
    expect(t.db.supplyChecks).toBe(2);
  });
});
