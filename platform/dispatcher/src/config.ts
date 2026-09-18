// Environment parsing for the dispatcher. Every value is validated by hand; a missing or
// malformed value stops the process before any tick runs.
import path from 'node:path';
import { modelPrice, parsePriceTable, type PriceTable } from './pricing.js';
import type { AgentMode } from './throttle.js';

export interface DispatcherConfig {
  repoRoot: string;
  agentMode: AgentMode;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  githubToken: string;
  githubRepo: string;
  netlifyAuthToken: string;
  netlifySiteIdSeed: string;
  netlifySiteIdPlatform: string;
  modelBuilder: string;
  // The director and host models, when set. Nothing in the dispatcher runs them yet; they are
  // checked against the price table so a role seeded with one can be metered.
  modelDirector: string | null;
  modelHost: string | null;
  priceTable: PriceTable;
  poolDailyCapUsd: number;
  cardMaxUsd: number;
  sessionMaxTurns: number;
  // The longest one agent session may run before it is interrupted.
  sessionMaxMinutes: number;
  agentHourlyRateUsd: number;
  tickMs: number;
  worktreeRoot: string;
  maxConcurrency: number;
  schedulerEnabled: boolean;
  claudeBin: string;
  boardSessionTtlMin: number;
  // The studio organisation's key for unattended sessions; null in attended mode, where the
  // value is ignored. Never the founder's ANTHROPIC_API_KEY, which the dispatcher does not read.
  studioAnthropicApiKey: string | null;
  // Optional board alerts: pinged every tick, and posted to when a card needs a human.
  healthcheckUrl: string | null;
  ntfyTopicUrl: string | null;
}

// A missing or malformed value cannot fix itself on a restart, so it is fatal: the process exits
// 78 and systemd does not restart it (exit-code.ts).
export class ConfigError extends Error {
  readonly fatal = true;
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export type Env = Record<string, string | undefined>;

export function requireEnv(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`${name} is not set`);
  return value;
}

export function optionalEnv(env: Env, name: string, fallback: string): string {
  const value = env[name]?.trim();
  return value ? value : fallback;
}

export function numberEnv(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new ConfigError(`${name} must be a non-negative number`);
  return value;
}

export function positiveIntegerEnv(env: Env, name: string, fallback: number): number {
  const value = numberEnv(env, name, fallback);
  if (!Number.isInteger(value) || value < 1) throw new ConfigError(`${name} must be a positive integer`);
  return value;
}

// An optional https URL; unset or blank is null.
export function optionalHttpsUrlEnv(env: Env, name: string): string | null {
  const value = env[name]?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${name} must be an https URL`);
  }
  if (url.protocol !== 'https:') throw new ConfigError(`${name} must be an https URL`);
  return value;
}

export function agentModeEnv(env: Env): AgentMode {
  const mode = optionalEnv(env, 'AGENT_MODE', 'attended');
  if (mode !== 'attended' && mode !== 'unattended') throw new ConfigError('AGENT_MODE must be attended or unattended');
  return mode;
}

const GITHUB_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const STUDIO_KEY = 'STUDIO_ANTHROPIC_API_KEY';
const FOUNDER_KEY = 'ANTHROPIC_API_KEY';

// Required in unattended mode, null in attended mode. A studio key equal to the founder's key
// is refused in either mode: the whole point of the second name is that they differ.
export function studioApiKeyEnv(env: Env, mode: AgentMode): string | null {
  const studio = env[STUDIO_KEY]?.trim();
  const founder = env[FOUNDER_KEY]?.trim();
  if (studio && founder && studio === founder) throw new ConfigError(`${STUDIO_KEY} must differ from ${FOUNDER_KEY}`);
  if (mode !== 'unattended') return null;
  return requireEnv(env, STUDIO_KEY);
}

// parsePriceTable is shared with code that is not configuration, so its plain errors are
// rethrown here as ConfigError with the same message.
export function priceTableEnv(env: Env): PriceTable {
  const raw = requireEnv(env, 'PRICE_TABLE_JSON');
  try {
    return parsePriceTable(raw);
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : String(error));
  }
}

// A model id with no row in the price table could not be metered, so it stops the process here
// rather than at the first turn. Blank is null.
export function pricedModel(model: string, name: string, table: PriceTable): string | null {
  if (!model) return null;
  if (!modelPrice(table, model)) throw new ConfigError(`${name} has no row in PRICE_TABLE_JSON`);
  return model;
}

export function loadConfig(env: Env, repoRoot: string): DispatcherConfig {
  const githubRepo = requireEnv(env, 'GITHUB_REPO');
  if (!GITHUB_REPO.test(githubRepo)) throw new ConfigError('GITHUB_REPO must be owner/repo');
  const scheduler = optionalEnv(env, 'DISPATCHER_SCHEDULER', 'on');
  if (scheduler !== 'on' && scheduler !== 'off') throw new ConfigError('DISPATCHER_SCHEDULER must be on or off');
  const agentMode = agentModeEnv(env);
  const modelBuilder = requireEnv(env, 'MODEL_BUILDER');
  const priceTable = priceTableEnv(env);
  pricedModel(modelBuilder, 'MODEL_BUILDER', priceTable);
  return {
    repoRoot,
    agentMode,
    supabaseUrl: requireEnv(env, 'SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    githubToken: requireEnv(env, 'GITHUB_TOKEN'),
    githubRepo,
    netlifyAuthToken: requireEnv(env, 'NETLIFY_AUTH_TOKEN'),
    netlifySiteIdSeed: requireEnv(env, 'NETLIFY_SITE_ID_SEED'),
    netlifySiteIdPlatform: requireEnv(env, 'NETLIFY_SITE_ID_PLATFORM'),
    modelBuilder,
    modelDirector: pricedModel(optionalEnv(env, 'MODEL_DIRECTOR', ''), 'MODEL_DIRECTOR', priceTable),
    modelHost: pricedModel(optionalEnv(env, 'MODEL_HOST', ''), 'MODEL_HOST', priceTable),
    priceTable,
    poolDailyCapUsd: numberEnv(env, 'POOL_DAILY_CAP_USD', 100),
    cardMaxUsd: numberEnv(env, 'CARD_MAX_USD', 25),
    sessionMaxTurns: positiveIntegerEnv(env, 'SESSION_MAX_TURNS', 60),
    sessionMaxMinutes: positiveIntegerEnv(env, 'SESSION_MAX_MINUTES', 60),
    agentHourlyRateUsd: numberEnv(env, 'AGENT_HOURLY_RATE_USD', 5),
    tickMs: positiveIntegerEnv(env, 'DISPATCHER_TICK_MS', 60_000),
    worktreeRoot: path.resolve(repoRoot, optionalEnv(env, 'DISPATCHER_WORKTREE_ROOT', '.worktrees')),
    maxConcurrency: positiveIntegerEnv(env, 'DISPATCHER_MAX_CONCURRENCY', 1),
    schedulerEnabled: scheduler === 'on',
    claudeBin: optionalEnv(env, 'CLAUDE_BIN', 'claude'),
    boardSessionTtlMin: positiveIntegerEnv(env, 'BOARD_SESSION_TTL_MIN', 3),
    studioAnthropicApiKey: studioApiKeyEnv(env, agentMode),
    healthcheckUrl: optionalHttpsUrlEnv(env, 'HEALTHCHECK_URL'),
    ntfyTopicUrl: optionalHttpsUrlEnv(env, 'NTFY_TOPIC_URL'),
  };
}
