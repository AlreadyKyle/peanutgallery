// One attended role-job session (docs/specs/agent-workflows.md): the Studio Head's ranking, a Game
// Designer round or a Game Director grade. It runs through the attended adapter (claude -p on the
// founder's plan) in either studio mode, so no role job spends studio or supporter money:
// - the session holds exactly its role spec's tools, which may only be Read, Glob, Grep and Bash
//   (Bash as the folder's package scripts), never Write, Edit, a web tool, an MCP tool or a
//   fallback model; the init line must show no other tool and no API key;
// - every turn is metered as card sessions are (metering.ts) and written billed to the founder with
//   the role and no card, each row under its own request id, so a replayed write is recorded once;
// - it stops when the board session lapses, the role is paused, the job is stopped, or it runs past
//   its turn cap, budget or wall clock;
// - its final message must be exactly one object valid against the job's schema (typed-output.ts),
//   or the session fails and the caller writes nothing.
import { SessionPaused, type AgentAdapter, type AgentEvent, type EndEvent, type SessionSpec } from './adapters/types.js';
import { refusedTools } from './adapters/tool-names.js';
import type { Db, Role } from './db.js';
import { errorMessage, type Logger } from './log.js';
import { SessionMeter, isSyntheticModel, type MeterRow } from './metering.js';
import { modelPrice, round4, type PriceTable } from './pricing.js';
import { API_KEY_SOURCE, LEDGER_RETRY_MS, LEDGER_TRIES, roleTools, rolePromptFile } from './session.js';
import { retry } from './time.js';
import type { SchemaName, TypedOutput } from './typed-output.js';

// The only tools a role job may hold. Write and Edit never appear: a planner or reviewer answers in
// its final message and changes no file.
export const ROLE_JOB_TOOLS: readonly string[] = ['Read', 'Glob', 'Grep', 'Bash'];
// Tools the init line must never report for a role job.
const NEVER_TOOLS = ['Write', 'Edit', 'NotebookEdit', 'MultiEdit'];

export interface RoleSessionDeps {
  db: Pick<Db, 'recordUsage' | 'boardSessionActive' | 'roleState'>;
  // The attended adapter, whatever mode the card sessions run in.
  adapter: AgentAdapter;
  typed: TypedOutput;
  priceTable: PriceTable;
  maxTurns: number;
  maxMs: number;
  boardSessionTtlMin: number;
  watchIntervalMs: number;
  log: Logger;
  // The job's stop signal: the role or the studio paused, or the dispatcher stopping.
  stopSignal: AbortSignal;
  now: () => Date;
  ledgerRetryMs?: number;
}

export interface RoleSessionRequest {
  role: Role;
  runId: string;
  // Unique within the run: designer-1, director-1, head-1.
  label: string;
  worktree: string;
  prompt: string;
  schema: SchemaName;
  budgetUsd: number;
}

export type RoleSessionResult<T> =
  | { ok: true; value: T; ref: string; turns: number; usd: number }
  // invalidOutput: the session ran and its final message was not one object valid against the schema.
  | { ok: false; reason: string; ref: string; turns: number; usd: number; invalidOutput: boolean };

// Why the role's tools may not run a role job, or null.
export function roleToolProblem(tools: readonly string[]): string | null {
  const refused = refusedTools(tools);
  if (refused.length > 0) return `role tools include excluded tools: ${refused.join(', ')}`;
  const other = tools.filter((tool) => !ROLE_JOB_TOOLS.includes(tool));
  if (other.length > 0) return `a role job holds only Read, Glob, Grep and Bash, not ${other.join(', ')}`;
  return null;
}

// The session spec: the role's own tools, Bash as seed-1's package scripts, in the scratch worktree.
export function roleSessionSpec(request: RoleSessionRequest, maxTurns: number): SessionSpec {
  const model = request.role.model.trim();
  return {
    cardId: `job-${request.runId}`,
    worktree: request.worktree,
    prompt: request.prompt,
    systemPromptFile: rolePromptFile(request.role, request.worktree),
    model,
    roleTools: roleTools(request.role),
    folder: 'seed-1',
    maxTurns,
    maxBudgetUsd: round4(request.budgetUsd),
    roleId: request.role.id,
  };
}

// Why an init line refuses the session, or null.
function startRefusal(event: Extract<AgentEvent, { type: 'start' }>): string | null {
  const refused = [...refusedTools(event.tools), ...event.tools.filter((tool) => NEVER_TOOLS.includes(tool))];
  if (refused.length > 0) return `session exposes tools a role job may not hold: ${refused.join(', ')}`;
  if (event.apiKeySource === API_KEY_SOURCE) return 'session bills an API key; a role job runs on the founder plan';
  return null;
}

export async function runRoleSession<T>(request: RoleSessionRequest, deps: RoleSessionDeps): Promise<RoleSessionResult<T>> {
  const { role } = request;
  let ref = `run:${request.runId}/${request.label}`;
  const fail = (reason: string, turns = 0, usd = 0, invalidOutput = false): RoleSessionResult<T> => ({ ok: false, reason, ref, turns, usd, invalidOutput });
  if (deps.adapter.mode !== 'attended') return fail('a role job runs attended, on the founder plan');
  const toolProblem = roleToolProblem(roleTools(role));
  if (toolProblem) return fail(toolProblem);
  if (!role.model.trim()) return fail(`role ${role.name} has no model`);
  if (!modelPrice(deps.priceTable, role.model.trim())) return fail(`no price for model ${role.model}`);
  if (!(request.budgetUsd > 0)) return fail('the session budget must be above zero');
  const spec = roleSessionSpec(request, deps.maxTurns);
  try {
    await deps.adapter.preflight(spec);
  } catch (error) {
    return fail(errorMessage(error));
  }

  const controller = new AbortController();
  let aborted: string | null = null;
  const abort = (reason: string) => {
    if (aborted) return;
    aborted = reason;
    deps.log.warn('role-session', `stopping ${request.label}`, { run: request.runId, role: role.name, reason });
    controller.abort(reason);
  };
  const onStop = () => abort(String(deps.stopSignal.reason ?? 'stopped'));
  if (deps.stopSignal.aborted) onStop();
  deps.stopSignal.addEventListener('abort', onStop, { once: true });
  const watch = setInterval(() => {
    void (async () => {
      try {
        const [present, state] = await Promise.all([deps.db.boardSessionActive(deps.boardSessionTtlMin, deps.now()), deps.db.roleState(role.id)]);
        if (!present) abort('board_session_lapsed');
        else if (state.paused) abort('role_paused');
      } catch (error) {
        deps.log.warn('role-session', 'watch failed', { run: request.runId, error: errorMessage(error) });
      }
    })();
  }, deps.watchIntervalMs);
  const wallClock = setTimeout(() => abort('wall_clock'), deps.maxMs);

  const meter = new SessionMeter(deps.priceTable, `job/${request.runId}/${request.label}`, spec.model);
  const record = (row: MeterRow) =>
    retry(
      () => deps.db.recordUsage({ billed_to: 'founder', card_id: null, role_id: role.id, ...row }),
      LEDGER_TRIES,
      deps.ledgerRetryMs ?? LEDGER_RETRY_MS,
      (error, attempt) => deps.log.warn('role-session', 'ledger write failed', { run: request.runId, request_id: row.request_id, attempt, error: errorMessage(error) }),
    );
  let end: EndEvent | null = null;
  let turns = 0;
  const onEvent = async (event: AgentEvent) => {
    switch (event.type) {
      case 'start': {
        if (event.sessionId) ref = `claude:${event.sessionId}`;
        const refusal = startRefusal(event);
        if (refusal) abort(refusal);
        return;
      }
      case 'turn_usage': {
        turns = event.turn;
        if (event.turn > deps.maxTurns) abort('turn_cap');
        if (isSyntheticModel(event.model)) return;
        const { row, fallback } = meter.addTurn(event);
        if (row.usd > 0 || row.input_tokens > 0 || row.output_tokens > 0 || row.cached_tokens > 0) {
          try {
            await record(row);
            meter.commit(row);
          } catch (error) {
            abort(`the ledger refused turn ${event.turn}: ${errorMessage(error)}`);
          }
        }
        if (fallback) abort(`no price for model ${event.model}`);
        if (meter.liveEstimateUsd() >= request.budgetUsd) abort('budget');
        return;
      }
      case 'turn_content':
        meter.addContent(event);
        return;
      case 'compaction':
        meter.addCompaction(event);
        return;
      case 'end':
        end = event;
        return;
      default:
        return;
    }
  };

  let result;
  try {
    result = await deps.adapter.run(spec, onEvent, controller.signal);
  } catch (error) {
    return fail(error instanceof SessionPaused ? error.message : `session error: ${errorMessage(error)}`, turns, round4(meter.recordedUsd()));
  } finally {
    clearInterval(watch);
    clearTimeout(wallClock);
    deps.stopSignal.removeEventListener('abort', onStop);
    const settled = meter.settle(end);
    for (const row of settled.rows) {
      try {
        await record(row);
        meter.commit(row);
      } catch (error) {
        deps.log.error('role-session', 'settle row not written', { run: request.runId, request_id: row.request_id, usd: row.usd, error: errorMessage(error) });
      }
    }
  }
  const usd = round4(meter.recordedUsd());
  if (aborted) return fail(aborted, result.turns, usd);
  const finished = end as EndEvent | null;
  if (result.endSubtype === 'error_max_turns' || result.killReason === 'turn_cap') return fail('turn_cap', result.turns, usd);
  if (result.endSubtype === 'error_max_budget_usd') return fail('budget', result.turns, usd);
  if (result.isError || result.exitCode !== 0 || finished === null) {
    return fail(`the model call failed: ${result.endSubtype ?? 'no result'} (exit ${result.exitCode ?? 'signal'})`, result.turns, usd);
  }
  const parsed = deps.typed.parse<T>(request.schema, finished.result);
  if (!parsed.ok) return fail(parsed.error, result.turns, usd, true);
  return { ok: true, value: parsed.value, ref, turns: result.turns, usd };
}
