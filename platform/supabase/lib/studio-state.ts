// studio_state row 1 for seed.ts. The row is inserted when it is missing and never updated: the
// board sets the agent mode and the caps from /board, and a seed run from a machine whose .env is
// stale (the Mac after the VPS cutover) must not flip the live dispatcher back to attended.

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEnv, requireUsd, type Env } from "./env.js";

export interface StudioStateSeed {
  id: 1;
  daily_cap_usd: number;
  card_max_usd: number;
  agent_hourly_rate_usd: number;
  agent_mode: string;
}

/** The live values the seed compares with .env. PostgREST returns numeric columns as numbers or strings. */
export interface LiveStudioState {
  agent_mode: string | null;
  daily_cap_usd: number | string;
  card_max_usd: number | string;
  agent_hourly_rate_usd: number | string;
}

export const LIVE_COLUMNS = "agent_mode, daily_cap_usd, card_max_usd, agent_hourly_rate_usd";

export function studioStateSeed(env: Env): StudioStateSeed {
  return {
    id: 1,
    daily_cap_usd: requireUsd(env, "POOL_DAILY_CAP_USD"),
    card_max_usd: requireUsd(env, "CARD_MAX_USD"),
    agent_hourly_rate_usd: requireUsd(env, "AGENT_HOURLY_RATE_USD"),
    agent_mode: requireEnv(env, "AGENT_MODE"),
  };
}

const CAPS: ReadonlyArray<{ column: "daily_cap_usd" | "card_max_usd" | "agent_hourly_rate_usd"; env: string }> = [
  { column: "daily_cap_usd", env: "POOL_DAILY_CAP_USD" },
  { column: "card_max_usd", env: "CARD_MAX_USD" },
  { column: "agent_hourly_rate_usd", env: "AGENT_HOURLY_RATE_USD" },
];

/** One warning line for each .env value that differs from the live row; empty when they agree. */
export function studioStateDrift(seed: StudioStateSeed, live: LiveStudioState): string[] {
  const lines: string[] = [];
  if (live.agent_mode !== seed.agent_mode) {
    lines.push(
      `studio_state warning: .env AGENT_MODE is ${seed.agent_mode} but the live agent_mode is ${live.agent_mode ?? "unset"}; not written (set the mode from /board)`,
    );
  }
  for (const cap of CAPS) {
    const value = Number(live[cap.column]);
    if (value !== seed[cap.column]) {
      lines.push(`studio_state warning: .env ${cap.env} is ${seed[cap.column]} but the live ${cap.column} is ${String(live[cap.column])}; not written`);
    }
  }
  return lines;
}

export function describeLive(live: LiveStudioState): string {
  return `studio_state (live): mode ${live.agent_mode ?? "unset"}, daily cap ${Number(live.daily_cap_usd)}, card max ${Number(live.card_max_usd)}, rate ${Number(live.agent_hourly_rate_usd)}`;
}

export interface StudioStateStore {
  /** Inserts row 1 when it is missing; an existing row is left exactly as it is. */
  insertIfMissing(row: StudioStateSeed): Promise<void>;
  readLive(): Promise<LiveStudioState>;
}

export function supabaseStudioStateStore(db: SupabaseClient): StudioStateStore {
  return {
    async insertIfMissing(row) {
      const { error } = await db.from("studio_state").upsert(row, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error(`studio_state insert: ${error.message}`);
    },
    async readLive() {
      const { data, error } = await db.from("studio_state").select(LIVE_COLUMNS).eq("id", 1).single<LiveStudioState>();
      if (error) throw new Error(`studio_state read: ${error.message}`);
      return data;
    },
  };
}

/** Inserts row 1 if missing, reads it back, logs the live values and a warning for each .env value that differs. */
export async function seedStudioState(store: StudioStateStore, env: Env, log: (line: string) => void): Promise<LiveStudioState> {
  const seed = studioStateSeed(env);
  await store.insertIfMissing(seed);
  const live = await store.readLive();
  log(describeLive(live));
  for (const line of studioStateDrift(seed, live)) log(line);
  return live;
}
