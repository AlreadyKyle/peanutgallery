// A scale model: what the studio ships per day as players' money grows, under the caps production
// holds, and which cap binds. It is a model, not a replay. The pipeline's shape is the dispatcher's
// and the supply refill's (docs/SYSTEM.md, The card supply's draft): pg_cron asks for a draft every
// 20 minutes while fewer than the floor of cards are open, one draft run at a time, at most
// draft_runs_per_day runs a New York day; the waterfall places money on open cards in line; a funded
// card builds within the slots concurrency() allows; every session's spend counts against the daily
// and monthly caps. The concurrency rule is the real one from throttle.ts.
//
// The measured inputs are production's, read on 10 October 2026 (cards, job_runs and ledger): the
// three cards the supply drafted that day spent 0.358, 0.369 and 0.805 USD from draft to live, with
// funding targets of 0.74, 0.75 and 1.19 USD; their draft runs took 1.1 minutes on average (1.6 at
// most); start to live took 2.3 to 2.6 minutes; and 1 of the day's 4 draft runs failed (a verdict
// note over the schema's length) and was retried. The studio_state values are production's too.
import { describe, expect, it } from 'vitest';
import { concurrency } from '../src/throttle.js';

const MEASURED = {
  cardSpendUsd: (0.358 + 0.369 + 0.805) / 3,
  cardTargetUsd: (0.74 + 0.75 + 1.19) / 3,
  draftMinutes: 2,
  buildMinutes: 3,
  draftSuccess: 3 / 4,
};

const PRODUCTION = {
  draftRunsPerDay: 4,
  cronMinutes: 20,
  floorOpen: 6,
  dailyCapUsd: 100,
  monthlyCapUsd: 500,
  hourlyRateUsd: 5,
  maxConcurrency: 1,
};

type Caps = typeof PRODUCTION;

interface Outcome {
  shippedPerDay: number;
  spentPerDay: number;
  fundedPerDay: number;
  unplacedUsd: number;
  binding: string;
}

// Thirty days, minute by minute, with the day's money arriving evenly. Deterministic: a draft
// succeeds on a fixed pattern that matches the measured rate.
function simulate(inflowPerDayUsd: number, caps: Caps, days = 30): Outcome {
  const minutes = days * 24 * 60;
  let balance = 0;
  let unplaced = 0;
  let spentToday = 0;
  let spentMonth = 0;
  let draftsToday = 0;
  let draftBusyUntil = -1;
  let draftAttempts = 0;
  const open: { funded: number }[] = [];
  const queue: number[] = [];
  const building: number[] = [];
  let shipped = 0;
  let funded = 0;
  let spent = 0;
  const blocked = { draft_cap: 0, monthly_cap: 0, daily_cap: 0, concurrency: 0, draft_pace: 0 };
  // Why the last cron tick drafted nothing, so a minute with money and no open card is charged to it.
  let draftBlock: keyof typeof blocked = 'draft_pace';

  for (let t = 0; t < minutes; t++) {
    if (t % (24 * 60) === 0) {
      spentToday = 0;
      draftsToday = 0;
    }
    const arriving = inflowPerDayUsd / (24 * 60);
    balance += arriving;
    unplaced += arriving;

    // The waterfall: money not on a card goes to the open cards in line.
    for (const card of open) {
      if (unplaced <= 0) break;
      const put = Math.min(unplaced, MEASURED.cardTargetUsd - card.funded);
      card.funded += put;
      unplaced -= put;
    }
    while ((open[0]?.funded ?? -1) >= MEASURED.cardTargetUsd - 1e-9) {
      open.shift();
      queue.push(t);
      funded++;
    }

    // A draft run finishing opens a card, or fails and opens nothing.
    if (draftBusyUntil === t) {
      draftAttempts++;
      if (draftAttempts % 4 !== 0 || MEASURED.draftSuccess === 1) open.push({ funded: 0 });
      draftBusyUntil = -1;
    }

    // pg_cron asks for a draft while the supply is short.
    if (t % caps.cronMinutes === 0 && open.length < caps.floorOpen && draftBusyUntil < 0) {
      const draftCost = MEASURED.cardSpendUsd / 2;
      if (draftsToday >= caps.draftRunsPerDay) draftBlock = 'draft_cap';
      else if (spentMonth + draftCost > caps.monthlyCapUsd) draftBlock = 'monthly_cap';
      else if (spentToday + draftCost > caps.dailyCapUsd) draftBlock = 'daily_cap';
      else {
        draftBlock = 'draft_pace';
        draftsToday++;
        draftBusyUntil = t + MEASURED.draftMinutes;
        spentToday += draftCost;
        spentMonth += draftCost;
        spent += draftCost;
        balance -= draftCost;
      }
    }

    // Builds finish, then funded cards start within the slots the real rule allows.
    for (let i = building.length - 1; i >= 0; i--) {
      if ((building[i] ?? Infinity) <= t) {
        building.splice(i, 1);
        shipped++;
      }
    }
    const slots = concurrency(balance, caps.hourlyRateUsd, caps.maxConcurrency);
    while (queue.length > 0) {
      const buildCost = MEASURED.cardSpendUsd / 2;
      if (building.length >= slots) {
        blocked.concurrency++;
        break;
      }
      if (spentMonth + buildCost > caps.monthlyCapUsd) {
        blocked.monthly_cap++;
        break;
      }
      if (spentToday + buildCost > caps.dailyCapUsd) {
        blocked.daily_cap++;
        break;
      }
      queue.shift();
      building.push(t + MEASURED.buildMinutes);
      spentToday += buildCost;
      spentMonth += buildCost;
      spent += buildCost;
      balance -= buildCost;
    }
    // Money waiting with no open card to take it: charged to what stopped the last draft, or to the
    // pace of one draft at a time on the cron's interval.
    if (open.length === 0 && unplaced > 0) blocked[draftBlock]++;
  }

  // Each cap that stopped work, with its share of the minutes money waited; the pace of one draft
  // per cron tick is listed only when no cap was hit.
  const waited = Object.values(blocked).reduce((sum, n) => sum + n, 0);
  const capsHit = Object.entries(blocked)
    .filter(([name, n]) => n > 0 && name !== 'draft_pace')
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${name} ${Math.round((100 * n) / waited)}%`);
  // The monthly cap stops work at the month's end, after the other minutes are counted, so a month
  // spent to within one card of it is named too.
  const monthSpent = spentMonth >= caps.monthlyCapUsd - MEASURED.cardSpendUsd;
  return {
    shippedPerDay: shipped / days,
    spentPerDay: spent / days,
    fundedPerDay: funded / days,
    unplacedUsd: unplaced + open.reduce((sum, card) => sum + card.funded, 0),
    binding:
      monthSpent && !capsHit.some((c) => c.startsWith('monthly_cap'))
        ? ['monthly_cap', ...capsHit].join(', ')
        : capsHit.length > 0
          ? capsHit.join(', ')
          : waited > 0
            ? 'draft pace only'
            : 'none',
  };
}

const INFLOWS = [5, 50, 500, 5000];

function table(label: string, caps: Caps): string {
  const rows = INFLOWS.map((inflow) => {
    const o = simulate(inflow, caps);
    return `| ${label} | $${inflow}/day | ${o.shippedPerDay.toFixed(1)} | $${o.spentPerDay.toFixed(2)} | $${Math.round(o.unplacedUsd)} | ${o.binding} |`;
  });
  return rows.join('\n');
}

describe('scale model (production caps, measured costs)', () => {
  it('prints shipped cards a day per inflow under today\'s caps and three alternatives', () => {
    const header = '| caps | inflow | shipped/day | spent/day | unplaced after 30 days | binding |\n|---|---|---|---|---|---|';
    const out = [
      header,
      table('production (4 drafts/day, $500/month)', PRODUCTION),
      table('48 drafts/day', { ...PRODUCTION, draftRunsPerDay: 48 }),
      table('48 drafts/day, no monthly cap', { ...PRODUCTION, draftRunsPerDay: 48, monthlyCapUsd: Infinity }),
      table('no draft count, no monthly cap, 5-min cron', { ...PRODUCTION, draftRunsPerDay: Infinity, monthlyCapUsd: Infinity, cronMinutes: 5 }),
    ].join('\n');
    console.log(`\n${out}\n`);
    expect(out).toContain('| production');
  });

  it('today the draft count is the binding cap as soon as players fund more than about $3 a day', () => {
    const o = simulate(50, PRODUCTION);
    expect(o.binding).toMatch(/^draft_cap/);
    // 4 runs a day, 3 of 4 succeed: at most 3 new cards a day, whatever the money.
    expect(o.shippedPerDay).toBeLessThanOrEqual(4);
    expect(simulate(5000, PRODUCTION).shippedPerDay).toBeCloseTo(o.shippedPerDay, 0);
  });

  it('with the count lifted, the $500 monthly cap binds next', () => {
    const o = simulate(5000, { ...PRODUCTION, draftRunsPerDay: 48 });
    expect(o.binding).toContain('monthly_cap');
    expect(o.spentPerDay).toBeCloseTo(PRODUCTION.monthlyCapUsd / 30, 0);
  });
});
