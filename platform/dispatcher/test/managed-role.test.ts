// A role session on the managed adapter (src/adapters/managed.ts runRole): the Director's visual
// review as a reader session on the studio's Console credit, against the fake Managed Agents client.
// The create call overrides the writer agent's tools to read, glob and grep only, with no MCP server,
// skill or custom tool; a session whose agent shows any other tool is refused before it runs; the
// frames are uploaded, mounted and deleted however the session ends; its ledger rows bill the card it
// reviews with the Director's role (or overhead with the role, for no card); an orphan role session
// settles with the same billing; a create refused for credit pauses as console_credit. Also the role
// probe (src/role-probe.ts) against the same fake. No request leaves the process.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import Anthropic from '@anthropic-ai/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ManagedAdapter, UPLOADS_DIR, type ManagedTimings } from '../src/adapters/managed.js';
import { readerProblems, readerToolset } from '../src/adapters/managed-config.js';
import { SessionPaused, type AgentEvent, type SessionSpec } from '../src/adapters/types.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable, round4 } from '../src/pricing.js';
import { normalizedAnswer, ROLE_PROBE_MOUNT, roleProbeSpec, runRoleProbe } from '../src/role-probe.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { FakeDb, card } from './helpers/fake-db.js';
import { AGENT_ID, CODE_ROOT, ENVIRONMENT_ID, FakeManagedClient, FILES, agentFromFile, type FakeSession } from './helpers/fake-managed.js';

const TABLE = parsePriceTable(JSON.stringify({ 'director-class': { input: 5, output: 25, cache_read: 0.5, cache_write_5m: 6.25, cache_write_1h: 10 } }));
const FAST: Partial<ManagedTimings> = {
  interruptGraceMs: 300,
  statusWaitMs: 60,
  statusPollMs: 5,
  stopWaitMs: 200,
  outputTries: 1,
  outputDelayMs: 1,
  reconnectTries: 2,
  reconnectDelayMs: 1,
  ledgerRetryMs: 1,
  archiveTries: 2,
  archiveDelayMs: 1,
  probeTimeoutMs: 2000,
};
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const DIRECTOR = 'role-platform-director';
const VERDICT = '{"criteria":{}}';
const FRAMES = `${UPLOADS_DIR}/frames`;

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-managed-role-'));
  await writeFile(path.join(dir, 'home-375.before.png'), PNG);
  await writeFile(path.join(dir, 'home-375.after.png'), PNG);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function harness(client = new FakeManagedClient()) {
  const db = new FakeDb();
  db.cards = [card({ stage: 'gated' })];
  const alert = new RecordingAlerter();
  const adapter = new ManagedAdapter({
    client,
    files: FILES,
    agentId: AGENT_ID,
    agentVersion: 3,
    environmentId: ENVIRONMENT_ID,
    githubRepo: 'owner/repo',
    readToken: 'github_pat_-fixture-read',
    priceTable: TABLE,
    probeModel: 'director-class',
    db,
    patches: null,
    alert,
    log: createLogger(new Writable({ write: (_c, _e, cb) => cb() })),
    // No repository is mounted, so GitHub is never asked.
    fetchFn: (async () => {
      throw new Error('no GitHub request expected');
    }) as typeof fetch,
    timings: FAST,
  });
  return { client, db, alert, adapter };
}

function roleSpec(overrides: Partial<SessionSpec> = {}, cardId: string | null = card().id): SessionSpec {
  return {
    cardId: 'job-visual',
    worktree: dir,
    prompt: `Review the frames at ${FRAMES}/site/home-375.before.png and ${FRAMES}/site/home-375.after.png.`,
    systemPromptFile: null,
    model: 'director-class',
    roleTools: ['Read', 'Glob', 'Grep'],
    folder: 'seed-1',
    maxTurns: 20,
    maxBudgetUsd: 1,
    roleId: DIRECTOR,
    purpose: 'role',
    role: {
      cardId,
      system: 'You are the Platform Director.',
      repoSha: null,
      files: [
        { path: path.join(dir, 'home-375.before.png'), mountPath: `${FRAMES}/site/home-375.before.png` },
        { path: path.join(dir, 'home-375.after.png'), mountPath: `${FRAMES}/site/home-375.after.png` },
      ],
      label: 'review-1 visual-4c2f5a1e',
    },
    ...overrides,
  };
}

// The platform reads the after frame, answers with answer and goes idle at end_turn, having cost cents.
function reviews(client: FakeManagedClient, answer = VERDICT, cents = 3, tool = 'read'): void {
  client.react = (session: FakeSession, event) => {
    if (event.type !== 'user.message') return;
    session.cost = { cents, activeSeconds: 60 };
    session.emit(
      { type: 'session.status_running' },
      { type: 'agent.tool_use', name: tool, input: { file_path: `${FRAMES}/site/home-375.after.png` }, evaluated_permission: 'allow' },
      { type: 'span.model_request_end', is_error: false, model_usage: { input_tokens: 2000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
      { type: 'agent.tool_result', tool_use_id: 'x', content: [{ type: 'text', text: 'image' }], is_error: false },
      { type: 'agent.message', content: [{ type: 'text', text: answer }] },
      { type: 'span.model_request_end', is_error: false, model_usage: { input_tokens: 3000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
      { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
    );
  };
}

async function run(h: ReturnType<typeof harness>, s: SessionSpec = roleSpec()) {
  const events: AgentEvent[] = [];
  const result = await h.adapter.run(s, (event) => void events.push(event), new AbortController().signal);
  return { result, events };
}

const uploadedIds = (client: FakeManagedClient) => [...client.uploads.keys()];

describe('a managed role session', () => {
  it('creates the session with exactly the reader tools, the role prompt and the frames mounted, and answers in its end event', async () => {
    const h = harness();
    reviews(h.client);
    const { result, events } = await run(h);
    const params = h.client.last.params;
    expect(params.agent).toEqual({
      type: 'agent_with_overrides',
      id: AGENT_ID,
      version: 3,
      model: { id: 'director-class', speed: 'standard' },
      system: 'You are the Platform Director.',
      tools: [readerToolset()],
      mcp_servers: [],
      skills: [],
    });
    expect(readerToolset()).toEqual({
      type: 'agent_toolset_20260401',
      default_config: { enabled: false, permission_policy: { type: 'always_allow' } },
      configs: [
        { name: 'bash', enabled: false },
        { name: 'read', enabled: true },
        { name: 'write', enabled: false },
        { name: 'edit', enabled: false },
        { name: 'glob', enabled: true },
        { name: 'grep', enabled: true },
        { name: 'web_fetch', enabled: false },
        { name: 'web_search', enabled: false },
      ],
    });
    const [before, after] = uploadedIds(h.client);
    expect(params.resources).toEqual([
      { type: 'file', file_id: before, mount_path: `${FRAMES}/site/home-375.before.png` },
      { type: 'file', file_id: after, mount_path: `${FRAMES}/site/home-375.after.png` },
    ]);
    expect([...h.client.uploads.values()].map((file) => [file.filename, file.mimeType, file.bytes.equals(PNG)])).toEqual([
      ['home-375.before.png', 'image/png', true],
      ['home-375.after.png', 'image/png', true],
    ]);
    expect(params.metadata).toMatchObject({ purpose: 'role', card_id: card().id, role_id: DIRECTOR, label: 'review-1 visual-4c2f5a1e' });
    expect(params.budget?.type).toBe('limit');
    expect(events[0]).toEqual({ type: 'start', sessionId: h.client.last.id, model: 'director-class', tools: ['read', 'glob', 'grep'], apiKeySource: 'ANTHROPIC_API_KEY', ledger: 'adapter' });
    // The prompt is the first and only message: no finishing section, no reminder, no patch.
    expect(h.client.sent.map((entry) => entry.event.type)).toEqual(['user.message']);
    expect((h.client.sent[0]!.event as { content: Array<{ text: string }> }).content[0]!.text).toBe(roleSpec().prompt);
    const end = events.find((event) => event.type === 'end');
    expect(end).toMatchObject({ type: 'end', subtype: 'end_turn', isError: false, result: VERDICT });
    expect(result).toMatchObject({ exitCode: 0, endSubtype: 'success', isError: false, turns: 2 });
    expect(h.client.last.archived).toBe(true);
  });

  it("writes the review's ledger rows to the card it reviews, studio-billed with the Director's role, settled to the list cost", async () => {
    const h = harness();
    reviews(h.client, VERDICT, 5);
    await run(h);
    expect(h.db.ledger.length).toBeGreaterThan(0);
    for (const row of h.db.ledger) expect([row.billed_to, row.card_id, row.role_id]).toEqual(['studio', card().id, DIRECTOR]);
    expect(round4(h.db.ledger.reduce((sum, row) => sum + row.usd, 0))).toBe(0.05);
  });

  it('bills overhead with the role when the session is for no card', async () => {
    const h = harness();
    reviews(h.client);
    await run(h, roleSpec({}, null));
    expect(h.client.last.params.metadata).toMatchObject({ purpose: 'role', card_id: '', role_id: DIRECTOR });
    expect(h.db.ledger.length).toBeGreaterThan(0);
    for (const row of h.db.ledger) expect([row.billed_to, row.card_id, row.role_id]).toEqual(['overhead', null, DIRECTOR]);
  });

  it('deletes the uploaded frames once the session ends', async () => {
    const h = harness();
    reviews(h.client);
    await run(h);
    expect(uploadedIds(h.client)).toHaveLength(2);
    expect(h.client.deletedFiles).toEqual(expect.arrayContaining(uploadedIds(h.client)));
  });

  it.each([
    ['bash', (tools: unknown[]) => tools.map((tool) => ({ ...(tool as object), configs: ((tool as { configs: Array<{ name: string; enabled: boolean }> }).configs ?? []).map((c) => (c.name === 'bash' ? { ...c, enabled: true } : c)) }))],
    ['write', (tools: unknown[]) => tools.map((tool) => ({ ...(tool as object), configs: ((tool as { configs: Array<{ name: string; enabled: boolean }> }).configs ?? []).map((c) => (c.name === 'write' ? { ...c, enabled: true } : c)) }))],
    ['a custom tool', (tools: unknown[]) => [...tools, { type: 'custom', name: 'submit_patch', description: 'x', input_schema: { type: 'object' } }]],
  ])('refuses a session whose agent shows %s, before it runs, and still deletes the uploads', async (_name, widen) => {
    const h = harness();
    reviews(h.client);
    h.client.sessionAgent = (agent) => ({ ...agent, tools: widen(agent.tools as unknown[]) as typeof agent.tools });
    const error = await run(h).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).toMatch(/refused before it ran: tools are/);
    expect(h.client.sent.filter((entry) => entry.event.type === 'user.message')).toEqual([]);
    expect(h.client.last.archived).toBe(true);
    expect(h.client.deletedFiles).toEqual(expect.arrayContaining(uploadedIds(h.client)));
  });

  it('readerProblems passes the reader override and names anything more', () => {
    const reader = agentFromFile({ ...FILES.agent, tools: [readerToolset()] });
    expect(readerProblems(reader)).toEqual([]);
    expect(readerProblems(agentFromFile())).toEqual([expect.stringMatching(/^tools are bash, edit, glob, grep, read, submit_patch, write, not glob, grep, read$/)]);
    expect(readerProblems({ ...reader, mcp_servers: [{ name: 'gh', type: 'url', url: 'https://x' }] as never })).toEqual(['MCP servers configured: gh']);
    expect(readerProblems({ ...reader, model: { id: 'director-class', speed: 'fast' } })).toEqual(['the model runs at fast speed']);
  });

  it('interrupts a session that calls a tool it does not hold, and ends it as a violation', async () => {
    const h = harness();
    reviews(h.client, VERDICT, 3, 'bash');
    const { result, events } = await run(h);
    expect(result).toMatchObject({ isError: true, endSubtype: 'violation' });
    expect(events.find((event) => event.type === 'end')).toMatchObject({ result: '' });
    expect(h.client.sent.map((entry) => entry.event.type)).toContain('user.interrupt');
  });

  it('deletes the uploads when the session errors: a lost stream pauses, and its spend is settled', async () => {
    const h = harness();
    h.client.failStream = new Error('connection refused');
    const error = await run(h).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionPaused);
    expect(error).toMatchObject({ failingCheck: 'stream_lost' });
    expect(uploadedIds(h.client)).toHaveLength(2);
    expect(h.client.deletedFiles).toEqual(expect.arrayContaining(uploadedIds(h.client)));
  });

  it('starts no session when an upload fails, and deletes the ones already uploaded', async () => {
    const h = harness();
    h.client.failUploadAfter = 1;
    const error = await run(h).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ failingCheck: 'managed_api' });
    expect(h.client.sessions_).toEqual([]);
    expect(uploadedIds(h.client)).toHaveLength(1);
    expect(h.client.deletedFiles).toEqual(uploadedIds(h.client));
  });

  it('pauses as console_credit when the create is refused for credit, with the API error as an event, and deletes the uploads', async () => {
    const h = harness();
    h.client.failCreate = Anthropic.APIError.generate(
      400,
      { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } },
      undefined,
      new Headers(),
    );
    const events: AgentEvent[] = [];
    const error = await h.adapter.run(roleSpec(), (event) => void events.push(event), new AbortController().signal).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionPaused);
    expect(error).toMatchObject({ failingCheck: 'console_credit' });
    expect(events.filter((event) => event.type === 'error').map((event) => event.type === 'error' && event.message)).toEqual([expect.stringContaining('credit balance is too low')]);
    expect(h.client.deletedFiles).toEqual(expect.arrayContaining(uploadedIds(h.client)));
  });

  it('refuses a role spec with no setup, or a file mounted outside the uploads folder, at preflight', async () => {
    const h = harness();
    await expect(h.adapter.preflight(roleSpec({ role: undefined }))).rejects.toThrow('spec.role');
    const outside = roleSpec();
    outside.role!.files = [{ path: path.join(dir, 'home-375.after.png'), mountPath: '/workspace/peanutgallery/x.png' }];
    await expect(h.adapter.preflight(outside)).rejects.toThrow(/mounts under/);
    await expect(h.adapter.preflight(roleSpec())).resolves.toBeUndefined();
  });

  it('settles an orphan role session with the billing its metadata names, and the startup probe leaves role sessions alone', async () => {
    const h = harness();
    const created = await h.client.sessions.create({
      agent: { type: 'agent_with_overrides', id: AGENT_ID, version: 3, model: { id: 'director-class', speed: 'standard' }, tools: [readerToolset()] },
      environment_id: ENVIRONMENT_ID,
      metadata: { purpose: 'role', card_id: card().id, role_id: DIRECTOR, label: 'review-1', run: 'r' },
    });
    const orphan = h.client.session(created.id);
    orphan.cost = { cents: 2, activeSeconds: 30 };
    orphan.emit(
      { type: 'span.model_request_end', is_error: false, model_usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
      { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
    );
    // The probe closes leftover probe and toolchain sessions, never a running dispatcher's role session.
    h.client.react = (session, event) => {
      if (event.type !== 'user.message') return;
      session.emit(
        { type: 'span.model_request_end', is_error: false, model_usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
        { type: 'agent.message', content: [{ type: 'text', text: 'ready' }] },
        { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
      );
    };
    await h.adapter.probe();
    expect(orphan.archived).toBe(false);
    const closed = await h.adapter.closeOrphans();
    expect(closed.get('role')).toEqual({ sessionIds: [orphan.id], patchStored: false, unsettled: [] });
    expect(orphan.archived).toBe(true);
    const rows = h.db.ledger.filter((row) => row.request_id?.startsWith('sevt_sesn_1') || row.request_id?.startsWith(`${orphan.id}/`));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect([row.billed_to, row.card_id, row.role_id]).toEqual(['studio', card().id, DIRECTOR]);
    expect(round4(rows.reduce((sum, row) => sum + row.usd, 0))).toBe(0.02);
  });
});

describe('the role probe', () => {
  // The platform reads the mounted fixture and answers.
  function answers(client: FakeManagedClient, answer: string, file = ROLE_PROBE_MOUNT): void {
    client.react = (session, event) => {
      if (event.type !== 'user.message') return;
      session.cost = { cents: 1, activeSeconds: 10 };
      session.emit(
        { type: 'agent.tool_use', name: 'read', input: { file_path: file }, evaluated_permission: 'allow' },
        { type: 'span.model_request_end', is_error: false, model_usage: { input_tokens: 900, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
        { type: 'agent.message', content: [{ type: 'text', text: answer }] },
        { type: 'span.model_request_end', is_error: false, model_usage: { input_tokens: 1000, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
        { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
      );
    };
  }

  it('passes when the reader session holds read, glob and grep only, reads the mounted PNG and names its colour; billed as overhead', async () => {
    const h = harness();
    answers(h.client, 'Red.');
    const report = await runRoleProbe(h.adapter, { codeRoot: CODE_ROOT, model: 'director-class' });
    expect(report).toMatchObject({ ok: true, reason: null, tools: ['glob', 'grep', 'read'], toolCalls: [`read ${ROLE_PROBE_MOUNT}`], answer: 'Red.' });
    const params = h.client.last.params;
    expect((params.agent as { tools: unknown }).tools).toEqual([readerToolset()]);
    expect(params.resources).toEqual([{ type: 'file', file_id: uploadedIds(h.client)[0], mount_path: ROLE_PROBE_MOUNT }]);
    const [upload] = [...h.client.uploads.values()];
    expect(upload!.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    for (const row of h.db.ledger) expect([row.billed_to, row.card_id, row.role_id]).toEqual(['overhead', null, null]);
    expect(h.client.deletedFiles).toEqual(uploadedIds(h.client));
  });

  it('fails on a wrong answer, an unread fixture, a widened agent or an attended adapter', async () => {
    const wrong = harness();
    answers(wrong.client, 'blue');
    expect(await runRoleProbe(wrong.adapter, { codeRoot: CODE_ROOT, model: 'director-class' })).toMatchObject({ ok: false, reason: 'the session answered "blue", not red' });
    const unread = harness();
    answers(unread.client, 'red', '/mnt/session/uploads/other.png');
    expect((await runRoleProbe(unread.adapter, { codeRoot: CODE_ROOT, model: 'director-class' })).reason).toMatch(/never read/);
    const widened = harness();
    answers(widened.client, 'red');
    widened.client.sessionAgent = (agent) => ({ ...agent, tools: agentFromFile().tools });
    expect((await runRoleProbe(widened.adapter, { codeRoot: CODE_ROOT, model: 'director-class' })).reason).toMatch(/refused before it ran/);
    const attended = new FakeAdapter(async () => undefined, { mode: 'attended' });
    expect(await runRoleProbe(attended, { codeRoot: CODE_ROOT, model: 'director-class' })).toMatchObject({ ok: false, reason: 'the role probe runs the managed adapter, which this process did not build' });
    expect(attended.specs).toEqual([]);
  });

  it('mounts the committed fixture and reads one bare word', () => {
    const spec = roleProbeSpec(CODE_ROOT, 'director-class');
    expect(spec.role!.files[0]!.path).toBe(path.join(CODE_ROOT, 'platform', 'dispatcher', 'test', 'fixtures', 'probe-red.png'));
    expect(['Red', ' red. ', '"red"', 'RED!'].map(normalizedAnswer)).toEqual(['red', 'red', 'red', 'red']);
  });
});
