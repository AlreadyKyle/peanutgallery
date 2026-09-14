// Scripted adapter for session and pipeline tests: the script emits events (and may edit the
// worktree) and stops when the session aborts, the way the real child is killed.
import { refusedTools } from '../../src/adapters/attended.js';
import type { AgentAdapter, AgentEvent, EventSink, SessionResult, SessionSpec } from '../../src/adapters/types.js';
import type { TurnUsage } from '../../src/pricing.js';

export type Emit = (event: AgentEvent) => Promise<void>;
export type FakeScript = (spec: SessionSpec, emit: Emit, signal: AbortSignal) => Promise<void>;

export interface FakeEnd {
  subtype?: string;
  isError?: boolean;
  exitCode?: number;
}

export class FakeAdapter implements AgentAdapter {
  readonly mode = 'attended' as const;
  readonly specs: SessionSpec[] = [];
  private readonly script: FakeScript;
  private readonly end: FakeEnd;

  constructor(script: FakeScript, end: FakeEnd = {}) {
    this.script = script;
    this.end = end;
  }

  async preflight(spec: SessionSpec): Promise<void> {
    const refused = refusedTools(spec.roleTools);
    if (refused.length > 0) throw new Error(`role tools include excluded tools: ${refused.join(', ')}`);
  }

  async run(spec: SessionSpec, onEvent: EventSink, signal: AbortSignal): Promise<SessionResult> {
    this.specs.push(spec);
    let turns = 0;
    const emit: Emit = async (event) => {
      if (signal.aborted) return;
      if (event.type === 'turn_usage') turns = event.turn;
      await onEvent(event);
    };
    await this.script(spec, emit, signal);
    if (signal.aborted) {
      return { exitCode: null, killed: true, killReason: String(signal.reason), turns, endSubtype: null, totalCostUsd: null, numTurns: null, isError: false };
    }
    const subtype = this.end.subtype ?? 'success';
    const isError = this.end.isError ?? false;
    await onEvent({ type: 'end', subtype, isError, totalCostUsd: null, numTurns: turns, result: '' });
    return { exitCode: this.end.exitCode ?? 0, killed: false, killReason: null, turns, endSubtype: subtype, totalCostUsd: null, numTurns: turns, isError };
  }
}

export function startEvent(tools: string[] = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash']): AgentEvent {
  return { type: 'start', sessionId: 'session-1', model: 'builder-class', tools };
}

export function usageEvent(turn: number, outputTokens: number, model = 'builder-class', extra: Partial<TurnUsage> = {}): AgentEvent {
  return {
    type: 'turn_usage',
    turn,
    model,
    usage: { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: outputTokens, ...extra },
  };
}

// Resolves when the signal aborts, or after the timeout so a broken test cannot hang.
export function untilAborted(signal: AbortSignal, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, timeoutMs);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
