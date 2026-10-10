// Environment parsing for the dispatcher. Every value is validated by hand; a missing or
// malformed value stops the process before any tick runs. The dispatcher has one mode, unattended
// (PLAN.md §10 decision 66, docs/specs/unattended-roles.md): AGENT_MODE=attended is warned about and
// otherwise ignored. The hand-run tools that still run attended on the founder's login (the replay
// eval and the probe's --attended run) load their values with loadHandRunConfig.
import path from 'node:path';
import { modelPrice, parsePriceTable, type PriceTable } from './pricing.js';

export interface DispatcherConfig {
  // The checkout the dispatcher's own code and node_modules are loaded from.
  codeRoot: string;
  // DISPATCHER_CODE_READONLY=required: startup refuses a code root this process can write to.
  codeReadonly: boolean;
  // The clone git fetches, pushes and adds worktrees from: the code root unless
  // DISPATCHER_REPO_ROOT names another. On the VPS it is a separate clone no code runs from.
  repoRoot: string;
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
  // The most a Director's visual review of one card's frames may spend per review, at list price
  // (docs/specs/design-review.md); its sessions also stay inside the card's ceiling and claim budget.
  visualReviewMaxUsd: number;
  // The most one draft_card session (a Game Designer round or a Game Director grade) may spend, at list
  // price (docs/specs/unattended-roles.md, PR4); it also stays under what the per-card maximum leaves
  // on the card it drafts.
  draftSessionMaxUsd: number;
  sessionMaxTurns: number;
  // The longest one agent session may run before it is interrupted.
  sessionMaxMinutes: number;
  agentHourlyRateUsd: number;
  tickMs: number;
  worktreeRoot: string;
  maxConcurrency: number;
  // The Claude Code command line the hand-run attended tools run (the replay eval, sandbox:check and
  // the probe's --attended run); the dispatcher runs no CLI.
  claudeBin: string;
  // The studio organisation's key, which every session bills; null only in a hand-run tool's
  // configuration (loadHandRunConfig). Never the founder's ANTHROPIC_API_KEY, which the dispatcher
  // does not read.
  studioAnthropicApiKey: string | null;
  // The Managed Agents agent, its pinned version and the environment every card session runs in, and
  // the read-only GitHub token sessions clone the repository with (docs/specs/launch-managed.md); null
  // or absent only in a hand-run tool's configuration.
  managed?: ManagedConfig | null;
  // Optional board alerts: pinged every tick, and posted to when a card needs a human.
  healthcheckUrl: string | null;
  ntfyTopicUrl: string | null;
  // The Discord webhooks the ship and weekly posts go to (docs/specs/studio-reports.md); null leaves
  // that lane inert. Each address is a bearer secret: never logged or printed.
  discordWebhookShips: string | null;
  discordWebhookWeekly: string | null;
  // The public site's origin, which the posts link to.
  publicSiteUrl: string;
  // DISPATCHER_DRAIN_AT: from this time the tick claims no new card or job, and the process exits 0
  // once nothing it started is still running (docs/specs/actions-host.md). Null or absent: never.
  drainAt?: Date | null;
}

export interface ManagedConfig {
  agentId: string;
  agentVersion: number;
  environmentId: string;
  readToken: string;
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

// Below this a visual review (or one batch of it) does not start: the card pauses at its ceiling or
// goes back to funded. It covers one managed session's withheld margin (one large request) with room
// to work, so a session never starts with less than a cent to spend.
export const VISUAL_REVIEW_MIN_USD = 0.35;

export function visualReviewMaxUsdEnv(env: Env): number {
  const value = numberEnv(env, 'VISUAL_REVIEW_MAX_USD', 1);
  if (value < VISUAL_REVIEW_MIN_USD) throw new ConfigError(`VISUAL_REVIEW_MAX_USD must be at least ${VISUAL_REVIEW_MIN_USD}`);
  return value;
}

// Below this a draft_card session does not start, for the same reason: one managed session's withheld
// margin with room to work.
export const DRAFT_SESSION_MIN_USD = 0.35;

export function draftSessionMaxUsdEnv(env: Env): number {
  const value = numberEnv(env, 'DRAFT_SESSION_MAX_USD', 0.75);
  if (value < DRAFT_SESSION_MIN_USD) throw new ConfigError(`DRAFT_SESSION_MAX_USD must be at least ${DRAFT_SESSION_MIN_USD}`);
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

// A Discord webhook address in any of Discord's forms. The token is the last part; a ConfigError names
// the key only, never the value.
export const DISCORD_WEBHOOK = /^https:\/\/((ptb|canary)[.])?discord(app)?[.]com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+$/;

// Optional; unset or blank is null. Set, it must be a Discord webhook address.
export function discordWebhookEnv(env: Env, name: string): string | null {
  const value = env[name]?.trim();
  if (!value) return null;
  if (!DISCORD_WEBHOOK.test(value)) throw new ConfigError(`${name} must be a Discord webhook address (https://discord.com/api/webhooks/<id>/<token>)`);
  return value;
}

export const DEFAULT_PUBLIC_SITE_URL = 'https://mobmachine.games';

// The public site's origin: https, with no path, query or fragment.
export function publicSiteUrlEnv(env: Env): string {
  const value = optionalEnv(env, 'PUBLIC_SITE_URL', DEFAULT_PUBLIC_SITE_URL);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError('PUBLIC_SITE_URL must be an https origin');
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    throw new ConfigError('PUBLIC_SITE_URL must be an https origin');
  }
  return url.origin;
}

// An ISO 8601 time with its zone (Z or an offset), as `date -u +%Y-%m-%dT%H:%M:%SZ` writes it; unset or
// blank is null. A time without a zone would be read in the host's own, so it is refused.
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function drainAtEnv(env: Env): Date | null {
  const value = env.DISPATCHER_DRAIN_AT?.trim();
  if (!value) return null;
  const time = Date.parse(value);
  if (!ISO_WITH_ZONE.test(value) || !Number.isFinite(time)) throw new ConfigError('DISPATCHER_DRAIN_AT must be an ISO 8601 time with its zone, such as 2026-01-01T05:00:00Z');
  return new Date(time);
}

// AGENT_MODE is no longer read: the dispatcher runs unattended only (PLAN.md §10 decision 66). A
// value other than unattended is the warning loadConfig gives, and is otherwise ignored, so an old
// .env never stops the process. The value is a mode name, not a secret.
export function agentModeWarning(env: Env): string | null {
  const mode = env.AGENT_MODE?.trim();
  if (!mode || mode === 'unattended') return null;
  if (mode === 'attended') return 'AGENT_MODE=attended is ignored: attended mode is retired and the dispatcher runs unattended only (PLAN.md §10 decision 66); remove AGENT_MODE from .env';
  return `AGENT_MODE=${mode} is ignored: the dispatcher runs unattended only (PLAN.md §10 decision 66); remove AGENT_MODE from .env`;
}

const GITHUB_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// A fine-grained personal access token: one repository, and only the permissions BOARD-SETUP.md
// names. A gh sign-in token (gho_) or a classic token (ghp_) reaches every repository the account can.
export const FINE_GRAINED_TOKEN_PREFIX = 'github_pat_';

// Why GITHUB_TOKEN is not a fine-grained token, or null when it is.
export function githubTokenProblem(token: string): string | null {
  if (token.startsWith(FINE_GRAINED_TOKEN_PREFIX)) return null;
  return `GITHUB_TOKEN is not a fine-grained token (${FINE_GRAINED_TOKEN_PREFIX}...); create one for this repository alone as BOARD-SETUP.md describes`;
}

// The dispatcher runs with no one watching, so it refuses a token that can reach more than this
// repository. A hand-run tool's configuration takes any token: the person running it is watching.
export function githubTokenEnv(env: Env, handRun = false): string {
  const token = requireEnv(env, 'GITHUB_TOKEN');
  const problem = githubTokenProblem(token);
  if (problem && !handRun) throw new ConfigError(problem);
  return token;
}
const STUDIO_KEY = 'STUDIO_ANTHROPIC_API_KEY';
const FOUNDER_KEY = 'ANTHROPIC_API_KEY';

// Required by the dispatcher, null in a hand-run tool's configuration. A studio key equal to the
// founder's key is refused either way: the whole point of the second name is that they differ.
export function studioApiKeyEnv(env: Env, handRun = false): string | null {
  const studio = env[STUDIO_KEY]?.trim();
  const founder = env[FOUNDER_KEY]?.trim();
  if (studio && founder && studio === founder) throw new ConfigError(`${STUDIO_KEY} must differ from ${FOUNDER_KEY}`);
  if (handRun) return null;
  return requireEnv(env, STUDIO_KEY);
}

// Fine-grained personal access tokens start with this. The dispatcher runs on no other kind, since a
// classic or OAuth token cannot be limited to this repository and its permissions.
export const FINE_GRAINED_PREFIX = 'github_pat_';

// Required by the dispatcher, null in a hand-run tool's configuration. The read token must differ
// from the write token either way, and the dispatcher's must both be fine-grained tokens. Startup then
// proves the read token cannot write (adapters/read-token.ts).
export function managedEnv(env: Env, githubToken: string, handRun = false): ManagedConfig | null {
  const read = env.GITHUB_READ_TOKEN?.trim();
  if (read && read === githubToken) throw new ConfigError('GITHUB_READ_TOKEN must differ from GITHUB_TOKEN: sessions clone with a token that cannot write');
  if (handRun) return null;
  const readToken = requireEnv(env, 'GITHUB_READ_TOKEN');
  const agentId = requireEnv(env, 'MANAGED_AGENT_ID');
  const version = Number(requireEnv(env, 'MANAGED_AGENT_VERSION'));
  if (!Number.isInteger(version) || version < 1) throw new ConfigError('MANAGED_AGENT_VERSION must be a positive integer');
  const environmentId = requireEnv(env, 'MANAGED_ENVIRONMENT_ID');
  for (const [name, token] of [
    ['GITHUB_TOKEN', githubToken],
    ['GITHUB_READ_TOKEN', readToken],
  ] as const) {
    if (!token.startsWith(FINE_GRAINED_PREFIX)) throw new ConfigError(`${name} must be a fine-grained personal access token (${FINE_GRAINED_PREFIX}...)`);
  }
  return { agentId, agentVersion: version, environmentId, readToken };
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

// True when target is root itself or a path inside it.
function inside(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export type Roots = Pick<DispatcherConfig, 'codeRoot' | 'codeReadonly' | 'repoRoot' | 'worktreeRoot'>;

// The default worktree root: a folder beside the clone, named after it (<clone>-worktrees), as the
// VPS's /srv/peanutgallery-worktrees sits beside its clone.
export function defaultWorktreeRoot(repoRoot: string): string {
  return path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-worktrees`);
}

// DISPATCHER_CODE_ROOT, when set, must name the checkout the process really runs from, or the
// read-only check would look at a folder the code is not loaded from. A read-only code root cannot
// hold the git state and the worktrees the dispatcher writes. Card worktrees live outside the clone,
// in every mode: a session started inside the clone would read the clone's own CLAUDE.md files and
// sit next to its .env, and a hand-run attended session's sandbox allows writes to the worktree alone.
export function rootsEnv(env: Env, codeRoot: string): Roots {
  const declared = optionalEnv(env, 'DISPATCHER_CODE_ROOT', '');
  if (declared && path.resolve(declared) !== path.resolve(codeRoot)) {
    throw new ConfigError(`DISPATCHER_CODE_ROOT is ${declared} but the dispatcher runs from ${codeRoot}`);
  }
  const readonly = optionalEnv(env, 'DISPATCHER_CODE_READONLY', 'off');
  if (readonly !== 'required' && readonly !== 'off') throw new ConfigError('DISPATCHER_CODE_READONLY must be required or off');
  const repoRoot = path.resolve(codeRoot, optionalEnv(env, 'DISPATCHER_REPO_ROOT', '.'));
  const declaredWorktrees = optionalEnv(env, 'DISPATCHER_WORKTREE_ROOT', '');
  const worktreeRoot = declaredWorktrees ? path.resolve(repoRoot, declaredWorktrees) : defaultWorktreeRoot(repoRoot);
  if (inside(worktreeRoot, repoRoot)) {
    throw new ConfigError(`DISPATCHER_WORKTREE_ROOT must be outside the repository clone ${repoRoot}; leave it unset for ${defaultWorktreeRoot(repoRoot)}`);
  }
  if (readonly === 'required') {
    const writable: Array<[string, string]> = [
      ['DISPATCHER_REPO_ROOT', repoRoot],
      ['DISPATCHER_WORKTREE_ROOT', worktreeRoot],
    ];
    for (const [name, target] of writable) {
      if (inside(target, path.resolve(codeRoot))) throw new ConfigError(`${name} must be outside the code root when DISPATCHER_CODE_READONLY is required`);
    }
  }
  return { codeRoot, codeReadonly: readonly === 'required', repoRoot, worktreeRoot };
}

// The dispatcher's configuration: unattended always. codeRoot is the checkout this process runs from;
// main.ts derives it from its own path. A retired or unknown AGENT_MODE goes to warn (stderr when no
// warn is given) and changes nothing else.
export function loadConfig(env: Env, codeRoot: string, warn: (message: string) => void = writeWarning): DispatcherConfig {
  const warning = agentModeWarning(env);
  if (warning) warn(warning);
  return buildConfig(env, codeRoot, false);
}

function writeWarning(message: string): void {
  process.stderr.write(`${message}\n`);
}

// A hand-run tool's configuration (the replay eval, the probe's --attended run): the dispatcher's
// values with no studio key and no managed ids, since its sessions run attended on the founder's
// login, and any GitHub token, since a person is running it. AGENT_MODE is not read.
export function loadHandRunConfig(env: Env, codeRoot: string): DispatcherConfig {
  return buildConfig(env, codeRoot, true);
}

function buildConfig(env: Env, codeRoot: string, handRun: boolean): DispatcherConfig {
  const githubRepo = requireEnv(env, 'GITHUB_REPO');
  if (!GITHUB_REPO.test(githubRepo)) throw new ConfigError('GITHUB_REPO must be owner/repo');
  const modelBuilder = requireEnv(env, 'MODEL_BUILDER');
  const priceTable = priceTableEnv(env);
  pricedModel(modelBuilder, 'MODEL_BUILDER', priceTable);
  const roots = rootsEnv(env, codeRoot);
  const githubToken = githubTokenEnv(env, handRun);
  return {
    ...roots,
    supabaseUrl: requireEnv(env, 'SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    githubToken,
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
    visualReviewMaxUsd: visualReviewMaxUsdEnv(env),
    draftSessionMaxUsd: draftSessionMaxUsdEnv(env),
    sessionMaxTurns: positiveIntegerEnv(env, 'SESSION_MAX_TURNS', 60),
    sessionMaxMinutes: positiveIntegerEnv(env, 'SESSION_MAX_MINUTES', 60),
    agentHourlyRateUsd: numberEnv(env, 'AGENT_HOURLY_RATE_USD', 5),
    tickMs: positiveIntegerEnv(env, 'DISPATCHER_TICK_MS', 60_000),
    maxConcurrency: positiveIntegerEnv(env, 'DISPATCHER_MAX_CONCURRENCY', 1),
    claudeBin: optionalEnv(env, 'CLAUDE_BIN', 'claude'),
    studioAnthropicApiKey: studioApiKeyEnv(env, handRun),
    managed: managedEnv(env, githubToken, handRun),
    healthcheckUrl: optionalHttpsUrlEnv(env, 'HEALTHCHECK_URL'),
    ntfyTopicUrl: optionalHttpsUrlEnv(env, 'NTFY_TOPIC_URL'),
    discordWebhookShips: discordWebhookEnv(env, 'DISCORD_WEBHOOK_SHIPS'),
    discordWebhookWeekly: discordWebhookEnv(env, 'DISCORD_WEBHOOK_WEEKLY'),
    publicSiteUrl: publicSiteUrlEnv(env),
    drainAt: drainAtEnv(env),
  };
}
