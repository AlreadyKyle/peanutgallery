// The Appendix A loop, one tick: read studio_state, check the board session, read the pool,
// apply the throttle, select the card, claim it, and start its pipeline in the background.
import type { AgentMode } from './adapters/types.js';
import type { Card, Db } from './db.js';
import { errorMessage, type Logger } from './log.js';
import { selectCard } from './select.js';
import { available, canStart, concurrency, type SleepReason } from './throttle.js';

export interface TickDeps {
  db: Db;
  mode: AgentMode;
  boardSessionTtlMin: number;
  maxConcurrency: number;
  running: Set<string>;
  now: () => Date;
  runCard: (card: Card) => Promise<void>;
  log: Logger;
}

export type TickOutcome =
  | { action: 'sleep'; reason: SleepReason | 'no_eligible_card' | 'mode_mismatch' }
  | { action: 'started'; cardId: string }
  | { action: 'claim_lost'; cardId: string };

export async function tick(deps: TickDeps): Promise<TickOutcome> {
  const studio = await deps.db.getStudioState();
  if (studio.paused) return { action: 'sleep', reason: 'paused' };
  if (studio.agent_mode !== deps.mode) {
    deps.log.warn('tick', 'studio_state.agent_mode differs from the running adapter', { studio: studio.agent_mode, adapter: deps.mode });
    return { action: 'sleep', reason: 'mode_mismatch' };
  }
  const boardSessionActive = await checkBoardSession(deps);
  const pool = await deps.db.getPool();
  const funded = await deps.db.listFundedCards();
  const reserved = await reservedEstimates(deps.db);
  const availableUsd = available(pool.balance_usd, studio.studio_reserve_usd, reserved);
  const decision = canStart({
    paused: studio.paused,
    mode: deps.mode,
    boardSessionActive,
    balanceUsd: pool.balance_usd,
    dailySpentUsd: pool.daily_spent_usd,
    dailyCapUsd: studio.daily_cap_usd,
    availableUsd,
    smallestEstimateUsd: smallestEstimate(funded),
    running: deps.running.size,
    concurrency: concurrency(pool.balance_usd, studio.agent_hourly_rate_usd, deps.mode, deps.maxConcurrency),
  });
  if (!decision.ok) return { action: 'sleep', reason: decision.reason };
  const card = selectCard(funded, availableUsd, pool.incident_reserve_usd);
  if (!card) return { action: 'sleep', reason: 'no_eligible_card' };
  const claimed = await deps.db.claimCard(card.id);
  if (!claimed) return { action: 'claim_lost', cardId: card.id };
  startCard(deps, claimed);
  return { action: 'started', cardId: claimed.id };
}

async function checkBoardSession(deps: TickDeps): Promise<boolean> {
  if (deps.mode !== 'attended') return true;
  return deps.db.boardSessionActive(deps.boardSessionTtlMin, deps.now());
}

// Estimates of cards already building or gated stay reserved until they reach a terminal stage.
async function reservedEstimates(db: Db): Promise<number> {
  const cards = await db.listCardsInStages(['building', 'gated']);
  return cards.reduce((total, card) => total + card.estimate_usd, 0);
}

function smallestEstimate(cards: readonly Card[]): number | null {
  if (cards.length === 0) return null;
  return Math.min(...cards.map((card) => card.estimate_usd));
}

function startCard(deps: TickDeps, card: Card): void {
  deps.running.add(card.id);
  deps.log.info('tick', `card ${card.id} claimed`, { title: card.title, lane: card.lane, estimate: card.estimate_usd });
  deps
    .runCard(card)
    .catch((error: unknown) => deps.log.error('tick', `card ${card.id} pipeline threw`, { error: errorMessage(error) }))
    .finally(() => deps.running.delete(card.id));
}
