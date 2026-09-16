// Startup rules for the dispatcher: the database must agree on the agent mode, every writing role's
// model must have a price, and in unattended mode the one-turn probe must pass and be metered before
// any card runs. The probe runner is passed in so tests can run these rules without git, a network or
// a real adapter. A failure that cannot change on retry is a fatal StartupError, which main.ts turns
// into exit 78.
import type { AgentAdapter } from './adapters/types.js';
import type { DispatcherConfig } from './config.js';
import type { Db } from './db.js';
import { StartupError } from './exit-code.js';
import { gitConfigViolations, originUrl } from './gitconfig.js';
import { errorMessage, type Logger } from './log.js';
import { modelPrice } from './pricing.js';
import { LEDGER_RETRY_MS, LEDGER_TRIES, billedToWrongAccount } from './session.js';
import { billingFor } from './throttle.js';
import { retry } from './time.js';
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

// The repository the dispatcher runs git in must carry only the git configuration git itself writes,
// and its origin must be the studio's repository. A halt lives in memory, so this is what keeps a
// restarted dispatcher from running git against configuration a session planted: the process exits
// 78 and stays down until someone has cleaned the repository.
export async function checkRepositoryGit(repoRoot: string, githubRepo: string): Promise<void> {
  let violations: string[];
  let origin: string | null;
  try {
    violations = await gitConfigViolations(repoRoot, null);
    origin = await originUrl(repoRoot);
  } catch (error) {
    throw new StartupError(`the repository's git configuration could not be read: ${errorMessage(error)}`, true);
  }
  if (violations.length > 0) throw new StartupError(`the repository's git configuration is refused: ${violations.join('; ')}`, true);
  const expected = `https://github.com/${githubRepo}`;
  if (origin !== expected && origin !== `${expected}.git`) {
    throw new StartupError(`remote.origin.url is ${origin ?? 'unset'}, not ${expected}(.git)`, true);
  }
}

// The probe's own model had no price. Its rows were written at the fallback rates first.
export class FallbackPricedError extends StartupError {
  readonly models: string[];
  constructor(models: string[]) {
    super(`no price for model ${models.join(', ')}`, true);
    this.name = 'FallbackPricedError';
    this.models = models;
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
// wrong account for the mode, or with no init line to say, is recorded as the founder's. A model the
// probe's turns ran on that is missing from the table is treated as a card turn treats it: the rows
// are written at the fallback rates, and then the caller stops, since the model is missing on every
// start and each start would spend on a probe it cannot price. A side model seen only in modelUsage
// is metered at the fallback rates and logged, and does not stop the process.
export async function meterProbe(db: Db, config: DispatcherConfig, probe: ProbeResult, log: Logger, retryMs: number = LEDGER_RETRY_MS): Promise<void> {
  const { rows, basis, fallbackModels, turnModels, overcountUsd, mismatch, anomaly } = probe.metering;
  if (rows.length === 0) {
    log.warn('probe', 'the probe reported no token usage; nothing metered', { ok: probe.ok, turns: probe.turns });
  }
  const billedTo = billedToWrongAccount(config.agentMode, probe.apiKeySource) ? 'founder' : billingFor(config.agentMode);
  for (const row of rows) {
    const recorded = await retry(() => db.recordUsage({ billed_to: billedTo, card_id: null, role_id: null, ...row }), LEDGER_TRIES, retryMs);
    log.info('probe', 'probe metered', { ledger: recorded.ledger_id, model: row.model, usd: row.usd, billedTo, balance: recorded.balance_usd });
  }
  if (rows.length > 0 && (basis === 'estimate' || overcountUsd > 0 || mismatch)) {
    log.warn('probe', 'probe metering needs review', { basis, anomaly, mismatch, overcountUsd, cliTotalCostUsd: probe.costUsd });
  }
  const sideFallbacks = fallbackModels.filter((model) => !turnModels.includes(model));
  if (sideFallbacks.length > 0) log.warn('probe', 'side models metered at fallback rates; add them to PRICE_TABLE_JSON', { models: sideFallbacks });
  const turnFallbacks = fallbackModels.filter((model) => turnModels.includes(model));
  if (turnFallbacks.length > 0) throw new FallbackPricedError(turnFallbacks);
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
