// The role probe (pnpm --filter @backseat/dispatcher probe --role, on the managed adapter): one tiny managed
// reader session, as a Director's visual review runs, that proves live what the unit tests prove
// against a fake: the session create's tools override leaves the agent read, glob and grep and nothing
// else, a file uploaded through the Files API is mounted where the prompt says, and the session can
// read an image there. It mounts one small PNG fixture filled with one colour and asks for that colour
// in one word. Billed as overhead (no card), with no role.
import path from 'node:path';
import { UPLOADS_DIR } from './adapters/managed.js';
import { READER_TOOLS } from './adapters/managed-config.js';
import type { AgentAdapter, AgentEvent, EndEvent, SessionSpec } from './adapters/types.js';
import { errorMessage } from './log.js';

export const ROLE_PROBE_FIXTURE = path.join('platform', 'dispatcher', 'test', 'fixtures', 'probe-red.png');
export const ROLE_PROBE_MOUNT = `${UPLOADS_DIR}/probe/probe-red.png`;
export const ROLE_PROBE_ANSWER = 'red';
export const ROLE_PROBE_BUDGET_USD = 0.5;
export const ROLE_PROBE_SYSTEM = 'You are a probe of the Mob Machine studio dispatcher. You read files and answer in one word.';
export const ROLE_PROBE_PROMPT = `Read the image at ${ROLE_PROBE_MOUNT} with the read tool. It is filled with a single colour. Reply with that colour as one lowercase English word and nothing else.`;
const ROLE_PROBE_TIMEOUT_MS = 180_000;

export interface RoleProbeResult {
  ok: boolean;
  reason: string | null;
  sessionId: string | null;
  // The tools the session's start event reported, sorted.
  tools: string[];
  // Every tool call, as name and the file path it named.
  toolCalls: string[];
  answer: string;
  turns: number;
}

export function roleProbeSpec(codeRoot: string, model: string): SessionSpec {
  return {
    cardId: 'role-probe',
    worktree: codeRoot,
    prompt: ROLE_PROBE_PROMPT,
    systemPromptFile: null,
    model,
    roleTools: ['Read', 'Glob', 'Grep'],
    folder: 'platform',
    maxTurns: 5,
    maxBudgetUsd: ROLE_PROBE_BUDGET_USD,
    roleId: null,
    purpose: 'role',
    role: { cardId: null, system: ROLE_PROBE_SYSTEM, repoSha: null, files: [{ path: path.join(codeRoot, ROLE_PROBE_FIXTURE), mountPath: ROLE_PROBE_MOUNT }], label: 'role probe' },
  };
}

// The answer as one bare lowercase word: surrounding space, quotes and a closing full stop dropped.
export function normalizedAnswer(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^["'`]+|["'`.!]+$/g, '');
}

export async function runRoleProbe(adapter: AgentAdapter, opts: { codeRoot: string; model: string; timeoutMs?: number }): Promise<RoleProbeResult> {
  const result: RoleProbeResult = { ok: false, reason: null, sessionId: null, tools: [], toolCalls: [], answer: '', turns: 0 };
  const fail = (reason: string): RoleProbeResult => ({ ...result, ok: false, reason });
  if (adapter.mode !== 'unattended') return fail('the role probe runs the managed adapter, which this process did not build');
  const spec = roleProbeSpec(opts.codeRoot, opts.model);
  let start: Extract<AgentEvent, { type: 'start' }> | null = null;
  let end: EndEvent | null = null;
  const errors: string[] = [];
  const onEvent = (event: AgentEvent) => {
    if (event.type === 'start') start = event;
    else if (event.type === 'tool_call') {
      const input = event.input as { file_path?: unknown } | null;
      result.toolCalls.push(`${event.name}${typeof input?.file_path === 'string' ? ` ${input.file_path}` : ''}`);
    } else if (event.type === 'error') errors.push(event.message);
    else if (event.type === 'end') end = event;
  };
  try {
    await adapter.preflight(spec);
    const run = await adapter.run(spec, onEvent, AbortSignal.timeout(opts.timeoutMs ?? ROLE_PROBE_TIMEOUT_MS));
    result.turns = run.turns;
  } catch (error) {
    return fail(`the session failed: ${errorMessage(error)}`);
  }
  const started = start as Extract<AgentEvent, { type: 'start' }> | null;
  const finished = end as EndEvent | null;
  result.sessionId = started?.sessionId ?? null;
  result.tools = [...(started?.tools ?? [])].sort();
  result.answer = finished?.result ?? '';
  if (!started) return fail('no session started');
  const want = [...READER_TOOLS].sort();
  if (result.tools.join(',') !== want.join(',')) return fail(`the session holds ${result.tools.join(', ') || 'no tool'}, not ${want.join(', ')}`);
  if (started.ledger !== 'adapter') return fail('the adapter did not write the ledger rows');
  if (!finished || finished.isError || finished.subtype !== 'end_turn') return fail(`the session stopped with ${finished?.subtype ?? 'no end'}${errors.length > 0 ? `: ${errors.join('; ')}` : ''}`);
  if (!result.toolCalls.some((call) => call === `read ${ROLE_PROBE_MOUNT}`)) return fail(`the session never read ${ROLE_PROBE_MOUNT} (tool calls: ${result.toolCalls.join(', ') || 'none'})`);
  if (normalizedAnswer(result.answer) !== ROLE_PROBE_ANSWER) return fail(`the session answered ${JSON.stringify(result.answer.slice(0, 80))}, not ${ROLE_PROBE_ANSWER}`);
  return { ...result, ok: true, reason: null };
}
