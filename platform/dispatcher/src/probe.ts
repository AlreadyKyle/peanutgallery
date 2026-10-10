// Probe command: prints the verdict as the first line, PASS: or FAIL:, with the details after it.
// - Attended mode runs the one-turn Claude Code probe on the founder's subscription, meters nothing,
//   and saves a passing run's raw stream as test/fixtures/probe.jsonl (paths replaced); a failing
//   run's stream goes to the temp directory for diagnosis and is never committed.
// - Unattended mode runs what startup runs: the containment check, then one minimal Managed Agents
//   session billed as overhead (docs/specs/launch-managed.md).
// - Unattended with --toolchain runs the one-time cutover check instead: a session with the
//   repository mounted at main's head runs the seed gate's commands once, and their output is read
//   back and checked (node 22 or later, pnpm 11.0.9, the install and the seed bot exiting 0). Billed
//   as overhead.
// - Unattended with --role runs the role probe instead (role-probe.ts): one tiny reader session, as a
//   Director's visual review runs, on the Director's model (MODEL_DIRECTOR, else MODEL_BUILDER), that
//   must hold read, glob and grep only and read a mounted PNG fixture back as one word. Billed as
//   overhead.
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createAdapter } from './adapters/factory.js';
import { ManagedAdapter } from './adapters/managed.js';
import { createAlerter } from './alert.js';
import { loadConfig } from './config.js';
import { createSupabaseDb } from './db.js';
import { errorMessage, logLine, type LogFields, type Logger, type LogLevel } from './log.js';
import { round4 } from './pricing.js';
import { initRecord, runProbe } from './probe-core.js';
import { runRoleProbe } from './role-probe.js';
import { fetchMain, gitAuthEnv } from './worktree.js';

const CODE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const FIXTURE = path.join(CODE_ROOT, 'platform', 'dispatcher', 'test', 'fixtures', 'probe.jsonl');

// The init line names what the session can reach beyond the prompt: tools, memory paths,
// skills, sub-agent definitions, MCP servers and the account it bills. Printed so the board
// can read it.
function reportInit(init: Record<string, unknown> | null, details: string[]): void {
  if (!init) return;
  for (const key of ['tools', 'memory_paths', 'skills', 'agents', 'mcp_servers', 'plugins', 'model', 'permissionMode', 'apiKeySource']) {
    details.push(`probe: init ${key}=${JSON.stringify(init[key] ?? null)}`);
  }
}

// Log lines are held with the details so nothing is printed before the verdict.
function detailLogger(details: string[]): Logger {
  const write = (level: LogLevel) => (scope: string, message: string, fields?: LogFields) => {
    details.push(logLine(new Date().toISOString(), level, scope, message, fields));
  };
  return { info: write('info'), warn: write('warn'), error: write('error') };
}

async function attendedVerdict(details: string[]): Promise<string> {
  const config = loadConfig(process.env, CODE_ROOT);
  const adapter = createAdapter(config);
  const raw: string[] = [];
  details.push(`probe: mode ${adapter.mode}; ANTHROPIC_BASE_URL is ${process.env.ANTHROPIC_BASE_URL ? 'set' : 'not set'} in the dispatcher environment`);
  const probe = await runProbe(adapter, {
    repoRoot: config.repoRoot,
    worktreeRoot: config.worktreeRoot,
    model: config.modelBuilder,
    priceTable: config.priceTable,
    onRawLine: (line) => raw.push(line),
  });
  reportInit(initRecord(raw), details);
  const meteredUsd = round4(probe.metering.rows.reduce((total, row) => total + row.usd, 0));
  details.push(`probe: priced at ${meteredUsd} USD at PRICE_TABLE_JSON on a ${probe.metering.basis} basis (${probe.metering.rows.length} rows); the command line reported ${probe.costUsd ?? 'no'} USD`);
  details.push('probe: attended mode runs on the subscription; nothing metered');
  const target = probe.ok ? FIXTURE : path.join(os.tmpdir(), `backseat-probe-${Date.now()}.jsonl`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, raw.length > 0 ? `${raw.join('\n')}\n` : '', 'utf8');
  details.push(`probe: raw stream saved to ${target} (${raw.length} lines)`);
  if (!probe.ok) return `FAIL: probe ${probe.reason} (claude exit ${probe.exitCode ?? 'signal'})`;
  return `PASS: probe mode=${adapter.mode} apiKeySource=${probe.apiKeySource ?? 'unreported'} tools=${probe.tools.join(',')} turns=${probe.turns} cost_usd=${probe.costUsd ?? 'unreported'}`;
}

type UnattendedProbe = 'startup' | 'toolchain' | 'role';

async function unattendedVerdict(details: string[], which: UnattendedProbe): Promise<string> {
  const config = loadConfig(process.env, CODE_ROOT);
  const log = detailLogger(details);
  const db = createSupabaseDb(config.supabaseUrl, config.supabaseServiceRoleKey);
  const alert = createAlerter({ healthcheckUrl: null, ntfyTopicUrl: config.ntfyTopicUrl, log });
  const adapter = createAdapter(config, { db, alert, log, patches: null });
  if (!(adapter instanceof ManagedAdapter)) return 'FAIL: probe unattended mode did not build the managed adapter';
  await adapter.checkContainment();
  if (which === 'role') {
    const model = config.modelDirector ?? config.modelBuilder;
    const report = await runRoleProbe(adapter, { codeRoot: CODE_ROOT, model });
    details.push(`role: session=${report.sessionId ?? 'none'} tools=${report.tools.join(',')} tool_calls=${report.toolCalls.join('; ') || 'none'} turns=${report.turns} answer=${JSON.stringify(report.answer.slice(0, 80))}`);
    if (!report.ok) return `FAIL: role ${report.reason}`;
    return `PASS: role model=${model} tools=${report.tools.join(',')} answer=${report.answer.trim()} billed_to=overhead`;
  }
  if (which === 'startup') {
    await adapter.probe();
    return `PASS: probe mode=unattended apiKeySource=ANTHROPIC_API_KEY agent=${config.managed?.agentId} version=${config.managed?.agentVersion} environment=${config.managed?.environmentId} billed_to=overhead`;
  }
  const mainSha = await fetchMain(config.repoRoot, gitAuthEnv(config.githubToken));
  const report = await adapter.toolchain(mainSha);
  for (const [key, value] of Object.entries(report.lines)) details.push(`toolchain: ${key}=${value}`);
  if (!report.ok) return `FAIL: toolchain ${report.reason} (main ${mainSha.slice(0, 8)})`;
  return `PASS: toolchain main=${mainSha.slice(0, 8)} node=${report.lines.node} pnpm=${report.lines.pnpm} install_exit=0 bot_exit=0 billed_to=overhead`;
}

async function probeVerdict(details: string[]): Promise<string> {
  loadDotenv({ path: path.join(CODE_ROOT, '.env'), quiet: true });
  const toolchain = process.argv.includes('--toolchain');
  const role = process.argv.includes('--role');
  if (toolchain && role) return 'FAIL: probe takes --toolchain or --role, not both';
  if ((process.env.AGENT_MODE ?? 'attended') === 'unattended') return unattendedVerdict(details, toolchain ? 'toolchain' : role ? 'role' : 'startup');
  if (toolchain) return 'FAIL: --toolchain checks the Managed Agents container; run it with AGENT_MODE=unattended';
  if (role) return 'FAIL: --role checks a Managed Agents reader session; run it with AGENT_MODE=unattended';
  return attendedVerdict(details);
}

async function main(): Promise<number> {
  const details: string[] = [];
  let verdict: string;
  try {
    verdict = await probeVerdict(details);
  } catch (error) {
    verdict = `FAIL: probe ${errorMessage(error)}`;
  }
  process.stdout.write(`${[verdict, ...details].join('\n')}\n`);
  return verdict.startsWith('PASS:') ? 0 : 1;
}

main().then((code) => process.exit(code));
