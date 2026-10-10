// The replay eval set (docs/specs/agent-upkeep.md, platform/agents/evals/README.md), run by a person
// at the Mac: pnpm eval:replay -- --set draft --k 3.
// - After loading .env it deletes STUDIO_ANTHROPIC_API_KEY and ANTHROPIC_API_KEY from its own
//   environment, so its sessions can only sign in with the founder's Claude login (the Max plan).
// - It refuses when CI or GITHUB_ACTIONS is set or AGENT_MODE is unattended: it runs attended only.
// - It writes no database row: the sessions run through the real attended adapter (with the Claude
//   Code pin) and the draft handler's own steps, against an in-memory store that refuses every other
//   call.
// - It runs each case k times. A case passes when all k runs meet its expectation; pass^k for a set
//   is the share of its cases that pass. It writes platform/agents/evals/results/<UTC stamp>.json
//   with the commit, the CLI version, the model ids and pass^k per set, and exits 1 when a set is
//   below baseline.json.
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import { promisify } from 'node:util';
import { config as loadDotenv } from 'dotenv';
import { AttendedAdapter } from '../adapters/attended.js';
import { claudeVersionReader, defaultCliPin, parseClaudeVersion } from '../cli-pin.js';
import { loadConfig, type DispatcherConfig } from '../config.js';
import type { Db, DraftFields, DraftTarget, OpenCardRow, RecordUsageResult, Role, StudioState, UsageInput } from '../db.js';
import { draftCard, directorPrompt, type DraftVerdict } from '../job-handlers/draft-card.js';
import { gitWorkspace, sessionDeps, type WorkflowDeps } from '../job-handlers/workflow.js';
import type { JobContext } from '../jobs.js';
import { createLogger } from '../log.js';
import { scanPublicText } from '../public-text.js';
import { MODEL_TOKENS, resolveRoleModel } from '../role-model.js';
import { runRoleSession } from '../role-session.js';
import { AGENTS_DIR, TypedOutput } from '../typed-output.js';
import { gitAuthEnv } from '../worktree.js';
import type { CardDraft } from '../draft-checks.js';

const execFileAsync = promisify(execFile);

export const CODE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
export const EVALS_DIR = path.join(AGENTS_DIR, 'evals');
export const SETS = ['draft'] as const;
export type SetName = (typeof SETS)[number];
export const REMOVED_KEYS = ['STUDIO_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'] as const;

export interface DirectorCase {
  id: string;
  kind: 'director';
  note?: string;
  draft: CardDraft;
  open_cards?: unknown[];
  expect: { result: Array<DraftVerdict['result']>; reason_code?: string };
}

export interface DesignerCase {
  id: string;
  kind: 'designer';
  note?: string;
  input: Record<string, unknown>;
  expect: { approved_within_rounds: number };
}

export type EvalCase = DirectorCase | DesignerCase;

export interface SetResult {
  cases: number;
  k: number;
  pass_k: number;
  // Each case's runs that met its expectation, out of k.
  passes: Record<string, number>;
}

export interface EvalResult {
  commit: string;
  cli_version: string | null;
  model_ids: Record<string, string>;
  sets: Record<string, SetResult>;
}

export interface Baseline {
  sets: Record<string, number>;
  reason?: string;
}

// Deletes the API keys, so no session can bill one.
export function removeApiKeys(env: NodeJS.ProcessEnv): void {
  for (const key of REMOVED_KEYS) delete env[key];
}

// Why this environment may not run the replay, or null.
export function refusal(env: NodeJS.ProcessEnv): string | null {
  if (env.CI) return 'CI is set: the replay runs attended, at the Mac, never in CI';
  if (env.GITHUB_ACTIONS) return 'GITHUB_ACTIONS is set: the replay runs attended, at the Mac, never in Actions';
  if ((env.AGENT_MODE ?? '').trim() === 'unattended') return 'AGENT_MODE is unattended: the replay runs attended, on the founder plan';
  return null;
}

export function parseArgs(argv: readonly string[]): { set: SetName; k: number } {
  const args = argv.filter((arg) => arg !== '--');
  const value = (flag: string) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const set = value('--set');
  if (!set || !(SETS as readonly string[]).includes(set)) throw new Error(`--set must be one of ${SETS.join(', ')}`);
  const k = Number(value('--k') ?? '3');
  if (!Number.isInteger(k) || k < 1 || k > 10) throw new Error('--k must be a whole number from 1 to 10');
  return { set: set as SetName, k };
}

export function validCase(value: unknown, file: string): EvalCase {
  const c = value as Partial<EvalCase> & Record<string, unknown>;
  if (typeof c.id !== 'string' || c.id === '') throw new Error(`${file}: a case needs an id`);
  if (c.kind === 'director') {
    const expect = c.expect as DirectorCase['expect'] | undefined;
    if (typeof c.draft !== 'object' || c.draft === null) throw new Error(`${file}: a director case needs a draft`);
    if (!expect || !Array.isArray(expect.result) || expect.result.length === 0) throw new Error(`${file}: a director case expects one or more results`);
    return c as DirectorCase;
  }
  if (c.kind === 'designer') {
    const expect = c.expect as DesignerCase['expect'] | undefined;
    if (typeof c.input !== 'object' || c.input === null) throw new Error(`${file}: a designer case needs an input`);
    if (!expect || !Number.isInteger(expect.approved_within_rounds)) throw new Error(`${file}: a designer case expects approval within a number of rounds`);
    return c as DesignerCase;
  }
  throw new Error(`${file}: kind must be director or designer`);
}

export async function loadCases(set: SetName, dir: string = EVALS_DIR): Promise<EvalCase[]> {
  const folder = path.join(dir, 'cases', set);
  const files = (await readdir(folder)).filter((file) => file.endsWith('.json')).sort();
  const cases: EvalCase[] = [];
  for (const file of files) cases.push(validCase(JSON.parse(await readFile(path.join(folder, file), 'utf8')), file));
  if (cases.length === 0) throw new Error(`no cases in ${folder}`);
  return cases;
}

// Whether a Director's verdict meets a director case's expectation.
export function directorPass(expect: DirectorCase['expect'], verdict: DraftVerdict): boolean {
  if (!expect.result.includes(verdict.result)) return false;
  return expect.reason_code === undefined || verdict.reason_codes.includes(expect.reason_code);
}

// Whether a draft_card run's output meets a designer case's expectation.
export function designerPass(expect: DesignerCase['expect'], output: Record<string, unknown> | void): boolean {
  if (!output || output.result !== 'approved') return false;
  const rounds = Array.isArray(output.rounds) ? output.rounds.length : Number.POSITIVE_INFINITY;
  return rounds <= expect.approved_within_rounds;
}

export interface Runners {
  // One Director session on the case's frozen draft; its verdict.
  director(c: DirectorCase, run: string): Promise<DraftVerdict>;
  // One draft_card run from the case's input; the handler's output.
  designer(c: DesignerCase, run: string): Promise<Record<string, unknown> | void>;
}

// Runs every case k times. A run that throws counts as a failed run.
export async function runSet(cases: readonly EvalCase[], k: number, runners: Runners, log: (line: string) => void = () => undefined): Promise<SetResult> {
  const passes: Record<string, number> = {};
  for (const c of cases) {
    passes[c.id] = 0;
    for (let i = 1; i <= k; i += 1) {
      const run = `eval-${c.id}-${i}`;
      let ok = false;
      try {
        ok = c.kind === 'director' ? directorPass(c.expect, await runners.director(c, run)) : designerPass(c.expect, await runners.designer(c, run));
      } catch (error) {
        log(`${run}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (ok) passes[c.id] = (passes[c.id] ?? 0) + 1;
      log(`${run}: ${ok ? 'pass' : 'fail'}`);
    }
  }
  const allPassed = cases.filter((c) => passes[c.id] === k).length;
  return { cases: cases.length, k, pass_k: Math.round((allPassed / cases.length) * 10_000) / 10_000, passes };
}

// The sets below their baseline, named; a set the baseline has and the result lacks is below it.
export function belowBaseline(result: Pick<EvalResult, 'sets'>, baseline: Baseline | null): string[] {
  if (baseline === null) return [];
  return Object.entries(baseline.sets)
    .filter(([name, floor]) => !(result.sets[name] && result.sets[name]!.pass_k >= floor))
    .map(([name, floor]) => `${name} ${result.sets[name]?.pass_k ?? 'missing'} < ${floor}`);
}

export function resultStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function readBaseline(dir: string): Promise<Baseline | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, 'baseline.json'), 'utf8')) as Baseline;
  } catch {
    return null;
  }
}

// Writes the result file and compares it with the baseline; the exit code.
export async function replay(options: { set: SetName; k: number; cases: readonly EvalCase[]; runners: Runners; meta: Omit<EvalResult, 'sets'>; dir?: string; now?: Date; log?: (line: string) => void }): Promise<{ file: string; result: EvalResult; below: string[]; exitCode: number }> {
  const dir = options.dir ?? EVALS_DIR;
  const set = await runSet(options.cases, options.k, options.runners, options.log);
  const result: EvalResult = { ...options.meta, sets: { [options.set]: set } };
  await mkdir(path.join(dir, 'results'), { recursive: true });
  const file = path.join(dir, 'results', `${resultStamp(options.now ?? new Date())}.json`);
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
  const below = belowBaseline(result, await readBaseline(dir));
  return { file, result, below, exitCode: below.length === 0 ? 0 : 1 };
}

// The replay's only store: what the draft handler and a role session call, in memory. Any other
// call throws, so the replay writes no database row.
export function inMemoryStore(roles: readonly Role[], studio: StudioState, openCards: readonly OpenCardRow[] = []): Db {
  let drafts = 0;
  const allowed = {
    async getStudioState() {
      return { ...studio };
    },
    async listActiveRoles() {
      return roles.map((role) => ({ ...role }));
    },
    async openCards() {
      return openCards.map((card) => ({ ...card }));
    },
    // A new card for every run, as the supply's draft opens one when no backlog card is eligible.
    async openDraftCard(run: string): Promise<DraftTarget> {
      return {
        cardId: `eval-card-${run}`,
        kind: 'new',
        opened: 'new',
        card: { title: 'A game card the Game Designer is drafting', summary: null, intent: null, horizon: 'next', rank: null, funded_usd: 0, severity: null },
      };
    },
    async cardSpend() {
      return new Map<string, number>();
    },
    async recordCardDraft(_card: string, _run: string, _role: string, _fields: DraftFields, _ref: string) {
      drafts += 1;
      return { id: `eval-draft-${drafts}`, content_sha256: '0'.repeat(64) };
    },
    async withdrawCardDraft() {},
    async rejectDraftCard() {},
    async approveCardDraft(draftId: string) {
      return `eval-card-for-${draftId}`;
    },
    async recordUsage(_input: UsageInput): Promise<RecordUsageResult> {
      return { ledger_id: 'eval', balance_usd: 0, daily_spent_usd: 0, actual_usd: 0 };
    },
    async boardSessionActive() {
      return true;
    },
    async roleState() {
      return { paused: false, state: 'active' };
    },
  };
  return new Proxy(allowed, {
    get(target, name) {
      if (name in target) return target[name as keyof typeof target];
      if (name === 'then') return undefined;
      return () => {
        throw new Error(`the replay writes no database row; ${String(name)} is not called`);
      };
    },
  }) as unknown as Db;
}

// The role specs as roles, each with its spec's model token.
export async function specRoles(agentsDir: string = AGENTS_DIR): Promise<Role[]> {
  const files = (await readdir(agentsDir)).filter((file) => file.endsWith('.json'));
  const roles: Role[] = [];
  for (const file of files) {
    const spec = JSON.parse(await readFile(path.join(agentsDir, file), 'utf8')) as Record<string, unknown>;
    roles.push({
      id: `eval-${file.replace(/\.json$/, '')}`,
      name: String(spec.name),
      title: String(spec.title),
      model: String(spec.model),
      prompt_path: String(spec.prompt_path),
      tools_json: spec.tools,
      write_access: spec.write_access === true,
      agent_class: typeof spec.class === 'string' ? spec.class : null,
      paused: false,
    });
  }
  return roles;
}

// The runners: the draft handler's own steps and a Director session on a frozen draft, through the
// workflow's attended adapter, against the in-memory store, each run in a scratch checkout of main.
export function draftRunners(workflow: WorkflowDeps, roles: readonly Role[], studio: StudioState, stop: AbortSignal): Runners {
  const log = createLogger(new Writable({ write: (_c, _e, cb) => cb() }));
  const typed = workflow.typed;
  const adapter = workflow.adapter;
  const db = inMemoryStore(roles, studio);
  const role = (name: string) => {
    const found = roles.find((r) => r.name === name);
    if (!found) throw new Error(`no role spec for ${name}`);
    return found;
  };
  const context = (run: string, input: Record<string, unknown>, jobRole: Role): JobContext => ({
    run: { id: run, job_name: 'draft_card', origin: 'board', status: 'running', card_id: null, input, parent_run_id: null, created_at: new Date().toISOString() },
    job: { name: 'draft_card', role_id: jobRole.id, calls_model: true, runs_when_paused: false, enabled: true },
    role: jobRole,
    mode: 'attended',
    db,
    adapter,
    log,
    alert: { ping: async () => undefined, notify: async () => undefined, notifyOnce: async () => undefined, forget: () => undefined },
    stopSignal: stop,
    now: () => new Date(),
    workflow,
  });
  return {
    async director(c, run) {
      const director = role('Game Director');
      const deps = sessionDeps(context(run, {}, director), workflow);
      const workspace = await workflow.openWorkspace(run);
      try {
        const rubric = await workflow.rubric();
        const graded = await runRoleSession<DraftVerdict>(
          { role: director, runId: run, label: 'director-1', worktree: workspace.path, prompt: directorPrompt(run, 1, c.draft, [], rubric, typed), schema: 'draft-verdict', budgetUsd: studio.card_max_usd },
          deps,
        );
        if (!graded.ok) throw new Error(`the Game Director's session failed: ${graded.reason}`);
        return graded.value;
      } finally {
        await workspace.close();
      }
    },
    async designer(c, run) {
      return draftCard(context(run, c.input, role('Game Designer')));
    },
  };
}

// The real attended adapter, with the Claude Code pin: the replay is the attended adapter's one use
// (docs/specs/unattended-roles.md), on the founder's login with no database row, so its workflow alone
// allows it. No money is read: nothing is billed to a card.
function liveWorkflow(config: DispatcherConfig): WorkflowDeps {
  return {
    adapter: new AttendedAdapter({ claudeBin: config.claudeBin, repoRoot: config.repoRoot, codeRoot: config.codeRoot, cliPin: defaultCliPin(config.codeRoot, config.claudeBin) }),
    allowAttended: true,
    draftSessionMaxUsd: config.cardMaxUsd,
    typed: new TypedOutput(),
    priceTable: config.priceTable,
    resolveModel: (role) => resolveRoleModel(role, config).model,
    sessionMaxTurns: config.sessionMaxTurns,
    sessionMaxMs: config.sessionMaxMinutes * 60_000,
    watchIntervalMs: config.tickMs,
    scanText: (strings) => scanPublicText(strings),
    openWorkspace: (runId) => gitWorkspace(config.repoRoot, config.worktreeRoot, runId, gitAuthEnv(config.githubToken)),
    rubric: () => readFile(path.join(AGENTS_DIR, 'rubrics', 'draft-game.md'), 'utf8'),
  };
}

async function main(): Promise<void> {
  loadDotenv({ path: path.join(CODE_ROOT, '.env'), quiet: true });
  removeApiKeys(process.env);
  const refused = refusal(process.env);
  if (refused) {
    process.stderr.write(`eval:replay refused: ${refused}\n`);
    process.exit(2);
  }
  const { set, k } = parseArgs(process.argv.slice(2));
  const config = loadConfig({ ...process.env, AGENT_MODE: 'attended' }, CODE_ROOT);
  const cases = await loadCases(set);
  const roles = await specRoles();
  const studio: StudioState = {
    paused: false,
    agent_mode: 'attended',
    daily_cap_usd: 0,
    card_max_usd: config.cardMaxUsd,
    agent_hourly_rate_usd: 0,
    studio_reserve_usd: 0,
    monthly_cap_usd: null,
    anthropic_tier_cap_usd: null,
    platform_lane_open: false,
  };
  const commit = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: CODE_ROOT })).stdout.trim();
  const cliVersion = parseClaudeVersion(await claudeVersionReader(config.claudeBin)());
  const modelIds: Record<string, string> = {};
  for (const token of MODEL_TOKENS) {
    const value = process.env[token]?.trim();
    if (value) modelIds[token] = value;
  }
  const stop = new AbortController();
  process.once('SIGINT', () => stop.abort('stopped'));
  const outcome = await replay({
    set,
    k,
    cases,
    runners: draftRunners(liveWorkflow(config), roles, studio, stop.signal),
    meta: { commit, cli_version: cliVersion, model_ids: modelIds },
    log: (line) => process.stdout.write(`${line}\n`),
  });
  process.stdout.write(`${set}: pass^${k} ${outcome.result.sets[set]!.pass_k} over ${outcome.result.sets[set]!.cases} cases; result ${path.relative(CODE_ROOT, outcome.file)}\n`);
  if (outcome.below.length > 0) process.stdout.write(`below baseline: ${outcome.below.join('; ')}\n`);
  process.exit(outcome.exitCode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    process.stderr.write(`eval:replay: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
