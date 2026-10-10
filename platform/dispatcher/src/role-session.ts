// One role session (docs/specs/agent-workflows.md, docs/specs/design-review.md): a Game Designer round
// or a Game Director grade, and a Director's visual review of a card's frames. It runs on one of two
// adapters:
// - the managed adapter (unattended, on the studio's Console credit): the writer agent with its tools
//   overridden to read, glob and grep, the role prompt as its system prompt and the files it reads
//   uploaded and mounted (adapters/managed.ts runRole). The adapter writes the ledger rows itself,
//   billed to the card the session is for (studio) or, for no card, to overhead, with the role;
// - the attended adapter (claude -p on the founder's plan), only where the caller allows it
//   (allowAttended: the hand-run replay eval alone; the dispatcher builds no attended adapter, PLAN.md
//   §10 decision 66). Its turns are metered as card sessions are (metering.ts) and written billed to
//   the founder with the role and no card, each row under its own request id, so a replayed write is
//   recorded once.
// Either way:
// - the session holds exactly its role spec's tools, which may only be Read, Glob, Grep and Bash
//   (Bash as the folder's package scripts), never Write, Edit, a web tool, an MCP tool or a fallback
//   model; the start event must show no other tool, and the account the adapter bills;
// - on the dispatcher it holds no Bash either: the seed's scripts are agent-written code, and no
//   agent-written code runs on the dispatcher's host (PLAN §6, decision 25), so there a role session
//   reads with Read, Glob and Grep only, and nothing is installed for it;
// - it stops when the role is paused, the job is stopped, the API refuses the studio key for credit
//   or at its tier cap, or it runs past its turn cap, budget or wall clock. No board member need be
//   signed in, and nothing reads a board session;
// - its final message must be exactly one object valid against the job's schema (typed-output.ts),
//   or the session fails and the caller writes nothing.
import { readFile } from 'node:fs/promises';
import { SessionPaused, type AgentAdapter, type AgentEvent, type EndEvent, type RoleSessionFile, type SessionSpec } from './adapters/types.js';
import { refusedTools } from './adapters/tool-names.js';
import { refusalForCheck, spendRefusal, type SpendRefusal } from './credit.js';
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
// Tools the start event must never report for a role job, in Claude Code's and Managed Agents' names.
const NEVER_TOOLS = ['Write', 'Edit', 'NotebookEdit', 'MultiEdit', 'write', 'edit'];

export interface RoleSessionDeps {
  db: Pick<Db, 'recordUsage' | 'roleState' | 'getStudioState'>;
  // True stops the session when the studio is paused (the board's pause, an incident or a money
  // pause), as a card session stops: a Director's review billed to the card.
  stopWhenStudioPaused?: boolean;
  // The managed adapter, or the attended adapter where allowAttended says so.
  adapter: AgentAdapter;
  // True lets the session run on the attended adapter (claude -p, billed to the founder). Without it
  // an attended adapter is refused.
  allowAttended?: boolean;
  // Whether a session may run its folder's package scripts (Bash): true only for a hand-run attended
  // session; the dispatcher's host runs no agent-written code.
  scripts: boolean;
  typed: TypedOutput;
  priceTable: PriceTable;
  // The model a role runs on when its session starts: the env value of its MODEL_* token first
  // (role-model.ts resolveRoleModel), as card sessions do. Without it, roles.model as stored.
  resolveModel?: (role: Role) => string;
  maxTurns: number;
  maxMs: number;
  watchIntervalMs: number;
  log: Logger;
  // The job's stop signal: the role or the studio paused, or the dispatcher stopping.
  stopSignal: AbortSignal;
  ledgerRetryMs?: number;
}

export interface RoleSessionRequest {
  role: Role;
  runId: string;
  // Unique within the run: designer-1, director-1, head-1.
  label: string;
  worktree: string;
  // Where the role's prompt_path is read from; the worktree when unset. The visual review works in a
  // folder of frames, so its Director's prompt is read from the dispatcher's own checkout.
  promptRoot?: string;
  prompt: string;
  schema: SchemaName;
  budgetUsd: number;
  // The card a managed session is billed to (studio); null or unset bills overhead with the role.
  cardId?: string | null;
  // Files a managed session reads, uploaded and mounted; an attended session reads them in worktree.
  files?: RoleSessionFile[];
  // A repository commit a managed session mounts read-only, or none.
  repoSha?: string | null;
  // The session's running estimate of its own spend, after every turn (a card's claim budget).
  onSpend?: (usd: number) => void;
}

export type RoleSessionResult<T> =
  | { ok: true; value: T; ref: string; turns: number; usd: number }
  // invalidOutput: the session ran and its final message was not one object valid against the schema.
  // refusal: the API refused the studio key for credit or at its usage tier's cap, so every session
  // after this one would fail the same way.
  | { ok: false; reason: string; ref: string; turns: number; usd: number; invalidOutput: boolean; refusal?: SpendRefusal };

// Why the role's tools may not run a role job, or null.
export function roleToolProblem(tools: readonly string[]): string | null {
  const refused = refusedTools(tools);
  if (refused.length > 0) return `role tools include excluded tools: ${refused.join(', ')}`;
  const other = tools.filter((tool) => !ROLE_JOB_TOOLS.includes(tool));
  if (other.length > 0) return `a role job holds only Read, Glob, Grep and Bash, not ${other.join(', ')}`;
  return null;
}

function isBash(tool: string): boolean {
  return tool === 'Bash' || tool === 'bash' || tool.startsWith('Bash(');
}

// The session spec: the role's own tools, Bash as seed-1's package scripts, in the scratch worktree.
// Without scripts (an unattended process) Bash is left out, whatever the role spec holds.
export function roleSessionSpec(request: RoleSessionRequest, maxTurns: number, scripts: boolean, model = request.role.model.trim()): SessionSpec {
  return {
    cardId: `job-${request.runId}`,
    worktree: request.worktree,
    prompt: request.prompt,
    systemPromptFile: rolePromptFile(request.role, request.promptRoot ?? request.worktree),
    model,
    roleTools: roleTools(request.role).filter((tool) => scripts || !isBash(tool)),
    folder: 'seed-1',
    maxTurns,
    maxBudgetUsd: round4(request.budgetUsd),
    roleId: request.role.id,
  };
}

// Why a start event refuses the session, or null. Without scripts, Bash is refused too. An attended
// session must not bill an API key; a managed one must bill the studio's.
function startRefusal(event: Extract<AgentEvent, { type: 'start' }>, scripts: boolean, attended: boolean): string | null {
  const refused = [...refusedTools(event.tools), ...event.tools.filter((tool) => NEVER_TOOLS.includes(tool) || (!scripts && isBash(tool)))];
  if (refused.length > 0) return `session exposes tools a role job may not hold: ${refused.join(', ')}`;
  if (attended && event.apiKeySource === API_KEY_SOURCE) return 'session bills an API key; an attended role job runs on the founder plan';
  if (!attended && event.apiKeySource !== API_KEY_SOURCE) return `session is billed to ${event.apiKeySource ?? 'an unreported account'}, not the studio key`;
  return null;
}

export async function runRoleSession<T>(request: RoleSessionRequest, deps: RoleSessionDeps): Promise<RoleSessionResult<T>> {
  const { role } = request;
  let ref = `run:${request.runId}/${request.label}`;
  let refusal: SpendRefusal | null = null;
  const fail = (reason: string, turns = 0, usd = 0, invalidOutput = false): RoleSessionResult<T> => ({ ok: false, reason, ref, turns, usd, invalidOutput, ...(refusal ? { refusal } : {}) });
  const attended = deps.adapter.mode === 'attended';
  if (attended && !deps.allowAttended) return fail('a role session runs on the managed adapter; this caller does not allow the attended one');
  const toolProblem = roleToolProblem(roleTools(role));
  if (toolProblem) return fail(toolProblem);
  const model = (deps.resolveModel ? deps.resolveModel(role) : role.model).trim();
  if (!model) return fail(`role ${role.name} has no model`);
  if (!modelPrice(deps.priceTable, model)) return fail(`no price for model ${model}`);
  if (!(request.budgetUsd > 0)) return fail('the session budget must be above zero');
  let spec: SessionSpec;
  try {
    spec = roleSessionSpec(request, deps.maxTurns, deps.scripts, model);
    if (!attended) {
      // The managed session's system prompt is the role prompt, read here from the checkout it names.
      if (!spec.systemPromptFile) return fail(`role ${role.name} has no prompt file`);
      const system = await readFile(spec.systemPromptFile, 'utf8');
      spec = { ...spec, purpose: 'role', role: { cardId: request.cardId ?? null, system, repoSha: request.repoSha ?? null, files: request.files ?? [], label: `${request.label} ${request.runId}`.slice(0, 200) } };
    }
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
        if ((await deps.db.roleState(role.id)).paused) abort('role_paused');
        else if (deps.stopWhenStudioPaused && (await deps.db.getStudioState()).paused) abort('studio_paused');
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
  // The managed adapter writes its own ledger rows; the meter here keeps only the live estimate, for
  // the budget and onSpend.
  let adapterMetered = false;
  const spent = () => round4(adapterMetered ? meter.liveEstimateUsd() : meter.recordedUsd());
  // Only the API's own words count: an error event, never the agent's reply.
  const creditCheck = (text: string) => {
    const found = spendRefusal(text);
    if (!found) return;
    refusal = found;
    abort(found === 'tier_cap' ? `the API refused the studio key at its usage tier's monthly cap: ${text.slice(0, 300)}` : `the API refused the studio key for credit: ${text.slice(0, 300)}`);
  };
  let end: EndEvent | null = null;
  let turns = 0;
  const onEvent = async (event: AgentEvent) => {
    switch (event.type) {
      case 'start': {
        if (event.sessionId) ref = `claude:${event.sessionId}`;
        adapterMetered = event.ledger === 'adapter';
        const startProblem = startRefusal(event, deps.scripts, attended);
        if (startProblem) abort(startProblem);
        return;
      }
      case 'turn_usage': {
        turns = event.turn;
        if (event.turn > deps.maxTurns) abort('turn_cap');
        if (isSyntheticModel(event.model)) return;
        const { row, fallback } = meter.addTurn(event);
        if (!adapterMetered && (row.usd > 0 || row.input_tokens > 0 || row.output_tokens > 0 || row.cached_tokens > 0)) {
          try {
            await record(row);
            meter.commit(row);
          } catch (error) {
            abort(`the ledger refused turn ${event.turn}: ${errorMessage(error)}`);
          }
        }
        if (fallback) abort(`no price for model ${event.model}`);
        const live = meter.liveEstimateUsd();
        request.onSpend?.(live);
        if (live >= request.budgetUsd) abort('budget');
        return;
      }
      case 'turn_content':
        meter.addContent(event);
        return;
      case 'compaction':
        meter.addCompaction(event);
        return;
      case 'error':
        creditCheck(event.message);
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
    if (error instanceof SessionPaused) refusal ??= refusalForCheck(error.failingCheck);
    return fail(error instanceof SessionPaused ? error.message : `session error: ${errorMessage(error)}`, turns, spent());
  } finally {
    clearInterval(watch);
    clearTimeout(wallClock);
    deps.stopSignal.removeEventListener('abort', onStop);
    if (!adapterMetered) {
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
  }
  const usd = spent();
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
