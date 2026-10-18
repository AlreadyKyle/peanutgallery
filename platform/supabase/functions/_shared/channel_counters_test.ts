// The channel-counters migration on PGlite (docs/specs/channel-counters.md): count_play_event takes a
// landing from each channel's tagged link and still drops any other name, the migration runs a second
// time without error, and refresh_daily_metrics carries the landings into daily_metrics as
// play.from_<channel>. Every migration runs in order behind the Supabase shim, as play_counts_test.ts
// runs them.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261018110000_channel_counters.sql";
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const OPTS = { sanitizeOps: false, sanitizeResources: false };
const CHANNELS = ["x", "bsky", "threads", "mastodon", "discord", "yt", "tiktok", "ig", "linkedin", "reddit", "hn", "itch", "ph", "creator"];

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

Deno.test("count_play_event takes each channel's landing and nothing else", OPTS, async (t) => {
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

    await t.step("anon counts a landing from every channel, adds repeats up, and drops unknown tags", async () => {
      await db.exec("set role anon");
      try {
        for (const channel of [...CHANNELS, "reddit"]) {
          assertEquals((await row<{ ok: boolean }>("select public.count_play_event($1) as ok", [`from_${channel}`])).ok, true, channel);
        }
        for (const other of ["from_elsewhere", "from_", "from_REDDIT", "reddit"]) {
          assertEquals((await row<{ ok: boolean }>("select public.count_play_event($1) as ok", [other])).ok, false, other);
        }
        // The earlier counters still count.
        assertEquals((await row<{ ok: boolean }>("select public.count_play_event('broadcast_qr') as ok")).ok, true);
      } finally {
        await db.exec("reset role");
      }
      const reddit = await row<{ count: number }>("select count from public.play_counts where day = (now() at time zone 'utc')::date and event = 'from_reddit'");
      assertEquals(reddit.count, 2);
    });

    await t.step("refresh_daily_metrics carries the landings into daily_metrics", async () => {
      await db.query("select public.refresh_daily_metrics((now() at time zone 'utc')::date)");
      const metric = await row<{ value: string }>("select value::text from public.daily_metrics where day = (now() at time zone 'utc')::date and metric = 'play.from_reddit'");
      assertEquals(Number(metric.value), 2);
      const hn = await row<{ value: string }>("select value::text from public.daily_metrics where day = (now() at time zone 'utc')::date and metric = 'play.from_hn'");
      assertEquals(Number(hn.value), 1);
    });
  } finally {
    await db.close();
  }
});
