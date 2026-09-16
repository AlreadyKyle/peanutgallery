// The agent adapter interface. Attended mode runs Claude Code on the founder's subscription;
// unattended mode runs the same command line on the studio organisation's key.
import type { AgentMode } from '../throttle.js';
import type { TurnUsage } from '../pricing.js';

export type { AgentMode };

export type CardFolder = 'seed-1' | 'platform';

export interface SessionSpec {
  cardId: string;
  worktree: string;
  prompt: string;
  // Absolute path of the executor role's prompt file (roles.prompt_path resolved in the worktree),
  // appended to the session's system prompt; null when the role has none.
  systemPromptFile: string | null;
  model: string;
  roleTools: string[];
  folder: CardFolder;
  maxTurns: number;
  maxBudgetUsd: number;
}

// One model's totals from the result line's modelUsage block. cost_usd is the command line's own
// figure, from a table that is not ours; the ledger never records it.
export interface ModelUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number | null;
}

export type AgentEvent =
  // apiKeySource is the init line's account report: 'ANTHROPIC_API_KEY' when the session bills
  // an API key, another value (Claude Code reports 'none' for a subscription sign-in) otherwise,
  // null when the line carries no such field. The session refuses the wrong source for its mode.
  | { type: 'start'; sessionId: string | null; model: string | null; tools: string[]; apiKeySource: string | null }
  // contentChars is the length of the turn's text, thinking and tool input, so a meter can estimate
  // output tokens the stream under-reports; thinking is true when the turn had a thinking block,
  // whose text Claude Code does not write.
  | { type: 'turn_usage'; turn: number; model: string; usage: TurnUsage; contentChars: number; thinking: boolean }
  // Content on a line for a turn whose usage was already emitted, so the estimate still counts it;
  // outputTokens is the increase in the id's reported output, and thinking is true only the first
  // time the id shows a thinking block.
  | { type: 'turn_content'; model: string; contentChars: number; thinking: boolean; outputTokens: number }
  // A compact_boundary line: Claude Code summarised a context of preTokens tokens in a request of its
  // own, on the model named (the last turn's, or the session's before any turn).
  | { type: 'compaction'; model: string; preTokens: number }
  | { type: 'tool_call'; toolUseId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { type: 'message'; text: string }
  // usage is the result line's session total, null when the line has none; modelUsage is empty when
  // the line has no modelUsage block.
  | {
      type: 'end';
      subtype: string;
      isError: boolean;
      totalCostUsd: number | null;
      numTurns: number | null;
      result: string;
      usage: TurnUsage | null;
      modelUsage: ModelUsage[];
      permissionDenials: unknown[];
    }
  | { type: 'error'; message: string };

export type EndEvent = Extract<AgentEvent, { type: 'end' }>;

export interface SessionResult {
  exitCode: number | null;
  killed: boolean;
  killReason: string | null;
  turns: number;
  endSubtype: string | null;
  totalCostUsd: number | null;
  numTurns: number | null;
  isError: boolean;
}

export type EventSink = (event: AgentEvent) => void | Promise<void>;

// A tap on the raw stream lines of one run, before parsing. The probe uses it to scan the whole
// stream for forbidden names and to save the recording; card sessions pass nothing.
export type RawLineSink = (line: string) => void;

export interface AgentAdapter {
  readonly mode: AgentMode;
  preflight(spec: SessionSpec): Promise<void>;
  run(spec: SessionSpec, onEvent: EventSink, signal: AbortSignal, onRawLine?: RawLineSink): Promise<SessionResult>;
}
