// The agent adapter interface. Attended mode runs Claude Code on the founder's subscription on the
// Mac; unattended mode runs each card as a Claude Managed Agents session on the studio organisation's
// key, in a container Anthropic hosts, so no agent-written code runs where the dispatcher runs.
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
  // The executor role, for the ledger rows an adapter writes itself (the managed adapter); null for
  // the probe.
  roleId?: string | null;
  // The lane's paths, which a patch the managed adapter receives must stay inside.
  allowedPaths?: readonly string[];
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
  // ledger is 'adapter' when the adapter writes the session's ledger rows itself (the managed
  // adapter: one row per model request, a runtime row and a settle row to the platform's list cost),
  // so the session records none and settles nothing.
  | { type: 'start'; sessionId: string | null; model: string | null; tools: string[]; apiKeySource: string | null; ledger?: 'adapter' }
  // contentChars is the length of the turn's text, thinking and tool input, so a meter can estimate
  // output tokens the stream under-reports; thinking is true when the turn had a thinking block,
  // whose text Claude Code does not write. requestId is the platform's id for the model request
  // (the managed adapter's span.model_request_end event id), which is the ledger row's request id.
  | { type: 'turn_usage'; turn: number; model: string; usage: TurnUsage; contentChars: number; thinking: boolean; requestId?: string }
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

// What a card's managed sessions left when recovery closed them: each session settled to the ledger
// and archived, or the reason one could not be.
export interface ClosedSessions {
  sessionIds: string[];
  // A patch the agent submitted that no one answered, now stored for the card (card_patches).
  patchStored: boolean;
  unsettled: string[];
}

// The unattended controls only the managed adapter has: the containment check and the probe at
// startup, and the orphan sessions recovery closes before it pauses a card.
export interface ManagedControl {
  // Throws a StartupError (fatal or not) unless the ids, the read-only token, the agent and the
  // environment are exactly what the repository declares.
  checkContainment(): Promise<void>;
  // One minimal session billed as overhead; throws a StartupError when it fails.
  probe(): Promise<void>;
  // Settles and archives every unarchived session the agent holds, keyed by the card it ran for.
  // Throws when the sessions cannot be listed.
  closeOrphans(): Promise<Map<string, ClosedSessions>>;
}

export interface AgentAdapter {
  readonly mode: AgentMode;
  // Present on the managed adapter only.
  readonly managed?: ManagedControl;
  preflight(spec: SessionSpec): Promise<void>;
  run(spec: SessionSpec, onEvent: EventSink, signal: AbortSignal, onRawLine?: RawLineSink): Promise<SessionResult>;
}
