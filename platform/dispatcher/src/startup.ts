// Startup rules for the dispatcher: on the VPS its code root must be read-only to it, the database must agree on the agent mode, every writing role's
// model must have a price, and in unattended mode the one-turn probe must pass and be metered before
// any card runs. The probe runner is passed in so tests can run these rules without git, a network or
// a real adapter. A failure that cannot change on retry is a fatal StartupError, which main.ts turns
// into exit 78.
import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, open, rm } from 'node:fs/promises';
import path from 'node:path';
import type { AgentAdapter } from './adapters/types.js';
import { githubTokenProblem, type DispatcherConfig } from './config.js';
import type { Db } from './db.js';
import { StartupError } from './exit-code.js';
import { gitConfigViolations, originUrl } from './gitconfig.js';
import { errorMessage, type Logger } from './log.js';
import type { MeterRow } from './metering.js';
import { modelPrice } from './pricing.js';
import { resolveRoleModel } from './role-model.js';
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

// Rows the ledger refused after every retry. The probe's spend is already made, so the process stops
// for good rather than restart and pay for another probe; the rows are named for the board to post.
export class UnwrittenRowsError extends StartupError {
  readonly rows: Array<MeterRow & { error: string }>;
  constructor(rows: Array<MeterRow & { error: string }>) {
    super(`the ledger refused probe rows: ${rows.map((row) => `${row.request_id} ${row.model} ${row.usd} USD (${row.error})`).join(', ')}`, true);
    this.name = 'UnwrittenRowsError';
    this.rows = rows;
  }
}

// A session runs on the model its role resolves to when the session starts (role-model.ts): the env
// value of the role's MODEL_* token, else roles.model, else MODEL_BUILDER. A writing role whose model
// has no price could not be metered, and the price table and the roles are the same on every restart,
// so it is fatal. A roles.model that differs from the model the env resolves means /team shows a model
// that is not the one running; it is logged so the board re-seeds the roles.
export async function checkRoleModels(db: Db, config: DispatcherConfig, log?: Logger): Promise<void> {
  const roles = await db.listActiveRoles();
  const writers = roles.filter((role) => role.write_access).map((role) => ({ role, resolved: resolveRoleModel(role, config) }));
  const unpriced = writers.filter(({ resolved }) => !modelPrice(config.priceTable, resolved.model));
  if (unpriced.length > 0) {
    throw new StartupError(`no price in PRICE_TABLE_JSON for ${unpriced.map(({ role, resolved }) => `${role.name} (${resolved.model})`).join(', ')}`, true);
  }
  for (const { role, resolved } of writers) {
    if (resolved.source === 'env' && role.model !== resolved.model) {
      log?.warn('startup', `${role.name} runs on ${resolved.model} from ${resolved.token}, but roles.model is ${role.model || 'unset'}; re-seed the roles so /team shows it`, { role: role.name });
    }
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
  const unwritten: Array<MeterRow & { error: string }> = [];
  for (const row of rows) {
    try {
      const recorded = await retry(
        () => db.recordUsage({ billed_to: billedTo, card_id: null, role_id: null, ...row }),
        LEDGER_TRIES,
        retryMs,
        (error, attempt) => log.warn('probe', 'ledger write failed', { request_id: row.request_id, usd: row.usd, attempt, error: errorMessage(error) }),
      );
      log.info('probe', 'probe metered', { ledger: recorded.ledger_id, request_id: row.request_id, model: row.model, usd: row.usd, billedTo, balance: recorded.balance_usd });
    } catch (error) {
      log.error('probe', 'probe row not metered', { request_id: row.request_id, model: row.model, usd: row.usd, error: errorMessage(error) });
      unwritten.push({ ...row, error: errorMessage(error) });
    }
  }
  if (rows.length > 0 && (basis === 'estimate' || overcountUsd > 0 || mismatch)) {
    log.warn('probe', 'probe metering needs review', { basis, anomaly, mismatch, overcountUsd, cliTotalCostUsd: probe.costUsd });
  }
  const sideFallbacks = fallbackModels.filter((model) => !turnModels.includes(model));
  if (sideFallbacks.length > 0) log.warn('probe', 'side models metered at fallback rates; add them to PRICE_TABLE_JSON', { models: sideFallbacks });
  if (unwritten.length > 0) throw new UnwrittenRowsError(unwritten);
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

// The folders of the code root the read-only check looks at: the root, the workspace's node_modules
// and its package store, and the dispatcher's package, source and node_modules.
export const CODE_PATHS: readonly string[] = ['.', 'node_modules', 'node_modules/.pnpm', 'platform/dispatcher', 'platform/dispatcher/src', 'platform/dispatcher/node_modules'];

// Agent-written code runs as the dispatcher's own user. If that user could write the dispatcher's
// source or the modules it loads, the next start would run the change with every secret. On the VPS
// (DISPATCHER_CODE_READONLY=required) the code root is a root-owned clone mounted read-only, and this
// check proves it before anything else runs: each folder must deny write access, and creating a file
// in it must fail, since access() answers from the mode bits alone. A missing folder is refused as
// well. The mount is the same on every start, so a failure is fatal.
export async function checkCodeReadonly(codeRoot: string): Promise<void> {
  const problems: string[] = [];
  for (const relative of CODE_PATHS) {
    const folder = path.join(codeRoot, relative);
    try {
      await access(folder, fsConstants.F_OK);
    } catch {
      problems.push(`${relative} (missing)`);
      continue;
    }
    let writable = await access(folder, fsConstants.W_OK).then(
      () => true,
      () => false,
    );
    const probe = path.join(folder, `.dispatcher-readonly-check-${process.pid}-${randomBytes(4).toString('hex')}`);
    try {
      const handle = await open(probe, 'wx');
      await handle.close();
      await rm(probe, { force: true });
      writable = true;
    } catch {
      // Refused, as it should be.
    }
    if (writable) problems.push(`${relative} (writable)`);
  }
  if (problems.length > 0) {
    throw new StartupError(
      `the code root ${codeRoot} is writable by this process or incomplete: ${problems.join(', ')}; DISPATCHER_CODE_READONLY=required runs the dispatcher only from a read-only code clone (platform/ops/README.md)`,
      true,
    );
  }
}

// The code root check runs first, before any database read. The mode and role model checks run next
// so a process that could not run a card never spends money on a probe.
export async function startupChecks(deps: StartupDeps): Promise<void> {
  if (deps.config.codeReadonly) {
    await checkCodeReadonly(deps.config.codeRoot);
    deps.log.info('startup', 'code root is read-only', { codeRoot: deps.config.codeRoot });
  }
  // Unattended mode refuses such a token when the config loads (config.ts).
  const tokenProblem = githubTokenProblem(deps.config.githubToken);
  if (tokenProblem) deps.log.warn('startup', tokenProblem, { mode: deps.config.agentMode });
  await checkMode(deps.db, deps.config);
  await checkRoleModels(deps.db, deps.config, deps.log);
  if (deps.config.agentMode === 'unattended') await startupProbe(deps);
}
