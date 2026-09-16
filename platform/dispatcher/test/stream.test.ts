import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { StreamParser, parseStream, readUsage } from '../src/adapters/stream.js';

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
    // The sample carries no cache_creation split, so every cache write counts at the one-hour rate.
    expect(usages).toEqual([
      {
        type: 'turn_usage',
        turn: 1,
        model: 'claude-sonnet-5',
        usage: { input_tokens: 12, cache_creation_input_tokens: 8400, cache_creation_1h_input_tokens: 8400, cache_read_input_tokens: 0, output_tokens: 61 },
        contentChars: 'Reading the spawn table before changing it.'.length + JSON.stringify({ file_path: '<repo>/seed-1/config/spawn-table.json' }).length,
      },
      {
        type: 'turn_usage',
        turn: 2,
        model: 'claude-sonnet-5',
        usage: { input_tokens: 6, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 8400, output_tokens: 118 },
        contentChars: JSON.stringify({
          file_path: '<repo>/seed-1/config/spawn-table.json',
          old_string: '"id": "gatherer", "name": "Gatherer", "baseCost": 10',
          new_string: '"id": "gatherer", "name": "Gatherer", "baseCost": 11',
        }).length,
      },
      {
        type: 'turn_usage',
        turn: 3,
        model: 'claude-sonnet-5',
        usage: { input_tokens: 4, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 8412, output_tokens: 33 },
        contentChars: 'The gatherer baseCost is now 11 and the check line holds.'.length,
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
      usage: { input_tokens: 22, cache_creation_input_tokens: 8400, cache_creation_1h_input_tokens: 8400, cache_read_input_tokens: 16812, output_tokens: 212 },
      modelUsage: [],
      permissionDenials: [],
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
        usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_creation_1h_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 },
        contentChars: 7,
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
      {
        type: 'turn_usage',
        turn: 1,
        model: 'claude-sonnet-5',
        usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 9 },
        contentChars: 0,
      },
    ]);
    expect(parser.push(line('end_turn', 9))).toEqual([]);
    expect(parser.turns).toBe(1);
    expect(parser.finish()).toEqual([]);
  });
});

describe('readUsage', () => {
  it('splits cache writes by the cache_creation block and counts anything it does not explain as one-hour', () => {
    const split = (fiveMinute: unknown, oneHour: unknown, total = 1000) =>
      readUsage({ input_tokens: 1, cache_creation_input_tokens: total, output_tokens: 2, cache_creation: { ephemeral_5m_input_tokens: fiveMinute, ephemeral_1h_input_tokens: oneHour } });
    expect(split(600, 400)).toMatchObject({ cache_creation_input_tokens: 1000, cache_creation_1h_input_tokens: 400 });
    expect(split(1000, 0)).toMatchObject({ cache_creation_input_tokens: 1000, cache_creation_1h_input_tokens: 0 });
    // 300 tokens the split does not name are priced at the one-hour rate.
    expect(split(700, 0)).toMatchObject({ cache_creation_input_tokens: 1000, cache_creation_1h_input_tokens: 300 });
    expect(split('x', null)).toMatchObject({ cache_creation_input_tokens: 1000, cache_creation_1h_input_tokens: 1000 });
    // A split larger than the total raises the total rather than dropping tokens.
    expect(split(900, 400)).toMatchObject({ cache_creation_input_tokens: 1300, cache_creation_1h_input_tokens: 400 });
    expect(readUsage({ cache_creation_input_tokens: 50 })).toMatchObject({ cache_creation_input_tokens: 50, cache_creation_1h_input_tokens: 50 });
  });
});

describe('the result line', () => {
  it('reads modelUsage per model and the permission denials', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 2,
      result: 'done',
      total_cost_usd: 1.5,
      usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 20 },
      modelUsage: {
        'claude-sonnet-5': { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 30, cacheCreationInputTokens: 40, costUSD: 1.25 },
        'claude-haiku-5': { inputTokens: 1, outputTokens: 2, costUSD: 'n/a' },
      },
      permission_denials: [{ tool_name: 'Bash', tool_use_id: 'toolu_1', tool_input: { command: 'git push' } }],
    });
    const [end] = new StreamParser().push(line);
    expect(end).toMatchObject({
      type: 'end',
      modelUsage: [
        { model: 'claude-sonnet-5', input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40, cost_usd: 1.25 },
        { model: 'claude-haiku-5', input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: null },
      ],
      permissionDenials: [{ tool_name: 'Bash', tool_use_id: 'toolu_1', tool_input: { command: 'git push' } }],
    });
  });

  it('reports no usage, no models and no denials when the line carries none', () => {
    const [end] = new StreamParser().push('{"type":"result","subtype":"error_during_execution","is_error":true}');
    expect(end).toMatchObject({ type: 'end', usage: null, modelUsage: [], permissionDenials: [] });
  });

  it('counts text, thinking and tool input characters toward the turn', () => {
    const parser = new StreamParser();
    const line = (content: unknown[]) => JSON.stringify({ type: 'assistant', message: { id: 'msg_c', model: 'claude-sonnet-5', content, usage: { output_tokens: 1 } } });
    parser.push(line([{ type: 'thinking', thinking: 'abcd', signature: 'not counted' }]));
    parser.push(line([{ type: 'text', text: 'hello' }]));
    parser.push(line([{ type: 'tool_use', id: 't', name: 'Read', input: { a: 1 } }]));
    expect(parser.finish()).toMatchObject([{ type: 'turn_usage', contentChars: 4 + 5 + '{"a":1}'.length }]);
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

// Pinned to the recording whose session id is below. probe.ts rewrites probe.jsonl whenever a probe
// passes; the invariants hold for any recording, the exact numbers only for this one.
describe('usage in the recorded probe', () => {
  const PINNED_SESSION = 'c8f7d2e6-bad7-4361-b2f5-4ece9bc3c0d1';
  const probePath = new URL('./fixtures/probe.jsonl', import.meta.url);
  const recorded = existsSync(probePath) ? readFileSync(probePath, 'utf8') : null;
  const pinned = recorded?.includes(`"session_id":"${PINNED_SESSION}"`) ?? false;
  const events = parseStream(recorded ?? '');

  it.skipIf(recorded === null)('reads the result line usage, which is never below the assistant lines', () => {
    const turns = events.filter((e) => e.type === 'turn_usage');
    const end = events.find((e) => e.type === 'end');
    expect(end?.type).toBe('end');
    if (end?.type !== 'end') return;
    expect(end.usage).not.toBeNull();
    expect(end.modelUsage.length).toBeGreaterThan(0);
    const reported = turns.reduce((total, turn) => total + turn.usage.output_tokens, 0);
    expect(end.usage!.output_tokens).toBeGreaterThanOrEqual(reported);
    for (const turn of turns) expect(turn.usage.cache_creation_1h_input_tokens).toBeLessThanOrEqual(turn.usage.cache_creation_input_tokens);
  });

  it.skipIf(!pinned)('emits one turn of 2 output tokens with every cache write at one hour, and a result line of 49', () => {
    expect(events.filter((e) => e.type === 'turn_usage')).toEqual([
      {
        type: 'turn_usage',
        turn: 1,
        model: 'claude-sonnet-5',
        usage: { input_tokens: 2, cache_creation_input_tokens: 8449, cache_creation_1h_input_tokens: 8449, cache_read_input_tokens: 0, output_tokens: 2 },
        contentChars: 35,
      },
    ]);
    const end = events.find((e) => e.type === 'end');
    if (end?.type !== 'end') throw new Error('no end event');
    expect(end.usage?.output_tokens).toBe(49);
    expect(end.usage?.cache_creation_1h_input_tokens).toBe(8449);
    expect(end.modelUsage).toEqual([
      { model: 'claude-sonnet-5', input_tokens: 2, output_tokens: 49, cache_read_input_tokens: 0, cache_creation_input_tokens: 8449, cost_usd: 0.05404125 },
    ]);
    expect(end.permissionDenials).toEqual([]);
  });
});
