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

export type AgentEvent =
  // apiKeySource is the init line's account report: 'ANTHROPIC_API_KEY' when the session bills
  // an API key, another value (Claude Code reports 'none' for a subscription sign-in) otherwise,
  // null when the line carries no such field. The session refuses the wrong source for its mode.
  | { type: 'start'; sessionId: string | null; model: string | null; tools: string[]; apiKeySource: string | null }
  | { type: 'turn_usage'; turn: number; model: string; usage: TurnUsage }
  | { type: 'tool_call'; toolUseId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { type: 'message'; text: string }
  | { type: 'end'; subtype: string; isError: boolean; totalCostUsd: number | null; numTurns: number | null; result: string }
  | { type: 'error'; message: string };

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
