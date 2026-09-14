// Pure parser for Claude Code's --output-format stream-json lines.
// Shape: a system/init line, assistant lines carrying message.model and message.usage,
// user lines carrying tool_result blocks, and a final result line.
// Assistant lines that share a message id belong to one turn; usage is emitted once per turn,
// using the last usage block seen for that id, as soon as a line for that id carries a
// stop_reason (the model has finished the turn), otherwise when the next turn begins or at
// the end. Metering therefore runs before the next turn starts, not one turn late.
import type { AgentEvent } from './types.js';
import type { TurnUsage } from '../pricing.js';

export const RESULT_TEXT_LIMIT = 4000;

interface PendingTurn {
  id: string;
  model: string;
  usage: TurnUsage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function readUsage(raw: unknown): TurnUsage | null {
  if (!isRecord(raw)) return null;
  return {
    input_tokens: count(raw.input_tokens),
    cache_creation_input_tokens: count(raw.cache_creation_input_tokens),
    cache_read_input_tokens: count(raw.cache_read_input_tokens),
    output_tokens: count(raw.output_tokens),
  };
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
      .filter((text) => text.length > 0)
      .join('\n');
  }
  return '';
}

export function clip(text: string, limit: number = RESULT_TEXT_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export class StreamParser {
  private pending: PendingTurn | null = null;
  private flushedId: string | null = null;
  private turnCount = 0;
  private anonymousTurns = 0;

  get turns(): number {
    return this.turnCount;
  }

  push(line: string): AgentEvent[] {
    const trimmed = line.trim();
    if (trimmed.length === 0) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
    if (!isRecord(parsed) || typeof parsed.type !== 'string') return [];
    switch (parsed.type) {
      case 'system':
        return this.system(parsed);
      case 'assistant':
        return this.assistant(parsed);
      case 'user':
        return this.user(parsed);
      case 'result':
        return this.result(parsed);
      default:
        return [];
    }
  }

  finish(): AgentEvent[] {
    return this.flush();
  }

  private flush(): AgentEvent[] {
    if (!this.pending) return [];
    const turn = this.pending;
    this.pending = null;
    this.flushedId = turn.id;
    return [{ type: 'turn_usage', turn: this.turnCount, model: turn.model, usage: turn.usage }];
  }

  private system(line: Record<string, unknown>): AgentEvent[] {
    if (line.subtype !== 'init') return [];
    const tools = Array.isArray(line.tools) ? line.tools.filter((t): t is string => typeof t === 'string') : [];
    return [
      {
        type: 'start',
        sessionId: typeof line.session_id === 'string' ? line.session_id : null,
        model: typeof line.model === 'string' ? line.model : null,
        tools,
        apiKeySource: typeof line.apiKeySource === 'string' ? line.apiKeySource : null,
      },
    ];
  }

  private assistant(line: Record<string, unknown>): AgentEvent[] {
    const message = isRecord(line.message) ? line.message : {};
    const events: AgentEvent[] = [];
    const usage = readUsage(message.usage);
    const model = typeof message.model === 'string' ? message.model : '';
    const id = typeof message.id === 'string' ? message.id : `anonymous-${++this.anonymousTurns}`;
    const stopReason = typeof message.stop_reason === 'string' && message.stop_reason.length > 0;
    if (this.pending && this.pending.id !== id) {
      events.push(...this.flush());
    }
    // A line for an id whose usage was already emitted adds no turn and no usage.
    const finished = !this.pending && this.flushedId === id;
    if (!this.pending && !finished) {
      this.turnCount += 1;
      this.pending = { id, model, usage: usage ?? { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } };
    } else if (this.pending && usage) {
      this.pending.usage = usage;
      if (model) this.pending.model = model;
    }
    const content = Array.isArray(message.content) ? message.content : [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
        events.push({ type: 'message', text: block.text });
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        events.push({
          type: 'tool_call',
          toolUseId: typeof block.id === 'string' ? block.id : '',
          name: block.name,
          input: block.input,
        });
      }
    }
    if (stopReason) events.push(...this.flush());
    return events;
  }

  private user(line: Record<string, unknown>): AgentEvent[] {
    const message = isRecord(line.message) ? line.message : {};
    const content = Array.isArray(message.content) ? message.content : [];
    const events: AgentEvent[] = [];
    for (const block of content) {
      if (!isRecord(block) || block.type !== 'tool_result') continue;
      events.push({
        type: 'tool_result',
        toolUseId: typeof block.tool_use_id === 'string' ? block.tool_use_id : '',
        content: clip(contentText(block.content)),
        isError: block.is_error === true,
      });
    }
    return events;
  }

  private result(line: Record<string, unknown>): AgentEvent[] {
    const events = this.flush();
    events.push({
      type: 'end',
      subtype: typeof line.subtype === 'string' ? line.subtype : '',
      isError: line.is_error === true,
      totalCostUsd: typeof line.total_cost_usd === 'number' ? line.total_cost_usd : null,
      numTurns: typeof line.num_turns === 'number' ? line.num_turns : null,
      result: typeof line.result === 'string' ? clip(line.result) : '',
    });
    return events;
  }
}

// Parses a whole recorded stream (one JSON object per line) into its events.
export function parseStream(text: string): AgentEvent[] {
  const parser = new StreamParser();
  const events: AgentEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    events.push(...parser.push(line));
  }
  events.push(...parser.finish());
  return events;
}
