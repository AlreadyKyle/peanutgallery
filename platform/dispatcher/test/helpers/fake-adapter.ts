// Scripted adapter for session and pipeline tests: the script emits events (and may edit the
// worktree) and stops when the session aborts, the way the real child is interrupted. Like Claude
// Code, it ends with a result line whose modelUsage totals the turns it emitted, also after an
// interrupt unless resultOnAbort is false.
import { refusedTools } from '../../src/adapters/attended.js';
import type { AgentAdapter, AgentEvent, AgentMode, EventSink, ModelUsage, SessionResult, SessionSpec } from '../../src/adapters/types.js';
import type { TurnUsage } from '../../src/pricing.js';

export type Emit = (event: AgentEvent) => Promise<void>;
export type FakeScript = (spec: SessionSpec, emit: Emit, signal: AbortSignal) => Promise<void>;

export interface FakeEnd {
  subtype?: string;
  isError?: boolean;
  exitCode?: number;
}

export interface FakeOptions extends FakeEnd {
  mode?: AgentMode;
  // The result line's modelUsage in place of the emitted turns' totals.
  modelUsage?: ModelUsage[];
  resultOnAbort?: boolean;
  // The result line's final message: a role job's typed answer (docs/specs/agent-workflows.md).
  result?: string | ((spec: SessionSpec) => string);
}

export class FakeAdapter implements AgentAdapter {
  readonly mode: AgentMode;
  readonly specs: SessionSpec[] = [];
  private readonly script: FakeScript;
  private readonly end: FakeOptions;

  constructor(script: FakeScript, options: FakeOptions = {}) {
    this.script = script;
    this.end = options;
    this.mode = options.mode ?? 'attended';
  }

  async preflight(spec: SessionSpec): Promise<void> {
    const refused = refusedTools(spec.roleTools);
    if (refused.length > 0) throw new Error(`role tools include excluded tools: ${refused.join(', ')}`);
  }

  async run(spec: SessionSpec, onEvent: EventSink, signal: AbortSignal): Promise<SessionResult> {
    this.specs.push(spec);
    let turns = 0;
    const totals = new Map<string, ModelUsage>();
    const emit: Emit = async (event) => {
      if (signal.aborted) return;
      if (event.type === 'turn_usage') {
        turns = event.turn;
        const total = totals.get(event.model) ?? { model: event.model, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: null };
        total.input_tokens += event.usage.input_tokens;
        total.output_tokens += event.usage.output_tokens;
        total.cache_read_input_tokens += event.usage.cache_read_input_tokens;
        total.cache_creation_input_tokens += event.usage.cache_creation_input_tokens;
        totals.set(event.model, total);
      }
      await onEvent(event);
    };
    await this.script(spec, emit, signal);
    const endEvent = (subtype: string, isError: boolean): AgentEvent => ({
      type: 'end',
      subtype,
      isError,
      totalCostUsd: null,
      numTurns: turns,
      result: typeof this.end.result === 'function' ? this.end.result(spec) : (this.end.result ?? ''),
      usage: null,
      modelUsage: this.end.modelUsage ?? [...totals.values()],
      permissionDenials: [],
    });
    if (signal.aborted) {
      if (this.end.resultOnAbort === false) {
        return { exitCode: null, killed: true, killReason: String(signal.reason), turns, endSubtype: null, totalCostUsd: null, numTurns: null, isError: false };
      }
      await onEvent(endEvent('error_during_execution', true));
      return { exitCode: 130, killed: true, killReason: String(signal.reason), turns, endSubtype: 'error_during_execution', totalCostUsd: null, numTurns: turns, isError: true };
    }
    const subtype = this.end.subtype ?? 'success';
    const isError = this.end.isError ?? false;
    await onEvent(endEvent(subtype, isError));
    return { exitCode: this.end.exitCode ?? 0, killed: false, killReason: null, turns, endSubtype: subtype, totalCostUsd: null, numTurns: turns, isError };
  }
}

// Claude Code reports apiKeySource 'none' for a subscription sign-in, which is what an attended
// session must show; an unattended session must show 'ANTHROPIC_API_KEY'.
export function startEvent(tools: string[] = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'], apiKeySource: string | null = 'none'): AgentEvent {
  return { type: 'start', sessionId: 'session-1', model: 'builder-class', tools, apiKeySource };
}

export function usageEvent(turn: number, outputTokens: number, model = 'builder-class', extra: Partial<TurnUsage> = {}, contentChars = 0, thinking = false): AgentEvent {
  return {
    type: 'turn_usage',
    turn,
    model,
    usage: { input_tokens: 1000, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: outputTokens, ...extra },
    contentChars,
    thinking,
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
