// The board-games-admin migration on PGlite (20261017220000_board_games_admin.sql,
// docs/specs/board-games-admin.md): the games table and its public view, the board's four game writes
// (each at the second factor, each logged with its reason in the moderation log), the richer
// board_games and board_agent_roster reads, and the card supply's stop for a game that takes no new
// cards. Every migration runs in order behind the Supabase shim, as board_roster_test.ts runs them.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261017220000_board_games_admin.sql";
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
  // The studio row and the two drafting roles, then the migrations that link jobs to roles again with
  // the roles in place (as supply_every_minute_test.ts seeds its studio), then this one again, since
  // supply_refill recreates enqueue_supply_draft.
  await db.exec(
    `insert into public.studio_state (id, credit_daily_cap_usd, credit_studio_daily_cap_usd, card_max_usd, daily_cap_usd, monthly_cap_usd, reserve_pct, incident_cap_usd)
       values (1, 10000, 10000, 25, 100, 500, 0, 0);
     insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);`,
  );
  for (const [name, klass] of [["Game Designer", "planner"], ["Game Director", "reviewer"]]) {
    await db.query(
      `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, write_access, agent_class)
       values ($1, $1, 'A small creature.', 'model-id', 0.1, 'plain', 'platform/agents/prompts/x.md', $2, $3)`,
      [name, klass === "planner", klass],
    );
  }
  for (const name of names.filter((n) => n >= "20260924400000")) await db.exec(await sqlOf(name));
  return { db, rows, row, as, signInAs, sqlOf, close: () => db.close() };
}

type Studio = Awaited<ReturnType<typeof studio>>;

const games = (s: Studio) => s.as("authenticated", async () => (await s.row<{ r: Row[] }>(`select public.board_games() as r`)).r);
const roster = (s: Studio) => s.as("authenticated", async () => (await s.row<{ r: Row[] }>(`select public.board_agent_roster() as r`)).r);
const write = (s: Studio, sql: string, params: unknown[] = []) => s.as("authenticated", () => s.row<{ r: Row }>(`select ${sql} as r`, params));
const log = (s: Studio) =>
  s.rows<{ actor_email: string; action: string; target: string; reason: string; details: Row }>(
    `select actor_email, action, target, reason, details from community.admin_log where target like 'game:%' order by id`,
  );

Deno.test("games: the table, the public view, the board's writes and its read", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("the seed row is Dust: live, featured, taking cards, with its blurb, address, art and events", async () => {
      const dust = await s.row(`select * from public.games where folder = 'seed-1'`);
      assertEquals(
        [dust.name, dust.status, dust.featured, dust.accepting_cards, dust.play_url, dust.box_art, dust.load_event, dust.share_event],
        ["Dust", "live", true, true, "https://play.mobmachine.games", "/games/dust-box-art.svg", "dust_load", "dust_share"],
      );
      assert(String(dust.blurb).startsWith("An idle game"));
    });

    await t.step("anon reads public_games, never the games table, and no one but the board's functions writes it", async () => {
      await s.signInAs(null);
      const pub = await s.as("anon", () => s.rows(`select * from public.public_games`));
      assertEquals(pub.map((g) => [g.folder, g.name, g.featured]), [["seed-1", "Dust", true]]);
      assertEquals(Object.keys(pub[0]!).sort(), ["accepting_cards", "blurb", "box_art", "featured", "folder", "name", "play_url", "status"]);
      await assertRejects(() => s.as("anon", () => s.rows(`select * from public.games`)), Error, "permission denied");
      await s.signInAs(BOARD_EMAIL, "aal2");
      await assertRejects(() => s.as("authenticated", () => s.rows(`update public.games set featured = false`)), Error, "permission denied");
      await assertRejects(() => s.as("authenticated", () => s.rows(`select public.board_game_row('seed-1')`)), Error, "permission denied");
      await assertRejects(() => s.as("service_role", () => s.rows(`select public.board_set_game_status('seed-1', 'paused', 'r')`)), Error, "permission denied");
    });

    await t.step("board_games carries each game's row, its loads and shares, and its log; a folder with no row lists as in development", async () => {
      await s.db.exec(
        `insert into public.play_counts (day, event, count) values
           ((now() at time zone 'utc')::date, 'dust_load', 5),
           ((now() at time zone 'utc')::date - 3, 'dust_load', 7),
           ((now() at time zone 'utc')::date - 20, 'dust_load', 11),
           ((now() at time zone 'utc')::date - 60, 'dust_load', 13),
           ((now() at time zone 'utc')::date, 'dust_share', 2),
           ((now() at time zone 'utc')::date, 'card_share', 99)`,
      );
      await s.signInAs(BOARD_EMAIL, "aal2");
      const dust = (await games(s)).find((g) => g.folder === "seed-1")!;
      assertEquals([dust.name, dust.status, dust.accepting_cards, dust.featured, dust.play_url, dust.box_art], [
        "Dust", "live", true, true, "https://play.mobmachine.games", "/games/dust-box-art.svg",
      ]);
      const plays = dust.plays as Row;
      assertEquals(plays.loads, { day: 5, week: 12, month: 23, total: 36 });
      assertEquals(plays.shares, { day: 2, week: 2, month: 2, total: 2 });
      assertEquals(dust.admin_log, []);
      await s.db.exec(`alter type public.card_folder add value if not exists 'seed-2'`);
      const second = (await games(s)).find((g) => g.folder === "seed-2")!;
      assertEquals([second.name, second.status, second.accepting_cards, second.featured, second.blurb], ["seed-2", "in_development", true, false, null]);
      assertEquals((second.plays as Row).loads, { day: 0, week: 0, month: 0, total: 0 });
    });

    await t.step("status: one of three words, logged with its reason", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      assertEquals((await write(s, `public.board_set_game_status('seed-1', 'paused', 'A crash on load')`)).r, { folder: "seed-1", status: "paused" });
      await assertRejects(() => write(s, `public.board_set_game_status('seed-1', 'gone', 'x')`), Error, "A status is live, paused or in_development");
      await assertRejects(() => write(s, `public.board_set_game_status('seed-1', 'live', '   ')`), Error, "Give a reason of 1 to 500 characters");
      await assertRejects(() => write(s, `public.board_set_game_status('platform', 'live', 'x')`), Error, "No game has the folder platform");
      await assertRejects(() => write(s, `public.board_set_game_status('seed-9', 'live', 'x')`), Error, "No game has the folder seed-9");
      assertEquals((await s.row(`select status from public.games where folder = 'seed-1'`)).status, "paused");
      assertEquals(await log(s), [
        { actor_email: BOARD_EMAIL, action: "set_game_status", target: "game:seed-1", reason: "A crash on load", details: { from: "live", to: "paused" } },
      ]);
    });

    await t.step("accepting new cards: off and on, each logged", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      await write(s, `public.board_set_game_accepting('seed-1', false, 'Hold drafts while we fix the crash')`);
      assertEquals((await s.row(`select accepting_cards from public.games where folder = 'seed-1'`)).accepting_cards, false);
      await assertRejects(() => write(s, `public.board_set_game_accepting('seed-1', null, 'x')`), Error, "p_accepting is required");
      const last = (await log(s)).at(-1)!;
      assertEquals([last.action, last.reason, last.details], ["close_game_cards", "Hold drafts while we fix the crash", { from: true, to: false }]);
    });

    await t.step("the card supply queues no draft while Dust takes no new cards, and queues one again after", async () => {
      const enqueue = () => s.row<{ r: Row }>(`select public.enqueue_supply_draft() as r`);
      const check = (await s.row<{ r: Row }>(`select public.supply_draft_check() as r`)).r;
      assertEquals([check.short, check.reason], [true, null]);
      const paused = (await enqueue()).r;
      assertEquals([paused.queued, paused.reason], [false, "game_paused"]);
      assertEquals((await s.row<{ n: number }>(`select count(*)::int as n from public.job_runs where job_name = 'draft_card'`)).n, 0);
      await s.signInAs(BOARD_EMAIL, "aal2");
      await write(s, `public.board_set_game_accepting('seed-1', true, 'Fixed')`);
      const open = (await enqueue()).r;
      assertEquals([open.queued, open.reason], [true, null]);
      assertEquals((await log(s)).at(-1)!.action, "open_game_cards");
    });

    await t.step("featured: at most one game, so featuring another unfeatures Dust, and the log names it", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      const r = (await write(s, `public.board_set_game_featured('seed-2', true, 'The new game')`)).r;
      assertEquals(r, { folder: "seed-2", featured: true, unfeatured: "seed-1" });
      assertEquals(await s.rows(`select folder, featured from public.games order by folder`), [
        { folder: "seed-1", featured: false },
        { folder: "seed-2", featured: true },
      ]);
      const last = (await log(s)).at(-1)!;
      assertEquals([last.action, last.target, last.details], ["feature_game", "game:seed-2", { from: false, to: true, unfeatured: "seed-1" }]);
      await write(s, `public.board_set_game_featured('seed-2', false, 'Not yet')`);
      assertEquals((await s.rows(`select folder from public.games where featured`)).length, 0);
      await write(s, `public.board_set_game_featured('seed-1', true, 'Back to Dust')`);
      await assertRejects(() => s.db.exec(`update public.games set featured = true where folder = 'seed-2'`), Error, "duplicate key");
    });

    await t.step("blurb: cleaned, one line of at most 280 characters, through the content filter; empty clears it", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      const r = (await write(s, `public.board_set_game_blurb('seed-1', $1, 'Sharper line')`, ["A quarry idle game.\nSee https://example.com <b>now</b>"])).r;
      assertEquals(r.blurb, "A quarry idle game. See now");
      assertEquals((await s.row(`select blurb from public.public_games where folder = 'seed-1'`)).blurb, "A quarry idle game. See now");
      const bad = ["c", "o", "c", "a", "i", "n", "e"].join("");
      await assertRejects(() => write(s, `public.board_set_game_blurb('seed-1', $1, 'x')`, [`More ${bad} here`]), Error, "content filter");
      await assertRejects(() => write(s, `public.board_set_game_blurb('seed-1', $1, 'x')`, ["a".repeat(281)]), Error, "at most 280 characters");
      assertEquals((await write(s, `public.board_set_game_blurb('seed-1', '', 'Clear it')`)).r.blurb, null);
      const last = (await log(s)).at(-1)!;
      assertEquals([last.action, last.details], ["set_game_blurb", { from: "A quarry idle game. See now", to: null }]);
    });

    await t.step("board_games shows each game's five newest log entries, newest first", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      const dust = (await games(s)).find((g) => g.folder === "seed-1")!;
      const entries = dust.admin_log as Row[];
      assertEquals(entries.length, 5);
      assertEquals(entries.map((e) => e.action), ["set_game_blurb", "set_game_blurb", "feature_game", "open_game_cards", "close_game_cards"]);
      assertEquals(entries[0]!.reason, "Clear it");
    });

    await t.step("every write and read refuses an aal1 session, a moderator, an outsider and anon", async () => {
      const calls = [
        `public.board_set_game_status('seed-1', 'live', 'r')`,
        `public.board_set_game_accepting('seed-1', true, 'r')`,
        `public.board_set_game_featured('seed-1', true, 'r')`,
        `public.board_set_game_blurb('seed-1', 'A line', 'r')`,
        `public.board_games()`,
        `public.board_agent_roster()`,
      ];
      const before = (await log(s)).length;
      for (const sql of calls) {
        await s.signInAs(BOARD_EMAIL, "aal1");
        await assertRejects(() => write(s, sql), Error, "A second factor is required");
        await s.signInAs(MODERATOR_EMAIL, "aal2");
        await assertRejects(() => write(s, sql), Error, "Board membership is required");
        await s.signInAs("someone@example.com", "aal2");
        await assertRejects(() => write(s, sql), Error, "Board membership is required");
        await s.signInAs(null);
        await assertRejects(() => s.as("anon", () => s.rows(`select ${sql}`)), Error, "permission denied");
      }
      assertEquals((await log(s)).length, before);
    });

    await t.step("the migration applies a second time without error and keeps the board's changes", async () => {
      await s.db.exec(await s.sqlOf(MIGRATION));
      await s.signInAs(BOARD_EMAIL, "aal2");
      const dust = (await games(s)).find((g) => g.folder === "seed-1")!;
      assertEquals([dust.status, dust.blurb, dust.featured], ["paused", null, true]);
    });
  } finally {
    await s.close();
  }
});

Deno.test("board_agent_roster: profile, status, spend against the caps, a week of runs and the pause history", OPTS, async (t) => {
  const s = await studio();
  try {
    const designer = (await s.row<{ id: string }>(`select id from public.roles where name = 'Game Designer'`)).id;
    await s.db.query(
      `update public.roles set description = 'Drafts the next cards.', status = 'running', avatar_url = '/team/designer.svg' where id = $1`,
      [designer],
    );
    await s.db.exec(
      `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, write_access, agent_class, status, trigger, description)
       values ('Host', 'Host', 'A loud bird.', 'model-id', 0, 'plain', 'h.md', false, 'web_only', 'planned', 'When the stream exists.', 'Narrates the stream.')`,
    );
    await s.db.query(`insert into public.jobs (name, role_id, calls_model) values ('roster_week', $1, false) on conflict (name) do nothing`, [designer]);
    await s.db.exec(
      `insert into public.job_runs (job_name, idem_key, origin, status, created_at) values
         ('roster_week', 'w1', 'schedule', 'succeeded', now() - interval '2 days'),
         ('roster_week', 'w2', 'schedule', 'failed', now() - interval '3 days'),
         ('roster_week', 'w3', 'schedule', 'succeeded', now() - interval '9 days')`,
    );
    // Spend this New York day billed to the studio, to the founder (not counted against the caps),
    // and another role's, so the studio's figures hold more than the role's.
    await s.db.query(
      `insert into public.ledger (role_id, model, usd, billed_to, created_at) values
         ($1, 'model-id', 1.5, 'studio', now()),
         ($1, 'model-id', 4, 'founder', now()),
         ((select id from public.roles where name = 'Game Director'), 'model-id', 2, 'studio', now())`,
      [designer],
    );
    await t.step("each role carries its profile, status, trigger and budget share", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      const list = await roster(s);
      const d = list.find((r) => r.name === "Game Designer")!;
      const host = list.find((r) => r.name === "Host")!;
      assertEquals([d.description, d.species_note, d.avatar_url, d.status, d.trigger, d.budget_share], [
        "Drafts the next cards.", "A small creature.", "/team/designer.svg", "running", null, 0.1,
      ]);
      assertEquals([host.status, host.trigger, host.description], ["planned", "When the stream exists.", "Narrates the stream."]);
    });

    await t.step("spend against the caps counts studio-billed rows this New York day and month, beside the studio's and the caps", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      const d = (await roster(s)).find((r) => r.name === "Game Designer")!;
      assertEquals(d.caps, { role_day_usd: 1.5, role_month_usd: 1.5, studio_day_usd: 3.5, studio_month_usd: 3.5, daily_cap_usd: 100, monthly_cap_usd: 500 });
      assertEquals((d.spend as Row).total_usd, 5.5);
    });

    await t.step("a week of runs by outcome, and the last run", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      const d = (await roster(s)).find((r) => r.name === "Game Designer")!;
      const week = d.runs_week as Row;
      assertEquals([week.succeeded, week.failed, week.skipped], [1, 1, 0]);
      assert(typeof week.last_at === "string");
    });

    await t.step("the pause history lists the role's pauses and resumes from board_actions, newest first", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      await s.as("authenticated", () => s.rows(`select public.set_role_pause($1, true, 'Too many drafts')`, [designer]));
      await s.as("authenticated", () => s.rows(`select public.set_role_pause($1, false, 'Back on')`, [designer]));
      const d = (await roster(s)).find((r) => r.name === "Game Designer")!;
      const history = d.pause_history as Row[];
      assertEquals(history.map((h) => [h.paused, h.reason, h.actor]), [[false, "Back on", BOARD_EMAIL], [true, "Too many drafts", BOARD_EMAIL]]);
      assertEquals((await roster(s)).find((r) => r.name === "Host")!.pause_history, []);
      assert(!JSON.stringify(await roster(s)).includes('"input"'), "no run input");
    });
  } finally {
    await s.close();
  }
});
