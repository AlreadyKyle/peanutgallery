// Startup rules for the dispatcher: the database must agree on the agent mode, every writing role's
// model must have a price, and in unattended mode the one-turn probe must pass and be metered before
// any card runs. The probe runner is passed in so tests can run these rules without git, a network or
// a real adapter. A failure that cannot change on retry is a fatal StartupError, which main.ts turns
// into exit 78.
import type { AgentAdapter } from './adapters/types.js';
import type { DispatcherConfig } from './config.js';
import type { Db } from './db.js';
import { StartupError } from './exit-code.js';
import type { Logger } from './log.js';
import { modelPrice } from './pricing.js';
import { billedToWrongAccount } from './session.js';
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
// gated on the wrong rule. Not fatal: the board fixes it from /board and the next restart, which
// runs no probe until the modes agree, costs nothing.
export async function checkMode(db: Db, config: DispatcherConfig): Promise<void> {
  const studio = await db.getStudioState();
  if (studio.agent_mode !== config.agentMode) {
    throw new StartupError(
      `studio_state.agent_mode is ${studio.agent_mode || 'unset'} but AGENT_MODE is ${config.agentMode}; set the mode from /board or start the dispatcher in the matching mode`,
      false,
    );
  }
}

// A session runs on its role's model, or MODEL_BUILDER when the role names none. A writing role whose
// model has no price could not be metered, and the price table and the roles are the same on every
// restart, so it is fatal.
export async function checkRoleModels(db: Db, config: DispatcherConfig): Promise<void> {
  const roles = await db.listActiveRoles();
  const unpriced = roles
    .filter((role) => role.write_access)
    .map((role) => ({ name: role.name, model: role.model || config.modelBuilder }))
    .filter((role) => !modelPrice(config.priceTable, role.model));
  if (unpriced.length > 0) {
    throw new StartupError(`no price in PRICE_TABLE_JSON for ${unpriced.map((role) => `${role.name} (${role.model})`).join(', ')}`, true);
  }
}

// The probe costs money whether or not it passes, so it is metered before the verdict is acted
// on. A ledger row with no card and no role is the studio's own spend; a probe that ran on the
// wrong account for the mode is recorded as the founder's. An unknown model is treated as a card
// turn treats it: its rows are written at the fallback rates, and then the caller stops, since the
// model is missing on every start and each start would spend on a probe it cannot price.
export async function meterProbe(db: Db, config: DispatcherConfig, probe: ProbeResult, log: Logger): Promise<void> {
  const { rows, basis, fallbackModels, overcountUsd } = probe.metering;
  if (rows.length === 0) {
    log.warn('probe', 'the probe reported no token usage; nothing metered', { ok: probe.ok, turns: probe.turns });
  }
  const billedTo = billedToWrongAccount(config.agentMode, probe.apiKeySource) ? 'founder' : billingFor(config.agentMode);
  for (const row of rows) {
    const recorded = await db.recordUsage({ billed_to: billedTo, card_id: null, role_id: null, ...row });
    log.info('probe', 'probe metered', { ledger: recorded.ledger_id, model: row.model, usd: row.usd, billedTo, balance: recorded.balance_usd });
  }
  if (rows.length > 0 && (basis === 'estimate' || overcountUsd > 0)) {
    log.warn('probe', 'probe metering needs review', { basis, overcountUsd, cliTotalCostUsd: probe.costUsd });
  }
  if (fallbackModels.length > 0) throw new StartupError(`no price for model ${fallbackModels.join(', ')}`, true);
}

export async function startupProbe(deps: StartupDeps): Promise<void> {
  const { db, adapter, config, log } = deps;
  log.info('probe', 'running the startup probe', { mode: adapter.mode, model: config.modelBuilder });
  const probe = await deps.runProbe(adapter, { repoRoot: config.repoRoot, worktreeRoot: config.worktreeRoot, model: config.modelBuilder, priceTable: config.priceTable });
  await meterProbe(db, config, probe, log);
  if (!probe.ok) throw new StartupError(`startup probe failed: ${probe.reason}`, probe.fatal);
  log.info('probe', 'startup probe passed', { apiKeySource: probe.apiKeySource, tools: probe.tools, turns: probe.turns, costUsd: probe.costUsd });
}

// The mode and role model checks run first so a process that could not run a card never spends
// money on a probe.
export async function startupChecks(deps: StartupDeps): Promise<void> {
  await checkMode(deps.db, deps.config);
  await checkRoleModels(deps.db, deps.config);
  if (deps.config.agentMode === 'unattended') await startupProbe(deps);
}
