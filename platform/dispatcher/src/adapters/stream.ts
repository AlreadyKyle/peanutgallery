// Pure parser for Claude Code's --output-format stream-json lines.
// Shape: a system/init line, assistant lines carrying message.model and message.usage,
// user lines carrying tool_result blocks, and a final result line.
// Assistant lines that share a message id belong to one turn. Claude Code writes one line per
// content block, each with a null stop_reason, so a turn ends at the first line that is not an
// assistant line for its id: a user line with the tool results, a system or rate-limit line, the
// result line, another message id, or the end of the stream. A line that does carry a stop_reason
// ends the turn at once. Usage is emitted once per turn from the last usage block seen for the id,
// so metering runs before the next request's turn, not one turn late. A later line for the turn
// just emitted adds no turn and no usage; its characters are passed on as turn_content.
// The assistant lines' usage is not the whole bill: Claude Code writes them before the turn's output
// is counted, so the result line's usage and modelUsage carry the totals the meter settles against.
import type { AgentEvent, ModelUsage } from './types.js';
import type { TurnUsage } from '../pricing.js';

export const RESULT_TEXT_LIMIT = 4000;

interface PendingTurn {
  id: string;
  model: string;
  usage: TurnUsage;
  contentChars: number;
  thinking: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

// The five-minute and one-hour split comes from usage.cache_creation. Cache writes the split does not
// explain, including every cache write when there is no split, count as one-hour, the higher rate, so
// the ledger never records less than was spent.
export function readUsage(raw: unknown): TurnUsage | null {
  if (!isRecord(raw)) return null;
  const split = isRecord(raw.cache_creation) ? raw.cache_creation : {};
  const fiveMinute = count(split.ephemeral_5m_input_tokens);
  const creation = Math.max(count(raw.cache_creation_input_tokens), fiveMinute + count(split.ephemeral_1h_input_tokens));
  return {
    input_tokens: count(raw.input_tokens),
    cache_creation_input_tokens: creation,
    cache_creation_1h_input_tokens: creation - fiveMinute,
    cache_read_input_tokens: count(raw.cache_read_input_tokens),
    output_tokens: count(raw.output_tokens),
  };
}

// The result line's modelUsage block is keyed by model id. Claude Code writes camelCase counts;
// snake_case is read too, so a renamed field is not silently read as zero.
export function readModelUsage(raw: unknown): ModelUsage[] {
  if (!isRecord(raw)) return [];
  return Object.entries(raw)
    .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
    .map(([model, counts]) => {
      const cost = counts.costUSD ?? counts.cost_usd;
      return {
        model,
        input_tokens: count(counts.inputTokens ?? counts.input_tokens),
        output_tokens: count(counts.outputTokens ?? counts.output_tokens),
        cache_read_input_tokens: count(counts.cacheReadInputTokens ?? counts.cache_read_input_tokens),
        cache_creation_input_tokens: count(counts.cacheCreationInputTokens ?? counts.cache_creation_input_tokens),
        cost_usd: typeof cost === 'number' && Number.isFinite(cost) ? cost : null,
      };
    });
}

// Characters of model output in one content block: text, thinking, or a tool call's input as JSON.
function blockChars(block: Record<string, unknown>): number {
  if (block.type === 'text' && typeof block.text === 'string') return block.text.length;
  if (block.type === 'thinking' && typeof block.thinking === 'string') return block.thinking.length;
  if (block.type === 'tool_use') return JSON.stringify(block.input ?? {}).length;
  return 0;
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
  private flushedModel = '';
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
    if (parsed.type === 'assistant') return this.assistant(parsed);
    // Any other line ends the turn in progress.
    const events = this.flush();
    switch (parsed.type) {
      case 'system':
        events.push(...this.system(parsed));
        break;
      case 'user':
        events.push(...this.user(parsed));
        break;
      case 'result':
        events.push(...this.result(parsed));
        break;
    }
    return events;
  }

  finish(): AgentEvent[] {
    return this.flush();
  }

  private flush(): AgentEvent[] {
    if (!this.pending) return [];
    const turn = this.pending;
    this.pending = null;
    this.flushedId = turn.id;
    this.flushedModel = turn.model;
    return [{ type: 'turn_usage', turn: this.turnCount, model: turn.model, usage: turn.usage, contentChars: turn.contentChars, thinking: turn.thinking }];
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
      const zero = { input_tokens: 0, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
      this.pending = { id, model, usage: usage ?? zero, contentChars: 0, thinking: false };
    } else if (this.pending && usage) {
      this.pending.usage = usage;
      if (model) this.pending.model = model;
    }
    const content = Array.isArray(message.content) ? message.content : [];
    const late = { contentChars: 0, thinking: false };
    for (const block of content) {
      if (!isRecord(block)) continue;
      const target = this.pending?.id === id ? this.pending : late;
      target.contentChars += blockChars(block);
      if (block.type === 'thinking') target.thinking = true;
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
    if (finished && (late.contentChars > 0 || late.thinking)) {
      events.unshift({ type: 'turn_content', model: model || this.flushedModel, contentChars: late.contentChars, thinking: late.thinking });
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
    const events: AgentEvent[] = [];
    events.push({
      type: 'end',
      subtype: typeof line.subtype === 'string' ? line.subtype : '',
      isError: line.is_error === true,
      totalCostUsd: typeof line.total_cost_usd === 'number' ? line.total_cost_usd : null,
      numTurns: typeof line.num_turns === 'number' ? line.num_turns : null,
      result: typeof line.result === 'string' ? clip(line.result) : '',
      usage: readUsage(line.usage),
      modelUsage: readModelUsage(line.modelUsage),
      permissionDenials: Array.isArray(line.permission_denials) ? line.permission_denials : [],
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
