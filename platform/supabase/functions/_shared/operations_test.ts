// The operations migrations on PGlite (docs/specs/operations.md): the new aggregate counters, the
// daily metrics (counts and sums only, unreadable by anon and authenticated, recomputed from the
// existing tables), the benchmark review's job, inputs, events and record, the benchmark findings,
// and the Discord announcements' structured, once-only feed. Every migration runs in order behind
// the Supabase shim, as play_counts_test.ts runs them, and both new migrations apply twice.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const OPERATIONS = ["20261017200000_benchmark_counters.sql", "20261017200100_benchmark_review.sql"];
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
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

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
  await db.query(`insert into public.board_members (email, role) values ($1, 'board')`, [BOARD_EMAIL]);
  const json = async (sql: string, params: unknown[] = []): Promise<Json> => (await row<{ r: Json }>(sql, params)).r;
  const metric = async (day: string, name: string): Promise<number | null> => {
    const found = await rows<{ value: string }>(`select value::text from public.daily_metrics where day = $1::date and metric = $2`, [day, name]);
    return found.length === 0 ? null : Number(found[0]!.value);
  };
  return { db, rows, row, as, signInAs, sqlOf, json, metric, close: () => db.close() };
}

const today = () => new Date().toISOString().slice(0, 10);

Deno.test("the operations migrations: counters, daily metrics, the benchmark review and the announcements", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("both migrations apply a second time", async () => {
      for (const name of OPERATIONS) await s.db.exec(await s.sqlOf(name));
    });

    await t.step("anon counts each new aggregate counter and still drops unknown names", async () => {
      await s.as("anon", async () => {
        for (const event of ["home_load", "home_load", "dust_load", "dust_return_1d", "dust_seed_open", "broadcast_qr", "discord_click"]) {
          assertEquals((await s.row<{ ok: boolean }>(`select public.count_play_event($1) as ok`, [event])).ok, true, event);
        }
        assertEquals((await s.row<{ ok: boolean }>(`select public.count_play_event('player@example.com') as ok`)).ok, false);
      });
    });

    await t.step("refresh_daily_metrics writes counts and sums from the existing tables, and nothing that names anyone", async () => {
      // Two payers: one pays twice today, one once; a Machine payment has no card.
      await s.db.exec(`
        insert into public.contributions (rail, contributor_id, payer_key, amount_usd, net_usd, studio_usd, agents_usd, studio_pct_chosen, created_at)
        values ('stripe', 'Supporter 1', 'email:a', 10, 9.5, 1.9, 6.65, 20, greatest(now() - interval '2 seconds', date_trunc('day', now() at time zone 'utc') at time zone 'utc')),
          ('stripe', 'Supporter 1', 'email:a', 4, 3.7, 0.74, 2.59, 20, now()),
          ('stripe', 'Supporter 2', 'email:b', 25, 24, 4.8, 16.8, 20, now());
      `);
      const written = (await s.row<{ n: number }>(`select public.refresh_daily_metrics((now() at time zone 'utc')::date) as n`)).n;
      assert(written > 20, `wrote ${written} metrics`);
      assertEquals(await s.metric(today(), "money.payments"), 3);
      assertEquals(await s.metric(today(), "money.gross_usd"), 39);
      assertEquals(await s.metric(today(), "money.supporters"), 2);
      assertEquals(await s.metric(today(), "money.supporters_30d"), 2);
      assertEquals(await s.metric(today(), "money.new_supporters"), 2);
      assertEquals(await s.metric(today(), "money.repeat_supporters"), 1);
      assertEquals(await s.metric(today(), "money.payments_under_5"), 1);
      assertEquals(await s.metric(today(), "money.median_30d"), 10);
      assertEquals(await s.metric(today(), "play.home_load"), 2);
      assertEquals(await s.metric(today(), "play.dust_load"), 1);
      // Recomputing replaces, never adds.
      await s.row(`select public.refresh_recent_metrics() as n`);
      assertEquals(await s.metric(today(), "money.payments"), 3);
      // Only a day, a metric name and a number: no payer key appears anywhere in the table.
      const columns = (await s.rows<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'daily_metrics' order by ordinal_position`,
      )).map((c) => c.column_name);
      assertEquals(columns, ["day", "metric", "value", "computed_at"]);
      const names = (await s.rows<{ metric: string }>(`select metric from public.daily_metrics`)).map((m) => m.metric).join(" ");
      assert(!names.includes("email:"), "no payer key in a metric name");
    });

    await t.step("anon and authenticated read no metrics; the board reads them at the second factor", async () => {
      for (const role of ["anon", "authenticated"]) {
        await assertRejects(() => s.as(role, () => s.rows(`select * from public.daily_metrics`)), Error, "permission denied");
        await assertRejects(() => s.as(role, () => s.rows(`select public.daily_metrics_window(7)`)), Error, "permission denied");
        await assertRejects(() => s.as(role, () => s.rows(`select public.refresh_daily_metrics(current_date)`)), Error, "permission denied");
      }
      await s.signInAs(BOARD_EMAIL, "aal1");
      await assertRejects(() => s.as("authenticated", () => s.rows(`select public.board_daily_metrics(7)`)), Error, "second factor");
      await s.signInAs(BOARD_EMAIL, "aal2");
      const board = await s.as("authenticated", () => s.json(`select public.board_daily_metrics(7) as r`));
      assertEquals(board.days.length, 7);
      assertEquals(board.days.at(-1).metrics["money.payments"], 3);
      await s.signInAs(null);
    });

    await t.step("enqueue_benchmark_review waits for its flag, then queues on the events and never twice", async () => {
      const enqueue = () => s.as("service_role", () => s.json(`select public.enqueue_benchmark_review() as r`));
      assertEquals((await enqueue()).reason, "flag_off");
      await s.db.exec(`update community.flags set value = 'true'::jsonb where key = 'benchmark_review'`);
      const first = await enqueue();
      assertEquals([first.queued, first.trigger], [true, "first"]);
      assertEquals((await enqueue()).reason, "already_queued");
      const run = await s.row<{ input: Json; status: string }>(`select input, status from public.job_runs where job_name = 'benchmark_review'`);
      assertEquals(run.input, { trigger: "first" });
      // The review is recorded; with nothing new the next call queues nothing.
      await s.db.exec(`update public.job_runs set status = 'succeeded' where job_name = 'benchmark_review'`);
      const id = await s.as("service_role", () =>
        s.row<{ id: string }>(`select public.record_benchmark_review(null, 'first', '[]'::jsonb, '[]'::jsonb, 'All rows above their floors.', false, 0) as id`)
      );
      assert(id.id);
      assertEquals((await enqueue()).reason, "nothing_new");
      // A milestone reached after the review calls for one.
      await s.db.exec(`insert into community.goals (amount_cents, title, outcome, reached_at) values (1000, 'Ten dollars', 'A test outcome', now() + interval '1 second')`);
      assertEquals((await enqueue()).trigger, "milestone");
    });

    await t.step("the review's inputs are counts, and the job belongs to the Studio Head's row when it exists", async () => {
      const inputs = await s.as("service_role", () => s.json(`select public.benchmark_review_inputs() as r`));
      assertEquals(Object.keys(inputs).sort(), ["cards_by_stage", "eras_reached", "goals_reached", "last_review_at", "live_since_last_review", "metrics", "open_findings", "paused"]);
      assertEquals(inputs.metrics.days.length, 60);
      const job = await s.row<{ calls_model: boolean; runs_when_paused: boolean }>(`select calls_model, runs_when_paused from public.jobs where name = 'benchmark_review'`);
      assertEquals([job.calls_model, job.runs_when_paused], [true, false]);
      await assertRejects(() => s.as("authenticated", () => s.rows(`select public.benchmark_review_inputs()`)), Error, "permission denied");
    });

    await t.step("a benchmark finding is recorded, keeps its newest subject, and the board reads the reviews", async () => {
      const record = (subject: string) =>
        s.as("service_role", () =>
          s.row<{ r: boolean }>(`select public.record_finding('benchmark:money.median', 'benchmark', $1, '{"area": 1}'::jsonb) as r`, [subject])
        );
      assertEquals((await record("Median contribution is $4.00, below its floor of $5.00")).r, true);
      assertEquals((await record("Median contribution is $3.50, below its floor of $5.00")).r, false);
      assertEquals((await s.row<{ subject: string }>(`select subject from public.findings where fingerprint = 'benchmark:money.median'`)).subject, "Median contribution is $3.50, below its floor of $5.00");
      await s.signInAs(BOARD_EMAIL, "aal2");
      const reviews = await s.as("authenticated", () => s.json(`select public.board_benchmark_reviews(5) as r`));
      assertEquals(Array.isArray(reviews) && reviews.length, 1);
      await s.signInAs(null);
    });

    await t.step("announcements_pending hands out structured fields of the notable feed events, each until it has a row", async () => {
      const card = await s.row<{ id: string }>(
        `insert into public.cards (bucket, source, shape, lane, folder, title, stage) values ('game', 'board', 'oneoff', 'code', 'seed-1', 'Carts leave dust trails', 'proposed') returning id`,
      );
      await s.db.query(`update public.cards set stage = 'funded' where id = $1`, [card.id]);
      await s.db.query(`update public.cards set stage = 'live' where id = $1`, [card.id]);
      // The milestone the previous step reached posts to the feed, as check_milestones does.
      await s.db.exec(`select community.add_event('milestone', 'Milestone reached: Ten dollars', 'goal:' || id) from community.goals where title = 'Ten dollars'`);
      const pending = await s.as("service_role", () => s.json(`select public.announcements_pending(now() - interval '1 hour', 10) as r`));
      const kinds = (pending.items as Json[]).map((i) => i.kind);
      assert(kinds.includes("milestone"), `kinds ${kinds}`);
      for (const item of pending.items as Json[]) {
        assertEquals(Object.keys(item).sort(), ["at", "card_id", "card_title", "era_name", "goal_amount_cents", "goal_title", "kind", "rarity", "ref", "suit"]);
        assert(["funded", "shipped", "rare_card", "milestone", "era"].includes(item.kind));
      }
      const milestone = (pending.items as Json[]).find((i) => i.kind === "milestone")!;
      assertEquals([milestone.goal_title, milestone.goal_amount_cents], ["Ten dollars", 1000]);
      // A contribution event is never announced: it names a supporter.
      assert(!(pending.items as Json[]).some((i) => i.kind === "contribution"));
      // Claimed once, it is never offered again.
      await s.as("service_role", () => s.rows(`insert into public.outbound_posts (kind, ref, state) values ('announce', $1, 'sending')`, [milestone.ref]));
      const after = await s.as("service_role", () => s.json(`select public.announcements_pending(now() - interval '1 hour', 10) as r`));
      assert(!(after.items as Json[]).some((i) => i.ref === milestone.ref));
      assertEquals(after.sent_last_hour, 1);
      await assertRejects(() => s.as("anon", () => s.rows(`select public.announcements_pending(now(), 5)`)), Error, "permission denied");
    });
  } finally {
    await s.close();
  }
});
