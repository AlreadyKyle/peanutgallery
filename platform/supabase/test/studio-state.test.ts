import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  describeLive,
  seedStudioState,
  studioStateDrift,
  studioStateSeed,
  supabaseStudioStateStore,
  type LiveStudioState,
} from "../lib/studio-state.js";

// An old .env still says attended; the seed no longer reads it (docs/specs/unattended-roles.md, PR5).
const MAC_ENV = { AGENT_MODE: "attended", POOL_DAILY_CAP_USD: "100", CARD_MAX_USD: "25", AGENT_HOURLY_RATE_USD: "5" };

interface RecordedRequest {
  method: string;
  url: URL;
  prefer: string;
  body: unknown;
}

/**
 * A PostgREST stand-in holding studio_state row 1 (or none). It applies what the request asks for:
 * a POST with resolution=ignore-duplicates leaves an existing row alone, any other POST, PATCH or
 * PUT overwrites it. Every request is recorded.
 */
function fakePostgrest(initial: LiveStudioState | null) {
  let row: Record<string, unknown> | null = initial ? { id: 1, ...initial } : null;
  const requests: RecordedRequest[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push({ method, url, prefer: headers.get("Prefer") ?? "", body });
    if (method === "GET") {
      if (!row) return new Response(JSON.stringify({ message: "no row" }), { status: 406 });
      return new Response(JSON.stringify(row), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const incoming = (Array.isArray(body) ? body[0] : body) as Record<string, unknown>;
    const ignoreDuplicates = method === "POST" && headers.get("Prefer")?.includes("resolution=ignore-duplicates");
    if (!row || !ignoreDuplicates) row = { ...(row ?? {}), ...incoming };
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  const db = createClient("https://project.supabase.local", "service-role-for-tests", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchFn },
  });
  return { db, requests, row: () => row };
}

describe("studioStateSeed", () => {
  it("reads the caps from .env, and the mode is always unattended whatever AGENT_MODE says", () => {
    const seed = { id: 1, daily_cap_usd: 100, card_max_usd: 25, agent_hourly_rate_usd: 5, agent_mode: "unattended" };
    expect(studioStateSeed(MAC_ENV)).toEqual(seed);
    expect(studioStateSeed({ ...MAC_ENV, AGENT_MODE: "" })).toEqual(seed);
    const { AGENT_MODE: _unread, ...withoutMode } = MAC_ENV;
    expect(studioStateSeed(withoutMode)).toEqual(seed);
  });
});

describe("studioStateDrift", () => {
  it("is empty when .env agrees with the live row, numeric strings included", () => {
    expect(studioStateDrift(studioStateSeed(MAC_ENV), { agent_mode: "unattended", daily_cap_usd: "100.0000", card_max_usd: 25, agent_hourly_rate_usd: "5.0000" })).toEqual([]);
  });

  it("names every value that differs, and a live mode the retire-attended migration has not set", () => {
    expect(studioStateDrift(studioStateSeed(MAC_ENV), { agent_mode: "attended", daily_cap_usd: "40.0000", card_max_usd: 25, agent_hourly_rate_usd: "5" })).toEqual([
      "studio_state warning: the live agent_mode is attended, not unattended; not written (apply 20261010300000_retire_attended.sql)",
      "studio_state warning: .env POOL_DAILY_CAP_USD is 100 but the live daily_cap_usd is 40.0000; not written",
    ]);
    expect(studioStateDrift(studioStateSeed(MAC_ENV), { agent_mode: null, daily_cap_usd: 100, card_max_usd: 25, agent_hourly_rate_usd: 5 })).toEqual([
      "studio_state warning: the live agent_mode is unset, not unattended; not written (apply 20261010300000_retire_attended.sql)",
    ]);
  });
});

describe("seedStudioState against PostgREST", () => {
  it("inserts row 1 when it is missing and logs the live values with no warning", async () => {
    const pg = fakePostgrest(null);
    const lines: string[] = [];
    const live = await seedStudioState(supabaseStudioStateStore(pg.db), MAC_ENV, (line) => lines.push(line));
    expect(pg.row()).toMatchObject({ id: 1, agent_mode: "unattended", daily_cap_usd: 100, card_max_usd: 25, agent_hourly_rate_usd: 5 });
    expect(live.agent_mode).toBe("unattended");
    expect(lines).toEqual(["studio_state (live): mode unattended, daily cap 100, card max 25, rate 5"]);
  });

  // A .env that still says attended never flips a live row: the mode is not read, and nothing updates.
  it("never writes a live row, and has nothing to warn about for an old AGENT_MODE=attended", async () => {
    const pg = fakePostgrest({ agent_mode: "unattended", daily_cap_usd: "100.0000", card_max_usd: "25.0000", agent_hourly_rate_usd: "5.0000" });
    const lines: string[] = [];
    await seedStudioState(supabaseStudioStateStore(pg.db), MAC_ENV, (line) => lines.push(line));

    expect(pg.row()).toMatchObject({ agent_mode: "unattended", daily_cap_usd: "100.0000" });
    expect(lines).toEqual(["studio_state (live): mode unattended, daily cap 100, card max 25, rate 5"]);
    // One insert that ignores duplicates, one read, and nothing that can update a row.
    expect(pg.requests.map((r) => r.method)).toEqual(["POST", "GET"]);
    const insert = pg.requests[0]!;
    expect(insert.url.pathname).toBe("/rest/v1/studio_state");
    expect(insert.url.searchParams.get("on_conflict")).toBe("id");
    expect(insert.prefer).toContain("resolution=ignore-duplicates");
    expect(insert.prefer).not.toContain("merge-duplicates");
    const read = pg.requests[1]!;
    expect(read.url.searchParams.get("id")).toBe("eq.1");
  });

  it("leaves live caps set from /board alone", async () => {
    const pg = fakePostgrest({ agent_mode: "unattended", daily_cap_usd: 40, card_max_usd: 10, agent_hourly_rate_usd: 5 });
    const lines: string[] = [];
    await seedStudioState(supabaseStudioStateStore(pg.db), MAC_ENV, (line) => lines.push(line));
    expect(pg.row()).toMatchObject({ daily_cap_usd: 40, card_max_usd: 10 });
    expect(lines.slice(1)).toEqual([
      "studio_state warning: .env POOL_DAILY_CAP_USD is 100 but the live daily_cap_usd is 40; not written",
      "studio_state warning: .env CARD_MAX_USD is 25 but the live card_max_usd is 10; not written",
    ]);
  });
});

describe("describeLive", () => {
  it("prints unset for a null mode", () => {
    expect(describeLive({ agent_mode: null, daily_cap_usd: "0", card_max_usd: "0", agent_hourly_rate_usd: "0" })).toBe("studio_state (live): mode unset, daily cap 0, card max 0, rate 0");
  });
});
