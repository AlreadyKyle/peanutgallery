// Probe command: runs the one-turn probe with the adapter the environment selects and prints the
// verdict as the first line, PASS: or FAIL:, with the details after it. In unattended mode the
// probe bills the studio key, so it is metered to the ledger before the verdict, as at startup;
// attended mode runs on the subscription and is not metered. A passing run's raw stream becomes
// test/fixtures/probe.jsonl (paths replaced); a failing run's stream is written to the temp
// directory for diagnosis and never committed.
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createAdapter } from './adapters/factory.js';
import { loadConfig } from './config.js';
import { createSupabaseDb } from './db.js';
import { errorMessage, logLine, type LogFields, type Logger, type LogLevel } from './log.js';
import { initRecord, runProbe } from './probe-core.js';
import { meterProbe } from './startup.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const FIXTURE = path.join(REPO_ROOT, 'platform', 'dispatcher', 'test', 'fixtures', 'probe.jsonl');

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

// Runs the probe and returns the verdict line; every other line goes to details.
async function probeVerdict(details: string[]): Promise<string> {
  loadDotenv({ path: path.join(REPO_ROOT, '.env'), quiet: true });
  const config = loadConfig(process.env, REPO_ROOT);
  const adapter = createAdapter(config);
  const raw: string[] = [];
  details.push(`probe: mode ${adapter.mode}; ANTHROPIC_BASE_URL is ${process.env.ANTHROPIC_BASE_URL ? 'set' : 'not set'} in the dispatcher environment`);
  const probe = await runProbe(adapter, { repoRoot: REPO_ROOT, worktreeRoot: config.worktreeRoot, model: config.modelBuilder, onRawLine: (line) => raw.push(line) });
  reportInit(initRecord(raw), details);
  let meterError: string | null = null;
  if (adapter.mode === 'unattended') {
    try {
      await meterProbe(createSupabaseDb(config.supabaseUrl, config.supabaseServiceRoleKey), config, probe, detailLogger(details));
    } catch (error) {
      meterError = errorMessage(error);
      details.push(`probe: not metered: ${meterError}`);
    }
  } else {
    details.push('probe: attended mode runs on the subscription; nothing metered');
  }
  const target = probe.ok ? FIXTURE : path.join(os.tmpdir(), `backseat-probe-${Date.now()}.jsonl`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, raw.length > 0 ? `${raw.join('\n')}\n` : '', 'utf8');
  details.push(`probe: raw stream saved to ${target} (${raw.length} lines)`);
  if (!probe.ok) return `FAIL: probe ${probe.reason} (claude exit ${probe.exitCode ?? 'signal'})`;
  if (meterError !== null) return `FAIL: probe passed but was not metered: ${meterError}`;
  return `PASS: probe mode=${adapter.mode} apiKeySource=${probe.apiKeySource ?? 'unreported'} tools=${probe.tools.join(',')} turns=${probe.turns} cost_usd=${probe.costUsd ?? 'unreported'}`;
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
