import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStream } from '../src/adapters/stream.js';
import type { SessionResult } from '../src/adapters/types.js';
import { parsePriceTable } from '../src/pricing.js';
import { PROMPT, initRecord, judge, memoryPaths, probeMetering, replacePaths, verdict } from '../src/probe-core.js';

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

describe('verdict', () => {
  it('passes what judge passes', () => {
    expect(verdict('attended', attendedRaw, events(attendedRaw), ok)).toBeNull();
    expect(verdict('unattended', unattendedRaw, events(unattendedRaw), ok)).toBeNull();
  });

  // What the image, the command line and the environment decide comes out the same on every start.
  it('marks failures that cannot change on retry as fatal', () => {
    const noTools = unattendedRaw.map((line) => line.replace('"tools":["Bash","Edit","Glob","Grep","Read","Write"]', '"tools":[]'));
    const withWeb = [...unattendedRaw.slice(0, 1), unattendedRaw[1]!.replace('Reading the spawn table before changing it.', 'Tools: Read, WebSearch'), ...unattendedRaw.slice(2)];
    const withMemory = [unattendedRaw[0]!.replace('"mcp_servers":[]', '"memory_paths":["<home>/.claude/memory/MEMORY.md"],"mcp_servers":[]'), ...unattendedRaw.slice(1)];
    expect(verdict('unattended', noTools, events(noTools), ok)).toEqual({ reason: 'init line lists no tools', fatal: true });
    expect(verdict('unattended', withWeb, events(withWeb), ok)).toEqual({ reason: 'forbidden tool names in the stream: WebSearch', fatal: true });
    expect(verdict('unattended', withMemory, events(withMemory), ok)).toEqual({ reason: 'memory paths registered for the session: <home>/.claude/memory/MEMORY.md', fatal: true });
    expect(verdict('unattended', attendedRaw, events(attendedRaw), ok)).toEqual({ reason: 'apiKeySource is none; unattended mode bills ANTHROPIC_API_KEY and nothing else', fatal: true });
    expect(verdict('attended', unattendedRaw, events(unattendedRaw), ok)).toEqual({ reason: 'apiKeySource is ANTHROPIC_API_KEY; attended mode runs on the subscription, not on a key', fatal: true });
  });

  // A network or API failure can pass on the next start.
  it('marks failures a retry can clear as not fatal', () => {
    expect(verdict('unattended', [], [], ok)).toEqual({ reason: 'claude produced no stream output', fatal: false });
    expect(verdict('unattended', ['warning: not a stream line'], [], ok)).toEqual({ reason: 'no system init line in the stream', fatal: false });
    const errored = unattendedRaw.map((line) => line.replace('"result":"The gatherer baseCost is now 11 and the check line holds."', '"result":"API Error: 529 overloaded"'));
    expect(verdict('unattended', errored, events(errored), { ...ok, isError: true })).toEqual({ reason: 'session ended in error: API Error: 529 overloaded', fatal: false });
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

describe('probeMetering', () => {
  it('meters the recorded probe as a session is metered: the turn row, then the settle row from the result line', () => {
    const probe = readFileSync(new URL('./fixtures/probe.jsonl', import.meta.url), 'utf8');
    const events = parseStream(probe);
    const end = events.find((event) => event.type === 'end');
    if (end?.type !== 'end') throw new Error('the recorded probe has no result line');
    const models = Object.fromEntries(end.modelUsage.map((model) => [model.model, { input: 2, output: 10, cache_read: 0.2, cache_write_5m: 2.5, cache_write_1h: 4 }]));
    const metering = probeMetering(parsePriceTable(JSON.stringify(models)), events);
    const turns = events.filter((event) => event.type === 'turn_usage').length;
    expect(metering.basis).toBe('result');
    expect(metering.fallbackModels).toEqual([]);
    expect(metering.rows.length).toBeGreaterThanOrEqual(turns);
    const output = metering.rows.reduce((total, row) => total + row.output_tokens, 0);
    expect(output).toBe(end.modelUsage.reduce((total, model) => total + model.output_tokens, 0));
  });

  it('names a model missing from the table and still returns its rows', () => {
    const metering = probeMetering(parsePriceTable('{"builder-class":{"input":3,"output":15,"cache_read":0.3,"cache_write_5m":3.75,"cache_write_1h":6}}'), events(attendedRaw));
    expect(metering.fallbackModels).toEqual(['claude-sonnet-5']);
    expect(metering.rows.length).toBeGreaterThan(0);
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
