// The week-counter migration on PGlite (docs/specs/counter-senders.md, This week): count_play_event
// takes week_load and still drops any other name, every earlier name still counts, the migration runs
// a second time without error, and refresh_daily_metrics carries it into daily_metrics as
// play.week_load. Every migration runs in order behind the Supabase shim, as funnel_counters_test.ts
// runs them.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261028170000_week_counter.sql";
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const OPTS = { sanitizeOps: false, sanitizeResources: false };
// Every name the funnel's migration took, which this one must keep.
const EARLIER = [
  "dust_load", "dust_share", "card_share", "dust_next_card",
  "dust_return_1d", "dust_return_7d", "dust_session_2m", "dust_session_4m", "dust_seed_save", "dust_seed_open",
  "home_load", "home_dwell_mid", "home_dwell_long", "broadcast_load", "broadcast_qr", "discord_click",
  "dust_daily_start", "dust_daily_finish", "dust_daily_share",
  "from_x", "from_bsky", "from_threads", "from_mastodon", "from_discord", "from_yt", "from_tiktok", "from_ig", "from_linkedin",
  "from_reddit", "from_hn", "from_itch", "from_ph", "from_creator",
  "contribute_load", "checkout_open", "home_play_click",
];

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

Deno.test("count_play_event takes week_load, keeps every earlier name and nothing else", OPTS, async (t) => {
  const db = new PGlite();
  const row = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> => {
    const all = (await db.query<T>(sql, params)).rows;
    assert(all.length > 0, `no row for: ${sql}`);
    return all[0]!;
  };
  try {
    await db.exec(SHIM);
    const names: string[] = [];
    for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
      if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
    }
    names.sort();
    const sqlOf = async (name: string) => (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "");
    for (const name of names) await db.exec(await sqlOf(name));

    await t.step("the migration applies a second time", async () => {
      await db.exec(await sqlOf(MIGRATION));
    });

    await t.step("anon counts week_load, adds repeats up, keeps every earlier name and still drops unknown names", async () => {
      await db.exec("set role anon");
      try {
        for (const event of ["week_load", "week_load", "week_load"]) {
          assertEquals((await row<{ ok: boolean }>("select public.count_play_event($1) as ok", [event])).ok, true, event);
        }
        for (const earlier of EARLIER) {
          assertEquals((await row<{ ok: boolean }>("select public.count_play_event($1) as ok", [earlier])).ok, true, earlier);
        }
        for (const other of ["week", "week_view", "WEEK_LOAD", "week_load ", "", "studio_load"]) {
          assertEquals((await row<{ ok: boolean }>("select public.count_play_event($1) as ok", [other])).ok, false, JSON.stringify(other));
        }
        assertEquals((await row<{ ok: boolean | null }>("select public.count_play_event(null) as ok")).ok, false);
      } finally {
        await db.exec("reset role");
      }
      const week = await row<{ count: number }>("select count from public.play_counts where day = (now() at time zone 'utc')::date and event = 'week_load'");
      assertEquals(week.count, 3);
    });

    await t.step("the table's check refuses a name the function would drop", async () => {
      let refused = false;
      try {
        await db.query("insert into public.play_counts (day, event, count) values ((now() at time zone 'utc')::date, 'week_view', 1)");
      } catch {
        refused = true;
      }
      assert(refused, "play_counts took week_view");
    });

    await t.step("refresh_daily_metrics carries week_load into daily_metrics", async () => {
      await db.query("select public.refresh_daily_metrics((now() at time zone 'utc')::date)");
      const metric = await row<{ value: string }>("select value::text from public.daily_metrics where day = (now() at time zone 'utc')::date and metric = 'play.week_load'");
      assertEquals(Number(metric.value), 3);
    });
  } finally {
    await db.close();
  }
});
