// The board's moderation fixes on PGlite (20261017230000_board_moderation_fix.sql,
// docs/specs/board-moderation-fixes.md): a suspended player's seeds and suggestions leave the public
// lists and come back on restore; a merge chain resolves to its root with a loop guard;
// board_merge_clusters refuses a cluster that was already merged, on either side, and keeps every
// chain one hop; and the migration repairs chains left from before it. Every migration runs in order
// behind the Supabase shim, as community_core_test.ts runs them.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261017230000_board_moderation_fix.sql";
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

Deno.test("a suspended player's seeds and suggestions leave the public lists until restored", OPTS, async (t) => {
  const s = await studio();
  try {
    const alice = await s.user("alice@example.com");
    const bob = await s.user("bob@example.com");
    const aliceIdea = (await s.call(alice, `public.submit_suggestion('dust', 'Night mode', '')`)).id;
    const bobIdea = (await s.call(bob, `public.submit_suggestion('dust', 'Faster carts', '')`)).id;
    const aliceSeed = (await s.call(alice, `public.save_seed('dust', 'dust:v3:alice', 'Alice run', true)`)).id;
    const bobSeed = (await s.call(bob, `public.save_seed('dust', 'dust:v3:bob', 'Bob run', true)`)).id;
    const handle = (await s.call(alice, `public.my_profile()`)).handle as string;
    const listed = async () => ({
      suggestions: ((await s.anon(`public.community_suggestions('new', null, null)`)).items as Json[]).map((i) => i.id).sort(),
      seeds: ((await s.anon(`public.community_seeds('new', null)`)).items as Json[]).map((i) => i.id).sort(),
    });

    await t.step("both players' content is listed before the suspension", async () => {
      assertEquals(await listed(), { suggestions: [aliceIdea, bobIdea].sort(), seeds: [aliceSeed, bobSeed].sort() });
    });

    await t.step("suspending a player hides their suggestions and seeds in every order", async () => {
      await s.board(`public.board_suspend_user($1, true, 'spam')`, [handle]);
      assertEquals(await listed(), { suggestions: [bobIdea], seeds: [bobSeed] });
      for (const sort of ["trending", "top_week", "top_all"]) {
        assertEquals(((await s.anon(`public.community_seeds($1, null)`, [sort])).items as Json[]).map((i) => i.id), [bobSeed], sort);
      }
      assertEquals(((await s.anon(`public.community_suggestions('top', 'dust', null)`)).items as Json[]).map((i) => i.id), [bobIdea]);
      // Nothing is deleted: the board still reads the suspended player's suggestion.
      assert(((await s.board(`public.board_suggestions(null, null)`)).items as Json[]).some((i) => i.id === aliceIdea));
    });

    await t.step("restoring the player lists their content again", async () => {
      await s.board(`public.board_suspend_user($1, false, 'appeal upheld')`, [handle]);
      assertEquals(await listed(), { suggestions: [aliceIdea, bobIdea].sort(), seeds: [aliceSeed, bobSeed].sort() });
    });

    await t.step("the public lists keep their grants: anon and authenticated may call them, the service role may not", async () => {
      await s.call(bob, `public.community_seeds('new', null)`);
      await assertRejects(() => s.as("service_role", () => s.rows(`select public.community_seeds('new', null)`)), Error, "permission denied");
      await assertRejects(() => s.as("service_role", () => s.rows(`select public.community_suggestions('new', null, null)`)), Error, "permission denied");
    });
  } finally {
    await s.close();
  }
});

Deno.test("merged clusters resolve to their root, and a merge refuses a merged cluster", OPTS, async (t) => {
  const s = await studio();
  try {
    const p = await s.user("p@example.com");
    const q = await s.user("q@example.com");

    await t.step("cluster_root follows a chain to the end, and gives null for a loop or a missing cluster", async () => {
      const c = await s.cluster("root-c");
      const b = await s.cluster("mid-b", c);
      const a = await s.cluster("leaf-a", b);
      const root = async (id: string) => (await s.row<{ r: string | null }>(`select community.cluster_root($1) as r`, [id])).r;
      assertEquals([await root(a), await root(b), await root(c)], [c, c, c]);
      assertEquals(await root(crypto.randomUUID()), null);
      const x = await s.cluster("loop-x");
      const y = await s.cluster("loop-y", x);
      await s.db.query(`update community.suggestion_clusters set merged_into = $2 where id = $1`, [x, y]);
      assertEquals([await root(x), await root(y)], [null, null]);
      await s.db.query(`update community.suggestion_clusters set merged_into = null where id = $1`, [x]);
    });

    await t.step("a triaged suggestion whose key names a cluster two merges down joins the root", async () => {
      const id = await s.triaged(p, "Dust that glows", "leaf-a");
      const root = (await s.row<{ id: string }>(`select id from community.suggestion_clusters where key = 'root-c'`)).id;
      assertEquals(await s.row(`select cluster_id, state from community.suggestions where id = $1`, [id]), { cluster_id: root, state: "clustered" });
    });

    await t.step("board_merge_clusters refuses a merged cluster on either side, and an outsider learns nothing", async () => {
      const ids = Object.fromEntries((await s.rows<{ key: string; id: string }>(`select key, id from community.suggestion_clusters`)).map((r) => [r.key, r.id]));
      const fresh = await s.cluster("fresh-d");
      await assertRejects(() => s.board(`public.board_merge_clusters($1, $2, 'tidy')`, [ids["mid-b"], fresh]), Error, "already merged");
      await assertRejects(() => s.board(`public.board_merge_clusters($1, $2, 'tidy')`, [fresh, ids["mid-b"]]), Error, "merge into that one");
      await assertRejects(() => s.board(`public.board_merge_clusters($1, $1, 'tidy')`, [fresh]), Error, "two different clusters");
      await assertRejects(() => s.board(`public.board_merge_clusters($1, $2, 'tidy')`, [crypto.randomUUID(), fresh]), Error, "No such cluster");
      await assertRejects(() => s.call(q, `public.board_merge_clusters($1, $2, 'tidy')`, [ids["mid-b"], fresh]), Error, "Board membership is required");
      const logged = ((await s.board(`public.board_moderation_log(null)`)).items as Json[]).filter((l) => l.action === "merge_clusters");
      assertEquals(logged, []);
    });

    await t.step("merging a root repoints every cluster merged into it, so each chain stays one hop", async () => {
      const ids = Object.fromEntries((await s.rows<{ key: string; id: string }>(`select key, id from community.suggestion_clusters`)).map((r) => [r.key, r.id]));
      const before = await s.triaged(q, "Sand that sparkles", "fresh-d");
      const out = await s.board(`public.board_merge_clusters($1, $2, 'same idea')`, [ids["root-c"], ids["fresh-d"]]);
      assertEquals(out, { into: ids["fresh-d"], moved: 1 });
      const merged = await s.rows<{ key: string; merged_into: string | null }>(`select key, merged_into from community.suggestion_clusters where key in ('leaf-a', 'mid-b', 'root-c', 'fresh-d') order by key`);
      assertEquals(merged, [
        { key: "fresh-d", merged_into: null },
        { key: "leaf-a", merged_into: ids["mid-b"] },
        { key: "mid-b", merged_into: ids["fresh-d"] },
        { key: "root-c", merged_into: ids["fresh-d"] },
      ]);
      assertEquals((await s.row<{ cluster_id: string }>(`select cluster_id from community.suggestions where id = $1`, [before])).cluster_id, ids["fresh-d"]);
      const later = await s.triaged(p, "Glowing dunes", "leaf-a");
      assertEquals((await s.row<{ cluster_id: string }>(`select cluster_id from community.suggestions where id = $1`, [later])).cluster_id, ids["fresh-d"]);
      // A merged cluster cannot be drafted from.
      await assertRejects(() => s.board(`public.board_draft_from_cluster($1, 'x')`, [ids["root-c"]]), Error, "merged into another");
    });

    await t.step("the migration repairs chains left from before it and moves suggestions off merged clusters, and runs twice", async () => {
      const ids = Object.fromEntries((await s.rows<{ key: string; id: string }>(`select key, id from community.suggestion_clusters`)).map((r) => [r.key, r.id]));
      const stranded = (await s.call(p, `public.submit_suggestion('dust', 'Stranded idea', '')`)).id;
      await s.db.query(`update community.suggestions set cluster_id = $2, state = 'clustered' where id = $1`, [stranded, ids["leaf-a"]]);
      const sql = await s.sqlOf(MIGRATION);
      await s.db.exec(sql);
      await s.db.exec(sql);
      const chains = await s.rows<{ key: string; merged_into: string | null }>(`select key, merged_into from community.suggestion_clusters where key in ('leaf-a', 'mid-b', 'root-c') order by key`);
      assertEquals(chains.map((c) => c.merged_into), [ids["fresh-d"], ids["fresh-d"], ids["fresh-d"]]);
      assertEquals((await s.row<{ cluster_id: string }>(`select cluster_id from community.suggestions where id = $1`, [stranded])).cluster_id, ids["fresh-d"]);
      const onMerged = await s.row<{ n: number }>(
        `select count(*)::int as n from community.suggestions s join community.suggestion_clusters c on c.id = s.cluster_id where c.merged_into is not null`,
      );
      assertEquals(onMerged.n, 0);
    });

    await t.step("the new helper is reachable by no API role", async () => {
      for (const role of ["anon", "authenticated", "service_role"]) {
        await assertRejects(() => s.as(role, () => s.rows(`select community.cluster_root(gen_random_uuid())`)), Error, "permission denied", role);
      }
    });
  } finally {
    await s.close();
  }
});
