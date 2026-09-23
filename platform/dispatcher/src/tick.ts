// The Appendix A loop, one tick: hold the dispatcher lease, read studio_state, check the board
// session, read the pool, apply the throttle, select the card, claim it with its session budget, and
// start its pipeline in the background. The heartbeat and the healthcheck ping follow a tick that
// completed while holding the lease, so a dispatcher whose ticks keep failing, or that another
// dispatcher has locked out, stops pinging. A halted dispatcher claims nothing and does not ping.
import type { AgentMode } from './adapters/types.js';
import type { Alerter } from './alert.js';
import type { SessionBudgets } from './budgets.js';
import type { Card, Db, Pool, StudioState } from './db.js';
import { haltReason } from './halt.js';
import { errorMessage, type Logger } from './log.js';
import { runnableInOrder } from './select.js';
import {
  HOLD_STAGES,
  canStart,
  concurrency,
  newYorkDate,
  newYorkMonth,
  newYorkMonthStart,
  planStart,
  spentToday,
  tierMonth,
  tierMonthStart,
  type MoneyReason,
  type MoneyState,
  type SleepReason,
} from './throttle.js';
import { shortId } from './worktree.js';

export interface TickDeps {
  db: Db;
  mode: AgentMode;
  boardSessionTtlMin: number;
  maxConcurrency: number;
  // Card id to the time its pipeline started, for cards this process is running.
  running: Map<string, Date>;
  // The session budget of each card this process is running.
  budgets: SessionBudgets;
  // This process's name on the dispatcher lease, and how long each claim holds it.
  leaseHolder: string;
  leaseTtlSeconds: number;
  // How long a card may stay in the pipeline before the board is alerted.
  stuckAfterMs: number;
  now: () => Date;
  runCard: (card: Card) => Promise<void>;
  log: Logger;
  alert: Alerter;
}

// Each claim holds the lease this long; the tick renews it every DISPATCHER_TICK_MS, so it lapses only
// after several ticks in a row have failed to reach the database. claim_dispatcher_lease takes at most
// an hour.
export const LEASE_TTL_MAX_SECONDS = 3600;

export function leaseTtlSeconds(tickMs: number): number {
  return Math.min(LEASE_TTL_MAX_SECONDS, Math.max(300, Math.ceil((5 * tickMs) / 1000)));
}

export type TickOutcome =
  | { action: 'sleep'; reason: SleepReason | 'mode_mismatch' | 'halted' | 'lease_held' }
  | { action: 'started'; cardId: string }
  | { action: 'claim_lost'; cardId: string };

export async function tick(deps: TickDeps): Promise<TickOutcome> {
  // Only the lease holder ticks: a second dispatcher (the Mac beside the VPS) claims nothing, writes
  // no heartbeat and sends no ping, so the healthcheck shows that the working one is not this one.
  if (!(await deps.db.claimLease(deps.leaseHolder, deps.leaseTtlSeconds))) {
    deps.log.warn('tick', 'another dispatcher holds the lease; claiming nothing', { holder: deps.leaseHolder });
    await deps.alert.notifyOnce(`lease:${deps.leaseHolder}`, 'Another dispatcher holds the dispatcher lease, so this one claims no card. Stop one of them.');
    return { action: 'sleep', reason: 'lease_held' };
  }
  deps.alert.forget(`lease:${deps.leaseHolder}`);
  await watchStuckCards(deps);
  const halted = haltReason() !== null;
  const outcome: TickOutcome = halted ? { action: 'sleep', reason: 'halted' } : await evaluate(deps);
  await heartbeat(deps);
  if (!halted) await deps.alert.ping();
  return outcome;
}

async function evaluate(deps: TickDeps): Promise<TickOutcome> {
  const studio = await deps.db.getStudioState();
  if (studio.paused) return { action: 'sleep', reason: 'paused' };
  if (studio.agent_mode !== deps.mode) {
    deps.log.warn('tick', 'studio_state.agent_mode differs from the running adapter', { studio: studio.agent_mode, adapter: deps.mode });
    return { action: 'sleep', reason: 'mode_mismatch' };
  }
  const boardSessionActive = await checkBoardSession(deps);
  const pool = await deps.db.getPool();
  const cards = await deps.db.listCardsInStages([...HOLD_STAGES, 'building']);
  const runnable = runnableInOrder(cards);
  const decision = canStart({
    paused: studio.paused,
    mode: deps.mode,
    boardSessionActive,
    fundedCount: cards.filter((card) => card.stage === 'funded').length,
    runnableCount: runnable.length,
    running: deps.running.size,
    concurrency: concurrency(pool.balance_usd, studio.agent_hourly_rate_usd, deps.mode, deps.maxConcurrency),
  });
  if (!decision.ok) return { action: 'sleep', reason: decision.reason };

  // An attended session is billed to the founder, so the pool bounds nothing: its budget is the card
  // ceiling alone (session.ts).
  if (deps.mode === 'attended') return claimAndStart(deps, runnable[0]!, Number.POSITIVE_INFINITY);

  const money = await moneyState(deps, studio, pool, cards);
  await creditShortfall(deps, studio, pool, money);
  let first: Stopped | null = null;
  for (const card of runnable) {
    const plan = planStart(money, card);
    if (plan.ok) return claimAndStart(deps, card, plan.budgetUsd);
    first ??= { reason: plan.reason, card, needUsd: plan.needUsd, creditUsd: plan.bounds.creditUsd };
  }
  await alertMoney(deps, studio, money, first!);
  return { action: 'sleep', reason: first!.reason };
}

// Two reads, both summed in the database: each card's studio spend (public_card_spend) and the spend
// totals (studio_spend_totals), so a tick never downloads the ledger.
async function moneyState(deps: TickDeps, studio: StudioState, pool: Pool, cards: readonly Card[]): Promise<MoneyState> {
  const now = deps.now();
  const [spent, totals] = await Promise.all([deps.db.cardSpend(cards.map((card) => card.id)), deps.db.spendTotals(newYorkMonthStart(now), tierMonthStart(now))]);
  return {
    balanceUsd: pool.balance_usd,
    studioReserveUsd: studio.studio_reserve_usd,
    incidentReserveUsd: pool.incident_reserve_usd,
    cardMaxUsd: studio.card_max_usd,
    dailyCapUsd: studio.daily_cap_usd,
    spentTodayUsd: spentToday(pool, now),
    monthlyCapUsd: studio.monthly_cap_usd,
    spentThisMonthUsd: totals.monthUsd,
    tierCapUsd: studio.anthropic_tier_cap_usd,
    spentThisTierMonthUsd: totals.tierUsd,
    creditPurchasedUsd: totals.creditPurchasedUsd,
    creditSpentUsd: totals.spentUsd,
    cards,
    spent,
    running: deps.budgets.remaining(),
  };
}

// The pool runs ahead of the Console credit whenever money arrives between purchases. The board is
// told once per purchase total, so the next purchase can raise the alert again.
async function creditShortfall(deps: TickDeps, studio: StudioState, pool: Pool, money: MoneyState): Promise<void> {
  const creditLeft = money.creditPurchasedUsd - money.creditSpentUsd;
  const poolAgentMoney = pool.balance_usd - studio.studio_reserve_usd;
  if (poolAgentMoney <= creditLeft) return;
  await deps.alert.notifyOnce(
    `credit_short:${money.creditPurchasedUsd.toFixed(4)}`,
    `Console credit needed: the pool holds $${poolAgentMoney.toFixed(2)} for the agents but $${Math.max(0, creditLeft).toFixed(2)} of Console credit is left. Buy credit and record it on /board.`,
  );
}

// The first runnable card in order that the money stopped, and why.
interface Stopped {
  reason: MoneyReason;
  card: Card;
  needUsd: number;
  // The Console credit left once the running sessions' budgets are covered.
  creditUsd: number;
}

async function alertMoney(deps: TickDeps, studio: StudioState, money: MoneyState, first: Stopped): Promise<void> {
  const now = deps.now();
  if (first.reason === 'daily_cap') {
    const day = newYorkDate(now);
    await deps.alert.notifyOnce(`daily_cap:${day}`, `The daily cap of $${studio.daily_cap_usd.toFixed(2)} stopped the agents for ${day}.`);
  } else if (first.reason === 'monthly_cap') {
    const month = newYorkMonth(now);
    const message =
      studio.monthly_cap_usd === null
        ? 'studio_state has no monthly cap, so no unattended card starts. Set the monthly cap on /board.'
        : `The monthly cap of $${studio.monthly_cap_usd.toFixed(2)} stopped the agents for ${month}.`;
    await deps.alert.notifyOnce(`monthly_cap:${month}`, message);
  } else if (first.reason === 'tier_cap' && studio.anthropic_tier_cap_usd !== null) {
    // Once per tier month as the throttle counts it, so the next month can raise it again. The key is
    // the month, not tierMonthStart, which moves forward on the 1st as each zone turns.
    const since = tierMonthStart(now).toISOString();
    await deps.alert.notifyOnce(
      `tier_cap:${tierMonth(now)}`,
      `The usage tier cap of $${studio.anthropic_tier_cap_usd.toFixed(2)} a month stopped the agents: the studio key has spent $${money.spentThisTierMonthUsd.toFixed(2)} since ${since}. It clears when the month turns, or when Anthropic raises the tier and the new limit is reported.`,
    );
  } else if (first.reason === 'console_credit') {
    await deps.alert.notifyOnce(
      `console_credit:${money.creditPurchasedUsd.toFixed(4)}`,
      `Console credit needed: card ${shortId(first.card.id)} needs $${first.needUsd.toFixed(2)} and $${Math.max(0, first.creditUsd).toFixed(2)} of Console credit is left once running sessions are covered. Buy credit and record it on /board.`,
    );
  }
}

async function claimAndStart(deps: TickDeps, card: Card, budgetUsd: number): Promise<TickOutcome> {
  const claimed = await deps.db.claimCard(card.id);
  if (!claimed) return { action: 'claim_lost', cardId: card.id };
  startCard(deps, claimed, budgetUsd);
  return { action: 'started', cardId: claimed.id };
}

// The heartbeat is a liveness signal for /board, not a precondition: a failed write is logged
// and the tick goes on.
async function heartbeat(deps: TickDeps): Promise<void> {
  try {
    await deps.db.dispatcherHeartbeat(deps.now());
  } catch (error) {
    deps.log.warn('tick', 'heartbeat write failed', { error: errorMessage(error) });
  }
}

// Every wait in the pipeline has a deadline, so a card past the sum of them is stuck on something
// that has none. The board is told once per card; the card is left running.
async function watchStuckCards(deps: TickDeps): Promise<void> {
  const now = deps.now().getTime();
  for (const [cardId, startedAt] of deps.running) {
    const elapsed = now - startedAt.getTime();
    if (elapsed <= deps.stuckAfterMs) continue;
    const minutes = Math.floor(elapsed / 60_000);
    deps.log.error('tick', `card ${cardId} has been in the pipeline for ${minutes} minutes`, { limitMinutes: deps.stuckAfterMs / 60_000 });
    await deps.alert.notifyOnce(
      `stuck:${cardId}`,
      `Card ${shortId(cardId)} has been in the pipeline for ${minutes} minutes, past its ${Math.round(deps.stuckAfterMs / 60_000)}-minute limit. Check the dispatcher log.`,
    );
  }
}

async function checkBoardSession(deps: TickDeps): Promise<boolean> {
  if (deps.mode !== 'attended') return true;
  return deps.db.boardSessionActive(deps.boardSessionTtlMin, deps.now());
}

function startCard(deps: TickDeps, card: Card, budgetUsd: number): void {
  deps.running.set(card.id, deps.now());
  deps.budgets.start(card.id, budgetUsd);
  deps.log.info('tick', `card ${card.id} claimed`, { title: card.title, lane: card.lane, estimate: card.estimate_usd, budget: Number.isFinite(budgetUsd) ? budgetUsd : 'ceiling' });
  deps
    .runCard(card)
    .catch((error: unknown) => deps.log.error('tick', `card ${card.id} pipeline threw`, { error: errorMessage(error) }))
    .finally(() => {
      deps.running.delete(card.id);
      deps.budgets.finish(card.id);
      deps.alert.forget(`stuck:${card.id}`);
    });
}
