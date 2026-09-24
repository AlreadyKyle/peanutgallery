// Startup rules for the dispatcher: on the VPS its code root must be read-only to it, the database
// must agree on the agent mode, every writing role's model must have a price, and in unattended mode
// the containment check and the managed probe must pass, the probe metered as overhead, before any
// card runs (docs/specs/launch-managed.md). The adapter is passed in, so tests run these rules with a
// fake Managed Agents client and no network. A failure that cannot change on retry is a fatal
// StartupError, which main.ts turns into exit 78.
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
import { modelPrice } from './pricing.js';
import { resolveRoleModel } from './role-model.js';


export interface StartupDeps {
  db: Db;
  adapter: AgentAdapter;
  config: DispatcherConfig;
  log: Logger;
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

// Unattended mode runs only on the managed adapter. Before any card: the containment check (the
// managed ids, a read-only token that cannot write, the agent and environment exactly as the
// repository declares them), then the probe, one minimal Managed Agents session billed as overhead.
// A drifted config, a token that can write or an unpriced probe model cannot change on retry and is
// fatal; an API that does not answer is not.
export async function unattendedStartup(deps: StartupDeps): Promise<void> {
  const managed = deps.adapter.managed;
  if (deps.adapter.mode !== 'unattended' || !managed) {
    throw new StartupError('unattended mode runs only on the managed adapter, which this process did not build', true);
  }
  await managed.checkContainment();
  deps.log.info('probe', 'running the startup probe', { mode: 'unattended', model: deps.config.modelBuilder, billed_to: 'overhead' });
  await managed.probe();
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

// At startup, once the lease is held: a job run still marked running belonged to a process that is
// gone, so it is finished as failed (fail_running_job_runs, docs/specs/agent-system-core.md).
export const RESTART_REASON = 'dispatcher_restart';

export async function failStaleJobRuns(db: Db, holder: string, log: Logger): Promise<number> {
  const count = await db.failRunningJobRuns(holder, RESTART_REASON);
  log.info('startup', `${count} running job run(s) finished as failed`, { count, reason: RESTART_REASON });
  return count;
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
  if (deps.config.agentMode === 'unattended') await unattendedStartup(deps);
}
