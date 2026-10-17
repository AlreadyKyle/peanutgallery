import type { SupabaseClient } from '@supabase/supabase-js';
import { toNumber } from './format';

// The board's Games and Agents admin (docs/specs/final-state.md, Admin): two reads, board_games and
// board_agent_roster (20261017210000_board_roster.sql), each for a board member at the second factor,
// and the per-role on/off, which is the database's own set_role_pause. Nothing here moves money or
// changes a cap. Like the rest of this kernel app, nothing is imported from the public site.

export const ROSTER_TABS = ['Games', 'Agents'] as const;
export type RosterTab = (typeof ROSTER_TABS)[number];

/** What the board site knows of each game folder that the database does not: its name, art and address. */
export type GameInfo = { name: string; boxArt: string | null; playUrl: string | null };

/**
 * One entry per game folder. The box art is a copy of the public site's (public/games/), so this
 * site's image policy ('self') holds; site-config.test.ts keeps the two copies equal.
 */
export const GAMES: Readonly<Record<string, GameInfo>> = {
  'seed-1': { name: 'Dust', boxArt: '/games/dust-box-art.svg', playUrl: 'https://play.mobmachine.games' },
};

export function gameInfo(folder: string): GameInfo {
  return GAMES[folder] ?? { name: folder, boxArt: null, playUrl: null };
}

export type CardLine = { id: string; title: string; stage: string; at: string | null };
export type Deploy = { sha: string; isGreen: boolean; smokeResult: string | null; at: string };

export type Game = {
  folder: string;
  openCount: number;
  shippedCount: number;
  openCards: CardLine[];
  shippedCards: CardLine[];
  latestDeploy: Deploy | null;
  latestGreenDeploy: { sha: string; at: string } | null;
};

/** A game's status in a word, from its deploys: live, deploy failing (still live on an older green) or no deploy yet. */
export function gameStatus(game: Game): 'live' | 'last deploy failed' | 'not deployed' {
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

export type Agent = {
  id: string;
  name: string;
  title: string;
  model: string;
  tools: string[];
  writeAccess: boolean;
  agentClass: string | null;
  state: string;
  paused: boolean;
  pausedReason: string | null;
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

export function gamesFrom(data: unknown): Game[] {
  return list(data).map((g) => {
    const latest = g.latest_deploy === null || g.latest_deploy === undefined ? null : rec(g.latest_deploy);
    const green = g.latest_green_deploy === null || g.latest_green_deploy === undefined ? null : rec(g.latest_green_deploy);
    return {
      folder: str(g.folder),
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
    return {
      id: str(r.id),
      name: str(r.name),
      title: str(r.title),
      model: str(r.model),
      tools: toolNames(r.tools),
      writeAccess: r.write_access === true,
      agentClass: strOrNull(r.agent_class),
      state: str(r.state),
      paused: r.paused === true,
      pausedReason: strOrNull(r.paused_reason),
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
