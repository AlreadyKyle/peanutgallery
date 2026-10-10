// The Appendix A loop, one tick: hold the dispatcher lease, unpause a studio the dispatcher paused for
// money once the credit probe passes, deal the approved agent cards whose cooling window has passed,
// resume the ceiling-paused cards the rule may resume (docs/specs/agent-system-core.md) and the cards
// paused for a reason that is not theirs (pause-checks.ts, docs/specs/unattended-roles.md), read studio_state, check the board session, read the pool,
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
import type { CreditProbeOutcome } from './credit-probe.js';
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
  // Unattended mode: the one-token call on the studio key (credit-probe.ts) that tells whether a pause
  // the dispatcher set for awaiting_credit or spend_limit can be lifted. Unset (attended mode, where no
  // such pause is set): never probed.
  creditProbe?: () => Promise<CreditProbeOutcome>;
  // The probe's backoff for this process; created on the first tick that needs it when unset.
  studioProbe?: StudioProbeState;
}

// The pause the credit probe is backing off on, how many probes it has refused, and when the next may run.
export interface StudioProbeState {
  key: string | null;
  failures: number;
  nextAt: number;
}

export function newStudioProbeState(): StudioProbeState {
  return { key: null, failures: 0, nextAt: 0 };
}

// awaiting_credit is probed 15 minutes after the pause, then after 30, 60 and 120 minutes, then every
// 4 hours; spend_limit, which clears only when the month turns or the tier rises, every hour.
export const CREDIT_PROBE_FIRST_MS = 15 * 60_000;
export const CREDIT_PROBE_MAX_MS = 4 * 60 * 60_000;
export const SPEND_LIMIT_PROBE_MS = 60 * 60_000;

export function probeDelayMs(reason: 'awaiting_credit' | 'spend_limit', failures: number): number {
  if (reason === 'spend_limit') return SPEND_LIMIT_PROBE_MS;
  return Math.min(CREDIT_PROBE_MAX_MS, CREDIT_PROBE_FIRST_MS * 2 ** failures);
}

// Only a pause the dispatcher set for money it could not spend is probed: never the board's or the
// moderator's (paused_by is their email), and never an incident.
function probedPause(studio: StudioState): 'awaiting_credit' | 'spend_limit' | null {
  if (!studio.paused || !(studio.paused_by ?? '').startsWith('dispatcher')) return null;
  return studio.pause_reason === 'awaiting_credit' || studio.pause_reason === 'spend_limit' ? studio.pause_reason : null;
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
  if (!halted) await resumeStudio(deps);
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

// A studio the dispatcher paused for awaiting_credit or spend_limit is unpaused once the credit probe
// answers ok (dispatcher_resume_studio, which refuses any other pause). The probe runs at most once per
// probeDelayMs, counted from the pause and then from each refusal, and the board hears once when the
// studio resumes. A failed read, probe or write is logged and never stops the tick; the studio then
// stays paused.
async function resumeStudio(deps: TickDeps): Promise<void> {
  if (!deps.creditProbe) return;
  const state = (deps.studioProbe ??= newStudioProbeState());
  let studio: StudioState;
  try {
    studio = await deps.db.getStudioState();
  } catch (error) {
    deps.log.warn('tick', 'studio_state could not be read for the credit probe', { error: errorMessage(error) });
    return;
  }
  const reason = probedPause(studio);
  if (reason === null) {
    state.key = null;
    return;
  }
  const now = deps.now().getTime();
  const key = `${reason}:${studio.paused_at ?? ''}`;
  if (state.key !== key) {
    const since = studio.paused_at ? Date.parse(studio.paused_at) : Number.NaN;
    state.key = key;
    state.failures = 0;
    state.nextAt = (Number.isFinite(since) ? since : now) + probeDelayMs(reason, 0);
  }
  if (now < state.nextAt) return;
  let probe: CreditProbeOutcome;
  try {
    probe = await deps.creditProbe();
  } catch (error) {
    probe = { outcome: 'error', model: null, detail: errorMessage(error) };
  }
  if (probe.outcome !== 'ok') {
    state.failures += 1;
    state.nextAt = now + probeDelayMs(reason, state.failures);
    deps.log.info('tick', 'the credit probe was refused; the studio stays paused', { reason, probe, failures: state.failures, nextProbeAt: new Date(state.nextAt).toISOString() });
    return;
  }
  let resumed: boolean;
  try {
    resumed = await deps.db.dispatcherResumeStudio('credit_probe_ok', { pause_reason: reason, paused_by: studio.paused_by ?? null, paused_at: studio.paused_at ?? null, model: probe.model, usd: probe.usd });
  } catch (error) {
    state.failures += 1;
    state.nextAt = now + probeDelayMs(reason, state.failures);
    deps.log.warn('tick', 'dispatcher_resume_studio failed; the studio stays paused', { error: errorMessage(error) });
    return;
  }
  state.key = null;
  if (!resumed) {
    deps.log.info('tick', 'the credit probe passed but the studio was not unpaused: its pause is no longer the dispatcher\'s', { reason });
    return;
  }
  deps.log.info('tick', 'the credit probe passed; the studio is unpaused', { reason, model: probe.model, usd: probe.usd });
  const what = reason === 'awaiting_credit' ? 'Console credit' : "the usage tier's monthly cap";
  await deps.alert.notifyOnce(
    `studio_resumed:${key}`,
    `The studio is unpaused: the dispatcher paused it for ${what}, and a one-token call on the studio key went through again. Cards paused for it resume on their own.`,
  );
}

// Dealing, resume by rule and auto-resume are the database's (deal_due_cards, resume_due_by_rule,
// auto_resume_due); each is logged and never stops the tick.
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
  try {
    const auto = await deps.db.autoResumeDue();
    if (auto.resumed > 0) deps.log.info('tick', `${auto.resumed} card(s) resumed on their own`, { results: auto.results.filter((result) => result.resumed === true) });
  } catch (error) {
    deps.log.warn('tick', 'auto_resume_due failed', { error: errorMessage(error) });
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

// Two reads, both summed in the database: each card's studio spend (dispatcher_card_spend) and the spend
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
