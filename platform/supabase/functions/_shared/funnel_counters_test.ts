// The funnel-counters migration on PGlite (docs/specs/counter-senders.md, Funnel): count_play_event
// takes contribute_load, checkout_open and home_play_click and still drops any other name, the
// migration runs a second time without error, and refresh_daily_metrics carries the three into
// daily_metrics as play.<name>. Every migration runs in order behind the Supabase shim, as
// channel_counters_test.ts runs them.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261019020000_funnel_counters.sql";
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const OPTS = { sanitizeOps: false, sanitizeResources: false };
const FUNNEL = ["contribute_load", "checkout_open", "home_play_click"];

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

Deno.test("count_play_event takes the funnel's three counts and nothing else", OPTS, async (t) => {
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

    await t.step("anon counts each of the three, adds repeats up, and still drops unknown names", async () => {
      await db.exec("set role anon");
      try {
        for (const event of [...FUNNEL, "checkout_open"]) {
          assertEquals((await row<{ ok: boolean }>("select public.count_play_event($1) as ok", [event])).ok, true, event);
        }
        for (const other of ["checkout_expired", "contribute", "CHECKOUT_OPEN", "home_play"]) {
          assertEquals((await row<{ ok: boolean }>("select public.count_play_event($1) as ok", [other])).ok, false, other);
        }
        // The earlier counters still count.
        for (const earlier of ["home_load", "from_reddit", "dust_daily_share"]) {
          assertEquals((await row<{ ok: boolean }>("select public.count_play_event($1) as ok", [earlier])).ok, true, earlier);
        }
      } finally {
        await db.exec("reset role");
      }
      const checkout = await row<{ count: number }>("select count from public.play_counts where day = (now() at time zone 'utc')::date and event = 'checkout_open'");
      assertEquals(checkout.count, 2);
    });

    await t.step("refresh_daily_metrics carries the funnel into daily_metrics", async () => {
      await db.query("select public.refresh_daily_metrics((now() at time zone 'utc')::date)");
      for (const [event, n] of [["contribute_load", 1], ["checkout_open", 2], ["home_play_click", 1]] as const) {
        const metric = await row<{ value: string }>("select value::text from public.daily_metrics where day = (now() at time zone 'utc')::date and metric = $1", [`play.${event}`]);
        assertEquals(Number(metric.value), n, event);
      }
    });
  } finally {
    await db.close();
  }
});
