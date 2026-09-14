import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { StreamParser, parseStream } from '../src/adapters/stream.js';

const fixture = readFileSync(new URL('./fixtures/sample-stream.jsonl', import.meta.url), 'utf8');

describe('parseStream against the recorded sample', () => {
  const events = parseStream(fixture);

  it('emits the event sequence in order', () => {
    expect(events.map((e) => e.type)).toEqual([
      'start',
      'message',
      'tool_call',
      'turn_usage',
      'tool_result',
      'tool_call',
      'turn_usage',
      'tool_result',
      'message',
      'turn_usage',
      'end',
    ]);
  });

  it('reads the init line', () => {
    const start = events[0];
    expect(start).toEqual({
      type: 'start',
      sessionId: '7d2c1f0e-3b7a-4c58-9a1e-2f6d8b4c9e10',
      model: 'claude-sonnet-5',
      tools: ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'],
      apiKeySource: 'none',
    });
  });

  it('emits one usage per assistant message id as soon as its stop_reason arrives, keeping the last usage block', () => {
    const usages = events.filter((e) => e.type === 'turn_usage');
    expect(usages).toEqual([
      {
        type: 'turn_usage',
        turn: 1,
        model: 'claude-sonnet-5',
        usage: { input_tokens: 12, cache_creation_input_tokens: 8400, cache_read_input_tokens: 0, output_tokens: 61 },
      },
      {
        type: 'turn_usage',
        turn: 2,
        model: 'claude-sonnet-5',
        usage: { input_tokens: 6, cache_creation_input_tokens: 0, cache_read_input_tokens: 8400, output_tokens: 118 },
      },
      {
        type: 'turn_usage',
        turn: 3,
        model: 'claude-sonnet-5',
        usage: { input_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 8412, output_tokens: 33 },
      },
    ]);
  });

  it('reads tool calls and tool results', () => {
    const calls = events.filter((e) => e.type === 'tool_call');
    expect(calls.map((c) => c.name)).toEqual(['Read', 'Edit']);
    expect(calls[0]).toMatchObject({ toolUseId: 'toolu_01Hx9pQ2rT5vW8yA3bC6dE0f', input: { file_path: '<repo>/seed-1/config/spawn-table.json' } });
    const results = events.filter((e) => e.type === 'tool_result');
    expect(results[1]).toEqual({
      type: 'tool_result',
      toolUseId: 'toolu_01Jy0qR3sU6wX9zB4cD7eF1g',
      content: 'The file <repo>/seed-1/config/spawn-table.json has been updated successfully.',
      isError: false,
    });
  });

  it('reads the result line', () => {
    expect(events.at(-1)).toEqual({
      type: 'end',
      subtype: 'success',
      isError: false,
      totalCostUsd: 0.0517,
      numTurns: 3,
      result: 'The gatherer baseCost is now 11 and the check line holds.',
    });
  });
});

describe('StreamParser', () => {
  it('ignores blank and non-JSON lines', () => {
    const parser = new StreamParser();
    expect(parser.push('')).toEqual([]);
    expect(parser.push('warning: not a stream line')).toEqual([]);
    expect(parser.push('{"type":"unknown"}')).toEqual([]);
  });

  it('flushes a pending turn on finish when no result line arrives', () => {
    const parser = new StreamParser();
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_pending',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'partial' }],
        usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 },
      },
    });
    expect(parser.push(line).map((e) => e.type)).toEqual(['message']);
    expect(parser.turns).toBe(1);
    expect(parser.finish()).toEqual([
      {
        type: 'turn_usage',
        turn: 1,
        model: 'claude-sonnet-5',
        usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 },
      },
    ]);
    expect(parser.finish()).toEqual([]);
  });

  it('reads apiKeySource from the init line and reports null when the line has none', () => {
    const init = (extra: Record<string, unknown>) => JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', tools: ['Read'], model: 'claude-sonnet-5', ...extra });
    expect(new StreamParser().push(init({ apiKeySource: 'ANTHROPIC_API_KEY' }))).toEqual([
      { type: 'start', sessionId: 's', model: 'claude-sonnet-5', tools: ['Read'], apiKeySource: 'ANTHROPIC_API_KEY' },
    ]);
    expect(new StreamParser().push(init({}))[0]).toMatchObject({ type: 'start', apiKeySource: null });
    expect(new StreamParser().push(init({ apiKeySource: 7 }))[0]).toMatchObject({ type: 'start', apiKeySource: null });
  });

  it('counts a message without an id as its own turn', () => {
    const parser = new StreamParser();
    const line = JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', content: [], usage: { output_tokens: 1 } } });
    parser.push(line);
    parser.push(line);
    expect(parser.turns).toBe(2);
  });

  it('emits usage on the stop_reason line and ignores a later line for the same id', () => {
    const parser = new StreamParser();
    const line = (stop: string | null, output: number) =>
      JSON.stringify({
        type: 'assistant',
        message: { id: 'msg_a', model: 'claude-sonnet-5', stop_reason: stop, content: [], usage: { input_tokens: 1, output_tokens: output } },
      });
    expect(parser.push(line(null, 3))).toEqual([]);
    expect(parser.push(line('end_turn', 9))).toEqual([
      { type: 'turn_usage', turn: 1, model: 'claude-sonnet-5', usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 9 } },
    ]);
    expect(parser.push(line('end_turn', 9))).toEqual([]);
    expect(parser.turns).toBe(1);
    expect(parser.finish()).toEqual([]);
  });
});

// The probe saves the real stream of a one-turn attended session only when it passes, so a
// recording that exists must be a successful run: a start event with no excluded tool, an end
// event without error, and no local user path in either the slash or the dash-encoded form.
// Until the probe has passed on this machine there is no recording and this test is skipped.
describe('parseStream against the recorded probe', () => {
  const probePath = new URL('./fixtures/probe.jsonl', import.meta.url);
  const recorded = existsSync(probePath) ? readFileSync(probePath, 'utf8') : null;

  it.skipIf(recorded === null)('is a passing session that exposes no excluded tool, no memory path and no local path', () => {
    const events = parseStream(recorded ?? '');
    const start = events.find((e) => e.type === 'start');
    expect(start?.type).toBe('start');
    if (start?.type !== 'start') return;
    expect(start.tools.length).toBeGreaterThan(0);
    expect(start.tools.filter((tool) => ['WebFetch', 'WebSearch', 'Agent', 'Task'].includes(tool) || tool.startsWith('mcp__'))).toEqual([]);
    const end = events.at(-1);
    expect(end?.type).toBe('end');
    if (end?.type !== 'end') return;
    expect(end.isError).toBe(false);
    expect(recorded).not.toMatch(/"memory_paths"/);
    expect(recorded).not.toMatch(/[/-](Users|home)[/-]/);
  });
});
