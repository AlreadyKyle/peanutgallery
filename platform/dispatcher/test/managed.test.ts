// The managed adapter against a fake Managed Agents client and doc-derived event fixtures
// (test/fixtures/managed-session.json, shapes from managed-agents-events.md). No request leaves the
// process.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import Anthropic from '@anthropic-ai/sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { budgetCents, exportCommand, MARGIN_CACHE_READ_TOKENS, MARGIN_OUTPUT_TOKENS, ManagedAdapter, toolchainProblem, type ManagedTimings } from '../src/adapters/managed.js';
import { FILES, AGENT_ID, ENVIRONMENT_ID, FakeManagedClient, agentFromFile, environmentFromFile, type FakeSession } from './helpers/fake-managed.js';
import { SessionPaused, type AgentEvent, type SessionSpec } from '../src/adapters/types.js';
import { StartupError, exitCodeFor } from '../src/exit-code.js';
import { haltReason, resetHalt } from '../src/halt.js';
import { createLogger } from '../src/log.js';
import { patchSha256, PATCH_MAX_BYTES, storedPatch, type PatchStore, type StoredPatch } from '../src/patch.js';
import { parsePriceTable, round4 } from '../src/pricing.js';
import { runAgentSession, type SessionDeps } from '../src/session.js';
import { AGENT_EMAIL, git, lanePaths } from '../src/worktree.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb, NOW, card, role } from './helpers/fake-db.js';
import { mockFetch, type Reply } from './helpers/mock-fetch.js';

// The usage tier cap's message, as the rate-limits page gives it.
const TIER_MESSAGE = 'You have reached your API usage limits: your organization has crossed its monthly API usage threshold.';

const TABLE = parsePriceTable(JSON.stringify({ 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } }));
const CONFIG_LANE = lanePaths('seed-1', 'config');
const SPAWN = `${JSON.stringify({ rows: [{ id: 'gatherer', name: 'Gatherer', baseCost: 10, rate: 0.2 }] }, null, 2)}\n`;
const READ_TOKEN = 'github_pat_-fixture-read';
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/managed-session.json', import.meta.url), 'utf8')) as Array<Record<string, unknown>>;
const FAST: Partial<ManagedTimings> = {
  interruptGraceMs: 300,
  statusWaitMs: 60,
  statusPollMs: 5,
  stopWaitMs: 200,
  outputTries: 3,
  outputDelayMs: 1,
  reconnectTries: 3,
  reconnectDelayMs: 1,
  ledgerRetryMs: 1,
  archiveTries: 2,
  archiveDelayMs: 1,
  probeTimeoutMs: 2000,
};

let dir: string;
let repo: string;
let base: string;
const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };

function raw(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();
}

async function patchFor(change: () => Promise<void>): Promise<Buffer> {
  await change();
  raw(['add', '-A']);
  const patch = execFileSync('git', ['diff', '--cached', '--no-renames', '--full-index', base], { cwd: repo, stdio: 'pipe' });
  raw(['reset', '-q', '--hard', base]);
  raw(['clean', '-qfdx']);
  return patch;
}

const costPatch = () => patchFor(async () => writeFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), SPAWN.replace('10', '11'), 'utf8'));
const strayPatch = () => patchFor(async () => writeFile(path.join(repo, 'platform', 'site', 'page.html'), '<title>stray</title>\n', 'utf8'));

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-managed-'));
  process.env.GIT_CONFIG_GLOBAL = path.join(dir, 'gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  await writeFile(process.env.GIT_CONFIG_GLOBAL, '', 'utf8');
  repo = path.join(dir, 'repo');
  await git(['init', '-q', '--initial-branch=main', repo], dir);
  for (const folder of ['seed-1/config', 'platform/site', 'platform/agents/prompts']) await mkdir(path.join(repo, folder), { recursive: true });
  await writeFile(path.join(repo, 'CLAUDE.md'), '# Root\n\nRoot instructions for every session.\n', 'utf8');
  await writeFile(path.join(repo, 'seed-1', 'CLAUDE.md'), '# Seed\n\nSeed instructions: the sim is deterministic.\n', 'utf8');
  await writeFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), SPAWN, 'utf8');
  await writeFile(path.join(repo, 'platform', 'site', 'page.html'), '<title>Mob Machine</title>\n', 'utf8');
  await writeFile(path.join(repo, 'platform', 'agents', 'prompts', 'builder-a.md'), '# Builder A\n\nYou are Builder A.\n', 'utf8');
  await git(['add', '-A'], repo);
  await git(['-c', 'user.name=Dispatcher test', '-c', `user.email=${AGENT_EMAIL}`, 'commit', '-q', '-m', 'base'], repo);
  base = await git(['rev-parse', 'HEAD'], repo);
});

afterAll(async () => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  resetHalt();
  raw(['checkout', '-q', 'main']);
  raw(['reset', '-q', '--hard', base]);
  raw(['clean', '-qfdx']);
});

class MemoryStore implements PatchStore {
  rows: StoredPatch[] = [];
  async save(patch: StoredPatch) {
    this.rows.push(patch);
  }
  async latest(cardId: string) {
    return [...this.rows].reverse().find((row) => row.cardId === cardId) ?? null;
  }
  async discard(cardId: string) {
    this.rows = this.rows.filter((row) => row.cardId !== cardId);
  }
}

// GitHub for the read-token check: the repository reads, and a ref write is refused for want of
// permission, unless write says otherwise.
function github(write: Reply = { status: 403, json: { message: 'Resource not accessible by personal access token' } }) {
  return mockFetch((method, url) => {
    if (method === 'GET' && url === 'https://api.github.com/repos/owner/repo') return { status: 200, json: { full_name: 'owner/repo' } };
    if (method === 'POST' && url === 'https://api.github.com/repos/owner/repo/git/refs') return write;
    return undefined;
  });
}

interface Harness {
  client: FakeManagedClient;
  db: FakeDb;
  alert: RecordingAlerter;
  store: MemoryStore;
  lines: string[];
  adapter: ManagedAdapter;
}

function harness(options: { fetchFn?: typeof fetch; client?: FakeManagedClient } = {}): Harness {
  const client = options.client ?? new FakeManagedClient();
  const db = new FakeDb();
  db.cards = [card({ stage: 'building' })];
  const alert = new RecordingAlerter();
  const store = new MemoryStore();
  const lines: string[] = [];
  const log = createLogger(new Writable({ write: (chunk, _enc, cb) => (lines.push(String(chunk)), cb()) }));
  const adapter = new ManagedAdapter({
    client,
    files: FILES,
    agentId: AGENT_ID,
    agentVersion: 3,
    environmentId: ENVIRONMENT_ID,
    githubRepo: 'owner/repo',
    readToken: READ_TOKEN,
    priceTable: TABLE,
    probeModel: 'builder-class',
    db,
    patches: store,
    alert,
    log,
    fetchFn: options.fetchFn ?? github().fetchFn,
    timings: FAST,
  });
  return { client, db, alert, store, lines, adapter };
}

function spec(overrides: Partial<SessionSpec> = {}): SessionSpec {
  return {
    cardId: card().id,
    worktree: repo,
    prompt: 'Card 4c2f5a1e: gatherer cost\nEdit only files under the allowed paths. Do not run git.',
    systemPromptFile: path.join(repo, 'platform', 'agents', 'prompts', 'builder-a.md'),
    model: 'builder-class',
    roleTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
    folder: 'seed-1',
    maxTurns: 60,
    maxBudgetUsd: 3,
    spentUsd: 0,
    roleId: 'role-builder-a',
    allowedPaths: CONFIG_LANE,
    ...overrides,
  };
}

// The fixture's events after the card prompt, with the submission naming this patch.
function fixtureEvents(patch: Buffer, input: Record<string, unknown> = {}): Array<Record<string, unknown>> {
  return FIXTURE.filter((event) => event.type !== 'user.message').map((event) =>
    event.type === 'agent.custom_tool_use' ? { ...event, input: { ...(event.input as object), sha256: patchSha256(patch), bytes: patch.byteLength, ...input } } : event,
  );
}

// The fixture's three requests price at 0.041 USD and 900 active seconds at 0.02 USD, so a list cost of
// 7 cents leaves a settle row under a cent.
const FIXTURE_CENTS = 7;

// The platform runs the fixture on the card prompt: the patch lands in the outputs and the session
// ends up idle waiting on submit_patch, having cost FIXTURE_CENTS over 900 active seconds.
function runsFixture(client: FakeManagedClient, patch: Buffer, input: Record<string, unknown> = {}, cents = FIXTURE_CENTS): void {
  client.react = (session, event) => {
    if (event.type !== 'user.message') return;
    client.addOutput(session.id, 'card.patch', patch);
    session.cost = { cents, activeSeconds: 900 };
    session.emit(...fixtureEvents(patch, input));
  };
}

async function run(h: Harness, s: SessionSpec = spec(), controller = new AbortController()) {
  const events: AgentEvent[] = [];
  const sentAtStart: number[] = [];
  const result = await h.adapter.run(
    s,
    (event) => {
      if (event.type === 'start') sentAtStart.push(h.client.sent.length);
      events.push(event);
    },
    controller.signal,
  );
  return { result, events, sentAtStart };
}

const sentTypes = (client: FakeManagedClient) => client.sent.map((entry) => entry.event.type);
const ledgerTotal = (db: FakeDb) => round4(db.ledger.reduce((sum, row) => sum + row.usd, 0));
const MARGIN = round4((MARGIN_CACHE_READ_TOKENS * 0.3 + MARGIN_OUTPUT_TOKENS * 15) / 1_000_000);

describe('a card session', () => {
  it('creates the session idle, records its id before any spend, applies the submitted patch and settles to the list cost', async () => {
    const h = harness();
    const patch = await costPatch();
    runsFixture(h.client, patch);
    const { result, events, sentAtStart } = await run(h);

    const session = h.client.last;
    const params = session.params;
    expect(params.initial_events).toBeUndefined();
    expect(params.agent).toMatchObject({ type: 'agent_with_overrides', id: AGENT_ID, version: 3, model: { id: 'builder-class', speed: 'standard' } });
    const system = (params.agent as { system: string }).system;
    expect(system).toContain('You are Builder A.');
    expect(system).toContain(`# Repository instructions: CLAUDE.md at ${base}`);
    expect(system).toContain('Root instructions for every session.');
    expect(system).toContain('Seed instructions: the sim is deterministic.');
    expect(params.resources).toEqual([{ type: 'github_repository', url: 'https://github.com/owner/repo', authorization_token: READ_TOKEN, mount_path: '/workspace/peanutgallery', checkout: { type: 'commit', sha: base } }]);
    expect(params.budget).toEqual({ type: 'limit', max_list_cost: { amount: String(Math.floor(round4(3 - MARGIN) * 100)), currency: 'USD' } });
    expect(params.metadata).toMatchObject({ purpose: 'card', card_id: card().id, role_id: 'role-builder-a', base_sha: base });

    expect(events[0]).toEqual({ type: 'start', sessionId: session.id, model: 'builder-class', tools: ['bash', 'read', 'write', 'edit', 'glob', 'grep', 'submit_patch'], apiKeySource: 'ANTHROPIC_API_KEY', ledger: 'adapter' });
    expect(sentAtStart).toEqual([0]);
    const first = h.client.sent[0]!.event as { type: string; content: Array<{ text: string }> };
    expect(first.type).toBe('user.message');
    expect(first.content[0]!.text.startsWith(spec().prompt)).toBe(true);
    expect(first.content[0]!.text).toContain(exportCommand(base));
    expect(first.content[0]!.text).toContain('pnpm install --frozen-lockfile');

    expect(events.filter((event) => event.type === 'turn_usage').map((event) => event.type === 'turn_usage' && [event.turn, event.requestId])).toEqual([
      [1, 'sevt_req_end_1'],
      [2, 'sevt_req_end_2'],
      [3, 'sevt_req_end_3'],
    ]);
    expect(h.db.ledger.map((row) => row.request_id)).toEqual(['sevt_req_end_1', 'sevt_req_end_2', 'sevt_req_end_3', `${session.id}/runtime`, `${session.id}/settle`]);
    expect(h.db.ledger.every((row) => row.billed_to === 'studio' && row.card_id === card().id && row.role_id === 'role-builder-a')).toBe(true);
    expect(ledgerTotal(h.db)).toBe(0.07);

    expect(await readFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), 'utf8')).toContain('"baseCost": 11');
    expect(h.store.rows).toEqual([storedPatch(card().id, base, patch, 'Gatherer base cost 10 to 11', session.id)]);
    expect(h.store.rows[0]).toMatchObject({ sha256: patchSha256(patch), bytes: patch.byteLength, patch: patch.toString('utf8') });
    expect(sentTypes(h.client)).toEqual(['user.message']);
    expect(session.archived).toBe(true);
    expect(h.client.deletedFiles).toEqual(['file_1']);
    expect(result).toEqual({ exitCode: 0, killed: false, killReason: null, turns: 3, endSubtype: 'success', totalCostUsd: null, numTurns: 3, isError: false });
    expect(events.at(-1)).toMatchObject({ type: 'end', subtype: 'accepted', isError: false, totalCostUsd: 0.07, numTurns: 3 });
    expect(h.alert.messages).toEqual([]);
  });

  it('settles up to a list cost well above the request rows, and alerts the shortfall', async () => {
    const h = harness();
    const patch = await costPatch();
    runsFixture(h.client, patch, {}, 12);
    await run(h);
    expect(ledgerTotal(h.db)).toBe(0.12);
    expect(h.db.ledger.at(-1)).toMatchObject({ request_id: `${h.client.last.id}/settle`, usd: 0.059 });
    expect(h.alert.messages).toEqual([`Managed session ${h.client.last.id} (card 4c2f5a1e) metering: the request rows fell 0.059 USD short of the session's list cost of 0.12 USD; the settle row covers it.`]);
  });

  it('puts only the root CLAUDE.md in a platform card session, since platform has none of its own', async () => {
    const h = harness();
    const patch = await patchFor(async () => writeFile(path.join(repo, 'platform', 'site', 'page.html'), '<title>Studio</title>\n', 'utf8'));
    runsFixture(h.client, patch);
    await run(h, spec({ folder: 'platform', allowedPaths: lanePaths('platform', 'code') }));
    const system = (h.client.last.params.agent as { system: string }).system;
    expect(system).toContain('Root instructions for every session.');
    expect(system).not.toContain('Seed instructions');
    expect(await readFile(path.join(repo, 'platform', 'site', 'page.html'), 'utf8')).toBe('<title>Studio</title>\n');
  });

  it('refuses a submission whose sha256 does not match, then accepts the corrected one', async () => {
    const h = harness();
    const patch = await costPatch();
    runsFixture(h.client, patch, { sha256: 'f'.repeat(64) });
    const react = h.client.react;
    h.client.react = async (session, event, client) => {
      await react(session, event, client);
      if (event.type === 'user.custom_tool_result') {
        session.emit(
          { type: 'session.status_running' },
          { type: 'agent.custom_tool_use', id: 'sevt_submit_2', name: 'submit_patch', input: { summary: 'again', sha256: patchSha256(patch), bytes: patch.byteLength } },
          { type: 'span.model_request_end', id: 'sevt_req_end_4', is_error: false, model_request_start_id: 'x', model_usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
          { type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_submit_2'] } },
        );
      }
    };
    const { result } = await run(h);
    const refusal = h.client.sent.find((entry) => entry.event.type === 'user.custom_tool_result')!.event as { is_error: boolean; custom_tool_use_id: string; content: Array<{ text: string }> };
    expect(refusal).toMatchObject({ is_error: true, custom_tool_use_id: 'sevt_submit_1' });
    expect(refusal.content[0]!.text).toMatch(/sha256/);
    expect(result).toMatchObject({ isError: false, endSubtype: 'success', turns: 4 });
    expect(await readFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), 'utf8')).toContain('"baseCost": 11');
  });

  it('refuses a patch outside the lane twice and ends the session as patch_rejected with nothing written', async () => {
    const h = harness();
    const patch = await strayPatch();
    runsFixture(h.client, patch);
    const react = h.client.react;
    h.client.react = async (session, event, client) => {
      await react(session, event, client);
      if (event.type === 'user.custom_tool_result') {
        session.emit(
          { type: 'agent.custom_tool_use', id: 'sevt_submit_2', name: 'submit_patch', input: { summary: 'again', sha256: patchSha256(patch), bytes: patch.byteLength } },
          { type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_submit_2'] } },
        );
      }
    };
    const { result, events } = await run(h);
    expect(sentTypes(h.client)).toEqual(['user.message', 'user.custom_tool_result']);
    expect(result).toMatchObject({ isError: true, endSubtype: 'patch_rejected', exitCode: 1 });
    expect(events.filter((event) => event.type === 'error').map((event) => event.type === 'error' && event.message)).toEqual([
      'submit_patch refused: the patch changes files outside the lane or on a kernel path: platform/site/page.html',
      'submit_patch refused: the patch changes files outside the lane or on a kernel path: platform/site/page.html',
    ]);
    expect(raw(['status', '--porcelain'])).toBe('');
    expect(h.store.rows).toEqual([]);
    expect(h.client.last.archived).toBe(true);
  });

  it('refuses an oversize patch file without downloading it', async () => {
    const h = harness();
    const big = Buffer.alloc(PATCH_MAX_BYTES + 1, 'a');
    let downloads = 0;
    const download = h.client.files.download;
    h.client.files.download = async (id: string) => {
      downloads += 1;
      return download(id);
    };
    runsFixture(h.client, big);
    const react = h.client.react;
    h.client.react = async (session, event, client) => {
      await react(session, event, client);
      if (event.type === 'user.custom_tool_result' || (event.type === 'user.message' && client.sent.length > 1)) session.emit({ type: 'session.status_idle', stop_reason: { type: 'end_turn' } });
    };
    const { result } = await run(h);
    const refusal = h.client.sent.find((entry) => entry.event.type === 'user.custom_tool_result')!.event as { content: Array<{ text: string }> };
    expect(refusal.content[0]!.text).toMatch(/over the 1048576-byte limit/);
    expect(downloads).toBe(0);
    expect(result).toMatchObject({ isError: true, endSubtype: 'no_patch' });
    // One reminder after the agent ended its turn without an accepted patch.
    expect(sentTypes(h.client)).toEqual(['user.message', 'user.custom_tool_result', 'user.message']);
  });

  it('keeps back one request from the budget, in whole cents, and runs no session under a cent', async () => {
    expect(budgetCents(3, MARGIN)).toBe(283);
    expect(budgetCents(0.17, MARGIN)).toBe(0);
    const h = harness();
    const { result } = await run(h, spec({ maxBudgetUsd: 0.17 }));
    expect(h.client.sessions_).toEqual([]);
    expect(result).toMatchObject({ endSubtype: 'error_max_budget_usd', isError: false, turns: 0 });
  });

  it('ends at the budget as the ceiling, records the request that crossed it and alerts the overshoot', async () => {
    const h = harness();
    h.client.react = (session, event) => {
      if (event.type !== 'user.message') return;
      session.cost = { cents: 310, activeSeconds: 1200 };
      session.emit(
        { type: 'session.status_running' },
        { type: 'span.model_request_end', id: 'sevt_big', is_error: false, model_request_start_id: 'x', model_usage: { input_tokens: 800_000, output_tokens: 20_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
        { type: 'session.thread_status_idle', agent_name: 'writer', session_thread_id: 't', stop_reason: { type: 'budget_reached' } },
        { type: 'session.usage', usage: { list_cost: { amount: '310', currency: 'USD' }, active_seconds: 1200 } },
        { type: 'session.status_idle', stop_reason: { type: 'budget_reached' } },
      );
    };
    const { result } = await run(h);
    expect(result).toMatchObject({ endSubtype: 'error_max_budget_usd', isError: false });
    expect(h.db.ledger[0]).toMatchObject({ request_id: 'sevt_big', usd: 2.7 });
    expect(ledgerTotal(h.db)).toBe(3.1);
    expect(h.alert.messages.some((message) => /spent 3\.1 USD against a budget of 3 USD, 0\.1 USD over/.test(message))).toBe(true);
    expect(sentTypes(h.client)).toEqual(['user.message']);
  });

  it('turns an abort into user.interrupt, drains to idle, then settles and archives', async () => {
    const h = harness();
    const controller = new AbortController();
    h.client.react = (session, event) => {
      if (event.type === 'user.message') {
        session.cost = { cents: 3, activeSeconds: 60 };
        session.emit(
          { type: 'session.status_running' },
          { type: 'span.model_request_end', id: 'sevt_one', is_error: false, model_request_start_id: 'x', model_usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
        );
        setTimeout(() => controller.abort('paused_by_board'), 5);
      }
      if (event.type === 'user.interrupt') session.emit({ type: 'session.status_idle', stop_reason: { type: 'end_turn' } });
    };
    const { result } = await run(h, spec(), controller);
    expect(sentTypes(h.client)).toEqual(['user.message', 'user.interrupt']);
    expect(result).toMatchObject({ killed: true, killReason: 'paused_by_board', endSubtype: 'interrupted', isError: false });
    expect(h.db.ledger.map((row) => row.request_id)).toEqual(['sevt_one', `${h.client.last.id}/runtime`, `${h.client.last.id}/settle`]);
    expect(ledgerTotal(h.db)).toBe(0.03);
    expect(h.client.last.archived).toBe(true);
  });

  it('reconnects after a dropped stream, meters every request once and still answers the pending submission', async () => {
    const h = harness();
    const patch = await costPatch();
    runsFixture(h.client, patch);
    h.client.dropAfter = 4;
    const { result } = await run(h);
    expect(h.client.streamsOpened).toBeGreaterThanOrEqual(2);
    expect(h.db.ledger.filter((row) => row.request_id?.startsWith('sevt_req_end_')).map((row) => row.request_id)).toEqual(['sevt_req_end_1', 'sevt_req_end_2', 'sevt_req_end_3']);
    expect(result).toMatchObject({ isError: false, endSubtype: 'success' });
    expect(ledgerTotal(h.db)).toBe(0.07);
  });

  it('refuses a session whose agent comes back with a web tool, before sending it anything', async () => {
    const client = new FakeManagedClient();
    client.agent = agentFromFile({ ...FILES.agent, tools: [{ type: 'agent_toolset_20260401', default_config: { enabled: true } }] });
    const h = harness({ client });
    const events: AgentEvent[] = [];
    await expect(h.adapter.run(spec(), (event) => void events.push(event), new AbortController().signal)).rejects.toThrow(/refused before it ran: enabled tools include web_fetch, web_search/);
    expect(events).toEqual([]);
    expect(client.sent).toEqual([]);
    expect(client.last.archived).toBe(true);
  });

  it('refuses a base commit that carries repository skills', async () => {
    raw(['checkout', '-q', '-b', 'skills']);
    await mkdir(path.join(repo, '.claude', 'skills', 'x'), { recursive: true });
    await writeFile(path.join(repo, '.claude', 'skills', 'x', 'SKILL.md'), '# x\n', 'utf8');
    raw(['add', '-A']);
    raw(['-c', 'user.name=t', '-c', `user.email=${AGENT_EMAIL}`, 'commit', '-q', '-m', 'skills']);
    try {
      const h = harness();
      const error = await run(h).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SessionPaused);
      expect(error).toMatchObject({ failingCheck: 'repo_skills', message: expect.stringMatching(/\.claude\/skills/) });
      expect(h.client.sessions_).toEqual([]);
    } finally {
      raw(['checkout', '-q', 'main']);
      raw(['branch', '-q', '-D', 'skills']);
    }
  });

  it('halts the dispatcher and creates no session when the read token turns out able to write', async () => {
    const h = harness({ fetchFn: github({ status: 422, json: { message: 'Object does not exist' } }).fetchFn });
    const error = await run(h).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionPaused);
    expect(error).toMatchObject({ failingCheck: 'read_token', message: expect.stringMatching(/GITHUB_READ_TOKEN can write to owner\/repo/) });
    expect(haltReason()).toMatch(/^read_token: /);
    expect(h.client.sessions_).toEqual([]);
    expect(h.alert.messages[0]).toMatch(/The dispatcher halted/);
  });

  it('pauses the card, with no session and no halt, when GitHub rate-limits the read-token check', async () => {
    const h = harness({ fetchFn: github({ status: 429, json: { message: 'API rate limit exceeded' } }).fetchFn });
    const error = await run(h).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionPaused);
    expect(error).toMatchObject({ failingCheck: 'read_token' });
    expect(haltReason()).toBeNull();
    expect(h.client.sessions_).toEqual([]);
  });

  it('pauses the card, and reports the API error as an event, when the session cannot be created', async () => {
    const h = harness();
    h.client.failCreate = new Error('529 overloaded_error');
    const events: AgentEvent[] = [];
    const error = await h.adapter.run(spec(), (event) => void events.push(event), new AbortController().signal).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionPaused);
    expect(error).toMatchObject({ failingCheck: 'managed_api' });
    expect(events).toEqual([{ type: 'error', message: 'the Managed Agents session could not be created: 529 overloaded_error' }]);
    expect(h.db.ledger).toEqual([]);
  });

  it("pauses the card as usage_tier_cap, keeping the API's error code in the event, when the create meets the usage tier's cap", async () => {
    const h = harness();
    // Built by the SDK itself, so the message is worded as the real client words it.
    h.client.failCreate = Anthropic.APIError.generate(429, { type: 'error', error: { type: 'rate_limit_error', message: TIER_MESSAGE }, error_code: 'enforced_spend_limit_reached' }, undefined, new Headers());
    const events: AgentEvent[] = [];
    const error = await h.adapter.run(spec(), (event) => void events.push(event), new AbortController().signal).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionPaused);
    expect(error).toMatchObject({ failingCheck: 'usage_tier_cap' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', message: expect.stringMatching(/^the Managed Agents session could not be created: 429 .*enforced_spend_limit_reached/) });
    expect(h.db.ledger).toEqual([]);
  });

  it('pauses the card as console_credit when the create is refused for credit', async () => {
    const h = harness();
    h.client.failCreate = Anthropic.APIError.generate(
      400,
      { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } },
      undefined,
      new Headers(),
    );
    const error = await h.adapter.run(spec(), () => undefined, new AbortController().signal).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ failingCheck: 'console_credit' });
  });

  it('pauses the card as stream_lost, after settling and archiving the session, when its event stream cannot be held', async () => {
    const h = harness();
    h.client.failStream = new Error('socket hang up');
    const error = await run(h).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionPaused);
    expect(error).toMatchObject({ failingCheck: 'stream_lost', message: expect.stringMatching(/the event stream dropped 4 times/) });
    expect(h.client.streamsOpened).toBe(4);
    expect(h.client.sent).toEqual([]);
    expect(h.client.last.archived).toBe(true);
  });
});

describe('a session the dispatcher stops reading', () => {
  const REQUEST = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

  it('interrupts a session whose stream drops after the prompt, reads it until it is not running, then settles and archives it and pauses the card', async () => {
    const h = harness();
    const retrieved: string[] = [];
    const retrieve = h.client.sessions.retrieve;
    h.client.sessions.retrieve = async (id: string) => {
      const snapshot = await retrieve(id);
      retrieved.push(snapshot.status);
      return snapshot;
    };
    h.client.react = (session, event, client) => {
      if (event.type === 'user.message') {
        session.cost = { cents: 3, activeSeconds: 60 };
        session.emit({ type: 'session.status_running' }, { type: 'span.model_request_end', id: 'sevt_before_drop', is_error: false, model_request_start_id: 'x', model_usage: REQUEST });
        // The connection goes, and no stream can be opened again.
        client.failStream = new Error('socket hang up');
        session.drop();
      }
      // The platform takes a moment to stop the session after the interrupt.
      if (event.type === 'user.interrupt') setTimeout(() => session.emit({ type: 'session.status_idle', stop_reason: { type: 'end_turn' } }), 20);
    };
    const error = await run(h).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionPaused);
    expect(error).toMatchObject({ failingCheck: 'stream_lost', message: expect.stringMatching(/the event stream dropped 4 times/) });
    expect(sentTypes(h.client)).toEqual(['user.message', 'user.interrupt']);
    expect(retrieved[0]).toBe('running');
    expect(retrieved.at(-1)).toBe('idle');
    expect(h.client.last.archived).toBe(true);
    expect(h.db.ledger.map((row) => row.request_id)).toEqual(['sevt_before_drop', `${h.client.last.id}/runtime`, `${h.client.last.id}/settle`]);
    expect(ledgerTotal(h.db)).toBe(0.03);
  });

  it('interrupts again, and settles, a session still running when the drain after an interrupt runs out', async () => {
    const h = harness();
    const controller = new AbortController();
    let interrupts = 0;
    h.client.react = (session, event) => {
      if (event.type === 'user.message') {
        session.cost = { cents: 2, activeSeconds: 30 };
        session.emit({ type: 'session.status_running' }, { type: 'span.model_request_end', id: 'sevt_drain', is_error: false, model_request_start_id: 'x', model_usage: REQUEST });
        setTimeout(() => controller.abort('wall_clock'), 5);
      }
      // The first interrupt is not honoured before the drain runs out; the second is.
      if (event.type === 'user.interrupt' && (interrupts += 1) === 2) session.emit({ type: 'session.status_idle', stop_reason: { type: 'end_turn' } });
    };
    const { result } = await run(h, spec(), controller);
    expect(sentTypes(h.client)).toEqual(['user.message', 'user.interrupt', 'user.interrupt']);
    expect(result).toMatchObject({ killed: true, killReason: 'wall_clock', endSubtype: 'interrupted' });
    expect(h.client.last.archived).toBe(true);
    expect(ledgerTotal(h.db)).toBe(0.02);
  });

  it('leaves a session that will not stop unarchived for recovery, and still pauses the card', async () => {
    const h = harness();
    h.client.react = (session, event, client) => {
      if (event.type !== 'user.message') return;
      session.emit({ type: 'session.status_running' });
      client.failStream = new Error('socket hang up');
      session.drop();
    };
    const error = await run(h).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ failingCheck: 'stream_lost' });
    expect(sentTypes(h.client)).toEqual(['user.message', 'user.interrupt']);
    expect(h.client.last.archived).toBe(false);
    expect(h.lines.some((line) => line.includes('left for recovery to settle'))).toBe(true);
  });

  it('starts the reconnect count again after a connect that brought new events, so a stream that drops now and then is not lost', async () => {
    const h = harness();
    let first = true;
    h.client.react = (session, event) => {
      if (event.type !== 'user.message') return;
      if (!first) {
        session.emit({ type: 'session.status_idle', stop_reason: { type: 'end_turn' } });
        return;
      }
      first = false;
      session.cost = { cents: 5, activeSeconds: 60 };
      // Five requests, each followed by a dropped connection: more drops than reconnectTries (3).
      let step = 0;
      const next = () => {
        step += 1;
        if (step <= 5) {
          session.emit({ type: 'span.model_request_end', id: `sevt_flaky_${step}`, is_error: false, model_request_start_id: 'x', model_usage: REQUEST });
          session.drop();
          setTimeout(next, 25);
        } else {
          session.emit({ type: 'session.status_idle', stop_reason: { type: 'end_turn' } });
        }
      };
      session.emit({ type: 'session.status_running' });
      setTimeout(next, 5);
    };
    const { result } = await run(h);
    expect(h.client.streamsOpened).toBeGreaterThan(4);
    expect(result.endSubtype).toBe('no_patch');
    expect(h.db.ledger.filter((row) => row.request_id?.startsWith('sevt_flaky_')).map((row) => row.request_id)).toEqual([1, 2, 3, 4, 5].map((n) => `sevt_flaky_${n}`));
    expect(h.client.last.archived).toBe(true);
  });
});

describe('orphan sessions', () => {
  // A card session a crashed dispatcher left running: two requests metered by nobody, and a patch the
  // agent submitted that no one answered.
  async function orphan(h: Harness, patch: Buffer, options: { submitted?: boolean; baseSha?: string } = {}): Promise<FakeSession> {
    await h.client.sessions.create({
      agent: { type: 'agent_with_overrides', id: AGENT_ID, version: 3, model: { id: 'builder-class' } },
      environment_id: ENVIRONMENT_ID,
      metadata: { purpose: 'card', card_id: card().id, role_id: 'role-builder-a', base_sha: options.baseSha ?? base, run: 'r1' },
    });
    const session = h.client.last;
    h.client.addOutput(session.id, 'card.patch', patch);
    session.cost = { cents: FIXTURE_CENTS, activeSeconds: 900 };
    const history = fixtureEvents(patch).slice(0, -1);
    session.emit(...(options.submitted === false ? history.filter((event) => event.type !== 'agent.custom_tool_use') : history), { type: 'session.status_running' });
    h.client.react = (s, event) => {
      if (event.type === 'user.interrupt') s.emit({ type: 'session.status_idle', stop_reason: { type: 'end_turn' } });
    };
    return session;
  }

  it('interrupts, meters the history once, stores the unanswered patch, settles and archives, and a second pass writes nothing', async () => {
    const h = harness();
    const patch = await costPatch();
    const session = await orphan(h, patch);
    const closed = await h.adapter.closeOrphans();
    expect(closed.get(card().id)).toEqual({ sessionIds: [session.id], patchStored: true, unsettled: [] });
    expect(sentTypes(h.client)).toEqual(['user.interrupt']);
    expect(h.db.ledger.map((row) => row.request_id)).toEqual(['sevt_req_end_1', 'sevt_req_end_2', 'sevt_req_end_3', `${session.id}/runtime`, `${session.id}/settle`]);
    expect(ledgerTotal(h.db)).toBe(0.07);
    expect(h.store.rows).toEqual([storedPatch(card().id, base, patch, 'Gatherer base cost 10 to 11', session.id)]);
    expect(session.archived).toBe(true);
    const again = await h.adapter.closeOrphans();
    expect(again.size).toBe(0);
    expect(h.db.ledger).toHaveLength(5);
  });

  it('starts no second session for a card while its earlier session cannot be settled', async () => {
    const h = harness();
    const patch = await costPatch();
    const session = await orphan(h, patch);
    h.client.react = () => undefined;
    const error = await run(h).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionPaused);
    expect(error).toMatchObject({ failingCheck: 'session_unsettled', message: expect.stringMatching(/has an earlier session that could not be settled/) });
    expect(h.client.sessions_).toEqual([session]);
    expect(session.archived).toBe(false);
  });

  it('settles an orphan that submitted nothing before the next session for the same card runs', async () => {
    const h = harness();
    const patch = await costPatch();
    const session = await orphan(h, patch, { submitted: false });
    const react = h.client.react;
    runsFixture(h.client, patch);
    const fixture = h.client.react;
    h.client.react = async (s, event, client) => {
      await react(s, event, client);
      await fixture(s, event, client);
    };
    const { result } = await run(h);
    expect(session.archived).toBe(true);
    expect(h.client.sessions_).toHaveLength(2);
    expect(result).toMatchObject({ endSubtype: 'success' });
  });

  it("lowers the new session's budget by what the settled orphan added to the card's spend", async () => {
    const h = harness();
    const patch = await costPatch();
    await orphan(h, patch, { submitted: false });
    const react = h.client.react;
    runsFixture(h.client, patch);
    const fixture = h.client.react;
    h.client.react = async (s, event, client) => {
      await react(s, event, client);
      await fixture(s, event, client);
    };
    await run(h, spec({ maxBudgetUsd: 3, spentUsd: 0 }));
    // The orphan settled at 0.07 USD on this card, so the session may spend 2.93 USD less one request.
    expect(h.client.last.params.budget).toEqual({ type: 'limit', max_list_cost: { amount: String(budgetCents(2.93, MARGIN)), currency: 'USD' } });
    expect(budgetCents(2.93, MARGIN)).toBeLessThan(budgetCents(3, MARGIN));
  });

  it('starts no session when the card cannot be read after its orphans are settled', async () => {
    const h = harness();
    h.db.cards = [];
    const error = await run(h).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionPaused);
    expect(error).toMatchObject({ failingCheck: 'card_spend' });
    expect(h.client.sessions_).toEqual([]);
  });

  it("applies the patch an orphan submitted instead of paying for a second session", async () => {
    const h = harness();
    const patch = await costPatch();
    const session = await orphan(h, patch);
    const { result, events } = await run(h);
    expect(session.archived).toBe(true);
    expect(h.client.sessions_).toEqual([session]);
    expect(result).toMatchObject({ exitCode: 0, endSubtype: 'success', turns: 0, isError: false });
    expect(events).toEqual([{ type: 'message', text: expect.stringMatching(/^the patch an earlier session submitted \(sha256 [0-9a-f]{64}\) was applied; no new session: seed-1\/config\/spawn-table\.json$/) }]);
    expect(await readFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), 'utf8')).toContain('"baseCost": 11');
    expect(ledgerTotal(h.db)).toBe(0.07);
  });

  // A dispatcher that stopped during a visual revision (docs/specs/design-review.md) leaves an orphan
  // whose base is the card's own commit: its patch is only the revision, never applied at main.
  it("refuses an orphan's patch made against a commit main does not hold, and starts no session", async () => {
    const h = harness();
    const patch = await costPatch();
    const cardCommit = await git(['commit-tree', `${base}^{tree}`, '-p', base, '-m', 'card commit'], repo);
    const session = await orphan(h, patch, { baseSha: cardCommit });
    const error = await run(h).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionPaused);
    expect(error).toMatchObject({ failingCheck: 'patch_conflict', message: expect.stringMatching(/is not on main/) });
    expect(session.archived).toBe(true);
    expect(h.client.sessions_).toEqual([session]);
    expect(h.store.rows).toEqual([]);
    expect(await readFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), 'utf8')).not.toContain('"baseCost": 11');
  });
});

describe('containment', () => {
  it('passes with a read-only token, the agent at its pinned version and the environment as declared', async () => {
    const h = harness();
    await h.adapter.checkContainment();
    expect(h.client.retrievedAgents).toEqual([{ id: AGENT_ID, version: 3 }]);
    expect(h.lines.some((line) => line.includes('"msg":"containment verified"'))).toBe(true);
  });

  const fatal: Array<[string, (client: FakeManagedClient) => void, RegExp]> = [
    ['an enabled web tool', (c) => (c.agent = agentFromFile({ ...FILES.agent, tools: [{ type: 'agent_toolset_20260401', default_config: { enabled: true } }] })), /enabled tools include web_fetch, web_search/],
    ['an MCP server', (c) => (c.agent = agentFromFile(FILES.agent, { mcp_servers: [{ type: 'url', name: 'github', url: 'https://mcp.example' }] })), /MCP servers configured: github/],
    ['an MCP toolset', (c) => (c.agent = agentFromFile({ ...FILES.agent, tools: [...(FILES.agent.tools ?? []), { type: 'mcp_toolset', mcp_server_name: 'github' }] })), /mcp__github/],
    ['a skill', (c) => (c.agent = agentFromFile(FILES.agent, { skills: [{ type: 'anthropic', skill_id: 'xlsx', version: 'latest' }] })), /skills attached: xlsx/],
    ['fast mode', (c) => (c.agent = agentFromFile(FILES.agent, { model: { id: 'builder-class', speed: 'fast' } })), /fast speed/],
    ['another version', (c) => (c.agent = agentFromFile(FILES.agent, { version: 4 })), /version 4, not the pinned 3/],
    ['unrestricted networking', (c) => (c.environment = environmentFromFile({ networking: { type: 'unrestricted' } })), /networking is unrestricted/],
    ['MCP egress', (c) => (c.environment = environmentFromFile({ networking: { type: 'limited', allow_mcp_servers: true, allow_package_managers: true, allowed_hosts: [] } })), /MCP server egress/],
    ['an extra host', (c) => (c.environment = environmentFromFile({ networking: { type: 'limited', allow_mcp_servers: false, allow_package_managers: true, allowed_hosts: ['example.com'] } })), /allowed_hosts is \[example\.com\]/],
  ];

  for (const [name, drift, reason] of fatal) {
    it(`refuses to start, exit 78, on ${name}`, async () => {
      const h = harness();
      drift(h.client);
      const error = await h.adapter.checkContainment().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(StartupError);
      expect((error as Error).message).toMatch(reason);
      expect(exitCodeFor(error)).toBe(78);
    });
  }

  it('refuses to start on a read token that can write, and retries on a rate limit', async () => {
    const writes = await harness({ fetchFn: github({ status: 422, json: { message: 'Object does not exist' } }).fetchFn }).adapter.checkContainment().catch((caught: unknown) => caught);
    expect(exitCodeFor(writes)).toBe(78);
    const { fetchFn } = mockFetch((method) => (method === 'GET' ? { status: 200, json: {} } : { status: 403, json: { message: 'API rate limit exceeded' } }));
    const limited = harness({
      fetchFn: (async (input: string | URL | Request, init?: RequestInit) => {
        const response = await fetchFn(input, init);
        return init?.method === 'POST' ? new Response(await response.text(), { status: 403, headers: { 'x-ratelimit-remaining': '0' } }) : response;
      }) as typeof fetch,
    });
    const error = await limited.adapter.checkContainment().catch((caught: unknown) => caught);
    expect(exitCodeFor(error)).toBe(1);
  });
});

describe('the startup probe', () => {
  function probing(client: FakeManagedClient): void {
    client.react = (session, event) => {
      if (event.type !== 'user.message') return;
      session.cost = { cents: 2, activeSeconds: 20 };
      session.emit(
        { type: 'session.status_running' },
        { type: 'agent.message', content: [{ type: 'text', text: 'ready' }] },
        { type: 'span.model_request_end', id: 'sevt_probe_1', is_error: false, model_request_start_id: 'x', model_usage: { input_tokens: 2000, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
        { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
      );
    };
  }

  it('runs one minimal session, bills it as overhead with no card and no role, leaves the pool alone and archives it', async () => {
    const h = harness();
    probing(h.client);
    await h.adapter.probe();
    const session = h.client.last;
    expect(session.params.metadata).toMatchObject({ purpose: 'probe' });
    expect(session.params.resources).toBeUndefined();
    expect(session.params.budget).toEqual({ type: 'limit', max_list_cost: { amount: '25', currency: 'USD' } });
    expect(h.db.ledger.map((row) => [row.request_id, row.billed_to, row.card_id, row.role_id])).toEqual([
      ['sevt_probe_1', 'overhead', null, null],
      [`${session.id}/runtime`, 'overhead', null, null],
      [`${session.id}/settle`, 'overhead', null, null],
    ]);
    expect(ledgerTotal(h.db)).toBe(0.02);
    expect(h.db.pool.balance_usd).toBe(50);
    expect(session.archived).toBe(true);
    expect(h.lines.some((line) => line.includes('"msg":"startup probe passed"') && line.includes('"apiKeySource":"ANTHROPIC_API_KEY"'))).toBe(true);
  });

  it('is fatal when the agent drifted and transient when the API is overloaded', async () => {
    const drifted = harness();
    drifted.client.agent = agentFromFile(FILES.agent, { skills: [{ type: 'anthropic', skill_id: 'pdf', version: 'latest' }] });
    probing(drifted.client);
    const fatal = await drifted.adapter.probe().catch((caught: unknown) => caught);
    expect(exitCodeFor(fatal)).toBe(78);
    const overloaded = harness();
    overloaded.client.failCreate = new Anthropic.APIError(529, { type: 'overloaded_error' }, 'Overloaded', new Headers());
    const transient = await overloaded.adapter.probe().catch((caught: unknown) => caught);
    expect(transient).toBeInstanceOf(StartupError);
    expect(exitCodeFor(transient)).toBe(1);
    const refused = harness();
    refused.client.failCreate = new Anthropic.APIError(400, { type: 'invalid_request_error' }, 'model has no list price', new Headers());
    expect(exitCodeFor(await refused.adapter.probe().catch((caught: unknown) => caught))).toBe(78);
  });

  it('fails, not fatally, when the session stops without a reply', async () => {
    const h = harness();
    h.client.react = (session, event) => {
      if (event.type === 'user.message') session.emit({ type: 'session.status_idle', stop_reason: { type: 'retries_exhausted' } });
    };
    const error = await h.adapter.probe().catch((caught: unknown) => caught);
    expect((error as Error).message).toMatch(/stopped with retries_exhausted after 0 model request/);
    expect(exitCodeFor(error)).toBe(1);
  });
});

describe('the toolchain check', () => {
  it('passes node 22 or later, pnpm 11.0.9 and both commands exiting 0, and nothing else', () => {
    const good = { node: 'v22.11.0', pnpm: '11.0.9', install_exit: '0', bot_exit: '0' };
    expect(toolchainProblem(good)).toBeNull();
    expect(toolchainProblem({ ...good, node: 'v20.1.0' })).toMatch(/node is v20\.1\.0/);
    expect(toolchainProblem({ ...good, pnpm: '9.0.0' })).toMatch(/pnpm is 9\.0\.0/);
    expect(toolchainProblem({ ...good, install_exit: '1' })).toMatch(/install/);
    expect(toolchainProblem({ ...good, bot_exit: '2' })).toMatch(/bot exited 2/);
  });

  it('reads the output file the command wrote and bills the session as overhead', async () => {
    const h = harness();
    h.client.react = (session, event) => {
      if (event.type !== 'user.message') return;
      h.client.addOutput(session.id, 'toolchain.txt', Buffer.from('node=v22.11.0\npnpm=11.0.9\ninstall_exit=0\nbot_exit=0\nbot_tail=PASS: headless-bot\n'));
      session.cost = { cents: 40, activeSeconds: 300 };
      session.emit(
        { type: 'span.model_request_end', id: 'sevt_tc_1', is_error: false, model_request_start_id: 'x', model_usage: { input_tokens: 3000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
        { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
      );
    };
    const report = await h.adapter.toolchain(base);
    expect(report).toMatchObject({ ok: true, reason: null, lines: { node: 'v22.11.0', pnpm: '11.0.9' } });
    expect(h.client.last.params.resources?.[0]).toMatchObject({ type: 'github_repository', checkout: { type: 'commit', sha: base } });
    expect(h.db.ledger.every((row) => row.billed_to === 'overhead')).toBe(true);
    expect(ledgerTotal(h.db)).toBe(0.4);
  });
});

describe('runAgentSession on the managed adapter', () => {
  function sessionDeps(h: Harness, overrides: Partial<SessionDeps> = {}): SessionDeps {
    return {
      db: h.db,
      adapter: h.adapter,
      priceTable: TABLE,
      sessionMaxTurns: 60,
      boardSessionTtlMin: 3,
      watchIntervalMs: 60_000,
      fallbackModel: 'builder-class',
      sessionMaxMs: 60_000,
      ledgerRetryMs: 1,
      alert: h.alert,
      log: createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() })),
      stopSignal: new AbortController().signal,
      now: () => NOW,
      ...overrides,
    };
  }

  it('bills the pool from the adapter rows alone: no command-line init or result line, no settle of its own and no metering alert', async () => {
    const h = harness();
    h.db.studio.agent_mode = 'unattended';
    const patch = await costPatch();
    runsFixture(h.client, patch);
    const run = await runAgentSession(card({ stage: 'building' }), role(), repo, h.db.studio, sessionDeps(h));
    expect(run).toMatchObject({ outcome: 'completed', turns: 3 });
    expect(h.db.ledger.map((row) => row.request_id)).toEqual(['sevt_req_end_1', 'sevt_req_end_2', 'sevt_req_end_3', `${h.client.last.id}/runtime`, `${h.client.last.id}/settle`]);
    expect(h.db.pool.balance_usd).toBe(round4(50 - 0.07));
    expect(h.db.cards[0]!.actual_usd).toBe(0.07);
    expect(h.db.events[0]).toMatchObject({ type: 'start', payload: { session_id: h.client.last.id, api_key_source: 'ANTHROPIC_API_KEY', mode: 'unattended', refusal: null } });
    expect(h.db.events.some((event) => event.type === 'error')).toBe(false);
    expect(h.alert.messages).toEqual([]);
  });

  // The agent's own reply is never read for a credit or spend-limit refusal (launch-dispatcher.md): only
  // an API error, an error event or a session.error is. A card about an in-game shop can put those
  // very words in the last message of a session that ended with no patch.
  it("does not read the agent's own last reply as a credit refusal when its session ends with no patch", async () => {
    const h = harness();
    h.db.studio.agent_mode = 'unattended';
    let idles = 0;
    h.client.react = (session, event) => {
      if (event.type !== 'user.message') return;
      session.emit(
        { type: 'span.model_request_end', model_usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
        ...(idles === 0 ? [{ type: 'agent.message', content: [{ type: 'text', text: 'I could not finish: the shop text says "Your credit balance is too low to buy this upgrade" and I did not know what to change.' }] }] : []),
        { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
      );
      idles += 1;
    };
    const run = await runAgentSession(card({ stage: 'building' }), role(), repo, h.db.studio, sessionDeps(h));
    expect(run.outcome).not.toBe('credit_exhausted');
    expect(run.outcome).toBe('error');
  });

  it('interrupts at the turn cap and ends as turn_cap', async () => {
    const h = harness();
    h.db.studio.agent_mode = 'unattended';
    const patch = await costPatch();
    runsFixture(h.client, patch);
    const react = h.client.react;
    h.client.react = async (session, event, client) => {
      await react(session, event, client);
      if (event.type === 'user.interrupt') session.emit({ type: 'session.status_idle', stop_reason: { type: 'end_turn' } });
    };
    const run = await runAgentSession(card({ stage: 'building' }), role(), repo, h.db.studio, sessionDeps(h, { sessionMaxTurns: 2 }));
    expect(run.outcome).toBe('turn_cap');
    expect(sentTypes(h.client)).toContain('user.interrupt');
  });

  it('ends as adapter_paused, naming the failing check, when the adapter starts no session for a reason that is not the card', async () => {
    const h = harness({ fetchFn: github({ status: 429, json: { message: 'API rate limit exceeded' } }).fetchFn });
    h.db.studio.agent_mode = 'unattended';
    const run = await runAgentSession(card({ stage: 'building' }), role(), repo, h.db.studio, sessionDeps(h));
    expect(run).toMatchObject({ outcome: 'adapter_paused', failingCheck: 'read_token', turns: 0 });
    expect(h.client.sessions_).toEqual([]);
    expect(h.db.ledger).toEqual([]);
    expect(h.alert.messages).toEqual([]);
  });

  it("ends as tier_cap when the session create meets the usage tier's cap, so the pipeline pauses the studio", async () => {
    const h = harness();
    h.db.studio.agent_mode = 'unattended';
    h.client.failCreate = Anthropic.APIError.generate(429, { type: 'error', error: { type: 'rate_limit_error', message: TIER_MESSAGE } }, undefined, new Headers());
    const run = await runAgentSession(card({ stage: 'building' }), role(), repo, h.db.studio, sessionDeps(h));
    expect(run.outcome).toBe('tier_cap');
    expect(h.db.ledger).toEqual([]);
  });

  it('ends as tier_cap when a running session reports the cap in a session.error event, keeping its error code', async () => {
    const h = harness();
    h.db.studio.agent_mode = 'unattended';
    h.client.react = (session, event) => {
      if (event.type === 'user.message') {
        session.emit(
          { type: 'session.status_running' },
          // error_code is a field the SDK's session.error types do not name; the adapter keeps it.
          { type: 'session.error', error: { type: 'model_request_failed_error', message: 'model request failed', retry_status: { type: 'terminal' }, error_code: 'enforced_spend_limit_reached' } as never },
        );
      }
      if (event.type === 'user.interrupt') session.emit({ type: 'session.status_idle', stop_reason: { type: 'end_turn' } });
    };
    const run = await runAgentSession(card({ stage: 'building' }), role(), repo, h.db.studio, sessionDeps(h));
    expect(run.outcome).toBe('tier_cap');
    expect(sentTypes(h.client)).toContain('user.interrupt');
    expect(h.db.events.some((e) => e.type === 'error' && String(e.payload.message).includes('enforced_spend_limit_reached'))).toBe(true);
  });
});
