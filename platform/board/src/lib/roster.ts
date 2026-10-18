import type { SupabaseClient } from '@supabase/supabase-js';
import { toNumber } from './format';

// The board's Games and Agents admin (docs/specs/final-state.md, Admin; docs/specs/board-games-admin.md):
// two reads, board_games and board_agent_roster (20261017220000_board_games_admin.sql), each for a board
// member at the second factor; the four game writes (status, taking new cards, featured, blurb), each
// logged with its reason in the moderation log; and the per-role on/off, which is the database's own
// set_role_pause. Nothing here moves money or changes a cap: the caps are only read. Like the rest of
// this kernel app, nothing is imported from the public site.

export const ROSTER_TABS = ['Games', 'Agents'] as const;
export type RosterTab = (typeof ROSTER_TABS)[number];

/** The board site's own fallback for a game the database has no name, art or address for yet. */
export type GameInfo = { name: string; boxArt: string | null; playUrl: string | null };

/**
 * One entry per game folder. The box art is a copy of the public site's (public/games/), so this
 * site's image policy ('self') holds; site-config.test.ts keeps the two copies equal.
 */
export const GAMES: Readonly<Record<string, GameInfo>> = {
  'seed-1': { name: 'Dust', boxArt: '/games/dust-box-art.svg', playUrl: 'https://play.mobmachine.games' },
};

/** A game's name, art and address: the database's (the games table), else this site's constant, else the folder. */
export function gameInfo(game: Pick<Game, 'folder' | 'name' | 'boxArt' | 'playUrl'>): GameInfo {
  const known = GAMES[game.folder];
  return {
    name: game.name !== '' && game.name !== game.folder ? game.name : (known?.name ?? game.folder),
    boxArt: game.boxArt ?? known?.boxArt ?? null,
    playUrl: game.playUrl ?? known?.playUrl ?? null,
  };
}

/** The board's status word for a game (games.status), as the database spells it. */
export const GAME_STATUSES = ['live', 'paused', 'in_development'] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];
export const GAME_STATUS_WORDS: Readonly<Record<GameStatus, string>> = { live: 'live', paused: 'paused', in_development: 'in development' };
/** The longest public blurb the database takes (games_blurb_check). */
export const BLURB_MAX = 280;
/** The moderation log's reason limit (community.log_admin). */
export const ADMIN_REASON_MAX = 500;

export type Counts = { day: number; week: number; month: number; total: number };
export type LogEntry = { at: string; actor: string; action: string; reason: string; details: Record<string, unknown> };

export type CardLine = { id: string; title: string; stage: string; at: string | null };
export type Deploy = { sha: string; isGreen: boolean; smokeResult: string | null; at: string };

export type Game = {
  folder: string;
  name: string;
  status: GameStatus;
  acceptingCards: boolean;
  featured: boolean;
  blurb: string | null;
  playUrl: string | null;
  boxArt: string | null;
  plays: { loadEvent: string | null; shareEvent: string | null; loads: Counts; shares: Counts };
  adminLog: LogEntry[];
  openCount: number;
  shippedCount: number;
  openCards: CardLine[];
  shippedCards: CardLine[];
  latestDeploy: Deploy | null;
  latestGreenDeploy: { sha: string; at: string } | null;
};

/** A game's deploy health in a word: live, deploy failing (still live on an older green) or no deploy yet. */
export function deployHealth(game: Pick<Game, 'latestDeploy' | 'latestGreenDeploy'>): 'live' | 'last deploy failed' | 'not deployed' {
  if (game.latestDeploy === null) return 'not deployed';
  return game.latestDeploy.isGreen ? 'live' : game.latestGreenDeploy === null ? 'not deployed' : 'last deploy failed';
}

export type Run = {
  id: string;
  job: string;
  status: string;
  origin: string;
  cardId: string | null;
  reason: string | null;
  createdAt: string;
  finishedAt: string | null;
};

/** A role's place on the roster (roles.status): running, starting on a trigger, or planned. */
export type RoleStatus = 'running' | 'starts' | 'planned' | null;
export const ROLE_STATUS_WORDS: Readonly<Record<'running' | 'starts' | 'planned', string>> = { running: 'Running', starts: 'Starts later', planned: 'Planned' };

export type Caps = {
  roleDay: number;
  roleMonth: number;
  studioDay: number;
  studioMonth: number;
  dailyCap: number | null;
  monthlyCap: number | null;
};

export type Agent = {
  id: string;
  name: string;
  title: string;
  description: string | null;
  speciesNote: string | null;
  avatarUrl: string | null;
  status: RoleStatus;
  trigger: string | null;
  budgetShare: number;
  caps: Caps;
  runsWeek: { succeeded: number; failed: number; skipped: number; lastAt: string | null };
  pauseHistory: { at: string; actor: string; paused: boolean; reason: string }[];
  model: string;
  tools: string[];
  writeAccess: boolean;
  agentClass: string | null;
  state: string;
  paused: boolean;
  pausedReason: string | null;
  pausedAt: string | null;
  jobs: string[];
  spend: { day: number; week: number; month: number; total: number };
  runsDay: { succeeded: number; failed: number; skipped: number; queued: number; running: number };
  recentRuns: Run[];
};

type Row = Record<string, unknown>;

function rec(value: unknown): Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Row) : {};
}

function list(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => typeof item === 'object' && item !== null && !Array.isArray(item)) : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(value: unknown): number {
  return typeof value === 'number' || typeof value === 'string' ? (toNumber(value) ?? 0) : 0;
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' || typeof value === 'string' ? toNumber(value) : null;
}

function counts(value: unknown): Counts {
  const c = rec(value);
  return { day: num(c.day), week: num(c.week), month: num(c.month), total: num(c.total) };
}

function gameStatusOf(value: unknown): GameStatus {
  return (GAME_STATUSES as readonly unknown[]).includes(value) ? (value as GameStatus) : 'in_development';
}

function roleStatusOf(value: unknown): RoleStatus {
  return value === 'running' || value === 'starts' || value === 'planned' ? value : null;
}

export function gamesFrom(data: unknown): Game[] {
  return list(data).map((g) => {
    const latest = g.latest_deploy === null || g.latest_deploy === undefined ? null : rec(g.latest_deploy);
    const green = g.latest_green_deploy === null || g.latest_green_deploy === undefined ? null : rec(g.latest_green_deploy);
    const plays = rec(g.plays);
    return {
      folder: str(g.folder),
      name: str(g.name),
      status: gameStatusOf(g.status),
      acceptingCards: g.accepting_cards !== false,
      featured: g.featured === true,
      blurb: strOrNull(g.blurb),
      playUrl: strOrNull(g.play_url),
      boxArt: strOrNull(g.box_art),
      plays: { loadEvent: strOrNull(plays.load_event), shareEvent: strOrNull(plays.share_event), loads: counts(plays.loads), shares: counts(plays.shares) },
      adminLog: list(g.admin_log).map((a) => ({ at: str(a.at), actor: str(a.actor), action: str(a.action), reason: str(a.reason), details: rec(a.details) })),
      openCount: num(g.open_count),
      shippedCount: num(g.shipped_count),
      openCards: list(g.open_cards).map((c) => ({ id: str(c.id), title: str(c.title), stage: str(c.stage), at: strOrNull(c.updated_at) })),
      shippedCards: list(g.shipped_cards).map((c) => ({ id: str(c.id), title: str(c.title), stage: 'live', at: strOrNull(c.live_at) })),
      latestDeploy: latest === null ? null : { sha: str(latest.sha), isGreen: latest.is_green === true, smokeResult: strOrNull(latest.smoke_result), at: str(latest.created_at) },
      latestGreenDeploy: green === null ? null : { sha: str(green.sha), at: str(green.created_at) },
    };
  });
}

/** tools_json holds tool names, or objects that name one. */
function toolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((tool) => (typeof tool === 'string' ? tool : str(rec(tool).name))).filter((name) => name !== '');
}

export function agentsFrom(data: unknown): Agent[] {
  return list(data).map((r) => {
    const spend = rec(r.spend);
    const runs = rec(r.runs_day);
    const caps = rec(r.caps);
    const week = rec(r.runs_week);
    return {
      id: str(r.id),
      name: str(r.name),
      title: str(r.title),
      description: strOrNull(r.description),
      speciesNote: strOrNull(r.species_note),
      avatarUrl: strOrNull(r.avatar_url),
      status: roleStatusOf(r.status),
      trigger: strOrNull(r.trigger),
      budgetShare: num(r.budget_share),
      caps: {
        roleDay: num(caps.role_day_usd),
        roleMonth: num(caps.role_month_usd),
        studioDay: num(caps.studio_day_usd),
        studioMonth: num(caps.studio_month_usd),
        dailyCap: numOrNull(caps.daily_cap_usd),
        monthlyCap: numOrNull(caps.monthly_cap_usd),
      },
      runsWeek: { succeeded: num(week.succeeded), failed: num(week.failed), skipped: num(week.skipped), lastAt: strOrNull(week.last_at) },
      pauseHistory: list(r.pause_history).map((h) => ({ at: str(h.at), actor: str(h.actor), paused: h.paused === true, reason: str(h.reason) })),
      model: str(r.model),
      tools: toolNames(r.tools),
      writeAccess: r.write_access === true,
      agentClass: strOrNull(r.agent_class),
      state: str(r.state),
      paused: r.paused === true,
      pausedReason: strOrNull(r.paused_reason),
      pausedAt: strOrNull(r.paused_at),
      jobs: Array.isArray(r.jobs) ? r.jobs.map(str) : [],
      spend: { day: num(spend.day_usd), week: num(spend.week_usd), month: num(spend.month_usd), total: num(spend.total_usd) },
      runsDay: { succeeded: num(runs.succeeded), failed: num(runs.failed), skipped: num(runs.skipped), queued: num(runs.queued), running: num(runs.running) },
      recentRuns: list(r.recent_runs).map((x) => ({
        id: str(x.id),
        job: str(x.job),
        status: str(x.status),
        origin: str(x.origin),
        cardId: strOrNull(x.card_id),
        reason: strOrNull(x.reason),
        createdAt: str(x.created_at),
        finishedAt: strOrNull(x.finished_at),
      })),
    };
  });
}

async function call(client: SupabaseClient, name: string, args?: Row): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchGames(client: SupabaseClient): Promise<Game[]> {
  return gamesFrom(await call(client, 'board_games'));
}

export async function fetchAgentRoster(client: SupabaseClient): Promise<Agent[]> {
  return agentsFrom(await call(client, 'board_agent_roster'));
}

/** The per-role on/off: the database's set_role_pause, which needs a reason of at most 200 characters. */
export const ROLE_REASON_MAX = 200;

export async function setRoleOn(client: SupabaseClient, roleId: string, on: boolean, reason: string): Promise<void> {
  await call(client, 'set_role_pause', { p_role: roleId, p_paused: !on, p_reason: reason });
}

/** The board's game writes (20261017220000_board_games_admin.sql): each needs a reason, logged in the moderation log. */
export async function setGameStatus(client: SupabaseClient, folder: string, status: GameStatus, reason: string): Promise<void> {
  await call(client, 'board_set_game_status', { p_folder: folder, p_status: status, p_reason: reason });
}

export async function setGameAccepting(client: SupabaseClient, folder: string, accepting: boolean, reason: string): Promise<void> {
  await call(client, 'board_set_game_accepting', { p_folder: folder, p_accepting: accepting, p_reason: reason });
}

export async function setGameFeatured(client: SupabaseClient, folder: string, featured: boolean, reason: string): Promise<void> {
  await call(client, 'board_set_game_featured', { p_folder: folder, p_featured: featured, p_reason: reason });
}

/** An empty blurb clears it; the database cleans the text and runs the content filter. */
export async function setGameBlurb(client: SupabaseClient, folder: string, blurb: string, reason: string): Promise<void> {
  await call(client, 'board_set_game_blurb', { p_folder: folder, p_blurb: blurb, p_reason: reason });
}

/** Roles in roster order: running, then starting later, then planned, then any without a status, then retired. */
export function rosterGroups(agents: readonly Agent[]): { key: string; label: string; agents: Agent[] }[] {
  const groups = [
    { key: 'running', label: ROLE_STATUS_WORDS.running, agents: [] as Agent[] },
    { key: 'starts', label: ROLE_STATUS_WORDS.starts, agents: [] as Agent[] },
    { key: 'planned', label: ROLE_STATUS_WORDS.planned, agents: [] as Agent[] },
    { key: 'unset', label: 'No roster status', agents: [] as Agent[] },
    { key: 'retired', label: 'Retired', agents: [] as Agent[] },
  ];
  for (const agent of agents) {
    const key = agent.state === 'retired' ? 'retired' : (agent.status ?? 'unset');
    groups.find((g) => g.key === key)!.agents.push(agent);
  }
  return groups.filter((g) => g.agents.length > 0);
}
