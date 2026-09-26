// The design-review migration on PGlite (docs/specs/design-review.md): cards.review_rounds starts at
// 0 and refuses a negative count; record_review_round adds one and returns the new count, refuses a
// card that does not exist and a null card, and is the service role's alone; anon and authenticated
// read neither the column nor dispatcher_cards, which now carries it for the dispatcher's recovery;
// and the migration applies a second time. Every migration runs in order behind the same Supabase
// shim as reports_supply_test.ts.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20260925200000_design_review.sql";
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const OPTS = { sanitizeOps: false, sanitizeResources: false };
const NO_CARD = "00000000-0000-4000-8000-000000000000";

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

async function readMigrations(): Promise<{ name: string; sql: string }[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  return await Promise.all(names.map(async (name) => ({ name, sql: (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "") })));
}

async function studio() {
  const db = new PGlite();
  const row = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T> => {
    const result = await db.query<T>(sql, params);
    assert(result.rows.length > 0, `no row for: ${sql}`);
    return result.rows[0]!;
  };
  const as = async <T>(role: string, run: () => Promise<T>): Promise<T> => {
    await db.exec(`set role ${role}`);
    try {
      return await run();
    } finally {
      await db.exec(`reset role`);
    }
  };
  await db.exec(SHIM);
  const migrations = await readMigrations();
  for (const m of migrations) await db.exec(m.sql);
  const card = async (title: string) =>
    (await row<{ id: string }>(
      `insert into public.cards (bucket, source, shape, lane, folder, title, intent, funding_target_usd, stage, horizon)
       values ('game', 'board', 'goal', 'code', 'seed-1', $1, 'An intent.', 5, 'gated', 'now') returning id`,
      [title],
    )).id;
  const round = async (id: string) => (await row<{ n: number }>(`select public.record_review_round($1) as n`, [id])).n;
  const rounds = async (id: string) => (await row<{ n: number }>(`select review_rounds as n from public.cards where id = $1`, [id])).n;
  return { db, row, as, card, round, rounds, migrations, close: () => db.close() };
}

Deno.test("record_review_round counts a card's revise rounds, for the service role alone", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("the migration applies a second time", async () => {
      const m = s.migrations.find((x) => x.name === MIGRATION)!;
      await s.db.exec(m.sql);
    });

    await t.step("a card starts at 0 rounds, and each call adds one and returns the new count", async () => {
      const id = await s.card("A visual card");
      const other = await s.card("Another card");
      assertEquals(await s.rounds(id), 0);
      assertEquals(await s.round(id), 1);
      assertEquals(await s.round(id), 2);
      assertEquals(await s.round(id), 3);
      assertEquals(await s.rounds(id), 3);
      assertEquals(await s.rounds(other), 0);
    });

    await t.step("a card that does not exist, or no card, is refused and nothing changes", async () => {
      await assertRejects(() => s.round(NO_CARD), Error, `Card ${NO_CARD} does not exist`);
      await assertRejects(() => s.db.query(`select public.record_review_round(null)`), Error, "A card is required");
    });

    await t.step("the count cannot go below zero", async () => {
      const id = await s.card("A card set by hand");
      await assertRejects(() => s.db.query(`update public.cards set review_rounds = -1 where id = $1`, [id]), Error, "cards_review_rounds_check");
      assertEquals(await s.rounds(id), 0);
    });

    await t.step("anon and authenticated cannot run it; the service role can", async () => {
      const id = await s.card("A card the public cannot count");
      for (const role of ["anon", "authenticated"]) {
        await assertRejects(() => s.as(role, () => s.db.query(`select public.record_review_round($1)`, [id])), Error, "permission denied");
      }
      assertEquals(await s.as("service_role", () => s.round(id)), 1);
      for (const [grantee, can] of [["anon", false], ["authenticated", false], ["service_role", true]] as const) {
        const has = (await s.row<{ has: boolean }>(`select has_function_privilege($1, 'public.record_review_round(uuid)', 'execute') as has`, [grantee])).has;
        assertEquals(has, can, grantee);
      }
    });

    await t.step("anon and authenticated cannot read the column; dispatcher_cards carries it for the service role only", async () => {
      const id = await s.card("A card the dispatcher recovers");
      await s.round(id);
      for (const role of ["anon", "authenticated"]) {
        await assertRejects(() => s.as(role, () => s.db.query(`select review_rounds from public.cards`)), Error, "permission denied");
        await assertRejects(() => s.as(role, () => s.db.query(`select review_rounds from public.dispatcher_cards`)), Error, "permission denied");
      }
      const seen = await s.as("service_role", () => s.row<{ review_rounds: number; stage: string }>(`select review_rounds, stage::text as stage from public.dispatcher_cards where id = $1`, [id]));
      assertEquals(seen, { review_rounds: 1, stage: "gated" });
    });

    await t.step("dispatcher_cards keeps agent-system-core's columns in order, review_rounds appended", async () => {
      const columns = await s.db.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'dispatcher_cards' order by ordinal_position`,
      );
      const names = columns.rows.map((c) => c.column_name);
      assertEquals(names.slice(0, 3), ["id", "bucket", "source"]);
      assertEquals(names.slice(-4), ["needs_approval", "approved", "executor_paused", "review_rounds"]);
      assertEquals(names.length, 41);
    });
  } finally {
    await s.close();
  }
});
