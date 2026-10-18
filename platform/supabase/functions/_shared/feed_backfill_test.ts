// The pipe's history on PGlite (20261018000000_feed_backfill.sql, docs/specs/community-core.md):
// cards and payments made before the feed's triggers existed get the lines the triggers would have
// posted, at the time each happened, oldest first; a second run and a line a trigger already posted
// are never doubled; a rejected card posts nothing. Every migration runs in order behind the Supabase
// shim, as community_core_test.ts runs them.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261018000000_feed_backfill.sql";
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

type Row = Record<string, unknown>;

async function studio() {
  const db = new PGlite();
  const rows = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
  const row = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T> => {
    const all = await rows<T>(sql, params);
    assert(all.length > 0, `no row for: ${sql}`);
    return all[0]!;
  };
  await db.exec(SHIM);
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  const sqlOf = async (name: string) => (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "");
  for (const name of names) await db.exec(await sqlOf(name));
  // Rarity is a function of the card's random id, so each card's is set after insert.
  const card = async (title: string, stage: string, at: string, rarity = "common") => {
    const id = (await row<{ id: string }>(
      `insert into public.cards (bucket, source, shape, lane, folder, title, stage, horizon, created_at, live_at)
       values ('game', 'board', 'oneoff', 'config', 'seed-1', $1, $2::public.card_stage, 'now', $3::timestamptz,
         case when $2 = 'live' then $3::timestamptz + interval '1 day' end) returning id`,
      [title, stage, at],
    )).id;
    await db.query(`update public.cards set rarity = $2 where id = $1`, [id, rarity]);
    return id;
  };
  const pay = async (usd: number, cardId: string | null, at: string) =>
    (await row<{ id: string }>(
      `insert into public.contributions (rail, contributor_id, amount_usd, net_usd, goal_card_id, entry, payer_key, stripe_event_id, created_at)
       values ('stripe', md5(gen_random_uuid()::text), $1, $1, $2, 'payment', 'email:x', 'evt_' || gen_random_uuid(), $3::timestamptz) returning id`,
      [usd, cardId, at],
    )).id;
  const events = () =>
    rows<{ id: number; at: string; kind: string; text: string; dedupe: string; amount_cents: number | null }>(
      `select id, at::text, kind, text, dedupe, amount_cents from community.events order by id`,
    );
  return { db, rows, row, sqlOf, card, pay, events, close: () => db.close() };
}

Deno.test("the feed backfill posts the studio's history once, oldest first", OPTS, async (t) => {
  const s = await studio();
  try {
    // History made while the feed did not exist: the triggers stay quiet.
    await s.db.exec(`set community.quiet = 'on'`);
    const shipped = await s.card("Cheaper first Gatherer", "live", "2026-09-15 04:00:00+00");
    const open = await s.card("A brighter dust storm", "proposed", "2026-09-20 10:00:00+00", "rare");
    const rejected = await s.card("Not this one", "rejected", "2026-09-21 10:00:00+00");
    await s.pay(5, open, "2026-09-22 12:00:00+00");
    await s.pay(2, null, "2026-09-23 12:00:00+00");
    await s.db.exec(`reset community.quiet`);
    assertEquals((await s.events()).length, 0);

    await t.step("posts each card opening, each ship and each payment at its own time", async () => {
      await s.db.exec(await s.sqlOf(MIGRATION));
      const got = await s.events();
      assertEquals(got.map((e) => [e.kind, e.text]), [
        ["card_opened", "A new card opened: Cheaper first Gatherer"],
        ["shipped", "Cheaper first Gatherer shipped"],
        ["card_opened", "A rare card appeared: A brighter dust storm"],
        ["contribution", "{actor} put $5.00 on A brighter dust storm"],
        ["contribution", "{actor} put $2.00 into the Machine"],
      ]);
      assertEquals(got.map((e) => e.dedupe).filter((d) => d.includes(rejected)), []);
      assertEquals(got.find((e) => e.kind === "shipped")!.dedupe, `shipped:${shipped}`);
      assertEquals(got.filter((e) => e.kind === "contribution").map((e) => e.amount_cents), [500, 200]);
      const times = got.map((e) => Date.parse(e.at));
      assertEquals(times, [...times].sort((a, b) => a - b), "ids follow time");
    });

    await t.step("a second run and a line a trigger posted are never doubled", async () => {
      const later = await s.card("Opened after go-live", "proposed", "2026-10-18 00:00:00+00");
      const before = (await s.events()).length;
      await s.db.exec(await s.sqlOf(MIGRATION));
      const got = await s.events();
      assertEquals(got.length, before);
      assertEquals(got.filter((e) => e.dedupe === `opened:${later}`).length, 1);
    });
  } finally {
    await s.close();
  }
});
