// One attended role-job session (src/role-session.ts, docs/specs/agent-workflows.md): exactly the
// role spec's tools and never Write, Edit, a web tool, an MCP tool or a fallback model; founder
// ledger rows with the role, written once per request id; a failed model call or an answer that is
// not one schema-valid object fails the session.
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { claudeArgs } from '../src/adapters/claude-cli.js';
import type { Role } from '../src/db.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable } from '../src/pricing.js';
import { roleSessionSpec, roleToolProblem, runRoleSession, type RoleSessionDeps, type RoleSessionRequest } from '../src/role-session.js';
import { TypedOutput } from '../src/typed-output.js';
import { FakeAdapter, startEvent, untilAborted, usageEvent, type FakeOptions, type FakeScript } from './helpers/fake-adapter.js';
import { FakeDb, NOW, role } from './helpers/fake-db.js';

const PRICE_TABLE = parsePriceTable(JSON.stringify({ 'director-class': { input: 5, output: 25, cache_read: 0.5, cache_write_5m: 6.25, cache_write_1h: 10 } }));
const typed = new TypedOutput();
const READ_SET = ['Read', 'Glob', 'Grep'];
const DESIGNER_TOOLS = ['Read', 'Glob', 'Grep', 'Bash'];
const VERDICT = JSON.stringify({ result: 'approved', reason_codes: ['fits_pillars'] });

const director: Role = role({ id: 'role-director', name: 'Game Director', title: 'Game Director', model: 'director-class', prompt_path: 'platform/agents/prompts/game-director.md', tools_json: READ_SET, write_access: false, agent_class: 'reviewer' });
const designer: Role = role({ id: 'role-designer', name: 'Game Designer', title: 'Game Designer', model: 'director-class', prompt_path: 'platform/agents/prompts/game-designer.md', tools_json: DESIGNER_TOOLS, write_access: true, agent_class: 'planner' });

function request(overrides: Partial<RoleSessionRequest> = {}): RoleSessionRequest {
  return { role: director, runId: 'run-1', label: 'director-1', worktree: '/tmp/job-run1', prompt: 'Grade this draft.', schema: 'draft-verdict', budgetUsd: 5, ...overrides };
}

function setup(script: FakeScript, options: FakeOptions = {}) {
  const db = new FakeDb();
  db.roles = [director, designer];
  const adapter = new FakeAdapter(script, { result: VERDICT, ...options });
  const stop = new AbortController();
  const deps: RoleSessionDeps = {
    db,
    adapter,
    typed,
    priceTable: PRICE_TABLE,
    maxTurns: 20,
    maxMs: 60_000,
    boardSessionTtlMin: 3,
    watchIntervalMs: 5,
    log: createLogger(new Writable({ write: (_c, _e, cb) => cb() })),
    stopSignal: stop.signal,
    now: () => NOW,
    ledgerRetryMs: 1,
  };
  return { db, adapter, deps, stop };
}

const oneTurn: FakeScript = async (_spec, emit) => {
  await emit({ type: 'start', sessionId: 'grader-session', model: 'director-class', tools: READ_SET, apiKeySource: 'none' });
  await emit(usageEvent(1, 400, 'director-class'));
};

describe('the role session spec', () => {
  it('holds exactly the role spec tools, with Bash as seed-1 package scripts, and no argument names Write, Edit, a web tool, an MCP tool or a fallback model', () => {
    for (const r of [director, designer]) {
      const spec = roleSessionSpec(request({ role: r }), 20);
      expect(spec.roleTools).toEqual(r.tools_json);
      const args = claudeArgs(spec, 'role prompt');
      expect(args).not.toContain('--fallback-model');
      const tools = args[args.indexOf('--tools') + 1]!.split(',');
      const allowedStart = args.indexOf('--allowedTools') + 1;
      const allowed = args.slice(allowedStart, args.indexOf('--disallowedTools'));
      for (const name of [...tools, ...allowed]) {
        expect(name, r.name).not.toMatch(/^(Write|Edit|WebFetch|WebSearch|NotebookEdit)\b|^mcp__/);
      }
      expect(tools).toEqual(r.name === 'Game Designer' ? DESIGNER_TOOLS : READ_SET);
      if (r.name === 'Game Designer') {
        expect(allowed.filter((rule) => rule.startsWith('Bash('))).toEqual([
          'Bash(pnpm --filter @backseat/seed-1 test:*)',
          'Bash(pnpm --filter @backseat/seed-1 typecheck:*)',
          'Bash(pnpm --filter @backseat/seed-1 bot:*)',
        ]);
      }
      expect(args[args.indexOf('--mcp-config') + 1]).toBe('{"mcpServers":{}}');
    }
  });

  it('refuses a role that holds Write, Edit, a web tool or an MCP tool, before any session starts', async () => {
    expect(roleToolProblem(READ_SET)).toBeNull();
    expect(roleToolProblem(DESIGNER_TOOLS)).toBeNull();
    for (const tools of [['Read', 'Write'], ['Read', 'Edit'], ['WebFetch'], ['WebSearch'], ['mcp__github__read']]) {
      expect(roleToolProblem(tools), tools.join()).not.toBeNull();
      const t = setup(oneTurn);
      const result = await runRoleSession(request({ role: { ...director, tools_json: tools } }), t.deps);
      expect(result.ok).toBe(false);
      expect(t.adapter.specs).toHaveLength(0);
      expect(t.db.ledger).toHaveLength(0);
    }
  });
});

describe('runRoleSession', () => {
  it('answers with the typed object, the session id as its ref, and one founder ledger row per turn with the role', async () => {
    const t = setup(oneTurn);
    const result = await runRoleSession<{ result: string }>(request(), t.deps);
    expect(result).toMatchObject({ ok: true, value: { result: 'approved', reason_codes: ['fits_pillars'] }, ref: 'claude:grader-session' });
    expect(t.db.ledger.length).toBeGreaterThan(0);
    for (const row of t.db.ledger) expect([row.billed_to, row.card_id, row.role_id]).toEqual(['founder', null, 'role-director']);
    expect(t.db.ledger[0]!.request_id).toBe('job/run-1/director-1/turn/1');
    // A replayed request id writes nothing (record_usage is idempotent on it).
    const before = t.db.ledger.length;
    const first = t.db.ledger[0]!;
    await t.db.recordUsage({ billed_to: first.billed_to, card_id: first.card_id, role_id: first.role_id, model: first.model, input_tokens: first.input_tokens, cached_tokens: first.cached_tokens, output_tokens: first.output_tokens, usd: first.usd, request_id: first.request_id });
    expect(t.db.ledger).toHaveLength(before);
    expect(t.db.pool.balance_usd).toBe(50);
  });

  it('fails, marked as invalid output, when the final message is not exactly one schema-valid object', async () => {
    for (const text of ['Approved.', `${VERDICT}\n${VERDICT}`, JSON.stringify({ result: 'approved', reason_codes: ['off_pillar'] })]) {
      const t = setup(oneTurn, { result: text });
      const result = await runRoleSession(request(), t.deps);
      expect(result).toMatchObject({ ok: false, invalidOutput: true });
    }
  });

  it('fails a failed model call, not as invalid output, and still meters what it spent', async () => {
    const t = setup(oneTurn, { isError: true, subtype: 'error_during_execution', exitCode: 1 });
    const result = await runRoleSession(request(), t.deps);
    expect(result).toMatchObject({ ok: false, invalidOutput: false });
    if (!result.ok) expect(result.reason).toMatch(/^the model call failed/);
    expect(t.db.ledger.length).toBeGreaterThan(0);
  });

  it('stops a session whose init line shows a write tool or an API key', async () => {
    for (const start of [startEvent([...READ_SET, 'Write']), startEvent(READ_SET, 'ANTHROPIC_API_KEY')]) {
      const t = setup(async (_spec, emit, signal) => {
        await emit(start);
        await untilAborted(signal, 1000);
      });
      const result = await runRoleSession(request(), t.deps);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/tools a role job may not hold|bills an API key/);
    }
  });

  it('stops when the board session lapses, and runs only attended', async () => {
    const t = setup(async (_spec, emit, signal) => {
      await emit(startEvent(READ_SET));
      t.db.boardActive = false;
      await untilAborted(signal, 1000);
    });
    expect(await runRoleSession(request(), t.deps)).toMatchObject({ ok: false, reason: 'board_session_lapsed' });
    const managed = setup(oneTurn, { mode: 'unattended' });
    expect(await runRoleSession(request(), managed.deps)).toMatchObject({ ok: false, reason: 'a role job runs attended, on the founder plan' });
    expect(managed.adapter.specs).toHaveLength(0);
  });
});
