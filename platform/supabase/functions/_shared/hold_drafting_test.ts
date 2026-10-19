// The hold-drafting migration on PGlite (docs/specs/studio-reports.md, the card supply floor; docs/PLAN.md
// §10 decision 77): while no card was funded in the last 7 days and a card is open, supply_draft_check()
// holds the floor at the open count (short false, reason no_sales) and enqueue_supply_draft() queues no
// draft; the first card a payment funds lifts the hold, a payment that only part-fills a card does not,
// and with no card open the floor refills as before. Every migration runs in order, then the ones that
// link jobs to roles again with the roles in place, as supply_every_minute_test.ts runs them.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261019030000_hold_drafting.sql";
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

// A payment as the Stripe webhook credits it: p_goal_card_id null is the Machine card (the next card in
// line), a card id funds that card first.
const APPLY =
  `select public.apply_contribution(p_stripe_event_id => $1, p_contributor_id => $2, p_display_name => null, p_amount_usd => $3, p_net_usd => $3, p_studio_pct => 0, p_goal_card_id => $4::uuid, p_stripe_session_id => $5, p_payer_key => null, p_session_created_at => null) as r`;

type Row = Record<string, unknown>;

async function studio() {
  const db = new PGlite();
  const row = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T> => {
    const result = await db.query<T>(sql, params);
    assert(result.rows.length > 0, `no row for: ${sql}`);
    return result.rows[0]!;
  };
  await db.exec(SHIM);
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  const sqlOf = async (name: string) => (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "");
  for (const name of names) await db.exec(await sqlOf(name));
  // The floor of docs/specs/studio-reports.md: 6 open, 1 of $5 or more, 1 under $2.
  await db.exec(
    `insert into public.studio_state (id, credit_daily_cap_usd, credit_studio_daily_cap_usd, card_max_usd, daily_cap_usd, monthly_cap_usd, reserve_pct, incident_cap_usd)
       values (1, 10000, 10000, 25, 100, 500, 0, 0);
     insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);`,
  );
  const roleOf = async (name: string, klass: string) =>
    (await row<{ id: string }>(
      `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, write_access, agent_class)
       values ($1, $1, 'A small creature.', 'model-id', 0.1, 'plain', 'platform/agents/prompts/x.md', $2, $3) returning id`,
      [name, klass !== "reviewer", klass],
    )).id;
  const builder = await roleOf("Builder A", "writer");
  await roleOf("Game Designer", "planner");
  await roleOf("Game Director", "reviewer");
  for (const name of ["20260924400000_agent_workflows.sql", "20261010200000_supply_refill.sql", "20261011200000_supply_every_minute.sql", "20261018100000_no_money_holds.sql", MIGRATION]) {
    await db.exec(await sqlOf(name));
  }
  let made = 0;
  // A card open for funding on now, with a target.
  const openCard = async (title: string, target: number) => {
    made += 1;
    return (await row<{ id: string }>(
      `insert into public.cards (bucket, source, shape, lane, folder, title, summary, intent, acceptance_test, funding_target_usd, estimate_usd, stage, horizon, executor_role_id, created_at)
       values ('game', 'board', 'goal', 'config', 'seed-1', $1, 'A summary.', 'An intent.', 'check: config seed-1/config/a.json x == 1', $2, $2, 'proposed', 'now', $3,
         timestamptz '2026-09-01T00:00:00Z' + make_interval(secs => $4)) returning id`,
      [title, target, builder, made],
    )).id;
  };
  let paid = 0;
  const pay = async (usd: number, card: string | null = null) => {
    paid += 1;
    return (await row<{ r: Row }>(APPLY, [`evt_hold_${paid}`, `contrib_hold_${paid}`, usd, card, `cs_test_hold_${paid}000000000`])).r;
  };
  const check = async () => (await row<{ r: Row }>(`select public.supply_draft_check() as r`)).r;
  const enqueue = async () => (await row<{ r: Row }>(`select public.enqueue_supply_draft() as r`)).r;
  const draftRuns = async () => (await row<{ n: number }>(`select count(*)::int as n from public.job_runs where job_name = 'draft_card' and status <> 'skipped'`)).n;
  const skipQueued = async () => await db.exec(`update public.job_runs set status = 'skipped', reason = 'test' where job_name = 'draft_card' and status in ('queued', 'running')`);
  // Moves every allocation back by the given days: the rows are append-only, so the trigger is off
  // for the one update.
  const backdate = async (days: number) =>
    await db.exec(
      `alter table public.contribution_allocations disable trigger contribution_allocations_append_only;
       update public.contribution_allocations set created_at = created_at - interval '${days} days';
       alter table public.contribution_allocations enable trigger contribution_allocations_append_only;`,
    );
  return { db, row, sqlOf, openCard, pay, check, enqueue, draftRuns, skipQueued, backdate, close: () => db.close() };
}

Deno.test("drafting holds at the open count while no card was funded in the last 7 days, and refills once one is", OPTS, async (t) => {
  const s = await studio();
  try {
    let first = "";
    let second = "";

    await t.step("with no card open, a short supply refills as before, so the supply never wedges", async () => {
      const c = await s.check();
      assertEquals([c.short, c.reason, c.held, c.last_funded_at], [true, null, false, null]);
    });

    await t.step("cards open and none ever funded: held, every shortfall 0, reason no_sales, and nothing queued", async () => {
      first = await s.openCard("First open card", 2);
      second = await s.openCard("Second open card", 2);
      const c = await s.check();
      assertEquals([c.short, c.reason, c.held], [false, "no_sales", true]);
      assertEquals(c.floor, { short_open: 0, short_big: 0, short_small: 0, big_min_usd: 5, small_max_usd: 2 });
      const r = await s.enqueue();
      assertEquals([r.queued, r.reason], [false, "no_sales"]);
      assertEquals(await s.draftRuns(), 0);
      // The public line passes the reason through, short false.
      const pub = (await s.row<{ r: Row }>(`select public.public_supply() as r`)).r;
      assertEquals([pub.short, pub.reason, pub.drafting], [false, "no_sales", false]);
    });

    await t.step("a payment that part-fills a card is not a sale of a card: still held", async () => {
      await s.pay(1, second);
      assertEquals((await s.row<{ f: string; st: string }>(`select funded_usd::text as f, stage::text as st from public.cards where id = $1`, [second])), { f: "1.0000", st: "proposed" });
      assertEquals([(await s.check()).reason, (await s.check()).held], ["no_sales", true]);
    });

    await t.step("the Machine card's money fills the first card in line; that card funded lifts the hold, and a draft is queued", async () => {
      await s.pay(2);
      assertEquals((await s.row<{ st: string }>(`select stage::text as st from public.cards where id = $1`, [first])).st, "funded");
      const c = await s.check();
      assertEquals([c.short, c.reason, c.held], [true, null, false]);
      const funded = new Date(String(c.last_funded_at)).getTime();
      assert(Math.abs(Date.now() - funded) < 60_000, `${c.last_funded_at} is now`);
      const r = await s.enqueue();
      assertEquals([r.queued, r.reason], [true, null]);
      assertEquals(await s.draftRuns(), 1);
      await s.skipQueued();
    });

    await t.step("8 days later with no card funded since, the hold is back", async () => {
      await s.backdate(8);
      const c = await s.check();
      assertEquals([c.short, c.reason, c.held], [false, "no_sales", true]);
      assertEquals((await s.enqueue()).queued, false);
    });

    await t.step("6 days after the last card was funded, it still counts", async () => {
      await s.backdate(-2);
      assertEquals([(await s.check()).reason, (await s.check()).held], [null, false]);
      await s.backdate(2);
    });

    await t.step("the second card's last dollar funds it: the hold lifts again", async () => {
      await s.openCard("Third open card", 2);
      assertEquals((await s.check()).reason, "no_sales");
      await s.pay(1, second);
      assertEquals((await s.row<{ st: string }>(`select stage::text as st from public.cards where id = $1`, [second])).st, "funded");
      const c = await s.check();
      assertEquals([c.reason, c.held], [null, false]);
    });

    await t.step("a reason ahead of it still comes first, and a supply not short is not_short, held or not", async () => {
      await s.backdate(8);
      await s.db.exec(`update public.studio_state set paused = true where id = 1`);
      assertEquals([(await s.check()).reason, (await s.check()).short], ["studio_paused", false]);
      await s.db.exec(`update public.studio_state set paused = false, card_floor_open = 0, card_floor_big = 0, card_floor_small = 0 where id = 1`);
      const c = await s.check();
      assertEquals([c.short, c.reason, c.held], [false, "not_short", false]);
    });
  } finally {
    await s.close();
  }
});

Deno.test("last_card_funded_at is no API role's, supply_draft_check stays the service role's, and the migration runs twice", OPTS, async () => {
  const s = await studio();
  try {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await s.db.exec(`set role ${role}`);
      try {
        await assertRejects(() => s.db.query(`select money.last_card_funded_at()`), Error, "permission denied");
      } finally {
        await s.db.exec(`reset role`);
      }
    }
    const rights = await s.row<{ anon: boolean; authenticated: boolean; service: boolean }>(
      `select has_function_privilege('anon', 'public.supply_draft_check()', 'execute') as anon,
              has_function_privilege('authenticated', 'public.supply_draft_check()', 'execute') as authenticated,
              has_function_privilege('service_role', 'public.supply_draft_check()', 'execute') as service`,
    );
    assertEquals(rights, { anon: false, authenticated: false, service: true });
    const sql = await s.sqlOf(MIGRATION);
    await s.db.exec(sql);
    await s.db.exec(sql);
    assertEquals((await s.check()).reason, null);
  } finally {
    await s.close();
  }
});
