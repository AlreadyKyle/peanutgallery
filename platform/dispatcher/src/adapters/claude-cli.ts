// Shared Claude Code adapter: one session per card through the claude command line with a
// fixed tool allowlist, no MCP servers, no web or sub-agent tools, and an allowlisted
// environment. Attended and unattended mode differ only in the credential the child sees,
// which each subclass supplies through sessionEnv().
import { spawn, type ChildProcess } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import readline from 'node:readline';
import { StreamParser } from './stream.js';
import type { AgentAdapter, AgentEvent, AgentMode, CardFolder, EndEvent, EventSink, RawLineSink, SessionResult, SessionSpec } from './types.js';

export const EXCLUDED_TOOLS = ['WebFetch', 'WebSearch', 'Agent', 'Task'] as const;
export const MCP_PREFIX = 'mcp__';

export const DISALLOWED_TOOLS = [
  'WebFetch',
  'WebSearch',
  'Agent',
  'Task',
  'NotebookEdit',
  'Bash(git *)',
  'Bash(gh *)',
  'Bash(curl *)',
  'Bash(wget *)',
] as const;

const PACKAGES: Record<CardFolder, string[]> = {
  'seed-1': ['@backseat/seed-1'],
  platform: ['@backseat/site', '@backseat/dispatcher', '@backseat/supabase', '@backseat/gate'],
};
const BASH_SCRIPTS = ['test', 'typecheck', 'bot'];
const STDERR_LIMIT = 4000;
// An interrupted session gets SIGINT, then SIGTERM after INTERRUPT_GRACE_MS, then SIGKILL after
// KILL_GRACE_MS. On SIGINT Claude Code can finish its result line, which carries the session's real
// usage for the meter.
export const INTERRUPT_GRACE_MS = 15_000;
const KILL_GRACE_MS = 5000;

export function refusedTools(tools: readonly string[]): string[] {
  return tools.filter((tool) => (EXCLUDED_TOOLS as readonly string[]).includes(tool) || tool.startsWith(MCP_PREFIX));
}

// A bare Bash entry in tools_json becomes the package scripts for the card's folder; every
// other tool name passes through unchanged.
export function allowedToolRules(tools: readonly string[], folder: CardFolder): string[] {
  const rules: string[] = [];
  for (const tool of tools) {
    if (tool === 'Bash') {
      for (const pkg of PACKAGES[folder]) {
        for (const script of BASH_SCRIPTS) {
          rules.push(`Bash(pnpm --filter ${pkg} ${script}:*)`);
        }
      }
    } else {
      rules.push(tool);
    }
  }
  return rules;
}

// The child environment is built from an allowlist, never from the dispatcher's own
// environment: no Supabase, GitHub, Netlify or Stripe secret and no CLAUDE* variable reaches
// the write agent or anything it runs. ANTHROPIC_BASE_URL passes through; the dispatcher's
// ANTHROPIC_API_KEY never does (unattended mode sets its own from the studio key, see
// unattended.ts). Two switches are then set on purpose: no auto-memory (the kernel says no
// memory reaches a write agent) and no background traffic from the child.
export const CHILD_ENV_NAMES: readonly string[] = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TMPDIR', 'TERM', 'ANTHROPIC_BASE_URL'];
export const CHILD_ENV_PREFIXES: readonly string[] = ['LC_'];
export const CHILD_ENV_SWITCHES: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
};

export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (CHILD_ENV_NAMES.includes(key) || CHILD_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) child[key] = value;
  }
  return { ...child, ...CHILD_ENV_SWITCHES };
}

// Base tool names for --tools, which limits the built-in set the session can see at all;
// --allowedTools then scopes what runs without a prompt. Bash rules collapse to the name.
export function baseToolNames(tools: readonly string[]): string[] {
  const names = tools.map((tool) => tool.replace(/\(.*$/, ''));
  return [...new Set(names)];
}

// systemPrompt is the executor role's prompt file contents, appended to Claude Code's system
// prompt so the session runs with the card, the CLAUDE.md files and the role prompt only.
export function claudeArgs(spec: SessionSpec, systemPrompt: string | null): string[] {
  return [
    '-p',
    spec.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--tools',
    baseToolNames(spec.roleTools).join(','),
    '--max-turns',
    String(spec.maxTurns),
    '--max-budget-usd',
    spec.maxBudgetUsd.toFixed(4),
    '--model',
    spec.model,
    ...(systemPrompt ? ['--append-system-prompt', systemPrompt] : []),
    '--permission-mode',
    'acceptEdits',
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--allowedTools',
    ...allowedToolRules(spec.roleTools, spec.folder),
    '--disallowedTools',
    ...DISALLOWED_TOOLS,
  ];
}

// Signals the session's process group, or the child alone when it has no group of its own (a test
// double without a pid, or a group already gone).
export function signalSession(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // No process is left in the group; the child itself may still need the signal.
    }
  }
  child.kill(signal);
}

// SIGKILL to every process left in the session's group. A process that called setsid has left the
// group and is not reached; the session sandbox is what contains that.
export function killGroup(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // The group is already empty.
  }
}

export type SpawnFn =(bin: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess;

export interface ClaudeCliOptions {
  claudeBin: string;
  spawnFn?: SpawnFn;
  onRawLine?: RawLineSink;
  interruptGraceMs?: number;
}

interface RunState {
  killReason: string | null;
  end: EndEvent | null;
  stderr: string;
  sinkError: unknown;
}

export abstract class ClaudeCliAdapter implements AgentAdapter {
  abstract readonly mode: AgentMode;
  private readonly claudeBin: string;
  private readonly spawnFn: SpawnFn;
  private readonly onRawLine: RawLineSink | undefined;
  private readonly interruptGraceMs: number;

  constructor(options: ClaudeCliOptions) {
    this.claudeBin = options.claudeBin;
    this.interruptGraceMs = options.interruptGraceMs ?? INTERRUPT_GRACE_MS;
    // detached puts the session in its own process group, so every signal reaches what the session
    // started too, and the group is killed once more when the session ends.
    this.spawnFn = options.spawnFn ?? ((bin, args, opts) => spawn(bin, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'], detached: true }));
    this.onRawLine = options.onRawLine;
  }

  // The environment the child process starts with; the only thing the two modes disagree on.
  protected abstract sessionEnv(): NodeJS.ProcessEnv;

  async preflight(spec: SessionSpec): Promise<void> {
    const refused = refusedTools(spec.roleTools);
    if (refused.length > 0) {
      throw new Error(`role tools include excluded tools: ${refused.join(', ')}`);
    }
    if (spec.maxBudgetUsd <= 0) {
      throw new Error('session budget must be positive');
    }
    if (spec.systemPromptFile) {
      try {
        await access(spec.systemPromptFile, fsConstants.R_OK);
      } catch {
        throw new Error(`role prompt file is not readable: ${spec.systemPromptFile}`);
      }
    }
  }

  async run(spec: SessionSpec, onEvent: EventSink, signal: AbortSignal, onRawLine?: RawLineSink): Promise<SessionResult> {
    const systemPrompt = spec.systemPromptFile ? (await readFile(spec.systemPromptFile, 'utf8')).trim() : null;
    const child = this.spawnFn(this.claudeBin, claudeArgs(spec, systemPrompt || null), { cwd: spec.worktree, env: this.sessionEnv() });
    const parser = new StreamParser();
    const state: RunState = { killReason: null, end: null, stderr: '', sinkError: null };

    const running = () => child.exitCode === null && child.signalCode === null;
    const kill = (reason: string) => {
      if (state.killReason) return;
      state.killReason = reason;
      signalSession(child, 'SIGINT');
      setTimeout(() => {
        if (!running()) return;
        signalSession(child, 'SIGTERM');
        setTimeout(() => {
          if (running()) signalSession(child, 'SIGKILL');
        }, KILL_GRACE_MS).unref();
      }, this.interruptGraceMs).unref();
    };
    const onAbort = () => kill(String(signal.reason ?? 'aborted'));
    if (signal.aborted) onAbort();
    signal.addEventListener('abort', onAbort, { once: true });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      state.stderr = (state.stderr + String(chunk)).slice(-STDERR_LIMIT);
    });

    // Events are delivered in order and each is awaited before the next line is parsed, so the
    // metering sink can abort the session before more turns run.
    let chain: Promise<void> = Promise.resolve();
    const deliver = (events: AgentEvent[]) => {
      chain = chain
        .then(async () => {
          for (const event of events) {
            if (event.type === 'end') state.end = event;
            await onEvent(event);
          }
          if (parser.turns > spec.maxTurns) kill('turn_cap');
        })
        .catch((error: unknown) => {
          state.sinkError = state.sinkError ?? error;
          kill('event_sink_error');
        });
    };

    const lines = child.stdout ? readline.createInterface({ input: child.stdout }) : null;
    lines?.on('line', (line) => {
      this.onRawLine?.(line);
      onRawLine?.(line);
      deliver(parser.push(line));
    });

    const exit = await new Promise<{ code: number | null; error: Error | null }>((resolve) => {
      child.once('error', (error) => resolve({ code: null, error }));
      child.once('close', (code) => resolve({ code, error: null }));
    });
    signal.removeEventListener('abort', onAbort);
    // Whatever the session left running in its group (a watcher, a server a test started) dies with
    // it, before the dispatcher reads the worktree or runs git.
    killGroup(child);
    lines?.close();
    deliver(parser.finish());
    await chain;
    if (exit.error) throw new Error(`claude could not start: ${exit.error.message}`);
    if (state.sinkError) throw state.sinkError instanceof Error ? state.sinkError : new Error(String(state.sinkError));

    const end = state.end;
    const failedWithoutResult = end === null && exit.code !== 0 && state.killReason === null;
    return {
      exitCode: exit.code,
      killed: state.killReason !== null,
      killReason: state.killReason,
      turns: parser.turns,
      endSubtype: end?.subtype ?? null,
      totalCostUsd: end?.totalCostUsd ?? null,
      numTurns: end?.numTurns ?? null,
      isError: (end?.isError ?? false) || failedWithoutResult,
    };
  }
}
