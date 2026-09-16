// One-turn probe shared by the probe command and the unattended dispatcher's startup. It runs
// Claude Code in a detached worktree the way a card session would, asks it to list its tools
// and quote any memory, and fails if a web, sub-agent or MCP tool appears anywhere in the
// stream, the init line registers a memory path, or the session bills the wrong account for
// the adapter's mode.
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentAdapter, AgentEvent, AgentMode, EndEvent, RawLineSink, SessionResult, SessionSpec } from './adapters/types.js';
import { SessionMeter, type Settlement } from './metering.js';
import type { PriceTable } from './pricing.js';
import { API_KEY_SOURCE } from './session.js';
import { git, removeWorktree } from './worktree.js';

export const PROBE_BUDGET_USD = 0.25;
// Global so matchAll lists every hit on a line; mcp__\w* keeps the bare-prefix match main had
// while reporting the full tool name when there is one.
const FORBIDDEN = /\b(?:WebFetch|WebSearch|Agent)\b|mcp__\w*/g;

export const PROMPT = [
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

// The first system/init line of the stream as a record, or null when there is none.
export function initRecord(raw: readonly string[]): Record<string, unknown> | null {
  for (const line of raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    if (record.type === 'system' && record.subtype === 'init') return record;
  }
  return null;
}

// Memory paths the init line registers. With CLAUDE_CODE_DISABLE_AUTO_MEMORY set the line
// carries no memory_paths key at all; any registered path fails the probe.
export function memoryPaths(init: Record<string, unknown> | null): string[] {
  const memory = init?.memory_paths;
  if (Array.isArray(memory)) return memory.map(String);
  if (typeof memory === 'object' && memory !== null) return Object.values(memory as Record<string, unknown>).map(String);
  return [];
}

// Why the probe failed, and whether a retry could change the verdict. The tool list, the memory
// paths and the account an init line reports follow from the image, the command line and the
// environment, so they come out the same on every restart: fatal. A missing stream, a missing init
// line or an error result can be a network or API failure that passes on the next start: not fatal.
export interface ProbeFailure {
  reason: string;
  fatal: boolean;
}

function transient(reason: string): ProbeFailure {
  return { reason, fatal: false };
}

function fatal(reason: string): ProbeFailure {
  return { reason, fatal: true };
}

// The probe's failure, or null when every rule holds.
export function verdict(mode: AgentMode, raw: readonly string[], events: readonly AgentEvent[], result: SessionResult): ProbeFailure | null {
  if (raw.length === 0) return transient('claude produced no stream output');
  const start = events.find((event) => event.type === 'start');
  if (!start || start.type !== 'start') return transient('no system init line in the stream');
  if (start.tools.length === 0) return fatal('init line lists no tools');
  const forbidden = raw.flatMap((line) => [...line.matchAll(FORBIDDEN)].map((match) => match[0]));
  if (forbidden.length > 0) return fatal(`forbidden tool names in the stream: ${[...new Set(forbidden)].join(', ')}`);
  const memory = memoryPaths(initRecord(raw));
  if (memory.length > 0) return fatal(`memory paths registered for the session: ${memory.join(', ')}`);
  const source = start.apiKeySource ?? 'unreported';
  if (mode === 'unattended' && start.apiKeySource !== API_KEY_SOURCE) {
    return fatal(`apiKeySource is ${source}; unattended mode bills ${API_KEY_SOURCE} and nothing else`);
  }
  if (mode === 'attended' && start.apiKeySource === API_KEY_SOURCE) {
    return fatal(`apiKeySource is ${API_KEY_SOURCE}; attended mode runs on the subscription, not on a key`);
  }
  if (result.isError) {
    const end = events.find((event) => event.type === 'end');
    const text = end?.type === 'end' && end.result ? `: ${end.result.split('\n')[0]}` : '';
    return transient(`session ended in error${text}`);
  }
  return null;
}

// The reason the probe fails, or null when every rule holds.
export function judge(mode: AgentMode, raw: readonly string[], events: readonly AgentEvent[], result: SessionResult): string | null {
  return verdict(mode, raw, events, result)?.reason ?? null;
}

export interface ProbeOptions {
  repoRoot: string;
  worktreeRoot: string;
  model: string;
  priceTable: PriceTable;
  // Receives every raw stream line with local paths replaced, in order; the probe command saves
  // them as the fixture.
  onRawLine?: RawLineSink;
}

export interface ProbeResult {
  ok: boolean;
  reason: string | null;
  // True when the failure cannot change on retry (see verdict); false when the probe passed.
  fatal: boolean;
  tools: string[];
  apiKeySource: string | null;
  // The command line's own cost figure, reported for comparison and never recorded.
  costUsd: number | null;
  // The ledger rows for the probe, metered as a card session is, so the caller can record them.
  metering: Settlement;
  turns: number;
  exitCode: number | null;
}

// The probe's ledger rows, metered as a card session is (metering.ts): nothing is written while the
// probe runs, so every turn row is still pending and settle returns it, followed by the settle rows.
// The ids are unique under probe/<run>, so the rows are written once however often a write is retried.
export function probeMetering(table: PriceTable, events: readonly AgentEvent[], idPrefix: string = `probe/${randomUUID()}`): Settlement {
  const meter = new SessionMeter(table, idPrefix);
  for (const event of events) {
    if (event.type === 'turn_usage') meter.addTurn(event);
    if (event.type === 'turn_content') meter.addContent(event);
    if (event.type === 'compaction') meter.addCompaction(event);
  }
  const end = events.find((event): event is EndEvent => event.type === 'end') ?? null;
  return meter.settle(end);
}

export async function runProbe(adapter: AgentAdapter, options: ProbeOptions): Promise<ProbeResult> {
  await mkdir(options.worktreeRoot, { recursive: true });
  const worktree = path.join(options.worktreeRoot, `probe-${Date.now()}`);
  await git(['worktree', 'add', '--detach', worktree, 'HEAD'], options.repoRoot);
  const home = os.homedir();
  const raw: string[] = [];
  const events: AgentEvent[] = [];
  const spec: SessionSpec = {
    cardId: 'probe',
    worktree,
    systemPromptFile: null,
    prompt: PROMPT,
    model: options.model,
    roleTools: ['Read', 'Glob', 'Grep'],
    folder: 'seed-1',
    maxTurns: 1,
    maxBudgetUsd: PROBE_BUDGET_USD,
  };
  try {
    await adapter.preflight(spec);
    const result = await adapter.run(spec, (event) => void events.push(event), new AbortController().signal, (line) => {
      const clean = replacePaths(line, worktree, options.repoRoot, home);
      raw.push(clean);
      options.onRawLine?.(clean);
    });
    const failure = verdict(adapter.mode, raw, events, result);
    const start = events.find((event) => event.type === 'start');
    const end = events.find((event) => event.type === 'end');
    return {
      ok: failure === null,
      reason: failure?.reason ?? null,
      fatal: failure?.fatal ?? false,
      tools: start?.type === 'start' ? start.tools : [],
      apiKeySource: start?.type === 'start' ? start.apiKeySource : null,
      costUsd: end?.type === 'end' ? end.totalCostUsd : null,
      metering: probeMetering(options.priceTable, events),
      turns: result.turns,
      exitCode: result.exitCode,
    };
  } finally {
    await removeWorktree(options.repoRoot, worktree, null);
  }
}
