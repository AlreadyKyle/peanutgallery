// One metered agent session for a card: builds the prompt, meters every turn through
// record_usage, enforces the cost and turn ceilings, and aborts when the board session lapses
// or the board pauses the studio.
import type { AgentAdapter, AgentEvent, SessionSpec } from './adapters/types.js';
import { refusedTools } from './adapters/attended.js';
import type { Card, Db, Role, StudioState } from './db.js';
import { errorMessage, type Logger } from './log.js';
import { UnknownModelError, priceUsage, round4, type PriceTable } from './pricing.js';
import path from 'node:path';
import { lanePaths } from './worktree.js';

export type SessionOutcome =
  | 'completed'
  | 'ceiling'
  | 'turn_cap'
  | 'board_session_lapsed'
  | 'paused_by_board'
  | 'unknown_model'
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
  log: Logger;
  stopSignal: AbortSignal;
  now: () => Date;
}

const PAYLOAD_LIMIT = 8000;

export function ceilingUsd(estimateUsd: number, cardMaxUsd: number): number {
  return round4(Math.min(1.5 * estimateUsd, cardMaxUsd));
}

export function roleTools(role: Role): string[] {
  return Array.isArray(role.tools_json) ? role.tools_json.filter((tool): tool is string => typeof tool === 'string') : [];
}

// The -p prompt is the card and the stop rule. The role prompt file is appended to the system
// prompt by the adapter, and the CLAUDE.md files are read by Claude Code from the worktree.
export function sessionPrompt(card: Card, allowedPaths: readonly string[]): string {
  const lines = [
    `Card ${card.id.replace(/-/g, '').slice(0, 8)}: ${card.title}`,
    `Bucket: ${card.bucket}. Lane: ${card.lane}. Folder: ${card.folder}.`,
    '',
    'Intent:',
    card.intent ?? '',
    '',
    'Acceptance test:',
    card.acceptance_test ?? '',
    '',
    `Allowed paths: ${allowedPaths.join(', ')}.`,
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

function zeroUsage(usage: { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number }): boolean {
  return usage.input_tokens === 0 && usage.cache_creation_input_tokens === 0 && usage.cache_read_input_tokens === 0 && usage.output_tokens === 0;
}

export async function runAgentSession(card: Card, role: Role, worktree: string, studio: StudioState, deps: SessionDeps): Promise<SessionRun> {
  const ceiling = ceilingUsd(card.estimate_usd, studio.card_max_usd);
  const remaining = round4(ceiling - card.actual_usd);
  if (remaining <= 0) {
    return { outcome: 'ceiling', detail: `actual ${card.actual_usd} has reached the ceiling ${ceiling} before the session`, turns: 0 };
  }
  const spec: SessionSpec = {
    cardId: card.id,
    worktree,
    prompt: sessionPrompt(card, lanePaths(card.folder, card.lane)),
    systemPromptFile: rolePromptFile(role, worktree),
    model: role.model || deps.fallbackModel,
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

  let turns = 0;
  const onEvent = async (event: AgentEvent) => {
    switch (event.type) {
      case 'start': {
        await deps.db.insertEvent(card.id, role.id, 'start', { session_id: event.sessionId, model: event.model, tools: event.tools, mode: deps.adapter.mode });
        const refused = refusedTools(event.tools);
        if (refused.length > 0) abort('refused', `session exposes excluded tools: ${refused.join(', ')}`);
        return;
      }
      case 'turn_usage': {
        turns = event.turn;
        if (event.turn > deps.sessionMaxTurns) abort('turn_cap', `turn ${event.turn} exceeds the cap ${deps.sessionMaxTurns}`);
        if (zeroUsage(event.usage)) return;
        let priced;
        try {
          priced = priceUsage(deps.priceTable, event.model, event.usage);
        } catch (error) {
          if (error instanceof UnknownModelError) {
            abort('unknown_model', error.message);
            return;
          }
          throw error;
        }
        const recorded = await deps.db.recordUsage({ card_id: card.id, role_id: role.id, ...priced });
        deps.log.info('session', `turn ${event.turn} metered`, { card: card.id, usd: priced.usd, actual: recorded.actual_usd });
        if (recorded.actual_usd >= ceiling) abort('ceiling', `actual ${recorded.actual_usd} reached the ceiling ${ceiling}`);
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
        return;
    }
  };

  let result;
  try {
    result = await deps.adapter.run(spec, onEvent, controller.signal);
  } catch (error) {
    clearInterval(watch);
    deps.stopSignal.removeEventListener('abort', onStop);
    return { outcome: 'error', detail: errorMessage(error), turns };
  }
  clearInterval(watch);
  deps.stopSignal.removeEventListener('abort', onStop);

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
