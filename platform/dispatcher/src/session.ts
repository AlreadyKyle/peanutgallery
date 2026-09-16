// One metered agent session for a card: builds the prompt, meters every turn through
// record_usage, settles the session against its result line (metering.ts), enforces the cost, turn
// and wall-clock ceilings, and aborts when the board session lapses or the board pauses the studio.
import type { AgentAdapter, AgentEvent, AgentMode, EndEvent, SessionSpec } from './adapters/types.js';
import { refusedTools } from './adapters/attended.js';
import type { Alerter } from './alert.js';
import type { Billing, Card, Db, Role, StudioState } from './db.js';
import { errorMessage, type Logger } from './log.js';
import { SessionMeter } from './metering.js';
import { modelPrice, round4, type LedgerUsage, type PriceTable } from './pricing.js';
import path from 'node:path';
import { billingFor } from './throttle.js';
import { KERNEL_NAMES, lanePaths, protectedPaths, shortId, singleLineTitle } from './worktree.js';

export type SessionOutcome =
  | 'completed'
  | 'ceiling'
  | 'turn_cap'
  | 'board_session_lapsed'
  | 'paused_by_board'
  | 'unknown_model'
  | 'wall_clock'
  | 'refused'
  | 'stopped'
  | 'error';

export interface SessionRun {
  outcome: SessionOutcome;
  detail: string;
  turns: number;
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
  alert: Alerter;
  log: Logger;
  stopSignal: AbortSignal;
  now: () => Date;
}

const PAYLOAD_LIMIT = 8000;
export const API_KEY_SOURCE = 'ANTHROPIC_API_KEY';

export function ceilingUsd(estimateUsd: number, cardMaxUsd: number): number {
  return round4(Math.min(1.5 * estimateUsd, cardMaxUsd));
}

export function roleTools(role: Role): string[] {
  return Array.isArray(role.tools_json) ? role.tools_json.filter((tool): tool is string => typeof tool === 'string') : [];
}

// The -p prompt is the card, its money, its design spec when it has one, and the definition of
// done. The role prompt file is appended to the system prompt by the adapter, and the CLAUDE.md
// files are read by Claude Code from the worktree.
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
  const model = role.model || deps.fallbackModel;
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
    maxBudgetUsd: remaining,
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

  const meter = new SessionMeter(deps.priceTable);
  // Who paid: the adapter's mode, unless the init line shows the session ran on another account. That
  // spend is not the pool's, so it is recorded as the founder's and the session is refused.
  let billedTo: Billing = billingFor(deps.adapter.mode);
  let end: EndEvent | null = null;
  const record = (row: LedgerUsage) => deps.db.recordUsage({ billed_to: billedTo, card_id: card.id, role_id: role.id, ...row });

  let turns = 0;
  const onEvent = async (event: AgentEvent) => {
    switch (event.type) {
      case 'start': {
        // The refusal is decided, and the session interrupted, before anything is written.
        const refusal = startRefusal(deps.adapter.mode, event);
        if (billedToWrongAccount(deps.adapter.mode, event.apiKeySource)) billedTo = 'founder';
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
        if (event.turn > deps.sessionMaxTurns) abort('turn_cap', `turn ${event.turn} exceeds the cap ${deps.sessionMaxTurns}`);
        if (zeroUsage(event.usage) && event.contentChars === 0) return;
        const { row, fallback } = meter.addTurn(event);
        const recorded = zeroUsage(event.usage) ? null : await record(row);
        const estimate = round4(priorUsd + meter.liveEstimateUsd());
        deps.log.info('session', `turn ${event.turn} metered`, { card: card.id, usd: row.usd, actual: recorded?.actual_usd ?? null, estimate });
        // A model missing from the price table is recorded at the fallback rates first, so the
        // turn it already paid for is on the ledger, and then the session stops.
        if (fallback) abort('unknown_model', `no price for model ${event.model}`);
        if (estimate >= ceiling) abort('ceiling', `estimated spend ${estimate} reached the ceiling ${ceiling}`);
        return;
      }
      case 'tool_call':
        await deps.db.insertEvent(card.id, role.id, 'tool_call', { tool_use_id: event.toolUseId, name: event.name, input: trimPayload(event.input) });
        return;
      case 'tool_result':
        await deps.db.insertEvent(card.id, role.id, 'tool_result', { tool_use_id: event.toolUseId, is_error: event.isError, content: event.content });
        return;
      case 'message':
        await deps.db.insertEvent(card.id, role.id, 'message', { text: event.text });
        return;
      case 'error':
        await deps.db.insertEvent(card.id, role.id, 'error', { message: event.message });
        return;
      case 'end':
        end = event;
        return;
    }
  };

  let result;
  try {
    result = await deps.adapter.run(spec, onEvent, controller.signal);
  } catch (error) {
    return { outcome: 'error', detail: errorMessage(error), turns };
  } finally {
    clearInterval(watch);
    clearTimeout(wallClock);
    deps.stopSignal.removeEventListener('abort', onStop);
    await settle(card, role, deps, meter, end, record);
  }

  if (state.aborted) return { outcome: state.aborted.outcome, detail: state.aborted.detail, turns: result.turns };
  if (result.killReason === 'turn_cap' || result.endSubtype === 'error_max_turns') {
    return { outcome: 'turn_cap', detail: `session reached ${result.turns} turns`, turns: result.turns };
  }
  if (result.endSubtype === 'error_max_budget_usd') {
    return { outcome: 'ceiling', detail: `session reached its budget of ${remaining} USD`, turns: result.turns };
  }
  if (result.isError || result.exitCode !== 0) {
    return { outcome: 'error', detail: `session ended with ${result.endSubtype ?? 'no result'} (exit ${result.exitCode ?? 'signal'})`, turns: result.turns };
  }
  return { outcome: 'completed', detail: `session completed in ${result.numTurns ?? result.turns} turns`, turns: result.turns };
}

// Writes the settle rows once the session has ended, however it ended. A session settled on an
// estimate, one that used a model the price table lacks, or one whose turns recorded more than its
// result line reports is written up as an error event and alerted once. A failure here is logged
// and alerted and does not change the session's outcome.
async function settle(
  card: Card,
  role: Role,
  deps: SessionDeps,
  meter: SessionMeter,
  end: EndEvent | null,
  record: (row: LedgerUsage) => Promise<unknown>,
): Promise<void> {
  try {
    const settled = meter.settle(end);
    for (const row of settled.rows) await record(row);
    const reported = settled.fallbackModels.length > 0 || settled.overcountUsd > 0 || (settled.basis === 'estimate' && meter.turnsRecorded);
    if (settled.rows.length > 0) deps.log.info('session', `card ${card.id} settled`, { basis: settled.basis, rows: settled.rows.length });
    if (!reported) return;
    const payload = {
      step: 'metering',
      basis: settled.basis,
      rows: settled.rows,
      fallback_models: settled.fallbackModels,
      overcount_usd: settled.overcountUsd,
      cli_total_cost_usd: end?.totalCostUsd ?? null,
    };
    deps.log.warn('session', `card ${card.id} metering needs review`, payload);
    await deps.db.insertEvent(card.id, role.id, 'error', payload);
    const problems = [
      ...(settled.basis === 'estimate' ? ['no result line, so unreported output was estimated'] : []),
      ...(settled.fallbackModels.length > 0 ? [`priced at fallback rates: ${settled.fallbackModels.join(', ')}`] : []),
      ...(settled.overcountUsd > 0 ? [`turn rows recorded ${settled.overcountUsd} USD above the result line`] : []),
    ];
    await deps.alert.notify(`Card ${shortId(card.id)} metering: ${problems.join('; ')}. ${singleLineTitle(card.title)}`);
  } catch (error) {
    deps.log.error('session', `card ${card.id} settle failed`, { error: errorMessage(error) });
    await deps.alert.notify(`Card ${shortId(card.id)} metering: the settle rows were not written (${errorMessage(error)}). ${singleLineTitle(card.title)}`);
  }
}
