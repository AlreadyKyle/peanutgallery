// One metered agent session for a card: builds the prompt, meters every turn through
// record_usage, settles the session against its result line (metering.ts), enforces the cost, turn
// and wall-clock ceilings, and aborts when the board session lapses or the board pauses the studio.
//
// The session's dollar budget is the card's remaining ceiling. In unattended mode the tick also
// passes the budget the throttle allowed (throttle.ts planStart), and the session stops at the lower
// of the two: reaching the ceiling is outcome ceiling, reaching the throttle's budget first is outcome
// budget. An API error that says the Console credit or spend limit ran out is credit_exhausted.
import { randomUUID } from 'node:crypto';
import { SessionPaused, type AgentAdapter, type AgentEvent, type AgentMode, type EndEvent, type SessionSpec } from './adapters/types.js';
import { refusedTools } from './adapters/attended.js';
import type { Alerter } from './alert.js';
import { creditExhausted } from './credit.js';
import type { Billing, Card, Db, Role, StudioState } from './db.js';
import { errorMessage, type Logger } from './log.js';
import { SessionMeter, isSyntheticModel, type MeterRow } from './metering.js';
import { modelPrice, round4, type PriceTable } from './pricing.js';
import path from 'node:path';
import { billingFor, ceilingUsd } from './throttle.js';
import { retry } from './time.js';
import { KERNEL_NAMES, lanePaths, protectedPaths, shortId, singleLineTitle } from './worktree.js';

export type SessionOutcome =
  | 'completed'
  | 'ceiling'
  // The throttle's budget, below the ceiling, was reached (unattended).
  | 'budget'
  // The throttle's budget was nothing by the time the session started (unattended).
  | 'insufficient_balance'
  // An API error said the Console credit or spend limit ran out.
  | 'credit_exhausted'
  | 'turn_cap'
  | 'board_session_lapsed'
  | 'paused_by_board'
  | 'unknown_model'
  | 'wall_clock'
  | 'refused'
  | 'stopped'
  // The adapter stopped the session, or started none, for a reason that is not the card's.
  | 'adapter_paused'
  | 'error';

export interface SessionRun {
  outcome: SessionOutcome;
  detail: string;
  turns: number;
  // With outcome adapter_paused: the failing check the card pauses with (adapters/types.ts
  // SessionPaused).
  failingCheck?: string;
}

export interface SessionDeps {
  db: Db;
  adapter: AgentAdapter;
  priceTable: PriceTable;
  sessionMaxTurns: number;
  boardSessionTtlMin: number;
  watchIntervalMs: number;
  fallbackModel: string;
  // The longest a session may run before it is interrupted, in milliseconds.
  sessionMaxMs: number;
  // The first wait between ledger write attempts; LEDGER_RETRY_MS when unset.
  ledgerRetryMs?: number;
  alert: Alerter;
  log: Logger;
  stopSignal: AbortSignal;
  now: () => Date;
  // The budget the tick allowed this card's session (throttle.ts); unset or Infinity leaves the
  // ceiling as the only budget, as for every attended session.
  budgetUsd?: number;
  // Told the session's running spend estimate after every metered turn (budgets.ts).
  onSpend?: (usd: number) => void;
  // The model a role runs on (role-model.ts); roles.model, then fallbackModel, when unset.
  resolveModel?: (role: Role) => string;
}

const PAYLOAD_LIMIT = 8000;
export const API_KEY_SOURCE = 'ANTHROPIC_API_KEY';
// Each ledger write is tried this many times, waiting LEDGER_RETRY_MS and then twice as long.
export const LEDGER_TRIES = 3;
export const LEDGER_RETRY_MS = 500;

export { ceilingUsd };

export function roleTools(role: Role): string[] {
  return Array.isArray(role.tools_json) ? role.tools_json.filter((tool): tool is string => typeof tool === 'string') : [];
}

// The -p prompt is the card, its money, its design spec when it has one, and the definition of
// done. The role prompt file is appended to the system prompt by the adapter. Attended, Claude Code
// reads the CLAUDE.md files from the worktree; unattended, the managed adapter puts the role prompt
// and the root and folder CLAUDE.md at the base commit in the session's system prompt, and adds its
// own finishing section after this prompt.
export function sessionPrompt(card: Card, allowedPaths: readonly string[], ceilingUsd: number): string {
  const designSpec = card.design_spec_url?.trim();
  const locked = protectedPaths(allowedPaths);
  const lines = [
    `Card ${card.id.replace(/-/g, '').slice(0, 8)}: ${card.title}`,
    `Bucket: ${card.bucket}. Lane: ${card.lane}. Folder: ${card.folder}.`,
    `Estimate: $${card.estimate_usd.toFixed(2)}. Ceiling: $${ceilingUsd.toFixed(2)} (the session stops there).`,
    '',
    'Intent:',
    card.intent ?? '',
    '',
    'Acceptance test:',
    card.acceptance_test ?? '',
    '',
    ...(designSpec ? [`Design spec: ${designSpec}`, ''] : []),
    `Allowed paths: ${allowedPaths.join(', ')}.`,
    ...(locked.length > 0 ? [`Never edit, even inside the allowed paths: ${locked.join(', ')}. The dispatcher rejects a change to any of them.`] : []),
    `Never create or edit a file or folder with one of these names, at any depth: ${KERNEL_NAMES.join(', ')}. The dispatcher rejects those too.`,
    'Definition of done:',
    '- every check: line in the acceptance test is true in this working tree',
    '- the invariants pass: the commands your role prompt names all exit 0',
    '- only files under the allowed paths changed',
    '- no git, gh or network; the dispatcher commits and pushes',
    'Edit only files under the allowed paths. Do not run git.',
    'Stop as soon as the acceptance check holds in this working tree and the invariants pass.',
  ];
  return lines.join('\n');
}

// The role prompt lives in the repository, so the worktree (a checkout of main) carries it.
export function rolePromptFile(role: Role, worktree: string): string | null {
  const rel = role.prompt_path?.trim();
  if (!rel) return null;
  const abs = path.resolve(worktree, rel);
  const root = path.resolve(worktree) + path.sep;
  if (!abs.startsWith(root)) throw new Error(`role prompt path escapes the worktree: ${rel}`);
  return abs;
}

function trimPayload(value: unknown): unknown {
  const json = JSON.stringify(value);
  if (json === undefined) return null;
  if (json.length <= PAYLOAD_LIMIT) return value;
  return { truncated: true, chars: json.length, head: json.slice(0, PAYLOAD_LIMIT) };
}

// An unattended session must bill the studio key and nothing else; an attended session must
// not bill a key at all, since the founder's subscription is the account it runs on.
export function billedToWrongAccount(mode: AgentMode, apiKeySource: string | null): boolean {
  if (mode === 'unattended') return apiKeySource !== API_KEY_SOURCE;
  return apiKeySource === API_KEY_SOURCE;
}

function zeroUsage(usage: { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number }): boolean {
  return usage.input_tokens === 0 && usage.cache_creation_input_tokens === 0 && usage.cache_read_input_tokens === 0 && usage.output_tokens === 0;
}

// Why the init line refuses the session, or null when it may run.
function startRefusal(mode: AgentMode, event: Extract<AgentEvent, { type: 'start' }>): string | null {
  const refused = refusedTools(event.tools);
  if (refused.length > 0) return `session exposes excluded tools: ${refused.join(', ')}`;
  if (billedToWrongAccount(mode, event.apiKeySource)) return `session is billed to the wrong account (${event.apiKeySource ?? 'unreported'})`;
  return null;
}

export async function runAgentSession(card: Card, role: Role, worktree: string, studio: StudioState, deps: SessionDeps): Promise<SessionRun> {
  const ceiling = ceilingUsd(card.estimate_usd, studio.card_max_usd);
  // The card's spend before this session; the meter counts this session's.
  const priorUsd = card.actual_usd;
  const remaining = round4(ceiling - priorUsd);
  if (remaining <= 0) {
    return { outcome: 'ceiling', detail: `actual ${priorUsd} has reached the ceiling ${ceiling} before the session`, turns: 0 };
  }
  const throttleBudget = deps.budgetUsd ?? Number.POSITIVE_INFINITY;
  const budget = round4(Math.min(remaining, throttleBudget));
  // Only an unattended budget can be below the ceiling; one that is nothing starts no session, and
  // the card goes back to funded rather than to a refusal.
  if (budget <= 0) {
    return { outcome: 'insufficient_balance', detail: `the throttle allowed ${throttleBudget} USD for this session`, turns: 0 };
  }
  const budgetBinds = budget < remaining;
  const model = deps.resolveModel ? deps.resolveModel(role) : role.model || deps.fallbackModel;
  if (!modelPrice(deps.priceTable, model)) {
    return { outcome: 'unknown_model', detail: `no price for model ${model}`, turns: 0 };
  }
  const spec: SessionSpec = {
    cardId: card.id,
    worktree,
    prompt: sessionPrompt(card, lanePaths(card.folder, card.lane), ceiling),
    systemPromptFile: rolePromptFile(role, worktree),
    model,
    roleTools: roleTools(role),
    folder: card.folder,
    maxTurns: deps.sessionMaxTurns,
    maxBudgetUsd: budget,
    spentUsd: priorUsd,
    roleId: role.id,
    allowedPaths: lanePaths(card.folder, card.lane),
  };
  try {
    await deps.adapter.preflight(spec);
  } catch (error) {
    return { outcome: 'refused', detail: errorMessage(error), turns: 0 };
  }

  const controller = new AbortController();
  const state: { aborted: { outcome: SessionOutcome; detail: string } | null } = { aborted: null };
  const abort = (outcome: SessionOutcome, detail: string) => {
    if (state.aborted) return;
    state.aborted = { outcome, detail };
    deps.log.warn('session', `aborting card ${card.id}`, { outcome, detail });
    controller.abort(outcome);
  };
  const onStop = () => abort('stopped', 'dispatcher stopping');
  if (deps.stopSignal.aborted) onStop();
  deps.stopSignal.addEventListener('abort', onStop, { once: true });

  const watch = setInterval(() => {
    void (async () => {
      try {
        const [active, state] = await Promise.all([deps.db.boardSessionActive(deps.boardSessionTtlMin, deps.now()), deps.db.getStudioState()]);
        if (deps.adapter.mode === 'attended' && !active) abort('board_session_lapsed', 'no board member seen within the session window');
        if (state.paused) abort('paused_by_board', 'the board paused agents');
      } catch (error) {
        deps.log.warn('session', 'board session check failed', { error: errorMessage(error) });
      }
    })();
  }, deps.watchIntervalMs);
  const wallClock = setTimeout(() => abort('wall_clock', `session ran past ${deps.sessionMaxMs / 60_000} minutes`), deps.sessionMaxMs);

  // Row ids are unique under the card and this run, so a retried write is recorded once.
  const meter = new SessionMeter(deps.priceTable, `${card.id}/${randomUUID()}`, spec.model);
  const retryMs = deps.ledgerRetryMs ?? LEDGER_RETRY_MS;
  // Who paid. An unattended session bills the pool only once its init line shows the studio key; until
  // then, and for a session on the wrong account, the spend is recorded as the founder's.
  const account: Account = { billedTo: 'founder', verified: false, started: false, apiKeySource: null };
  // The managed adapter writes its own ledger rows (one per model request, then runtime and settle
  // rows to the platform's list cost), so the session records none and settles nothing.
  let adapterMetered = false;
  let end: EndEvent | null = null;
  const record = (row: MeterRow) =>
    retry(
      () => deps.db.recordUsage({ billed_to: account.billedTo, card_id: card.id, role_id: role.id, ...row }),
      LEDGER_TRIES,
      retryMs,
      (error, attempt) => deps.log.warn('session', 'ledger write failed', { card: card.id, request_id: row.request_id, usd: row.usd, attempt, error: errorMessage(error) }),
    );
  const checkCeiling = () => {
    const live = meter.liveEstimateUsd();
    const estimate = round4(priorUsd + live);
    deps.onSpend?.(live);
    if (estimate >= ceiling) abort('ceiling', `estimated spend ${estimate} reached the ceiling ${ceiling}`);
    else if (budgetBinds && live >= budget) abort('budget', `estimated session spend ${round4(live)} reached the session budget ${budget}, below the ceiling ${ceiling}`);
    return estimate;
  };
  // Text the session wrote since its last turn, read when Claude Code turns an API error into a
  // turn of its own.
  let recentText: string[] = [];
  const creditCheck = (text: string) => {
    if (creditExhausted(text)) abort('credit_exhausted', `the API refused the studio key for credit: ${text.split('\n')[0]?.slice(0, 300) ?? ''}`);
  };

  let turns = 0;
  const onEvent = async (event: AgentEvent) => {
    switch (event.type) {
      case 'start': {
        // The refusal is decided, and the session interrupted, before anything is written.
        const refusal = startRefusal(deps.adapter.mode, event);
        adapterMetered = event.ledger === 'adapter';
        account.started = true;
        account.apiKeySource = event.apiKeySource;
        if (!billedToWrongAccount(deps.adapter.mode, event.apiKeySource)) {
          account.billedTo = billingFor(deps.adapter.mode);
          account.verified = true;
        }
        if (refusal) abort('refused', refusal);
        await deps.db.insertEvent(card.id, role.id, 'start', {
          session_id: event.sessionId,
          model: event.model,
          tools: event.tools,
          mode: deps.adapter.mode,
          api_key_source: event.apiKeySource,
          refusal,
        });
        return;
      }
      case 'turn_usage': {
        turns = event.turn;
        const text = recentText.join('\n');
        recentText = [];
        if (event.turn > deps.sessionMaxTurns) abort('turn_cap', `turn ${event.turn} exceeds the cap ${deps.sessionMaxTurns}`);
        // An API error Claude Code wrote as a turn: no request, nothing to meter.
        if (isSyntheticModel(event.model)) {
          deps.log.warn('session', `turn ${event.turn} is an API error, not metered`, { card: card.id, text: text.slice(0, 300) });
          creditCheck(text);
          return;
        }
        if (zeroUsage(event.usage) && event.contentChars === 0 && !event.thinking) return;
        const { row, fallback, premium } = meter.addTurn(event);
        let actual: number | null = null;
        if (!zeroUsage(event.usage) && !adapterMetered) {
          try {
            actual = (await record(row)).actual_usd;
            meter.commit(row);
          } catch (error) {
            // The row stays pending and settle writes it again. A ledger that refuses three writes
            // in a row cannot hold the caps, so the session stops.
            deps.log.error('session', `turn ${event.turn} not metered`, { card: card.id, usd: row.usd, error: errorMessage(error) });
            abort('error', `the ledger refused turn ${event.turn}: ${errorMessage(error)}`);
          }
        }
        const estimate = checkCeiling();
        deps.log.info('session', `turn ${event.turn} metered`, { card: card.id, usd: row.usd, actual, estimate, ...(premium ? { premium_tier: premium } : {}) });
        // A model missing from the price table is recorded at the fallback rates first, so the
        // turn it already paid for is on the ledger, and then the session stops.
        if (fallback) abort('unknown_model', `no price for model ${event.model}`);
        return;
      }
      case 'turn_content':
        meter.addContent(event);
        checkCeiling();
        return;
      case 'compaction':
        meter.addCompaction(event);
        checkCeiling();
        deps.log.info('session', 'context compacted', { card: card.id, model: event.model, pre_tokens: event.preTokens });
        return;
      case 'tool_call':
        await deps.db.insertEvent(card.id, role.id, 'tool_call', { tool_use_id: event.toolUseId, name: event.name, input: trimPayload(event.input) });
        return;
      case 'tool_result':
        await deps.db.insertEvent(card.id, role.id, 'tool_result', { tool_use_id: event.toolUseId, is_error: event.isError, content: event.content });
        return;
      case 'message':
        recentText.push(event.text);
        await deps.db.insertEvent(card.id, role.id, 'message', { text: event.text });
        return;
      case 'error':
        creditCheck(event.message);
        await deps.db.insertEvent(card.id, role.id, 'error', { message: event.message });
        return;
      case 'end':
        end = event;
        if (event.isError) creditCheck(event.result);
        return;
    }
  };

  let result;
  try {
    result = await deps.adapter.run(spec, onEvent, controller.signal);
  } catch (error) {
    if (error instanceof SessionPaused) {
      if (state.aborted) return { outcome: state.aborted.outcome, detail: state.aborted.detail, turns };
      return { outcome: 'adapter_paused', detail: error.message, turns, failingCheck: error.failingCheck };
    }
    return { outcome: 'error', detail: errorMessage(error), turns };
  } finally {
    clearInterval(watch);
    clearTimeout(wallClock);
    deps.stopSignal.removeEventListener('abort', onStop);
    if (!adapterMetered) await settle({ card, role, deps, meter, end, record, account, turns });
  }

  if (state.aborted) return { outcome: state.aborted.outcome, detail: state.aborted.detail, turns: result.turns };
  if (result.killReason === 'turn_cap' || result.endSubtype === 'error_max_turns') {
    return { outcome: 'turn_cap', detail: `session reached ${result.turns} turns`, turns: result.turns };
  }
  if (result.endSubtype === 'error_max_budget_usd') {
    return { outcome: budgetBinds ? 'budget' : 'ceiling', detail: `session reached its budget of ${budget} USD`, turns: result.turns };
  }
  if (result.isError || result.exitCode !== 0) {
    return { outcome: 'error', detail: `session ended with ${result.endSubtype ?? 'no result'} (exit ${result.exitCode ?? 'signal'})`, turns: result.turns };
  }
  return { outcome: 'completed', detail: `session completed in ${result.numTurns ?? result.turns} turns`, turns: result.turns };
}

// Why the spend was recorded as the founder's rather than the mode's account, when it was.
function accountProblem(mode: AgentMode, account: Account): string[] {
  if (account.started && billedToWrongAccount(mode, account.apiKeySource)) {
    return [`the init line reported apiKeySource ${account.apiKeySource ?? 'unreported'}, so the spend was recorded as the founder's`];
  }
  if (!account.started && mode === 'unattended') return ["no init line confirmed the studio key, so the spend was recorded as the founder's"];
  return [];
}

interface SettleContext {
  card: Card;
  role: Role;
  deps: SessionDeps;
  meter: SessionMeter;
  end: EndEvent | null;
  record: (row: MeterRow) => Promise<unknown>;
  account: Account;
  turns: number;
}

interface Account {
  billedTo: Billing;
  // The init line confirmed the account the mode bills.
  verified: boolean;
  // An init line arrived, and the key source it reported.
  started: boolean;
  apiKeySource: string | null;
}

// Writes the settle rows once the session has ended, however it ended, and only once: a row that
// fails its three tries is named with its usd in the error event and the alert, for the board to
// post by hand, never written again by a second settle. A session settled on an estimate, with
// mismatched model names, with a turn model priced at fallback rates, with an overcount, with rows
// left unwritten, or unattended with no init line is written up as an error event and alerted once.
// A side model priced at fallback rates is alerted once per process, not once per session. The rows
// are logged before they are written, so a write that hangs or fails leaves them in the log.
async function settle({ card, role, deps, meter, end, record, account, turns }: SettleContext): Promise<void> {
  // The no-result estimate, taken before settle, to compare with what a result line settles to.
  const estimateUsd = meter.liveEstimateUsd();
  const settled = meter.settle(end);
  const unwritten: Array<MeterRow & { error: string }> = [];
  if (settled.rows.length > 0) {
    deps.log.info('session', 'settle rows', {
      card: card.id,
      rows: settled.rows.map((row) => ({
        request_id: row.request_id,
        model: row.model,
        input_tokens: row.input_tokens,
        cached_tokens: row.cached_tokens,
        output_tokens: row.output_tokens,
        usd: row.usd,
      })),
    });
  }
  for (const row of settled.rows) {
    try {
      await record(row);
      meter.commit(row);
    } catch (error) {
      unwritten.push({ ...row, error: errorMessage(error) });
    }
  }
  if (settled.rows.length > 0) deps.log.info('session', `card ${card.id} settled`, { basis: settled.basis, rows: settled.rows.length, unwritten: unwritten.length });
  // One line with the same fields for every session with a result line, to tune the estimate's floors.
  if (end !== null) {
    deps.log.info('session', 'metering estimate check', {
      card: card.id,
      basis: settled.basis,
      turns,
      estimate_usd: estimateUsd,
      settled_usd: meter.recordedUsd(),
      cli_total_cost_usd: end.totalCostUsd,
    });
  }

  const metered = meter.turnsRecorded || settled.rows.length > 0;
  const turnFallbacks = settled.fallbackModels.filter((model) => settled.turnModels.includes(model));
  const sideFallbacks = settled.fallbackModels.filter((model) => !settled.turnModels.includes(model));
  const reportedModels = (end?.modelUsage ?? []).map((entry) => entry.model);
  const premiumTiers = settled.premiumTiers ?? [];
  const problems = [
    ...(settled.basis === 'estimate' && metered
      ? [settled.anomaly ? 'modelUsage reported fewer tokens than the turns, so the session was settled on the estimate' : 'no usable result line, so the session was settled on the estimate']
      : []),
    ...(settled.zeroedFields.length > 0 ? [`modelUsage reported 0 for ${settled.zeroedFields.join(', ')} where the turns reported tokens`] : []),
    ...(settled.mismatch ? [`modelUsage names ${reportedModels.join(', ') || 'no model'} but the turns named ${settled.turnModels.join(', ')}`] : []),
    ...(turnFallbacks.length > 0 ? [`priced at fallback rates: ${turnFallbacks.join(', ')}`] : []),
    ...(premiumTiers.length > 0 ? [`turns ran at a premium tier and were priced at the table's highest rates, which may be below the tier's price: ${premiumTiers.join('; ')}`] : []),
    ...(settled.overcountUsd > 0 ? [`the rows recorded ${settled.overcountUsd} USD above the settled total`] : []),
    ...(unwritten.length > 0 ? [`rows not written, to post by hand: ${unwritten.map((row) => `${row.request_id} ${row.model} ${row.usd} USD`).join(', ')}`] : []),
    ...(metered ? accountProblem(deps.adapter.mode, account) : []),
  ];
  if (problems.length === 0 && sideFallbacks.length === 0) return;

  const payload = {
    step: 'metering',
    basis: settled.basis,
    rows: settled.rows,
    unwritten_rows: unwritten,
    billed_to: account.billedTo,
    fallback_models: settled.fallbackModels,
    mismatch: settled.mismatch,
    anomaly: settled.anomaly,
    zeroed_fields: settled.zeroedFields,
    ...(premiumTiers.length > 0 ? { premium_tiers: premiumTiers } : {}),
    overcount_usd: settled.overcountUsd,
    cli_total_cost_usd: end?.totalCostUsd ?? null,
  };
  deps.log.warn('session', `card ${card.id} metering needs review`, payload);
  try {
    await deps.db.insertEvent(card.id, role.id, 'error', payload);
  } catch (error) {
    deps.log.error('session', `card ${card.id} metering event not written`, { error: errorMessage(error) });
  }
  if (problems.length > 0) await deps.alert.notify(`Card ${shortId(card.id)} metering: ${problems.join('; ')}. ${singleLineTitle(card.title)}`);
  for (const model of sideFallbacks) {
    await deps.alert.notifyOnce(`fallback-model:${model}`, `Model ${model} is missing from PRICE_TABLE_JSON; sessions that call it are metered at the table's highest rates until it is added.`);
  }
}
