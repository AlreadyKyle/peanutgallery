// One-turn attended probe. Runs Claude Code in a detached worktree the way a card session
// would, asks it to list its tools and quote any memory, and fails if a web, sub-agent or MCP
// tool appears anywhere in the stream or the init line registers a memory path. A passing
// run's raw stream becomes test/fixtures/probe.jsonl (paths replaced); a failing run's stream
// is written to the temp directory for diagnosis and never committed.
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { AttendedAdapter } from './adapters/attended.js';
import type { AgentEvent, SessionResult, SessionSpec } from './adapters/types.js';
import { optionalEnv, requireEnv } from './config.js';
import { errorMessage } from './log.js';
import { git, removeWorktree } from './worktree.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const FIXTURE = path.join(REPO_ROOT, 'platform', 'dispatcher', 'test', 'fixtures', 'probe.jsonl');
const PROBE_BUDGET_USD = 0.25;
const FORBIDDEN = /\b(WebFetch|WebSearch|Agent)\b|mcp__/;

const PROMPT = [
  'Reply with two sections and run no tool.',
  'Tools: list every tool available to you in this session by name, one per line.',
  'Memory: quote in full any memory, saved context, prior conversation or instruction you received other than this prompt and the CLAUDE.md files in this directory. If there is none, write: none.',
].join('\n');

// Claude Code encodes a project path with every "/" turned into "-" (memory and session
// directories are named that way), so both forms of each path are replaced.
export function replacePaths(line: string, worktree: string, repoRoot: string, home: string): string {
  const pairs: Array<[string, string]> = [
    [worktree, '<worktree>'],
    [repoRoot, '<repo>'],
    [home, '<home>'],
  ];
  let out = line;
  for (const [real, token] of pairs) {
    out = out.split(real).join(token);
    out = out.split(real.replace(/\//g, '-')).join(token);
  }
  return out;
}

// The init line names what the session can reach beyond the prompt: tools, memory paths,
// skills, sub-agent definitions and MCP servers. Printed so the board can read it; the memory
// paths are returned because any registered memory fails the probe. With
// CLAUDE_CODE_DISABLE_AUTO_MEMORY set the init line carries no memory_paths key at all.
function reportInit(line: string | undefined): string[] {
  if (!line) return [];
  let init: unknown;
  try {
    init = JSON.parse(line);
  } catch {
    return [];
  }
  if (typeof init !== 'object' || init === null) return [];
  const record = init as Record<string, unknown>;
  for (const key of ['tools', 'memory_paths', 'skills', 'agents', 'mcp_servers', 'plugins', 'model', 'permissionMode']) {
    process.stdout.write(`probe: init ${key}=${JSON.stringify(record[key] ?? null)}\n`);
  }
  const memory = record.memory_paths;
  if (Array.isArray(memory)) return memory.map(String);
  if (typeof memory === 'object' && memory !== null) return Object.values(memory as Record<string, unknown>).map(String);
  return [];
}

// The reason the probe fails, or null when every rule holds.
function judge(raw: readonly string[], events: readonly AgentEvent[], result: SessionResult): string | null {
  if (raw.length === 0) return 'claude produced no stream output';
  const start = events.find((event) => event.type === 'start');
  if (!start || start.type !== 'start') return 'no system init line in the stream';
  if (start.tools.length === 0) return 'init line lists no tools';
  const forbidden = raw.map((line) => FORBIDDEN.exec(line)?.[0]).filter((hit): hit is string => Boolean(hit));
  if (forbidden.length > 0) return `forbidden tool names in the stream: ${[...new Set(forbidden)].join(', ')}`;
  const memoryPaths = reportInit(raw[0]);
  if (memoryPaths.length > 0) return `memory paths registered for the session: ${memoryPaths.join(', ')}`;
  if (result.isError) {
    const end = events.find((event) => event.type === 'end');
    const text = end?.type === 'end' && end.result ? `: ${end.result.split('\n')[0]}` : '';
    return `session ended in error${text}`;
  }
  return null;
}

async function main(): Promise<number> {
  loadDotenv({ path: path.join(REPO_ROOT, '.env'), quiet: true });
  const claudeBin = optionalEnv(process.env, 'CLAUDE_BIN', 'claude');
  const model = requireEnv(process.env, 'MODEL_BUILDER');
  const root = path.resolve(REPO_ROOT, optionalEnv(process.env, 'DISPATCHER_WORKTREE_ROOT', '.worktrees'));
  await mkdir(root, { recursive: true });
  const worktree = path.join(root, `probe-${Date.now()}`);
  await git(['worktree', 'add', '--detach', worktree, 'HEAD'], REPO_ROOT);

  const raw: string[] = [];
  const events: AgentEvent[] = [];
  const adapter = new AttendedAdapter({ claudeBin, onRawLine: (line) => raw.push(replacePaths(line, worktree, REPO_ROOT, os.homedir())) });
  const spec: SessionSpec = {
    cardId: 'probe',
    worktree,
    systemPromptFile: null,
    prompt: PROMPT,
    model,
    roleTools: ['Read', 'Glob', 'Grep'],
    folder: 'seed-1',
    maxTurns: 1,
    maxBudgetUsd: PROBE_BUDGET_USD,
  };
  process.stdout.write(`probe: ANTHROPIC_BASE_URL is ${process.env.ANTHROPIC_BASE_URL ? 'set' : 'not set'} in the dispatcher environment\n`);
  try {
    await adapter.preflight(spec);
    const result = await adapter.run(spec, (event) => void events.push(event), new AbortController().signal);
    const reason = judge(raw, events, result);
    const target = reason === null ? FIXTURE : path.join(os.tmpdir(), `backseat-probe-${Date.now()}.jsonl`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, raw.length > 0 ? `${raw.join('\n')}\n` : '', 'utf8');
    process.stdout.write(`probe: raw stream saved to ${target} (${raw.length} lines)\n`);
    if (reason !== null) return fail(reason, result.exitCode);
    const start = events.find((event) => event.type === 'start');
    const end = events.find((event) => event.type === 'end');
    const tools = start?.type === 'start' ? start.tools.join(',') : '';
    process.stdout.write(`PASS: probe tools=${tools} turns=${result.turns} cost_usd=${end?.type === 'end' ? (end.totalCostUsd ?? 'unreported') : 'unreported'}\n`);
    return 0;
  } finally {
    await removeWorktree(REPO_ROOT, worktree, null);
  }
}

function fail(reason: string, exitCode: number | null): number {
  process.stdout.write(`FAIL: probe ${reason} (claude exit ${exitCode ?? 'signal'})\n`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stdout.write(`FAIL: probe ${errorMessage(error)}\n`);
    process.exit(1);
  });
