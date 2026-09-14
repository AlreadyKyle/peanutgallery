import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStream } from '../src/adapters/stream.js';
import type { SessionResult } from '../src/adapters/types.js';
import { PROMPT, initRecord, judge, memoryPaths, replacePaths, sumUsage } from '../src/probe-core.js';

const fixture = readFileSync(new URL('./fixtures/sample-stream.jsonl', import.meta.url), 'utf8');

// The recorded sample bills no key ('none'); an unattended recording is the same stream with
// the studio key reported instead.
const attendedRaw = fixture.split('\n').filter((line) => line.length > 0);
const unattendedRaw = attendedRaw.map((line) => line.replace('"apiKeySource":"none"', '"apiKeySource":"ANTHROPIC_API_KEY"'));

const ok: SessionResult = { exitCode: 0, killed: false, killReason: null, turns: 3, endSubtype: 'success', totalCostUsd: 0.0517, numTurns: 3, isError: false };

function events(raw: readonly string[]) {
  return parseStream(raw.join('\n'));
}

describe('judge', () => {
  it('passes an attended session that bills no key and an unattended session that bills the studio key', () => {
    expect(judge('attended', attendedRaw, events(attendedRaw), ok)).toBeNull();
    expect(judge('unattended', unattendedRaw, events(unattendedRaw), ok)).toBeNull();
  });

  it('fails an unattended session that bills anything but ANTHROPIC_API_KEY', () => {
    expect(judge('unattended', attendedRaw, events(attendedRaw), ok)).toBe('apiKeySource is none; unattended mode bills ANTHROPIC_API_KEY and nothing else');
    const unreported = attendedRaw.map((line) => line.replace(',"apiKeySource":"none"', ''));
    expect(judge('unattended', unreported, events(unreported), ok)).toBe('apiKeySource is unreported; unattended mode bills ANTHROPIC_API_KEY and nothing else');
  });

  it('fails an attended session that bills ANTHROPIC_API_KEY', () => {
    expect(judge('attended', unattendedRaw, events(unattendedRaw), ok)).toBe('apiKeySource is ANTHROPIC_API_KEY; attended mode runs on the subscription, not on a key');
  });

  it('fails on no output, no init line and an empty tool list', () => {
    expect(judge('attended', [], [], ok)).toBe('claude produced no stream output');
    expect(judge('attended', ['warning: not a stream line'], [], ok)).toBe('no system init line in the stream');
    const noTools = attendedRaw.map((line) => line.replace('"tools":["Bash","Edit","Glob","Grep","Read","Write"]', '"tools":[]'));
    expect(judge('attended', noTools, events(noTools), ok)).toBe('init line lists no tools');
  });

  it('fails when a forbidden tool name appears anywhere in the stream', () => {
    const withWeb = [...attendedRaw.slice(0, 1), attendedRaw[1]!.replace('Reading the spawn table before changing it.', 'Tools: Read, WebFetch, mcp__github__create_issue'), ...attendedRaw.slice(2)];
    expect(judge('attended', withWeb, events(withWeb), ok)).toBe('forbidden tool names in the stream: WebFetch, mcp__github__create_issue');
  });

  it('fails when the init line registers a memory path', () => {
    const withMemory = [attendedRaw[0]!.replace('"mcp_servers":[]', '"memory_paths":["<home>/.claude/projects/<repo>/memory/MEMORY.md"],"mcp_servers":[]'), ...attendedRaw.slice(1)];
    expect(judge('attended', withMemory, events(withMemory), ok)).toBe('memory paths registered for the session: <home>/.claude/projects/<repo>/memory/MEMORY.md');
  });

  it('fails a session that ended in error, quoting the first line of the result', () => {
    const errored = attendedRaw.map((line) => line.replace('"result":"The gatherer baseCost is now 11 and the check line holds."', '"result":"Not logged in\\nRun claude login"'));
    expect(judge('attended', errored, events(errored), { ...ok, isError: true })).toBe('session ended in error: Not logged in');
  });
});

describe('initRecord and memoryPaths', () => {
  it('finds the init line past leading noise and reads memory paths in either shape', () => {
    const init = initRecord(['not json', '{"type":"assistant"}', ...attendedRaw]);
    expect(init?.apiKeySource).toBe('none');
    expect(initRecord(['{"type":"assistant"}'])).toBeNull();
    expect(memoryPaths(null)).toEqual([]);
    expect(memoryPaths({ memory_paths: ['/a', '/b'] })).toEqual(['/a', '/b']);
    expect(memoryPaths({ memory_paths: { user: '/u', project: '/p' } })).toEqual(['/u', '/p']);
  });
});

describe('sumUsage', () => {
  it('sums every usage field over the turn_usage events and keeps the first model reported', () => {
    const summed = sumUsage([
      { type: 'start', sessionId: 'session-1', model: 'start-model', tools: ['Read'], apiKeySource: 'ANTHROPIC_API_KEY' },
      { type: 'turn_usage', turn: 1, model: 'first-model', usage: { input_tokens: 1000, cache_creation_input_tokens: 200, cache_read_input_tokens: 30, output_tokens: 4 } },
      { type: 'message', text: 'Tools: Read' },
      { type: 'turn_usage', turn: 2, model: 'second-model', usage: { input_tokens: 5, cache_creation_input_tokens: 60, cache_read_input_tokens: 700, output_tokens: 8000 } },
    ]);
    expect(summed).toEqual({
      usage: { input_tokens: 1005, cache_creation_input_tokens: 260, cache_read_input_tokens: 730, output_tokens: 8004 },
      model: 'first-model',
    });
  });
});

describe('replacePaths', () => {
  it('replaces the worktree, repo and home in slash and dash form', () => {
    const line = '{"cwd":"/Users/kyle/repo/.worktrees/probe-1","dir":"/Users/kyle/.claude/projects/-Users-kyle-repo-.worktrees-probe-1"}';
    expect(replacePaths(line, '/Users/kyle/repo/.worktrees/probe-1', '/Users/kyle/repo', '/Users/kyle')).toBe('{"cwd":"<worktree>","dir":"<home>/.claude/projects/<worktree>"}');
  });
});

describe('PROMPT', () => {
  it('asks for the tool list and any memory and forbids tool use', () => {
    expect(PROMPT).toContain('run no tool');
    expect(PROMPT).toContain('Tools:');
    expect(PROMPT).toContain('Memory:');
  });
});
