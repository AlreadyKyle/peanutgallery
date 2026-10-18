// The Daily Dust counters migration on PGlite (docs/specs/daily-dust.md): count_play_event takes
// dust_daily_start, dust_daily_finish and dust_daily_share as well as every name it took before, still
// drops any other name, anon may call it but reads nothing, and refresh_daily_metrics carries the new
// counts as play.<event>. Every migration runs in order behind the Supabase shim, as
// operations_test.ts runs them, and this one applies twice.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261018020000_daily_dust_counters.sql";
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const OPTS = { sanitizeOps: false, sanitizeResources: false };

const SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.email() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.email', true), '')
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create publication supabase_realtime;
`;

// Every name count_play_event took before this migration (20261017200000_benchmark_counters.sql).
const EARLIER = [
  "dust_load", "dust_share", "card_share", "dust_next_card",
  "dust_return_1d", "dust_return_7d", "dust_session_2m", "dust_session_4m", "dust_seed_save", "dust_seed_open",
  "home_load", "home_dwell_mid", "home_dwell_long", "broadcast_load", "broadcast_qr", "discord_click",
];
const DAILY = ["dust_daily_start", "dust_daily_finish", "dust_daily_share"];

type Row = Record<string, unknown>;

Deno.test("the Daily Dust counters: three more names, counted like the rest", OPTS, async (t) => {
  const db = new PGlite();
  const rows = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
  const as = async <T>(role: string, run: () => Promise<T>): Promise<T> => {
    await db.exec(`set role ${role}`);
    try {
      return await run();
    } finally {
      await db.exec(`reset role`);
    }
  };
  const count = async (event: string | null) => (await rows<{ ok: boolean }>(`select public.count_play_event($1) as ok`, [event]))[0]!.ok;
  try {
    await db.exec(SHIM);
    const names: string[] = [];
    for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
      if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
    }
    names.sort();
    assert(names.includes(MIGRATION), `${MIGRATION} is in the migrations folder`);
    const sqlOf = async (name: string) => (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "");
    for (const name of names) await db.exec(await sqlOf(name));

    await t.step("applies a second time", async () => {
      await db.exec(await sqlOf(MIGRATION));
    });

    await t.step("anon counts each daily name and every earlier one, and still drops anything else", async () => {
      await as("anon", async () => {
        for (const event of [...DAILY, "dust_daily_start", "dust_daily_share", ...EARLIER]) assertEquals(await count(event), true, event);
        for (const event of ["dust_daily", "Dust_daily_start", "dust_daily_start ", "player@example.com", "", null]) {
          assertEquals(await count(event), false, String(event));
        }
      });
      const today = await rows<{ event: string; count: number }>(
        `select event, count from public.play_counts where day = (now() at time zone 'utc')::date and event like 'dust_daily_%' order by event`,
      );
      assertEquals(today, [
        { event: "dust_daily_finish", count: 1 },
        { event: "dust_daily_share", count: 2 },
        { event: "dust_daily_start", count: 2 },
      ]);
    });

    await t.step("the table refuses a name outside the list, even written directly", async () => {
      await assertRejects(
        () => db.exec(`insert into public.play_counts (day, event, count) values (current_date, 'dust_daily_streak', 1)`),
        Error,
        "play_counts_event_check",
      );
    });

    await t.step("anon reads no counts", async () => {
      await assertRejects(() => as("anon", () => rows(`select * from public.play_counts`)), Error, "permission denied");
    });

    await t.step("the daily metrics carry the new counts as play.<event>", async () => {
      await db.query(`select public.refresh_daily_metrics((now() at time zone 'utc')::date)`);
      const metrics = await rows<{ metric: string; value: string }>(
        `select metric, value::text from public.daily_metrics where day = (now() at time zone 'utc')::date and metric like 'play.dust_daily_%' order by metric`,
      );
      assertEquals(metrics.map((m) => [m.metric, Number(m.value)]), [
        ["play.dust_daily_finish", 1],
        ["play.dust_daily_share", 2],
        ["play.dust_daily_start", 2],
      ]);
    });
  } finally {
    await db.close();
  }
});
