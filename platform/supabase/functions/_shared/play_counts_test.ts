// The play-counts migration on PGlite (docs/specs/play-counts.md): count_play_event adds one to
// today's total for each of the four known events and drops any other name; anon may call it but
// reads nothing; board_play_counts answers a board member at the second factor only, one entry a day
// with every event, newest first; the table holds a day, an event and a count, nothing that names a
// player. Every migration runs in order behind the Supabase shim, as ship_notices_test.ts runs them.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261011500000_play_counts.sql";
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const OPTS = { sanitizeOps: false, sanitizeResources: false };
const BOARD_EMAIL = "board@mobmachine.games";
const MODERATOR_EMAIL = "moderator@mobmachine.games";

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

type Row = Record<string, unknown>;

async function studio() {
  const db = new PGlite();
  const rows = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
  const row = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T> => {
    const all = await rows<T>(sql, params);
    assert(all.length > 0, `no row for: ${sql}`);
    return all[0]!;
  };
  const as = async <T>(role: string, run: () => Promise<T>): Promise<T> => {
    await db.exec(`set role ${role}`);
    try {
      return await run();
    } finally {
      await db.exec(`reset role`);
    }
  };
  const signInAs = async (email: string | null, aal: "aal1" | "aal2" = "aal2") => {
    await db.query(`select set_config('request.jwt.claim.email', $1, false)`, [email ?? ""]);
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [email === null ? "" : JSON.stringify({ email, aal })]);
  };
  await db.exec(SHIM);
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  const sqlOf = async (name: string) => (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "");
  for (const name of names) await db.exec(await sqlOf(name));
  await db.query(`insert into public.board_members (email, role) values ($1, 'board'), ($2, 'moderator')`, [BOARD_EMAIL, MODERATOR_EMAIL]);
  const count = async (event: string | null) => (await row<{ ok: boolean }>(`select public.count_play_event($1) as ok`, [event])).ok;
  return { db, rows, row, as, signInAs, sqlOf, count, close: () => db.close() };
}

Deno.test("count_play_event adds one to today's total for a known event and drops any other name", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("anon counts each of the four events; repeats add up on one row a day", async () => {
      await s.as("anon", async () => {
        for (const event of ["dust_load", "dust_load", "dust_load", "dust_share", "card_share", "dust_next_card", "dust_next_card"]) {
          assertEquals(await s.count(event), true, event);
        }
      });
      const counts = await s.rows<{ day: string; event: string; count: string }>(
        `select day::text, event, count::text from public.play_counts order by event`,
      );
      const today = (await s.row<{ d: string }>(`select ((now() at time zone 'utc')::date)::text as d`)).d;
      assertEquals(counts, [
        { day: today, event: "card_share", count: "1" },
        { day: today, event: "dust_load", count: "3" },
        { day: today, event: "dust_next_card", count: "2" },
        { day: today, event: "dust_share", count: "1" },
      ]);
    });

    await t.step("an unknown name, an empty one, a near miss or null answers false and writes nothing", async () => {
      const before = await s.rows(`select * from public.play_counts order by event`);
      await s.as("anon", async () => {
        for (const event of ["page_view", "", "Dust_load", "dust_load ", "dust_load'; drop table public.play_counts; --", null]) {
          assertEquals(await s.count(event), false, String(event));
        }
      });
      assertEquals(await s.rows(`select * from public.play_counts order by event`), before);
    });

    await t.step("the table refuses an event outside the list even from the owner", async () => {
      await assertRejects(
        () => s.db.exec(`insert into public.play_counts (day, event, count) values (current_date, 'visitor_ip', 1)`),
        Error,
        "play_counts_event_check",
      );
    });

    await t.step("anon and authenticated read and write nothing directly; service_role only reads", async () => {
      for (const role of ["anon", "authenticated"]) {
        await assertRejects(() => s.as(role, () => s.rows(`select * from public.play_counts`)), Error, "permission denied");
        await assertRejects(
          () => s.as(role, () => s.rows(`insert into public.play_counts (day, event, count) values (current_date, 'dust_load', 1000)`)),
          Error,
          "permission denied",
        );
      }
      await s.as("service_role", () => s.rows(`select * from public.play_counts`));
      await assertRejects(
        () => s.as("service_role", () => s.rows(`update public.play_counts set count = 0`)),
        Error,
        "permission denied",
      );
    });

    await t.step("the table holds a day, an event and a count, and row level security is on", async () => {
      const columns = await s.rows<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'play_counts' order by ordinal_position`,
      );
      assertEquals(columns.map((c) => c.column_name), ["day", "event", "count"]);
      assertEquals((await s.row<{ on: boolean }>(`select relrowsecurity as on from pg_class where relname = 'play_counts'`)).on, true);
    });
  } finally {
    await s.close();
  }
});

Deno.test("board_play_counts answers a board member at the second factor, one entry a day, newest first", OPTS, async (t) => {
  const s = await studio();
  try {
    await s.db.exec(
      `insert into public.play_counts (day, event, count) values
         ((now() at time zone 'utc')::date, 'dust_load', 5),
         ((now() at time zone 'utc')::date - 1, 'dust_share', 2),
         ((now() at time zone 'utc')::date - 1, 'card_share', 1),
         ((now() at time zone 'utc')::date - 30, 'dust_load', 9)`,
    );
    const read = (days: number | null) =>
      s.as("authenticated", async () => (await s.row<{ r: Row[] }>(`select public.board_play_counts($1) as r`, [days])).r);

    await t.step("the last days, today first, every event with 0 where nothing was counted", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      const days = await read(3);
      assertEquals(days.length, 3);
      assertEquals(days.map((d) => [d.dust_load, d.dust_share, d.card_share, d.dust_next_card]), [
        [5, 0, 0, 0],
        [0, 2, 1, 0],
        [0, 0, 0, 0],
      ]);
      assert(String(days[0]!.day) > String(days[1]!.day), "newest first");
      assertEquals((await read(null)).length, 14, "the default is 14 days");
      assertEquals((await read(1000)).length, 90, "at most 90 days");
      assertEquals((await read(0)).length, 1, "at least today");
      assertEquals((await read(31)).at(-1)!.dust_load, 9);
    });

    await t.step("an aal1 session, a moderator, an outsider and anon are refused", async () => {
      await s.signInAs(BOARD_EMAIL, "aal1");
      await assertRejects(() => read(3), Error, "A second factor is required");
      await s.signInAs(MODERATOR_EMAIL, "aal2");
      await assertRejects(() => read(3), Error, "Board membership is required");
      await s.signInAs("someone@example.com", "aal2");
      await assertRejects(() => read(3), Error, "Board membership is required");
      await s.signInAs(null);
      await assertRejects(() => s.as("anon", () => s.rows(`select public.board_play_counts(3)`)), Error, "permission denied");
    });

    await t.step("the migration applies a second time without error and keeps the counts", async () => {
      await s.db.exec(await s.sqlOf(MIGRATION));
      assertEquals((await s.row<{ n: string }>(`select sum(count)::text as n from public.play_counts`)).n, "17");
    });
  } finally {
    await s.close();
  }
});
