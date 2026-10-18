// Suggested by on PGlite (20261018120000_card_suggested_by.sql, docs/specs/place.md): a card's
// public read lists the ideas in the clusters linked to it, most backed first, follows a merge to the
// root cluster, leaves out held, declined and suspended players' ideas, answers nothing for a card the
// public may not read, and anon may call it. Every migration runs in order behind the Supabase shim,
// as board_moderation_test.ts runs them, and this one applies twice.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261018120000_card_suggested_by.sql";
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const OPTS = { sanitizeOps: false, sanitizeResources: false };
const BOARD_EMAIL = "board@mobmachine.games";

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
type Json = Record<string, any>;
type User = { id: string; email: string };

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
  const signIn = async (user: User | null, aal: "aal1" | "aal2" = "aal1") => {
    await db.query(`select set_config('request.jwt.claim.email', $1, false)`, [user?.email ?? ""]);
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [user === null ? "" : JSON.stringify({ sub: user.id, email: user.email, aal })]);
  };
  await db.exec(SHIM);
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  assert(names.includes(MIGRATION), `${MIGRATION} is in the migrations folder`);
  const sqlOf = async (name: string) => (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "");
  for (const name of names) await db.exec(await sqlOf(name));
  await db.query(`insert into public.board_members (email, role) values ($1, 'board')`, [BOARD_EMAIL]);
  const user = async (email: string): Promise<User> => {
    const id = (await row<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email])).id;
    return { id, email };
  };
  const call = async <T = Json>(who: User | null, sql: string, params: unknown[] = []): Promise<T> => {
    await signIn(who);
    return await as("authenticated", async () => (await row<{ r: T }>(`select ${sql} as r`, params)).r);
  };
  const board = async <T = Json>(sql: string, params: unknown[] = []): Promise<T> => {
    await signIn({ id: crypto.randomUUID(), email: BOARD_EMAIL }, "aal2");
    return await as("authenticated", async () => (await row<{ r: T }>(`select ${sql} as r`, params)).r);
  };
  const anon = async <T = Json>(sql: string, params: unknown[] = []): Promise<T> => {
    await signIn(null);
    return await as("anon", async () => (await row<{ r: T }>(`select ${sql} as r`, params)).r);
  };
  const cluster = async (key: string, mergedInto: string | null = null) =>
    (await row<{ id: string }>(
      `insert into community.suggestion_clusters (key, area, kind, summary, fit, merged_into) values ($1, 'dust', 'feature', 'A summary.', 0.5, $2) returning id`,
      [key, mergedInto],
    )).id;
  // A suggestion the Curator has triaged into the cluster key given, not yet clustered.
  const triaged = async (who: User, title: string, key: string) => {
    const id = (await call(who, `public.submit_suggestion('dust', $1, '')`, [title])).id as string;
    await db.query(`update community.suggestions set state = 'reviewed' where id = $1`, [id]);
    await db.query(
      `insert into community.suggestion_triage (suggestion_id, area, kind, cluster_key, fit, flags, summary) values ($1, 'dust', 'feature', $2, 0.5, '{}', 'A summary.')`,
      [id, key],
    );
    await db.query(`select community.cluster_suggestion($1)`, [id]);
    return id;
  };
  return { db, rows, row, as, signIn, sqlOf, user, call, board, anon, cluster, triaged, close: () => db.close() };
}

Deno.test("a card names the ideas it came from", OPTS, async (t) => {
  const s = await studio();
  try {
    const card = async (title: string) =>
      (await s.row<{ id: string }>(
        `insert into public.cards (bucket, source, shape, lane, folder, title, stage, horizon)
         values ('game', 'board', 'oneoff', 'config', 'seed-1', $1, 'proposed', 'now') returning id`,
        [title],
      )).id;
    const ideas = async (cardId: string | null) => (await s.anon<{ items: Json[] }>(`public.community_card_ideas($1)`, [cardId])).items;
    const titles = async (cardId: string | null) => (await ideas(cardId)).map((item) => item.title as string);

    const alice = await s.user("alice@example.com");
    const bob = await s.user("bob@example.com");
    const carol = await s.user("carol@example.com");
    const dan = await s.user("dan@example.com");
    const night = await s.triaged(alice, "Night mode", "night");
    const lamps = await s.triaged(bob, "Lamps at night", "night");
    const dusk = await s.triaged(carol, "A dusk palette", "dusk");
    const quiet = await s.triaged(dan, "Quiet nights", "night");
    const other = await s.triaged(dan, "Faster carts", "carts");
    await s.db.query(`update community.suggestions set votes = 5 where id = $1`, [lamps]);
    await s.db.query(`update community.suggestions set votes = 2 where id = $1`, [night]);
    const nightCluster = (await s.row<{ id: string }>(`select cluster_id as id from community.suggestions where id = $1`, [night])).id;
    const duskCluster = (await s.row<{ id: string }>(`select cluster_id as id from community.suggestions where id = $1`, [dusk])).id;
    const nightCard = await card("Night mode for Dust");

    await t.step("applies a second time", async () => {
      await s.db.exec(await s.sqlOf(MIGRATION));
    });

    await t.step("a card no cluster is linked to, an unknown card and no card answer no ideas", async () => {
      assertEquals(await ideas(nightCard), []);
      assertEquals(await ideas(crypto.randomUUID()), []);
      assertEquals(await ideas(null), []);
    });

    await t.step("the board links a cluster: anon reads its ideas, most backed first, with their authors", async () => {
      await s.board(`public.board_link_cluster_card($1, $2, 'drafted from the night ideas')`, [nightCluster, nightCard]);
      const items = await ideas(nightCard);
      assertEquals(items.map((item) => item.title), ["Lamps at night", "Night mode", "Quiet nights"]);
      assertEquals(items[0]!.cardId, nightCard);
      assert(items.every((item) => item.author !== null), "each idea names its author");
      assertEquals(await titles(await card("Another card")), []);
      assert(!(await titles(nightCard)).includes("Faster carts"), "an idea in another cluster is not credited");
      void other;
    });

    await t.step("a cluster merged into the linked one brings its ideas", async () => {
      await s.board(`public.board_merge_clusters($1, $2, 'same idea')`, [duskCluster, nightCluster]);
      assertEquals(await titles(nightCard), ["Lamps at night", "Night mode", "A dusk palette", "Quiet nights"]);
    });

    await t.step("held, declined and suspended players' ideas are left out", async () => {
      await s.db.query(`update community.suggestions set held = true where id = $1`, [quiet]);
      await s.db.query(`update community.suggestions set state = 'declined', decline_reason = 'duplicate' where id = $1`, [dusk]);
      const handle = (await s.call(bob, `public.my_profile()`)).handle as string;
      await s.board(`public.board_suspend_user($1, true, 'spam')`, [handle]);
      assertEquals(await titles(nightCard), ["Night mode"]);
      await s.board(`public.board_suspend_user($1, false, 'appeal')`, [handle]);
      assertEquals(await titles(nightCard), ["Lamps at night", "Night mode"]);
    });

    await t.step("a card the public may not read answers no ideas", async () => {
      await s.db.query(`update community.suggestion_clusters set card_id = null where id = $1`, [nightCluster]);
      const hidden = (await s.row<{ id: string }>(
        `insert into public.cards (bucket, source, shape, lane, folder, title, stage, horizon)
         values ('game', 'agent', 'oneoff', 'config', 'seed-1', 'A draft', 'proposed', 'now') returning id`,
      )).id;
      // An agent's draft is not public until the board approves it (card_is_public).
      assertEquals((await s.row<{ p: boolean }>(`select public.card_is_public($1) as p`, [hidden])).p, false);
      await s.db.query(`update community.suggestion_clusters set card_id = $1 where id = $2`, [hidden, nightCluster]);
      assertEquals(await ideas(hidden), []);
    });

    await t.step("only anon and authenticated may call it", async () => {
      const grants = await s.rows<{ grantee: string }>(
        `select grantee from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'community_card_ideas' order by grantee`,
      );
      const who = grants.map((g) => g.grantee).filter((g) => g !== "postgres");
      assertEquals(who, ["anon", "authenticated"]);
    });
  } finally {
    await s.close();
  }
});
