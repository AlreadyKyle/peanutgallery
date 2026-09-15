// Startup rules for the dispatcher: the database must agree on the agent mode, and in unattended
// mode the one-turn probe must pass and be metered before any card runs. The probe runner is
// passed in so tests can run these rules without git, a network or a real adapter.
import type { AgentAdapter } from './adapters/types.js';
import type { DispatcherConfig } from './config.js';
import type { Db } from './db.js';
import type { Logger } from './log.js';
import { priceUsage } from './pricing.js';
import { billingFor } from './throttle.js';
import type { ProbeOptions, ProbeResult } from './probe-core.js';

export type ProbeRunner = (adapter: AgentAdapter, options: ProbeOptions) => Promise<ProbeResult>;

export interface StartupDeps {
  db: Db;
  adapter: AgentAdapter;
  config: DispatcherConfig;
  log: Logger;
  runProbe: ProbeRunner;
}

// The board sets the mode from /board and the process reads its own from AGENT_MODE; when they
// disagree nothing should run, because the sessions would be billed to the wrong account or
// gated on the wrong rule.
export async function checkMode(db: Db, config: DispatcherConfig): Promise<void> {
  const studio = await db.getStudioState();
  if (studio.agent_mode !== config.agentMode) {
    throw new Error(
      `studio_state.agent_mode is ${studio.agent_mode || 'unset'} but AGENT_MODE is ${config.agentMode}; set the mode from /board or start the dispatcher in the matching mode`,
    );
  }
}

// The probe costs money whether or not it passes, so it is metered before the verdict is acted
// on. A ledger row with no card and no role is the studio's own spend. An unknown model is
// treated as a card turn treats it: priceUsage throws, no row is written at zero, and the caller
// stops.
export async function meterProbe(db: Db, config: DispatcherConfig, probe: ProbeResult, log: Logger): Promise<void> {
  const usage = probe.usage;
  if (usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens + usage.output_tokens === 0) {
    log.warn('probe', 'the probe reported no token usage; nothing metered', { ok: probe.ok, turns: probe.turns });
    return;
  }
  const priced = priceUsage(config.priceTable, probe.model ?? config.modelBuilder, usage);
  const recorded = await db.recordUsage({ billed_to: billingFor(config.agentMode), card_id: null, role_id: null, ...priced });
  log.info('probe', 'probe metered', { ledger: recorded.ledger_id, model: priced.model, usd: priced.usd, balance: recorded.balance_usd });
}

export async function startupProbe(deps: StartupDeps): Promise<void> {
  const { db, adapter, config, log } = deps;
  log.info('probe', 'running the startup probe', { mode: adapter.mode, model: config.modelBuilder });
  const probe = await deps.runProbe(adapter, { repoRoot: config.repoRoot, worktreeRoot: config.worktreeRoot, model: config.modelBuilder });
  await meterProbe(db, config, probe, log);
  if (!probe.ok) throw new Error(`startup probe failed: ${probe.reason}`);
  log.info('probe', 'startup probe passed', { apiKeySource: probe.apiKeySource, tools: probe.tools, turns: probe.turns, costUsd: probe.costUsd });
}

// The mode check runs first so a mismatched process never spends money on a probe.
export async function startupChecks(deps: StartupDeps): Promise<void> {
  await checkMode(deps.db, deps.config);
  if (deps.config.agentMode === 'unattended') await startupProbe(deps);
}
