// The board-roster migration on PGlite (20261017210000_board_roster.sql): board_games and
// board_agent_roster answer a board member at the second factor only; the games list every folder
// but the site's, with their open and shipped cards and newest deploys; the roster lists every role
// with its model, tools, write access, pause, ledger spend and newest job runs, and never a run's
// input or output. Every migration runs in order behind the Supabase shim, as play_counts_test.ts runs them.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261017210000_board_roster.sql";
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
  return { db, rows, row, as, signInAs, sqlOf, close: () => db.close() };
}

Deno.test("board_games and board_agent_roster answer the board at the second factor", OPTS, async (t) => {
  const s = await studio();
  try {
    // Two roles, a job for one, its runs and spend, cards in both folders and deploys for the game.
    const builder = (await s.row<{ id: string }>(
      `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, tools_json, write_access)
       values ('Roster Builder', 'Builder', 'a test role', 'claude-test', 0.1, 'plain', 'x.md', '["Read","Edit"]', true) returning id`,
    )).id;
    await s.db.exec(
      `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, tools_json, write_access)
       values ('Roster Reader', 'Reader', 'a test role', 'claude-test-small', 0.1, 'plain', 'y.md', '[]', false)`,
    );
    await s.db.query(`insert into public.jobs (name, role_id, calls_model) values ('roster_build', $1, true)`, [builder]);
    await s.db.exec(
      `insert into public.job_runs (job_name, idem_key, origin, status, input, output, created_at) values
         ('roster_build', 'r1', 'schedule', 'succeeded', '{"secret":"input"}', '{"secret":"output"}', now() - interval '2 hours'),
         ('roster_build', 'r2', 'schedule', 'failed', '{}', null, now() - interval '1 hour'),
         ('roster_build', 'r3', 'board', 'succeeded', '{}', null, now() - interval '3 days')`,
    );
    await s.db.query(
      `insert into public.ledger (role_id, model, usd, created_at) values ($1, 'claude-test', 1.25, now() - interval '1 hour'), ($1, 'claude-test', 2, now() - interval '10 days')`,
      [builder],
    );
    const card = async (folder: string, title: string, stage: string) => {
      await s.db.query(
        `insert into public.cards (bucket, source, shape, lane, folder, title, stage, live_at)
         values ((enum_range(null::public.card_bucket))[1], (enum_range(null::public.card_source))[1], (enum_range(null::public.card_shape))[1],
                 (enum_range(null::public.card_lane))[1], $1::public.card_folder, $2, $3::public.card_stage, case when $3 = 'live' then now() end)`,
        [folder, title, stage],
      );
    };
    await card("seed-1", "Open one", "building");
    await card("seed-1", "Shipped one", "live");
    await card("seed-1", "Rejected one", "rejected");
    await card("platform", "A site card", "building");
    await s.db.exec(
      `insert into public.deploys (folder, sha, is_green, created_at) values
         ('seed-1', 'aaa111', true, now() - interval '2 days'),
         ('seed-1', 'bbb222', false, now() - interval '1 day')`,
    );
    const games = () => s.as("authenticated", async () => (await s.row<{ r: Row[] }>(`select public.board_games() as r`)).r);
    const roster = () => s.as("authenticated", async () => (await s.row<{ r: Row[] }>(`select public.board_agent_roster() as r`)).r);

    await t.step("board_games lists each game folder, not the site's, with its cards and deploys", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      const list = await games();
      assertEquals(list.map((g) => g.folder), ["seed-1"]);
      const dust = list[0]!;
      assertEquals([dust.open_count, dust.shipped_count], [1, 1]);
      assertEquals((dust.open_cards as Row[]).map((c) => c.title), ["Open one"]);
      assertEquals((dust.shipped_cards as Row[]).map((c) => c.title), ["Shipped one"]);
      assertEquals((dust.latest_deploy as Row).sha, "bbb222");
      assertEquals((dust.latest_deploy as Row).is_green, false);
      assertEquals((dust.latest_green_deploy as Row).sha, "aaa111");
    });

    await t.step("board_agent_roster lists every role with tools, write access, spend and runs, never a run's input or output", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      const list = await roster();
      const b = list.find((r) => r.name === "Roster Builder")!;
      const reader = list.find((r) => r.name === "Roster Reader")!;
      assertEquals([b.model, b.tools, b.write_access, b.paused, b.jobs], ["claude-test", ["Read", "Edit"], true, false, ["roster_build"]]);
      assertEquals(b.spend, { day_usd: 1.25, week_usd: 1.25, month_usd: 3.25, total_usd: 3.25 });
      assertEquals(b.runs_day, { succeeded: 1, failed: 1, skipped: 0, queued: 0, running: 0 });
      const runs = b.recent_runs as Row[];
      assertEquals(runs.map((r) => r.status), ["failed", "succeeded", "succeeded"]);
      assert(!JSON.stringify(list).includes("secret"), "no run input or output");
      assertEquals([reader.write_access, reader.tools, reader.recent_runs, (reader.spend as Row).total_usd], [false, [], [], 0]);
    });

    await t.step("the per-role on/off is the existing set_role_pause, and the roster shows it", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      await s.as("authenticated", () => s.rows(`select public.set_role_pause($1, true, 'roster test')`, [builder]));
      const b = (await roster()).find((r) => r.name === "Roster Builder")!;
      assertEquals([b.paused, b.paused_reason], [true, "roster test"]);
    });

    await t.step("an aal1 session, a moderator, an outsider and anon are refused", async () => {
      for (const read of [games, roster]) {
        await s.signInAs(BOARD_EMAIL, "aal1");
        await assertRejects(() => read(), Error, "A second factor is required");
        await s.signInAs(MODERATOR_EMAIL, "aal2");
        await assertRejects(() => read(), Error, "Board membership is required");
        await s.signInAs("someone@example.com", "aal2");
        await assertRejects(() => read(), Error, "Board membership is required");
      }
      await s.signInAs(null);
      await assertRejects(() => s.as("anon", () => s.rows(`select public.board_games()`)), Error, "permission denied");
      await assertRejects(() => s.as("anon", () => s.rows(`select public.board_agent_roster()`)), Error, "permission denied");
    });

    await t.step("the migration applies a second time without error", async () => {
      await s.db.exec(await s.sqlOf(MIGRATION));
      await s.signInAs(BOARD_EMAIL, "aal2");
      assertEquals((await games()).length, 1);
    });
  } finally {
    await s.close();
  }
});
