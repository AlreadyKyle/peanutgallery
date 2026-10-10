// The Appendix A loop, one tick: hold the dispatcher lease, deal the approved agent cards whose
// cooling window has passed and resume the ceiling-paused cards the rule may resume
// (docs/specs/agent-system-core.md), read studio_state, check the board session, read the pool,
// apply the throttle, select the card, claim it with its session budget, and start its pipeline in
// the background; then, however the card path ended, the job queue's tick (jobs.ts). The heartbeat
// and the healthcheck ping follow a tick that completed while holding the lease, so a dispatcher
// whose ticks keep failing, or that another dispatcher has locked out, stops pinging. A halted
// dispatcher claims nothing, deals nothing, runs no job and does not ping. After the heartbeat, a tick
// that holds the lease and is not halted runs the outbound lane (outbound.ts, docs/specs/studio-reports.md)
// inside its own try/catch, so Discord can never delay a card or the heartbeat.
import type { AgentMode } from './adapters/types.js';
import type { Alerter } from './alert.js';
import type { SessionBudgets } from './budgets.js';
import type { PinState } from './cli-pin.js';
import type { Card, Db, Pool, StudioState } from './db.js';
import { isInfrastructureConclusion, type GateStatus } from './github.js';
import { haltReason } from './halt.js';
import { errorMessage, type Logger } from './log.js';
import { runnableInOrder } from './select.js';
import {
  HOLD_STAGES,
  RUNNING_STAGES,
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
  // The running role job's session budget, by the card it is billed to (a draft_card session); unset
  // is none.
  jobBudgets?: SessionBudgets;
  // This process's name on the dispatcher lease, and how long each claim holds it.
  leaseHolder: string;
  leaseTtlSeconds: number;
  // How long a card may stay in the pipeline before the board is alerted.
  stuckAfterMs: number;
  now: () => Date;
  runCard: (card: Card) => Promise<void>;
  log: Logger;
  alert: Alerter;
  // main's head and its gate status (docs/specs/money-safety.md); unset, main is not checked.
  mainGate?: () => Promise<{ sha: string; status: GateStatus }>;
  // The Claude Code pin against the installed CLI (cli-pin.ts), read before an attended claim; unset,
  // it is not read.
  cliPin?: () => Promise<PinState>;
  // The job queue's tick (jobs.ts), run after the card path on every tick that is not halted.
  jobTick?: () => Promise<unknown>;
  // The outbound lane (outbound.ts), run after the heartbeat on every tick that is not halted.
  outbound?: () => Promise<unknown>;
  // DISPATCHER_DRAIN_AT (config.ts): from this time no card or job is claimed. Unset or null: never.
  drainAt?: Date | null;
}

export type DrainState = 'off' | 'draining' | 'drained';

// A host that runs for a bounded time (GitHub Actions, docs/specs/actions-host.md) drains before its
// hard stop: from drainAt the tick claims nothing, and once no card or job this process started is
// still running the process is drained and main exits 0. Before drainAt, or with none, it is off.
export function drainState(drainAt: Date | null | undefined, now: Date, runningCards: number, jobRunning: boolean): DrainState {
  if (!drainAt || now.getTime() < drainAt.getTime()) return 'off';
  return runningCards === 0 && !jobRunning ? 'drained' : 'draining';
}

// Each claim holds the lease this long; the tick renews it every DISPATCHER_TICK_MS, so it lapses only
// after several ticks in a row have failed to reach the database. claim_dispatcher_lease takes at most
// an hour.
export const LEASE_TTL_MAX_SECONDS = 3600;

export function leaseTtlSeconds(tickMs: number): number {
  return Math.min(LEASE_TTL_MAX_SECONDS, Math.max(300, Math.ceil((5 * tickMs) / 1000)));
}

export type TickOutcome =
  | { action: 'sleep'; reason: SleepReason | 'mode_mismatch' | 'halted' | 'lease_held' | MainReason | 'cli_version' | 'draining' }
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
  // Draining claims no card and starts no job; the cards and the job already running carry on, and
  // the heartbeat, the ping and the outbound lane go on until main exits.
  const draining = deps.drainAt != null && deps.now().getTime() >= deps.drainAt.getTime();
  if (!halted) await dealAndResume(deps);
  let outcome: TickOutcome;
  try {
    outcome = halted ? { action: 'sleep', reason: 'halted' } : draining ? { action: 'sleep', reason: 'draining' } : await evaluate(deps);
  } finally {
    // A sleeping or failed card path never skips the job queue; a draining one starts no job.
    if (!halted && !draining) await runJobs(deps);
  }
  await heartbeat(deps);
  if (!halted) await deps.alert.ping();
  if (!halted) await runOutboundLane(deps);
  return outcome;
}

// A failed or slow Discord post is logged and never stops the tick.
async function runOutboundLane(deps: TickDeps): Promise<void> {
  if (!deps.outbound) return;
  try {
    const outcome = await deps.outbound();
    const inert = typeof outcome === 'object' && outcome !== null && (outcome as { inert?: unknown }).inert === true;
    if (!inert) deps.log.info('outbound', 'outbound tick', { outcome });
  } catch (error) {
    deps.log.warn('outbound', 'outbound tick failed', { error: errorMessage(error) });
  }
}

// Dealing and resume by rule are the database's (deal_due_cards, resume_due_by_rule); each is
// logged and never stops the tick.
async function dealAndResume(deps: TickDeps): Promise<void> {
  try {
    const dealt = await deps.db.dealDueCards();
    if (dealt.length > 0) deps.log.info('tick', `${dealt.length} card(s) dealt to now`, { cards: dealt });
  } catch (error) {
    deps.log.warn('tick', 'deal_due_cards failed', { error: errorMessage(error) });
  }
  try {
    const resumed = await deps.db.resumeDueByRule();
    if (resumed.results.length > 0) deps.log.info('tick', `${resumed.resumed} card(s) resumed by rule`, { results: resumed.results });
  } catch (error) {
    deps.log.warn('tick', 'resume_due_by_rule failed', { error: errorMessage(error) });
  }
}

async function runJobs(deps: TickDeps): Promise<void> {
  if (!deps.jobTick) return;
  try {
    const outcome = await deps.jobTick();
    deps.log.info('jobs', 'job tick', { outcome });
  } catch (error) {
    deps.log.warn('jobs', 'job tick failed', { error: errorMessage(error) });
  }
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
  const cards = await deps.db.listCardsInStages([...HOLD_STAGES, ...RUNNING_STAGES]);
  const runnable = runnableInOrder(cards, studio.platform_lane_open);
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
  const main = await mainBlocks(deps);
  if (main) return { action: 'sleep', reason: main };

  // An attended session is billed to the founder, so the pool bounds nothing: its budget is the card
  // ceiling alone (session.ts). It runs on the host's Claude Code, so nothing is claimed off the pin.
  if (deps.mode === 'attended') {
    if (await offPin(deps)) return { action: 'sleep', reason: 'cli_version' };
    return claimAndStart(deps, runnable[0]!, Number.POSITIVE_INFINITY);
  }

  const money = await moneyState(deps, studio, pool, cards);
  let first: Stopped | null = null;
  for (const card of runnable) {
    const plan = planStart(money, card);
    if (plan.ok) return claimAndStart(deps, card, plan.budgetUsd);
    first ??= { reason: plan.reason, card, needUsd: plan.needUsd, creditUsd: plan.bounds.creditUsd };
  }
  await alertMoney(deps, studio, money, first!);
  return { action: 'sleep', reason: first!.reason };
}

type MainReason = 'main_red' | 'main_unreadable';

// Every card's gate runs on main's tree, so while main's own gate has failed no card is claimed: its
// gate would fail for a break it did not cause (docs/specs/money-safety.md). The board hears once per
// red sha, and claiming resumes by itself once main is green. A main gate that is pending or missing
// lets cards run, since their own gate decides; one GitHub could not read stops claiming, so no session
// is spent on a card that could not be pushed.
async function mainBlocks(deps: TickDeps): Promise<MainReason | null> {
  if (!deps.mainGate) return null;
  let main: { sha: string; status: GateStatus };
  try {
    main = await deps.mainGate();
  } catch (error) {
    deps.log.warn('tick', "main's gate could not be read; claiming nothing", { error: errorMessage(error) });
    return 'main_unreadable';
  }
  const { sha, status } = main;
  if (status.state === 'fail' && !isInfrastructureConclusion(status.conclusion)) {
    await deps.alert.notifyOnce(
      `main_red:${sha}`,
      `main's gate failed at ${sha.slice(0, 8)} (${status.conclusion}), so no card is claimed until main is green again. Cards stay funded with their money; fix main with a pull request.`,
    );
    return 'main_red';
  }
  return null;
}

// The attended adapter refuses a Claude Code that is not on its pin, and the card it was given pauses
// with cli_version (cli-pin.ts, docs/specs/agent-upkeep.md). Claiming then would pause one funded card
// a tick, each shown stopped until the board resumed it, so while the installed CLI is off its pin no
// card is claimed: the cards stay funded, the board hears once per installed and pinned version, and
// claiming resumes by itself once the CLI is back on its pin. A pin that cannot be read counts as off
// it. The adapter's own check stays, for the role jobs and for an update between this read and a
// session's start.
async function offPin(deps: TickDeps): Promise<boolean> {
  if (!deps.cliPin) return false;
  let pin: PinState;
  try {
    pin = await deps.cliPin();
  } catch (error) {
    pin = { ok: false, installed: null, pinned: null, detail: `the Claude Code pin could not be checked: ${errorMessage(error)}` };
  }
  if (pin.ok) return false;
  deps.log.warn('tick', 'claude code is off its pin; claiming nothing', { installed: pin.installed, pinned: pin.pinned });
  await deps.alert.notifyOnce(
    `cli_version:${pin.installed ?? 'unknown'}:${pin.pinned ?? 'unknown'}`,
    `No card is claimed while Claude Code is off its pin, and funded cards keep their money. ${pin.detail}`,
  );
  return true;
}

export type MoneyDeps = Pick<TickDeps, 'db' | 'now' | 'budgets' | 'jobBudgets'>;

// What the running role job's sessions may still spend.
export function jobsHoldUsd(jobBudgets: SessionBudgets | undefined): number {
  let total = 0;
  for (const left of jobBudgets?.remaining().values() ?? []) total += left;
  return Math.round(total * 10_000) / 10_000;
}

// The money state as a tick reads it, for a role job's session to check its budget against
// (job-handlers/draft-card.ts): the studio, the pool and every card that can hold money, read fresh.
export async function currentMoneyState(deps: MoneyDeps): Promise<MoneyState> {
  const [studio, pool, cards] = await Promise.all([deps.db.getStudioState(), deps.db.getPool(), deps.db.listCardsInStages([...HOLD_STAGES, ...RUNNING_STAGES])]);
  return moneyState(deps, studio, pool, cards);
}

// Two reads, both summed in the database: each card's studio spend (dispatcher_card_spend) and the spend
// totals (studio_spend_totals), so a tick never downloads the ledger.
async function moneyState(deps: MoneyDeps, studio: StudioState, pool: Pool, cards: readonly Card[]): Promise<MoneyState> {
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
    jobsUsd: jobsHoldUsd(deps.jobBudgets),
  };
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
