// Runs every file in migrations/ in name order on PGlite (Postgres in WASM)
// behind a shim for the Supabase-only objects, then checks the RPC arithmetic,
// the refusals, the auth trigger, the views, the privileges and the
// publication. The shim reproduces the project's default privileges (every new
// relation and function granted to anon, authenticated and service_role) so the
// revoke block is exercised the way production exercises it.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";

/** Every migrations/*.sql, sorted by name; the 14-digit stamp orders them. */
async function readMigrations(): Promise<{ name: string; sql: string }[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  const migrations: { name: string; sql: string }[] = [];
  for (const name of names) {
    migrations.push({
      name,
      sql: await Deno.readTextFile(new URL(name, MIGRATIONS_DIR)),
    });
  }
  return migrations;
}

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

const BOARD_EMAIL = "board@peanutgallery.games";
const MODERATOR_EMAIL = "mod@peanutgallery.games";
const OUTSIDER_EMAIL = "someone@peanutgallery.games";

type Row = Record<string, unknown>;

Deno.test("migrations on PGlite", {
  sanitizeOps: false,
  sanitizeResources: false,
}, async (t) => {
  const db = new PGlite();

  async function row<T extends Row = Row>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T> {
    const result = await db.query<T>(sql, params);
    assert(result.rows.length > 0, `no row for: ${sql}`);
    return result.rows[0]!;
  }

  async function rows<T extends Row = Row>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return (await db.query<T>(sql, params)).rows;
  }

  async function refuses(sql: string, message: string, params: unknown[] = []) {
    await assertRejects(() => db.query(sql, params), Error, message);
  }

  /**
   * Sets the claims Supabase Auth would put in the JWT: the email and the
   * assurance level (aal1 after the magic link, aal2 after a TOTP code). A null
   * aal leaves the claim out, as a token without it would.
   */
  async function signInAs(
    email: string | null,
    aal: "aal1" | "aal2" | null = null,
  ) {
    await db.query(
      `select set_config('request.jwt.claim.email', $1, false)`,
      [email ?? ""],
    );
    const claims = email === null
      ? ""
      : JSON.stringify(aal === null ? { email } : { email, aal });
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [
      claims,
    ]);
  }

  async function pool() {
    return await row<{
      balance_usd: string;
      reserve_usd: string;
      incident_reserve_usd: string;
      held_usd: string;
      daily_spent_usd: string;
      day: string;
    }>(
      `select balance_usd, reserve_usd, incident_reserve_usd, held_usd, daily_spent_usd, day::text as day from public.pool where id = 1`,
    );
  }

  /**
   * The ledger identity as three differences that must stay fixed
   * (docs/specs/refunds-and-holds.md). Earlier steps write pool figures by hand,
   * so a step compares the offsets before and after instead of expecting zero.
   */
  async function identityOffsets() {
    return await row<{ reserve: string; funds: string; held: string }>(
      `select
         (p.reserve_usd - c.reserve)::text as reserve,
         (p.balance_usd + p.incident_reserve_usd + p.held_usd - (c.agents - l.usd))::text as funds,
         (p.held_usd - c.held)::text as held
       from public.pool p,
         (select coalesce(sum(reserve_usd), 0) as reserve, coalesce(sum(agents_usd), 0) as agents, coalesce(sum(held_usd), 0) as held from public.contributions) c,
         (select coalesce(sum(usd), 0) as usd from public.ledger where billed_to = 'studio') l
       where p.id = 1`,
    );
  }

  let goalCardId = "";
  let votedGoalId = "";
  let oneoffCardId = "";
  let roleId = "";

  try {
    await t.step("every migration applies in order after the Supabase shim", async () => {
      const migrations = await readMigrations();
      assertEquals(migrations.map((m) => m.name), [
        "20260914000000_week1_schema.sql",
        "20260915000000_live_cut.sql",
        "20260916000000_card_summary.sql",
        "20260917000000_contribution_session.sql",
        "20260918000000_founder_billing.sql",
        "20260919000000_board_two_factor.sql",
        "20260919000100_card_spend.sql",
        "20260920000000_refunds_and_holds.sql",
      ]);
      for (const m of migrations) {
        assert(/^\d{14}_[a-z0-9_]+\.sql$/.test(m.name), `stamp on ${m.name}`);
      }
      assert(
        migrations[0]!.sql.includes(PGCRYPTO_LINE),
        "the first migration creates pgcrypto",
      );
      await db.exec(SHIM);
      // gen_random_uuid() is core Postgres; PGlite ships no pgcrypto build.
      for (const m of migrations) {
        await db.exec(m.sql.replaceAll(PGCRYPTO_LINE, ""));
      }
      // Every migration after the first is written to run twice.
      for (const m of migrations.slice(1)) {
        await db.exec(m.sql.replaceAll(PGCRYPTO_LINE, ""));
      }

      const tables = await rows<{ table_name: string }>(
        `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
      );
      assertEquals(tables.map((r) => r.table_name), [
        "agent_events",
        "board_members",
        "board_notes",
        "cards",
        "contributions",
        "decisions",
        "deploys",
        "images",
        "ledger",
        "pool",
        "roles",
        "scores",
        "standing_costs",
        "stream_state",
        "studio_state",
        "votes",
      ]);
      const views = await rows<{ table_name: string }>(
        `select table_name from information_schema.views where table_schema = 'public' order by 1`,
      );
      assertEquals(views.map((r) => r.table_name), [
        "last_green",
        "public_agent_events",
        "public_card_funding",
        "public_card_spend",
        "public_ledger_totals",
        "public_studio",
      ]);
      const columns = await rows<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'studio_state' and column_name in ('launched_at', 'dispatcher_seen_at') order by 1`,
      );
      assertEquals(columns.map((c) => c.column_name), [
        "dispatcher_seen_at",
        "launched_at",
      ]);
      const summary = await row<{ data_type: string; is_nullable: string }>(
        `select data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'cards' and column_name = 'summary'`,
      );
      assertEquals(summary, { data_type: "text", is_nullable: "YES" });
      const sessionKey = await rows(
        `select c.conname from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) where c.conrelid = 'public.contributions'::regclass and c.contype = 'u' and a.attname = 'stripe_session_id'`,
      );
      assertEquals(sessionKey.length, 1);
      const applySignatures = await rows(
        `select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'apply_contribution'`,
      );
      assertEquals(applySignatures, [{
        args:
          "p_stripe_event_id text, p_contributor_id text, p_display_name text, p_amount_usd numeric, p_net_usd numeric, p_studio_pct integer, p_goal_card_id uuid, p_stripe_session_id text",
      }]);
      const withoutRls = await rows(
        `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
      );
      assertEquals(withoutRls, []);

      await db.exec(
        `insert into public.studio_state (id) values (1); insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);`,
      );
    });

    await t.step(
      "apply_contribution splits net 0.71 at 20% into the goal-1 numbers",
      async () => {
        const { r } = await row<{ r: Row }>(
          `select public.apply_contribution('evt_a', 'contrib_a', 'Board', 1.00, 0.71, 20, null) as r`,
        );
        assertEquals(r.inserted, true);
        assertEquals(r.reserve_usd, 0.071);
        assertEquals(r.studio_usd, 0.1278);
        assertEquals(r.agents_usd, 0.5112);
        assertEquals(r.incident_usd, 0.0256);
        assertEquals(r.pool_credit_usd, 0.4856);
        assertEquals(r.goal_card_id, null);
        assertEquals(r.goal_stage, null);
        assertEquals(r.goal_funded_usd, null);

        const p = await pool();
        assertEquals(p.balance_usd, "0.4856");
        assertEquals(p.reserve_usd, "0.0710");
        assertEquals(p.incident_reserve_usd, "0.0256");

        const c = await row(
          `select rail::text as rail, contributor_id, display_name, amount_usd, net_usd, reserve_usd, agents_usd, studio_usd, incident_usd, studio_pct_chosen, kind::text as kind, public, goal_card_id, decision_id, credited_at is not null as credited from public.contributions where stripe_event_id = 'evt_a'`,
        );
        assertEquals(c, {
          rail: "stripe",
          contributor_id: "contrib_a",
          display_name: "Board",
          amount_usd: "1.0000",
          net_usd: "0.7100",
          reserve_usd: "0.0710",
          agents_usd: "0.5112",
          studio_usd: "0.1278",
          incident_usd: "0.0256",
          studio_pct_chosen: 20,
          kind: "cash",
          public: true,
          goal_card_id: null,
          decision_id: null,
          credited: true,
        });
      },
    );

    await t.step("a duplicate stripe_event_id changes nothing", async () => {
      const first = await row<{ id: string }>(
        `select id from public.contributions where stripe_event_id = 'evt_a'`,
      );
      const { r } = await row<{ r: Row }>(
        `select public.apply_contribution('evt_a', 'contrib_a', 'Board', 1.00, 0.71, 20, null) as r`,
      );
      assertEquals(r.inserted, false);
      assertEquals(r.contribution_id, first.id);
      assertEquals(r.goal_card_id, null);
      assertEquals(r.goal_stage, null);
      assertEquals(r.goal_funded_usd, null);
      const p = await pool();
      assertEquals(p.balance_usd, "0.4856");
      assertEquals(p.reserve_usd, "0.0710");
      assertEquals(p.incident_reserve_usd, "0.0256");
      const count = await row<{ n: number }>(
        `select count(*)::int as n from public.contributions`,
      );
      assertEquals(count.n, 1);
    });

    await t.step(
      "one checkout session credits once across two event ids",
      async () => {
        const before = await pool();
        const first = await row<{ r: Row }>(
          `select public.apply_contribution('evt_s1', 'contrib_s', null, 1.00, 0.71, 20, null, 'cs_s') as r`,
        );
        assertEquals(first.r.inserted, true);
        const second = await row<{ r: Row }>(
          `select public.apply_contribution('evt_s2', 'contrib_s', null, 1.00, 0.71, 20, null, 'cs_s') as r`,
        );
        assertEquals(second.r.inserted, false);
        assertEquals(second.r.contribution_id, first.r.contribution_id);
        const credited = await rows(
          `select stripe_event_id, stripe_session_id from public.contributions where stripe_session_id = 'cs_s'`,
        );
        assertEquals(credited, [{ stripe_event_id: "evt_s1", stripe_session_id: "cs_s" }]);
        const after = await pool();
        assertEquals(
          (Number(after.balance_usd) - Number(before.balance_usd)).toFixed(4),
          "0.4856",
        );
        await db.exec(
          `delete from public.contributions where stripe_session_id = 'cs_s';
           update public.pool set balance_usd = ${before.balance_usd}, reserve_usd = ${before.reserve_usd}, incident_reserve_usd = ${before.incident_reserve_usd} where id = 1;`,
        );
      },
    );

    await t.step(
      "a goal card's bar rises by the net amount and an open decision of matching size is assigned",
      async () => {
        const goal = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage) values ('game', 'board', 'goal', 'code', 'seed-1', 'A goal card with a 100 target', 100, 'voted') returning id`,
        );
        goalCardId = goal.id;
        await db.exec(
          `insert into public.decisions (size, title, config_key) values ('small', 'Name the first unit', 'spawn.gatherer.name')`,
        );
        const { r } = await row<{ r: Row }>(
          `select public.apply_contribution('evt_b', 'contrib_b', null, 2.00, 1.65, 0, $1) as r`,
          [goalCardId],
        );
        assertEquals(r.inserted, true);
        assertEquals(r.reserve_usd, 0.165);
        assertEquals(r.studio_usd, 0);
        assertEquals(r.agents_usd, 1.485);
        assertEquals(r.incident_usd, 0.0743);
        // The bar takes what reached the pool: agents 1.4850 - incident 0.0743 = 1.4107,
        // not the gross 2.00. The estimate is seeded from the target because it was 0.
        assertEquals(r.pool_credit_usd, 1.4107);
        assertEquals(r.goal_card_id, goalCardId);
        assertEquals(r.goal_stage, "voted");
        assertEquals(r.goal_funded_usd, 1.4107);
        const funded = await row(
          `select funded_usd, estimate_usd, stage::text as stage from public.cards where id = $1`,
          [goalCardId],
        );
        assertEquals(funded, {
          funded_usd: "1.4107",
          estimate_usd: "100.0000",
          stage: "voted",
        });
        const decision = await row(
          `select state::text as state, assigned_to, contribution_id = $1 as linked, assigned_at is not null as assigned from public.decisions`,
          [r.contribution_id],
        );
        assertEquals(decision, {
          state: "assigned",
          assigned_to: "contrib_b",
          linked: true,
          assigned: true,
        });
        const contribution = await row(
          `select goal_card_id = $1 as goal, decision_id is not null as decided from public.contributions where stripe_event_id = 'evt_b'`,
          [goalCardId],
        );
        assertEquals(contribution, { goal: true, decided: true });
      },
    );

    await t.step(
      "a voted goal that reaches its target moves to funded with the estimate seeded from the target",
      async () => {
        const voted = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage) values ('game', 'board', 'goal', 'config', 'seed-1', 'A voted goal with a 1 target', 1, 'voted') returning id`,
        );
        votedGoalId = voted.id;
        const before = await pool();
        const first = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_e', 'contrib_e', null, 2.00, 1.65, 0, $1) as r`,
          [votedGoalId],
        )).r;
        // net 1.65 at 0%: reserve 0.1650, agents 1.4850, incident 0.0743, credit 1.4107 >= target 1.
        assertEquals(first.pool_credit_usd, 1.4107);
        assertEquals(first.goal_stage, "funded");
        assertEquals(first.goal_funded_usd, 1.4107);
        assertEquals(
          await row(
            `select funded_usd, estimate_usd, stage::text as stage from public.cards where id = $1`,
            [votedGoalId],
          ),
          { funded_usd: "1.4107", estimate_usd: "1.0000", stage: "funded" },
        );
        const second = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_f', 'contrib_f', null, 1.00, 0.71, 20, $1) as r`,
          [votedGoalId],
        )).r;
        // net 0.71 at 20%: agents 0.5112, incident 0.0256, credit 0.4856; the card stays funded.
        assertEquals(second.pool_credit_usd, 0.4856);
        assertEquals(second.goal_stage, "funded");
        assertEquals(second.goal_funded_usd, 1.8963);
        assertEquals(
          await row(
            `select funded_usd, estimate_usd, stage::text as stage from public.cards where id = $1`,
            [votedGoalId],
          ),
          { funded_usd: "1.8963", estimate_usd: "1.0000", stage: "funded" },
        );
        // The pool moved by the same two credits as the bar.
        const after = await pool();
        assertEquals(
          (Number(after.balance_usd) - Number(before.balance_usd)).toFixed(4),
          "1.8963",
        );

        // A proposed card flips too, and an estimate that was already set is left alone.
        const proposed = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, estimate_usd, stage) values ('game', 'board', 'goal', 'code', 'seed-1', 'A proposed goal with a 1 target', 1, 0.5, 'proposed') returning id`,
        );
        const third = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_g', 'contrib_g', null, 2.00, 1.65, 0, $1) as r`,
          [proposed.id],
        )).r;
        assertEquals(third.goal_stage, "funded");
        assertEquals(
          await row(
            `select funded_usd, estimate_usd, stage::text as stage from public.cards where id = $1`,
            [proposed.id],
          ),
          { funded_usd: "1.4107", estimate_usd: "0.5000", stage: "funded" },
        );
      },
    );

    await t.step("a live goal keeps its stage while its bar rises", async () => {
      const live = await row<{ id: string }>(
        `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage) values ('game', 'board', 'goal', 'config', 'seed-1', 'A live goal with a 1 target', 1, 'live') returning id`,
      );
      const { r } = await row<{ r: Row }>(
        `select public.apply_contribution('evt_h', 'contrib_h', null, 2.00, 1.65, 0, $1) as r`,
        [live.id],
      );
      assertEquals(r.goal_card_id, live.id);
      assertEquals(r.goal_stage, "live");
      assertEquals(r.goal_funded_usd, 1.4107);
      assertEquals(
        await row(
          `select funded_usd, estimate_usd, stage::text as stage from public.cards where id = $1`,
          [live.id],
        ),
        { funded_usd: "1.4107", estimate_usd: "1.0000", stage: "live" },
      );
    });

    await t.step(
      "a card that is not a goal is dropped and a large contribution finds no open decision",
      async () => {
        const oneoff = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, stage) values ('game', 'board', 'oneoff', 'config', 'seed-1', 'Spawn table: gatherer baseCost 10 to 11', 'funded') returning id`,
        );
        oneoffCardId = oneoff.id;
        const { r } = await row<{ r: Row }>(
          `select public.apply_contribution('evt_c', 'contrib_c', null, 60.00, 58.00, 100, $1) as r`,
          [oneoffCardId],
        );
        assertEquals(r.inserted, true);
        assertEquals(r.agents_usd, 0);
        assertEquals(r.studio_usd, 52.2);
        assertEquals(r.incident_usd, 0);
        assertEquals(r.goal_card_id, null);
        assertEquals(r.goal_stage, null);
        const c = await row(
          `select goal_card_id, decision_id from public.contributions where stripe_event_id = 'evt_c'`,
        );
        assertEquals(c, { goal_card_id: null, decision_id: null });
        const card = await row<{ funded_usd: string }>(
          `select funded_usd from public.cards where id = $1`,
          [oneoffCardId],
        );
        assertEquals(card.funded_usd, "0.0000");
      },
    );

    await t.step(
      "the incident carve-out stops at the cap and the rest reaches the pool, above $50 held",
      async () => {
        await db.exec(
          `update public.pool set incident_reserve_usd = 499.99 where id = 1`,
        );
        const before = await pool();
        const { r } = await row<{ r: Row }>(
          `select public.apply_contribution('evt_d', 'contrib_d', null, 100.00, 100.00, 0, null) as r`,
        );
        assertEquals(r.agents_usd, 90);
        assertEquals(r.incident_usd, 0.01);
        // 89.99 of pool credit: $50 today, the rest held for 14 days.
        assertEquals(r.pool_credit_usd, 50);
        assertEquals(r.held_usd, 39.99);
        const after = await pool();
        assertEquals(after.incident_reserve_usd, "500.0000");
        assertEquals(
          (Number(after.balance_usd) - Number(before.balance_usd)).toFixed(4),
          "50.0000",
        );
        assertEquals(
          (Number(after.held_usd) - Number(before.held_usd)).toFixed(4),
          "39.9900",
        );
      },
    );

    await t.step("apply_contribution refuses bad inputs", async () => {
      await refuses(
        `select public.apply_contribution('', 'c', null, 1, 0.5, 20, null)`,
        "p_stripe_event_id is required",
      );
      await refuses(
        `select public.apply_contribution('evt_x', '', null, 1, 0.5, 20, null)`,
        "p_contributor_id is required",
      );
      await refuses(
        `select public.apply_contribution('evt_x', 'c', null, 0, 0, 20, null)`,
        "p_amount_usd must be above zero",
      );
      await refuses(
        `select public.apply_contribution('evt_x', 'c', null, 1, 1.5, 20, null)`,
        "p_net_usd must be between zero and p_amount_usd",
      );
      await refuses(
        `select public.apply_contribution('evt_x', 'c', null, 1, 0.5, 101, null)`,
        "p_studio_pct must be between 0 and 100",
      );
    });

    await t.step(
      "founder_credit adds a private founder row and raises the balance",
      async () => {
        const before = await pool();
        const { id } = await row<{ id: string }>(
          `select public.founder_credit(50, 'cash', 'Founder') as id`,
        );
        const c = await row(
          `select rail::text as rail, contributor_id, display_name, amount_usd, net_usd, agents_usd, reserve_usd, studio_usd, incident_usd, studio_pct_chosen, kind::text as kind, public, stripe_event_id from public.contributions where id = $1`,
          [id],
        );
        assertEquals(c, {
          rail: "founder",
          contributor_id: "founder",
          display_name: "Founder",
          amount_usd: "50.0000",
          net_usd: "50.0000",
          agents_usd: "50.0000",
          reserve_usd: "0.0000",
          studio_usd: "0.0000",
          incident_usd: "0.0000",
          studio_pct_chosen: 0,
          kind: "cash",
          public: false,
          stripe_event_id: null,
        });
        const after = await pool();
        assertEquals(
          (Number(after.balance_usd) - Number(before.balance_usd)).toFixed(4),
          "50.0000",
        );
        assertEquals(after.reserve_usd, before.reserve_usd);
        assertEquals(after.incident_reserve_usd, before.incident_reserve_usd);
        await refuses(
          `select public.founder_credit(0, 'cash', 'Founder')`,
          "p_amount_usd must be above zero",
        );
      },
    );

    await t.step(
      "record_usage meters the ledger, resets the day and charges the card",
      async () => {
        const role = await row<{ id: string }>(
          `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, tools_json, write_access) values ('Builder A', 'Builder A', 'A small blue creature.', 'builder-model-id', 0.2, 'plain', 'platform/agents/prompts/builder-a.md', '["Read"]', true) returning id`,
        );
        roleId = role.id;
        await db.exec(
          `update public.pool set day = date '2020-01-01', daily_spent_usd = 9 where id = 1`,
        );
        const before = await pool();
        const { r } = await row<{ r: Row }>(
          `select public.record_usage($1, $2, 'builder-model-id', 1000, 200, 300, 0.1234) as r`,
          [oneoffCardId, roleId],
        );
        const today = await row<{ d: string }>(
          `select ((now() at time zone 'America/New_York')::date)::text as d`,
        );
        assertEquals(r.daily_spent_usd, 0.1234);
        assertEquals(r.actual_usd, 0.1234);
        assertEquals(
          r.balance_usd,
          Number((Number(before.balance_usd) - 0.1234).toFixed(4)),
        );
        const after = await pool();
        assertEquals(after.day, today.d);
        assertEquals(after.daily_spent_usd, "0.1234");
        assertEquals(after.incident_reserve_usd, before.incident_reserve_usd);
        const ledger = await row(
          `select role_id = $1 as role, model, input_tokens, cached_tokens, output_tokens, usd from public.ledger where id = $2`,
          [roleId, r.ledger_id],
        );
        assertEquals(ledger, {
          role: true,
          model: "builder-model-id",
          input_tokens: 1000,
          cached_tokens: 200,
          output_tokens: 300,
          usd: "0.1234",
        });
        const card = await row<{ actual_usd: string }>(
          `select actual_usd from public.cards where id = $1`,
          [oneoffCardId],
        );
        assertEquals(card.actual_usd, "0.1234");
      },
    );

    await t.step(
      "an S1 card draws the incident reserve first, then the balance",
      async () => {
        await db.exec(
          `update public.cards set severity = 's1' where id = '${oneoffCardId}'`,
        );
        const before = await pool();
        const { r } = await row<{ r: Row }>(
          `select public.record_usage($1, $2, 'builder-model-id', 10, 0, 10, 0.05) as r`,
          [oneoffCardId, roleId],
        );
        const covered = await pool();
        assertEquals(covered.balance_usd, before.balance_usd);
        assertEquals(
          (Number(before.incident_reserve_usd) -
            Number(covered.incident_reserve_usd)).toFixed(4),
          "0.0500",
        );
        assertEquals(r.daily_spent_usd, 0.1734);
        assertEquals(r.actual_usd, 0.1734);

        await db.exec(
          `update public.pool set incident_reserve_usd = 0.02 where id = 1`,
        );
        await row(
          `select public.record_usage($1, $2, 'builder-model-id', 10, 0, 10, 0.05) as r`,
          [oneoffCardId, roleId],
        );
        const partial = await pool();
        assertEquals(partial.incident_reserve_usd, "0.0000");
        assertEquals(
          (Number(covered.balance_usd) - Number(partial.balance_usd)).toFixed(
            4,
          ),
          "0.0300",
        );
      },
    );

    await t.step(
      "record_usage without a card meters the pool only and refuses bad inputs",
      async () => {
        const { r } = await row<{ r: Row }>(
          `select public.record_usage(null, $1, 'builder-model-id', 1, 0, 1, 0.01) as r`,
          [roleId],
        );
        assertEquals(r.actual_usd, null);
        assertNotEquals(r.ledger_id, null);
        await refuses(
          `select public.record_usage(null, null, '', 1, 0, 1, 0.01)`,
          "p_model is required",
        );
        await refuses(
          `select public.record_usage(null, null, 'builder-model-id', 1, 0, 1, -0.01)`,
          "p_usd must be zero or more",
        );
        await refuses(
          `select public.record_usage($1, null, 'builder-model-id', 1, 0, 1, 0.01)`,
          "does not exist",
          [goalCardId.replace(/^[0-9a-f]{8}/, "00000000")],
        );
      },
    );

    await t.step(
      "record_usage billed to the founder charges the card and leaves the pool alone",
      async () => {
        const before = await pool();
        const card = await row<{ actual_usd: string }>(
          `select actual_usd from public.cards where id = $1`,
          [oneoffCardId],
        );
        const { r } = await row<{ r: Row }>(
          `select public.record_usage($1, $2, 'builder-model-id', 500, 0, 50, 0.4, 'founder') as r`,
          [oneoffCardId, roleId],
        );
        assertEquals(await pool(), before);
        assertEquals(r.balance_usd, Number(before.balance_usd));
        assertEquals(r.daily_spent_usd, Number(before.daily_spent_usd));
        assertEquals(
          r.actual_usd,
          Number((Number(card.actual_usd) + 0.4).toFixed(4)),
        );
        const ledger = await row(
          `select billed_to::text as billed_to, usd from public.ledger where id = $1`,
          [r.ledger_id],
        );
        assertEquals(ledger, { billed_to: "founder", usd: "0.4000" });
        const studio = await rows<{ billed_to: string }>(
          `select distinct billed_to::text as billed_to from public.ledger where id <> $1`,
          [r.ledger_id],
        );
        assertEquals(studio, [{ billed_to: "studio" }]);
        await refuses(
          `select public.record_usage(null, null, 'builder-model-id', 1, 0, 1, 0.01, null)`,
          "p_billed_to is required",
        );
      },
    );

    await t.step(
      "a board member can heartbeat, pause, resume, file a directive and file a note",
      async () => {
        await db.exec(
          `insert into public.board_members (email, role) values ('${BOARD_EMAIL}', 'board'), ('${MODERATOR_EMAIL}', 'moderator')`,
        );
        await signInAs("Board@PeanutGallery.games", "aal2");
        assertEquals(
          (await row<{ b: boolean }>(`select public.is_board_member() as b`)).b,
          true,
        );
        assertEquals(
          (await row<{ r: string }>(`select public.board_role()::text as r`)).r,
          "board",
        );
        const seen = await row<{ t: Date }>(
          `select public.board_heartbeat() as t`,
        );
        assert(seen.t instanceof Date);
        const member = await row<{ seen: boolean }>(
          `select last_seen_at is not null as seen from public.board_members where email = $1`,
          [BOARD_EMAIL],
        );
        assertEquals(member.seen, true);

        await db.exec(`select public.set_paused(true)`);
        assertEquals(
          await row(
            `select paused, paused_by, paused_at is not null as at from public.studio_state`,
          ),
          { paused: true, paused_by: "Board@PeanutGallery.games", at: true },
        );
        await db.exec(`select public.set_paused(false)`);
        assertEquals(
          await row(
            `select paused, paused_by, paused_at from public.studio_state`,
          ),
          { paused: false, paused_by: null, paused_at: null },
        );

        const directive = await row<{ id: string }>(
          `select public.file_directive('game', 'config', 'seed-1', '  Directive title ', 'Intent', 'check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11', 2, 'Reason', $1) as id`,
          [roleId],
        );
        assertEquals(
          await row(
            `select source::text as source, shape::text as shape, stage::text as stage, priority, confidence::text as confidence, title, board_reason, estimate_usd, proposer_role_id, executor_role_id = $2 as executor from public.cards where id = $1`,
            [directive.id, roleId],
          ),
          {
            source: "board",
            shape: "oneoff",
            stage: "funded",
            priority: 0,
            confidence: "low",
            title: "Directive title",
            board_reason: "Reason",
            estimate_usd: "2.0000",
            proposer_role_id: null,
            executor: true,
          },
        );
        await refuses(
          `select public.file_directive('game', 'config', 'seed-1', 'x', 'y', 'z', 2, 'r', null)`,
          "An executor role is required",
        );
        await refuses(
          `select public.file_directive('game', 'config', 'seed-1', ' ', 'y', 'z', 2, 'r', $1)`,
          "A title is required",
          [roleId],
        );
        await refuses(
          `select public.file_directive('game', 'config', 'seed-1', 'x', 'y', 'z', -1, 'r', $1)`,
          "The estimate must be zero or more",
          [roleId],
        );
        await db.exec(
          `update public.roles set state = 'retired' where id = '${roleId}'`,
        );
        await refuses(
          `select public.file_directive('game', 'config', 'seed-1', 'x', 'y', 'z', 2, 'r', $1)`,
          "The executor must be an active role",
          [roleId],
        );
        await db.exec(
          `update public.roles set state = 'active' where id = '${roleId}'`,
        );

        const note = await row<{ id: string }>(
          `select public.file_note('A note') as id`,
        );
        assertEquals(
          await row(
            `select author_email, text, state::text as state from public.board_notes where id = $1`,
            [note.id],
          ),
          {
            author_email: "Board@PeanutGallery.games",
            text: "A note",
            state: "new",
          },
        );
        await refuses(`select public.file_note(' ')`, "Note text is required");
      },
    );

    await t.step(
      "the board files Next cards, stamps the launch, sets the agent mode and reads studio_state",
      async () => {
        await signInAs(BOARD_EMAIL, "aal2");
        // The test row was inserted with defaults, so the per-card maximum is 0 until set.
        await db.exec(
          `update public.studio_state set card_max_usd = 25 where id = 1`,
        );

        const configCard = await row<{ id: string }>(
          `select public.file_card('game', 'config', 'seed-1', '  Rename the Gatherer to Sweeper ', '  Rename the first unit to Sweeper. ', 'Display only.', $2, 2, 'proposed', $1, '  ') as id`,
          [
            roleId,
            'spawn-table row gatherer: name changes from Gatherer to Sweeper.\n  check: config seed-1/config/spawn-table.json rows[id=gatherer].name == "Sweeper"',
          ],
        );
        assertEquals(
          await row(
            `select bucket::text as bucket, source::text as source, shape::text as shape, lane::text as lane, folder::text as folder, stage::text as stage, priority, confidence::text as confidence, title, summary, intent, board_reason, funding_target_usd, funded_usd, estimate_usd, proposer_role_id, executor_role_id = $2 as executor from public.cards where id = $1`,
            [configCard.id, roleId],
          ),
          {
            bucket: "game",
            source: "board",
            shape: "goal",
            lane: "config",
            folder: "seed-1",
            stage: "proposed",
            priority: 100,
            confidence: "low",
            title: "Rename the Gatherer to Sweeper",
            // The summary is stored trimmed.
            summary: "Rename the first unit to Sweeper.",
            intent: "Display only.",
            board_reason: null,
            funding_target_usd: "2.0000",
            funded_usd: "0.0000",
            estimate_usd: "2.0000",
            proposer_role_id: null,
            executor: true,
          },
        );
        const codeCard = await row<{ id: string }>(
          `select public.file_card('platform', 'code', 'platform', 'A platform code card', 'Summary.', null, 'No check line is needed on the code lane.', 25, 'voted', $1, ' Board reason ') as id`,
          [roleId],
        );
        assertEquals(
          await row(
            `select stage::text as stage, lane::text as lane, folder::text as folder, intent, board_reason, funding_target_usd, estimate_usd from public.cards where id = $1`,
            [codeCard.id],
          ),
          {
            stage: "voted",
            lane: "code",
            folder: "platform",
            intent: null,
            board_reason: "Board reason",
            funding_target_usd: "25.0000",
            estimate_usd: "25.0000",
          },
        );

        const CHECK =
          `'check: config seed-1/config/spawn-table.json rows[id=cart].baseCost == 120'`;
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', 'Title', 'Summary.', 'Intent', ${CHECK}, 0, 'proposed', $1, null)`,
          "The funding target must be above zero",
          [roleId],
        );
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', 'Title', 'Summary.', 'Intent', ${CHECK}, null, 'proposed', $1, null)`,
          "The funding target must be above zero",
          [roleId],
        );
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', 'Title', 'Summary.', 'Intent', ${CHECK}, 26, 'proposed', $1, null)`,
          "The funding target must not exceed the per-card maximum of 25.0000",
          [roleId],
        );
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', 'Title', 'Summary.', 'Intent', ${CHECK}, 3, 'funded', $1, null)`,
          "A Next card starts at proposed or voted",
          [roleId],
        );
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', 'Title', 'Summary.', 'Intent', ${CHECK}, 3, 'designing', $1, null)`,
          "A Next card starts at proposed or voted",
          [roleId],
        );
        await refuses(
          `select public.file_card('platform', 'config', 'platform', 'Title', 'Summary.', 'Intent', ${CHECK}, 3, 'proposed', $1, null)`,
          "The config lane exists only for seed-1",
          [roleId],
        );
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', 'Title', 'Summary.', 'Intent', 'Run the bot; see check: below.', 3, 'proposed', $1, null)`,
          "A config-lane card needs a check: line in its acceptance test",
          [roleId],
        );
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', 'Title', 'Summary.', 'Intent', null, 3, 'proposed', $1, null)`,
          "A config-lane card needs a check: line in its acceptance test",
          [roleId],
        );
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', ' ', 'Summary.', 'Intent', ${CHECK}, 3, 'proposed', $1, null)`,
          "A title is required",
          [roleId],
        );
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', 'Title', 'Summary.', 'Intent', ${CHECK}, 3, 'proposed', null, null)`,
          "An executor role is required",
        );
        // The summary refusals come right after the title check.
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', 'Title', '   ', 'Intent', ${CHECK}, 3, 'proposed', $1, null)`,
          "A public summary is required",
          [roleId],
        );
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', 'Title', null, 'Intent', ${CHECK}, 3, 'proposed', $1, null)`,
          "A public summary is required",
          [roleId],
        );
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', 'Title', $2, 'Intent', ${CHECK}, 3, 'proposed', $1, null)`,
          "The public summary must be 200 characters or fewer",
          [roleId, "a".repeat(201)],
        );
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', ' ', ' ', 'Intent', ${CHECK}, 0, 'funded', null, null)`,
          "A title is required",
        );
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', 'Title', ' ', 'Intent', ${CHECK}, 0, 'funded', null, null)`,
          "A public summary is required",
        );
        const fullLength = await row<{ id: string }>(
          `select public.file_card('game', 'code', 'seed-1', 'Two hundred characters', $2, null, 'Acceptance.', 2, 'proposed', $1, null) as id`,
          [roleId, "b".repeat(200)],
        );
        assertEquals(
          (await row<{ n: number }>(
            `select char_length(summary)::int as n from public.cards where id = $1`,
            [fullLength.id],
          )).n,
          200,
        );
        // The column check refuses a long summary written without file_card.
        await refuses(
          `insert into public.cards (bucket, source, shape, lane, folder, title, summary, funding_target_usd, stage) values ('game', 'board', 'goal', 'config', 'seed-1', 'Direct insert', $1, 5, 'proposed')`,
          "cards_summary_check",
          ["c".repeat(201)],
        );
        // The ten-argument live-cut signature no longer exists.
        assertEquals(
          await rows<{ args: string }>(
            `select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'file_card'`,
          ),
          [{
            args:
              "p_bucket card_bucket, p_lane card_lane, p_folder card_folder, p_title text, p_summary text, p_intent text, p_acceptance_test text, p_funding_target_usd numeric, p_stage card_stage, p_executor_role_id uuid, p_board_reason text",
          }],
        );
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', 'Title', 'Intent', ${CHECK}, 3, 'proposed', $1, null)`,
          "does not exist",
          [roleId],
        );
        await db.exec(
          `update public.roles set state = 'retired' where id = '${roleId}'`,
        );
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', 'Title', 'Summary.', 'Intent', ${CHECK}, 3, 'proposed', $1, null)`,
          "The executor must be an active role",
          [roleId],
        );
        await db.exec(
          `update public.roles set state = 'active' where id = '${roleId}'`,
        );

        // set_launched stamps once. Moving the stored stamp back a day and calling
        // again proves the second call reads the stored value and writes nothing.
        assertEquals(
          (await row<{ t: Date | null }>(
            `select launched_at as t from public.studio_state where id = 1`,
          )).t,
          null,
        );
        const first = await row<{ t: Date }>(
          `select public.set_launched() as t`,
        );
        assert(first.t instanceof Date);
        await db.exec(
          `update public.studio_state set launched_at = launched_at - interval '1 day' where id = 1`,
        );
        const second = await row<{ t: Date }>(
          `select public.set_launched() as t`,
        );
        assertEquals(second.t.getTime(), first.t.getTime() - 86_400_000);
        const stored = await row<{ t: Date }>(
          `select launched_at as t from public.studio_state where id = 1`,
        );
        assertEquals(stored.t.getTime(), second.t.getTime());

        await db.exec(`select public.set_agent_mode('unattended')`);
        assertEquals(
          (await row<{ m: string }>(
            `select agent_mode as m from public.studio_state where id = 1`,
          )).m,
          "unattended",
        );
        await db.exec(`select public.set_agent_mode('attended')`);
        assertEquals(
          (await row<{ m: string }>(
            `select agent_mode as m from public.studio_state where id = 1`,
          )).m,
          "attended",
        );
        await refuses(
          `select public.set_agent_mode('auto')`,
          "agent_mode must be attended or unattended",
        );
        await refuses(
          `select public.set_agent_mode('Attended')`,
          "agent_mode must be attended or unattended",
        );
        await refuses(
          `select public.set_agent_mode(null)`,
          "agent_mode must be attended or unattended",
        );

        const { s } = await row<{ s: Row }>(
          `select public.board_studio_state() as s`,
        );
        assertEquals(Object.keys(s).sort(), [
          "agent_mode",
          "card_max_usd",
          "daily_cap_usd",
          "dispatcher_seen_at",
          "launched_at",
          "paused",
          "paused_at",
          "paused_by",
        ]);
        assertEquals(s.agent_mode, "attended");
        assertEquals(s.paused, false);
        assertEquals(s.card_max_usd, 25);
        assertEquals(s.daily_cap_usd, 0);
        assertEquals(s.dispatcher_seen_at, null);
        assertNotEquals(s.launched_at, null);
      },
    );

    await t.step(
      "a board session without the second factor is refused every state-changing RPC and keeps the aal1 ones",
      async () => {
        const CHECK =
          `'check: config seed-1/config/spawn-table.json rows[id=cart].baseCost == 120'`;
        const stateChanging: [string, unknown[]][] = [
          [
            `select public.file_directive('game', 'config', 'seed-1', 'Two-factor directive', 'Intent', ${CHECK}, 2, 'Reason', $1)`,
            [roleId],
          ],
          [
            `select public.file_card('game', 'config', 'seed-1', 'Two-factor card', 'Summary.', 'Intent', ${CHECK}, 3, 'proposed', $1, null)`,
            [roleId],
          ],
          [`select public.file_note('Two-factor note')`, []],
          [`select public.set_launched()`, []],
          [`select public.set_agent_mode('unattended')`, []],
          [`select public.set_paused(true)`, []],
        ];
        const counts = async () =>
          await row(
            `select (select count(*)::int from public.cards) as cards, (select count(*)::int from public.board_notes) as notes, (select agent_mode from public.studio_state where id = 1) as mode, (select paused from public.studio_state where id = 1) as paused`,
          );
        const before = await counts();

        for (const aal of ["aal1", null] as const) {
          await signInAs(BOARD_EMAIL, aal);
          assertEquals(
            (await row<{ a: boolean }>(`select public.board_aal2() as a`)).a,
            false,
          );
          for (const [sql, params] of stateChanging) {
            await refuses(sql, "A second factor is required", params);
          }
          // The heartbeat, the role and the studio state stay open at aal1.
          assert(
            (await row<{ t: Date }>(`select public.board_heartbeat() as t`))
              .t instanceof Date,
          );
          assertEquals(
            (await row<{ r: string }>(`select public.board_role()::text as r`))
              .r,
            "board",
          );
          const { s } = await row<{ s: Row }>(
            `select public.board_studio_state() as s`,
          );
          assertEquals(s.agent_mode, "attended");
        }
        assertEquals(await counts(), before);

        await signInAs(BOARD_EMAIL, "aal2");
        assertEquals(
          (await row<{ a: boolean }>(`select public.board_aal2() as a`)).a,
          true,
        );
        const directive = await row<{ id: string }>(
          `select public.file_directive('game', 'config', 'seed-1', 'Two-factor directive', 'Intent', ${CHECK}, 2, 'Reason', $1) as id`,
          [roleId],
        );
        assertNotEquals(directive.id, null);
        const card = await row<{ id: string }>(
          `select public.file_card('game', 'config', 'seed-1', 'Two-factor card', 'Summary.', 'Intent', ${CHECK}, 3, 'proposed', $1, null) as id`,
          [roleId],
        );
        assertNotEquals(card.id, null);
        const note = await row<{ id: string }>(
          `select public.file_note('Two-factor note') as id`,
        );
        assertNotEquals(note.id, null);
        assert(
          (await row<{ t: Date }>(`select public.set_launched() as t`))
            .t instanceof Date,
        );
        await db.exec(`select public.set_agent_mode('unattended')`);
        await db.exec(`select public.set_paused(true)`);
        assertEquals(
          await row(
            `select agent_mode, paused, paused_by from public.studio_state where id = 1`,
          ),
          { agent_mode: "unattended", paused: true, paused_by: BOARD_EMAIL },
        );
        await db.exec(`select public.set_paused(false)`);
        await db.exec(`select public.set_agent_mode('attended')`);
        assertEquals(
          await counts(),
          {
            cards: (before.cards as number) + 2,
            notes: (before.notes as number) + 1,
            mode: "attended",
            paused: false,
          },
        );
        await db.exec(
          `delete from public.cards where id in ('${directive.id}', '${card.id}'); delete from public.board_notes where id = '${note.id}';`,
        );
      },
    );

    await t.step(
      "a moderator can pause, heartbeat and read studio_state at aal1 but not file or launch",
      async () => {
        await signInAs(MODERATOR_EMAIL, "aal1");
        assertEquals(
          (await row<{ r: string }>(`select public.board_role()::text as r`)).r,
          "moderator",
        );
        await refuses(
          `select public.file_directive('game', 'config', 'seed-1', 'x', 'y', 'z', 2, 'r', $1)`,
          "Board membership is required",
          [roleId],
        );
        await refuses(
          `select public.file_note('x')`,
          "Board membership is required",
        );
        await refuses(
          `select public.file_card('game', 'code', 'seed-1', 'x', 'Summary.', 'y', 'z', 2, 'proposed', $1, null)`,
          "Board membership is required",
          [roleId],
        );
        await refuses(
          `select public.set_launched()`,
          "Board membership is required",
        );
        await refuses(
          `select public.set_agent_mode('attended')`,
          "Board membership is required",
        );
        const { s } = await row<{ s: Row }>(
          `select public.board_studio_state() as s`,
        );
        assertEquals(Object.keys(s).sort(), [
          "agent_mode",
          "card_max_usd",
          "daily_cap_usd",
          "dispatcher_seen_at",
          "launched_at",
          "paused",
          "paused_at",
          "paused_by",
        ]);
        await db.exec(`select public.set_paused(true)`);
        assertEquals(
          await row(`select paused, paused_by from public.studio_state`),
          { paused: true, paused_by: MODERATOR_EMAIL },
        );
        await db.exec(`select public.set_paused(false)`);
        await row(`select public.board_heartbeat()`);
      },
    );

    await t.step("an outsider is refused by every board RPC, even at aal2", async () => {
      await signInAs(OUTSIDER_EMAIL, "aal2");
      assertEquals(
        (await row<{ b: boolean }>(`select public.is_board_member() as b`)).b,
        false,
      );
      assertEquals(
        (await row<{ r: string | null }>(
          `select public.board_role()::text as r`,
        )).r,
        null,
      );
      await refuses(
        `select public.board_heartbeat()`,
        "Board membership is required",
      );
      await refuses(
        `select public.set_paused(true)`,
        "Board or moderator membership is required",
      );
      await refuses(
        `select public.file_directive('game', 'config', 'seed-1', 'x', 'y', 'z', 2, 'r', $1)`,
        "Board membership is required",
        [roleId],
      );
      await refuses(
        `select public.file_note('x')`,
        "Board membership is required",
      );
      await refuses(
        `select public.file_card('game', 'code', 'seed-1', 'x', 'Summary.', 'y', 'z', 2, 'proposed', $1, null)`,
        "Board membership is required",
        [roleId],
      );
      await refuses(
        `select public.set_launched()`,
        "Board membership is required",
      );
      await refuses(
        `select public.set_agent_mode('attended')`,
        "Board membership is required",
      );
      await refuses(
        `select public.board_studio_state()`,
        "Board or moderator membership is required",
      );
      await signInAs(null);
      assertEquals(
        (await row<{ b: boolean }>(`select public.is_board_member() as b`)).b,
        false,
      );
    });

    await t.step(
      "auth.users accepts board accounts only, case-insensitively",
      async () => {
        await refuses(
          `insert into auth.users (email) values ($1)`,
          "Sign-in is limited to board accounts",
          [OUTSIDER_EMAIL],
        );
        await db.query(`insert into auth.users (email) values ($1)`, [
          "BOARD@peanutgallery.games",
        ]);
        await db.query(`insert into auth.users (email) values ($1)`, [
          MODERATOR_EMAIL,
        ]);
        const users = await row<{ n: number }>(
          `select count(*)::int as n from auth.users`,
        );
        assertEquals(users.n, 2);
      },
    );

    await t.step(
      "the views show the newest green deploy, the ledger totals and payload-free events",
      async () => {
        await db.exec(
          `insert into public.deploys (folder, sha, is_green, created_at) values
          ('seed-1', 'a1', true, now() - interval '3 minutes'),
          ('seed-1', 'a2', false, now() - interval '1 minute'),
          ('seed-1', 'a3', true, now() - interval '2 minutes'),
          ('platform', 'b1', true, now() - interval '5 minutes')`,
        );
        const green = await rows<{ folder: string; sha: string }>(
          `select folder::text as folder, sha from public.last_green order by folder`,
        );
        assertEquals(green, [
          { folder: "platform", sha: "b1" },
          { folder: "seed-1", sha: "a3" },
        ]);

        const totals = await row(`select * from public.public_ledger_totals`);
        assertEquals(totals, {
          usd_total: "0.2334",
          input_tokens: 1021,
          cached_tokens: 200,
          output_tokens: 321,
          row_count: 4,
        });

        await db.query(
          `insert into public.agent_events (card_id, role_id, type, payload_json) values ($1, $2, 'start', '{"prompt":"private"}')`,
          [oneoffCardId, roleId],
        );
        const event = await row(`select * from public.public_agent_events`);
        assertEquals(Object.keys(event).sort(), [
          "card_id",
          "created_at",
          "id",
          "role_id",
          "type",
        ]);
      },
    );

    await t.step(
      "anon holds select on the five public tables and the six views and nothing else",
      async () => {
        const expected = [
          "cards",
          "deploys",
          "last_green",
          "ledger",
          "pool",
          "public_agent_events",
          "public_card_funding",
          "public_card_spend",
          "public_ledger_totals",
          "public_studio",
          "roles",
        ].map((table_name) => ({ table_name, privilege_type: "SELECT" }));
        for (const grantee of ["anon", "authenticated"]) {
          const grants = await rows<
            { table_name: string; privilege_type: string }
          >(
            `select table_name, privilege_type from information_schema.role_table_grants where grantee = $1 and table_schema = 'public' order by 1, 2`,
            [grantee],
          );
          assertEquals(grants, expected, grantee);
        }
      },
    );

    await t.step(
      "as anon, the public window works and the private tables and view writes are refused",
      async () => {
        const total = await row<{ n: number }>(
          `select count(*)::int as n from public.cards`,
        );
        await db.exec(`set role anon`);
        try {
          const events = await rows(`select * from public.public_agent_events`);
          assertEquals(events.length, 1);
          const billing = await rows<{ billed_to: string }>(
            `select distinct billed_to::text as billed_to from public.ledger`,
          );
          assertEquals(billing, [{ billed_to: "studio" }]);
          const totals = await row(`select * from public.public_ledger_totals`);
          assertEquals(totals.row_count, 4);
          const green = await rows(`select * from public.last_green`);
          assertEquals(green.length, 2);
          const cards = await rows(`select id from public.cards`);
          assertEquals(cards.length, total.n);
          const summaries = await rows<{ summary: string | null }>(
            `select summary from public.cards where summary is not null order by summary`,
          );
          assert(
            summaries.some((c) => c.summary === "Rename the first unit to Sweeper."),
            "anon reads cards.summary",
          );

          const studio = await rows(`select * from public.public_studio`);
          assertEquals(studio.length, 1);
          assertEquals(Object.keys(studio[0]!), ["launched_at"]);
          assertNotEquals(studio[0]!.launched_at, null);

          const funding = await rows<{
            card_id: string;
            contributors: number;
            credited_usd: string;
          }>(`select * from public.public_card_funding`);
          // Four goal cards received money: the 100-target card, the voted card
          // (two contributions), the proposed card and the live card.
          assertEquals(funding.length, 4);
          assertEquals(Object.keys(funding[0]!).sort(), [
            "card_id",
            "contributors",
            "credited_usd",
          ]);
          const byCard = new Map(funding.map((f) => [f.card_id, f]));
          assertEquals(byCard.get(goalCardId), {
            card_id: goalCardId,
            contributors: 1,
            credited_usd: "1.4107",
          });
          assertEquals(byCard.get(votedGoalId), {
            card_id: votedGoalId,
            contributors: 2,
            credited_usd: "1.8963",
          });

          await refuses(
            `select * from public.agent_events`,
            "permission denied",
          );
          await refuses(
            `update public.public_studio set launched_at = null`,
            "permission denied",
          );
          await refuses(
            `select * from public.contributions`,
            "permission denied",
          );
          await refuses(
            `select * from public.studio_state`,
            "permission denied",
          );
          await refuses(
            `select * from public.board_members`,
            "permission denied",
          );
          await refuses(
            `insert into public.public_agent_events (card_id, role_id, type) values (null, null, 'start')`,
            "permission denied",
          );
          await refuses(
            `delete from public.public_agent_events`,
            "permission denied",
          );
          await refuses(
            `update public.pool set balance_usd = 0`,
            "permission denied",
          );
          await refuses(
            `select public.apply_contribution('evt_anon', 'c', null, 1, 0.5, 20, null)`,
            "permission denied",
          );
          await refuses(
            `select public.board_heartbeat()`,
            "permission denied",
          );
        } finally {
          await db.exec(`reset role`);
        }
      },
    );

    await t.step(
      "public_card_funding counts a contributor who funds one card twice once",
      async () => {
        const card = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage) values ('game', 'board', 'goal', 'config', 'seed-1', 'A goal card funded twice by one contributor', 100, 'proposed') returning id`,
        );
        const first = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_i', 'contrib_i', null, 2.00, 1.65, 0, $1) as r`,
          [card.id],
        )).r;
        const second = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_j', 'contrib_i', null, 1.00, 0.71, 20, $1) as r`,
          [card.id],
        )).r;
        assertEquals(first.inserted, true);
        assertEquals(second.inserted, true);
        const paid = await rows<{ agents_usd: string; incident_usd: string }>(
          `select agents_usd, incident_usd from public.contributions where stripe_event_id in ('evt_i', 'evt_j')`,
        );
        assertEquals(paid.length, 2);
        const credited = paid.reduce(
          (sum, c) => sum + Number(c.agents_usd) - Number(c.incident_usd),
          0,
        ).toFixed(4);
        // 1.4107 from the first payment and 0.4856 from the second.
        assertEquals(credited, "1.8963");
        await db.exec(`set role anon`);
        try {
          const funding = await rows<{
            card_id: string;
            contributors: number;
            credited_usd: string;
          }>(`select * from public.public_card_funding where card_id = $1`, [
            card.id,
          ]);
          assertEquals(funding, [
            { card_id: card.id, contributors: 1, credited_usd: credited },
          ]);
        } finally {
          await db.exec(`reset role`);
        }
      },
    );

    await t.step(
      "public_card_spend publishes studio-billed spend per card and never founder-billed turns",
      async () => {
        const founderCards = await rows<{ card_id: string }>(
          `select distinct card_id from public.ledger where billed_to = 'founder' and card_id is not null`,
        );
        assert(founderCards.length > 0, "an earlier step billed a card's turns to the founder");
        const expected = await rows<{ card_id: string; spent_usd: string }>(
          `select card_id, sum(usd)::numeric(12,4)::text as spent_usd from public.ledger where billed_to = 'studio' and card_id is not null group by card_id order by card_id`,
        );
        await db.exec(`set role anon`);
        try {
          const published = await rows<{ card_id: string; spent_usd: string }>(
            `select card_id, spent_usd::text as spent_usd from public.public_card_spend order by card_id`,
          );
          assertEquals(published, expected);
          for (const { card_id } of founderCards) {
            const seen = published.find((p) => p.card_id === card_id);
            const studioOnly = expected.find((e) => e.card_id === card_id);
            assertEquals(seen, studioOnly, `card ${card_id} shows only its studio-billed rows`);
          }
        } finally {
          await db.exec(`reset role`);
        }
      "a $120 payment credits $50 today, holds the rest, and the release credits it once after 14 days",
      async () => {
        // The incident reserve at its cap keeps the agents share whole as pool credit.
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        const offsets = await identityOffsets();
        const card = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage) values ('game', 'board', 'goal', 'config', 'seed-1', 'A goal card funded past the daily hold', 100, 'proposed') returning id`,
        );
        const before = await pool();
        const first = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_hold1', 'contrib_hold', null, 120.00, 120.00, 0, $1, 'cs_hold1') as r`,
          [card.id],
        )).r;
        assertEquals(first.agents_usd, 108);
        assertEquals(first.incident_usd, 0);
        assertEquals(first.pool_credit_usd, 50);
        assertEquals(first.held_usd, 58);
        assertEquals(first.goal_stage, "proposed");
        assertEquals(first.goal_funded_usd, 50);
        const due = await row<{ days: number }>(
          `select round(extract(epoch from hold_until - created_at) / 86400)::int as days from public.contributions where stripe_event_id = 'evt_hold1'`,
        );
        assertEquals(due.days, 14);

        // A second payment the same day has no room left: all of it is held.
        const second = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_hold2', 'contrib_hold', null, 10.00, 10.00, 0, $1, 'cs_hold2') as r`,
          [card.id],
        )).r;
        assertEquals(second.pool_credit_usd, 0);
        assertEquals(second.held_usd, 9);
        // A replay reports the stored hold and moves nothing.
        const replay = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_hold2', 'contrib_hold', null, 10.00, 10.00, 0, $1, 'cs_hold2') as r`,
          [card.id],
        )).r;
        assertEquals(replay.inserted, false);
        assertEquals(replay.held_usd, 9);

        const held = await pool();
        assertEquals(
          (Number(held.balance_usd) - Number(before.balance_usd)).toFixed(4),
          "50.0000",
        );
        assertEquals(
          (Number(held.held_usd) - Number(before.held_usd)).toFixed(4),
          "67.0000",
        );
        assertEquals(
          (Number(held.reserve_usd) - Number(before.reserve_usd)).toFixed(4),
          "13.0000",
        );

        // Nothing is due yet, evt_d's hold from the carve-out step included.
        const early = (await row<{ r: Row }>(
          `select public.credit_held_contributions() as r`,
        )).r;
        assertEquals(early, { released: 0, released_usd: 0 });
        const afterEarly = await pool();

        await db.exec(
          `update public.contributions set hold_until = now() - interval '1 minute' where stripe_event_id in ('evt_hold1', 'evt_hold2')`,
        );
        const released = (await row<{ r: Row }>(
          `select public.credit_held_contributions() as r`,
        )).r;
        assertEquals(released, { released: 2, released_usd: 67 });
        const again = (await row<{ r: Row }>(
          `select public.credit_held_contributions() as r`,
        )).r;
        assertEquals(again, { released: 0, released_usd: 0 });

        const after = await pool();
        assertEquals(
          (Number(after.balance_usd) - Number(afterEarly.balance_usd)).toFixed(4),
          "67.0000",
        );
        assertEquals(
          (Number(after.held_usd) - Number(afterEarly.held_usd)).toFixed(4),
          "-67.0000",
        );
        const releases = await rows<{ held_usd: string; amount_usd: string }>(
          `select r.held_usd, r.amount_usd from public.contributions r join public.contributions p on p.id = r.parent_id where r.entry = 'release' and p.stripe_event_id in ('evt_hold1', 'evt_hold2') order by r.held_usd`,
        );
        assertEquals(releases, [
          { held_usd: "-58.0000", amount_usd: "0.0000" },
          { held_usd: "-9.0000", amount_usd: "0.0000" },
        ]);
        const funded = await row(
          `select stage::text as stage, funded_usd from public.cards where id = $1`,
          [card.id],
        );
        assertEquals(funded, { stage: "funded", funded_usd: "117.0000" });
        await refuses(
          `insert into public.contributions (entry, parent_id, rail, contributor_id) select 'release', id, 'stripe', 'x' from public.contributions where stripe_event_id = 'evt_hold1'`,
          "contributions_one_release",
        );
        assertEquals(await identityOffsets(), offsets);
      },
    );

    await t.step(
      "function privileges: anon none, authenticated the eleven board RPCs, service_role the fourteen, one file_card",
      "a refund cancels the hold first, follows Stripe's cumulative total and a replay changes nothing",
      async () => {
        // The incident reserve at its cap keeps the agents share whole as pool credit.
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        const offsets = await identityOffsets();
        const card = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage) values ('game', 'board', 'goal', 'config', 'seed-1', 'A goal card whose funding is refunded', 50, 'proposed') returning id`,
        );
        const pay = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_r', 'contrib_r', null, 100.00, 100.00, 0, $1, 'cs_r') as r`,
          [card.id],
        )).r;
        assertEquals(pay.pool_credit_usd, 50);
        assertEquals(pay.held_usd, 40);
        assertEquals(pay.goal_stage, "funded");
        const before = await pool();

        const part = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_rf1', 'cs_r', 'refund', 25) as r`,
        )).r;
        assertEquals(part.inserted, true);
        assertEquals(part.reversed_usd, 25);
        assertEquals(part.held_cancelled_usd, 22.5);
        assertEquals(part.reserve_cover_usd, 0);
        assertEquals(part.fully_reversed, false);
        const partRow = await row(
          `select entry::text as entry, amount_usd, net_usd, reserve_usd, agents_usd, studio_usd, incident_usd, held_usd, stripe_session_id from public.contributions where stripe_event_id = 'evt_rf1'`,
        );
        assertEquals(partRow, {
          entry: "refund",
          amount_usd: "-25.0000",
          net_usd: "-25.0000",
          reserve_usd: "-2.5000",
          agents_usd: "-22.5000",
          studio_usd: "0.0000",
          incident_usd: "0.0000",
          held_usd: "-22.5000",
          stripe_session_id: null,
        });
        const afterPart = await pool();
        assertEquals(afterPart.balance_usd, before.balance_usd);
        assertEquals(
          (Number(afterPart.held_usd) - Number(before.held_usd)).toFixed(4),
          "-22.5000",
        );

        const replay = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_rf1', 'cs_r', 'refund', 25) as r`,
        )).r;
        assertEquals(replay.inserted, false);
        assertEquals(replay.replay, true);
        assertEquals(await pool(), afterPart);

        // The next refund event carries the cumulative 100, so only 75 is due.
        const rest = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_rf2', 'cs_r', 'refund', 100) as r`,
        )).r;
        assertEquals(rest.reversed_usd, 75);
        assertEquals(rest.held_cancelled_usd, 17.5);
        assertEquals(rest.fully_reversed, true);
        assertEquals(rest.goal_stage, "funded");
        assertEquals(rest.goal_funded_usd, 0);
        const afterRest = await pool();
        assertEquals(
          (Number(afterRest.balance_usd) - Number(before.balance_usd)).toFixed(4),
          "-50.0000",
        );
        assertEquals(
          (Number(afterRest.held_usd) - Number(before.held_usd)).toFixed(4),
          "-40.0000",
        );
        assertEquals(
          (Number(afterRest.reserve_usd) - Number(before.reserve_usd)).toFixed(4),
          "-10.0000",
        );

        const nothingDue = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_rf3', 'cs_r', 'refund', 100) as r`,
        )).r;
        assertEquals(nothingDue.inserted, false);
        assertEquals(nothingDue.reversed_usd, 0);

        // The cancelled hold releases 0 and leaves the queue.
        await db.exec(
          `update public.contributions set hold_until = now() - interval '1 minute' where stripe_event_id = 'evt_r'`,
        );
        const release = (await row<{ r: Row }>(
          `select public.credit_held_contributions() as r`,
        )).r;
        assertEquals(release, { released: 0, released_usd: 0 });
        const zero = await row(
          `select r.held_usd from public.contributions r join public.contributions p on p.id = r.parent_id where r.entry = 'release' and p.stripe_event_id = 'evt_r'`,
        );
        assertEquals(zero, { held_usd: "0.0000" });
        assertEquals(await pool(), afterRest);

        const sums = await row(
          `select sum(amount_usd) as amount, sum(net_usd) as net, sum(reserve_usd) as reserve, sum(agents_usd) as agents, sum(held_usd) as held from public.contributions where id = (select id from public.contributions where stripe_event_id = 'evt_r') or parent_id = (select id from public.contributions where stripe_event_id = 'evt_r')`,
        );
        assertEquals(sums, {
          amount: "0.0000",
          net: "0.0000",
          reserve: "0.0000",
          agents: "0.0000",
          held: "0.0000",
        });
        await db.exec(`set role anon`);
        try {
          const funding = await rows(
            `select contributors, credited_usd from public.public_card_funding where card_id = $1`,
            [card.id],
          );
          assertEquals(funding, [{ contributors: 0, credited_usd: "0.0000" }]);
        } finally {
          await db.exec(`reset role`);
        }

        const missing = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_rf4', 'cs_unknown', 'refund', 1) as r`,
        )).r;
        assertEquals(missing, { found: false, inserted: false });
        assertEquals(await identityOffsets(), offsets);
      },
    );

    await t.step(
      "a dispute draws the reserve first and only the rest comes off the pool and the bar",
      async () => {
        // The incident reserve at its cap keeps the agents share whole as pool credit.
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        const offsets = await identityOffsets();
        const card = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage) values ('game', 'board', 'goal', 'config', 'seed-1', 'A goal card with a disputed payment', 30, 'proposed') returning id`,
        );
        await row(
          `select public.apply_contribution('evt_dp', 'contrib_dp', null, 20.00, 20.00, 0, $1, 'cs_dp') as r`,
          [card.id],
        );
        const before = await pool();
        assert(Number(before.reserve_usd) >= 20, "the reserve covers the whole dispute");
        const covered = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_dpd', 'cs_dp', 'dispute', 20) as r`,
        )).r;
        assertEquals(covered.reversed_usd, 20);
        assertEquals(covered.reserve_cover_usd, 18);
        assertEquals(covered.goal_funded_usd, 18);
        const afterCovered = await pool();
        assertEquals(afterCovered.balance_usd, before.balance_usd);
        assertEquals(
          (Number(afterCovered.reserve_usd) - Number(before.reserve_usd)).toFixed(4),
          "-20.0000",
        );
        const coveredRow = await row(
          `select entry::text as entry, amount_usd, reserve_usd, agents_usd, held_usd from public.contributions where stripe_event_id = 'evt_dpd'`,
        );
        assertEquals(coveredRow, {
          entry: "dispute",
          amount_usd: "-20.0000",
          reserve_usd: "-20.0000",
          agents_usd: "0.0000",
          held_usd: "0.0000",
        });
        assertEquals(await identityOffsets(), offsets);

        // With $5 left in the reserve, it covers $3 and the pool and bar lose $15.
        await row(
          `select public.apply_contribution('evt_dq', 'contrib_dq', null, 20.00, 20.00, 0, $1, 'cs_dq') as r`,
          [card.id],
        );
        await db.exec(`update public.pool set reserve_usd = 5 where id = 1`);
        const shortOffsets = await identityOffsets();
        const beforeShort = await pool();
        const short = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_dqd', 'cs_dq', 'dispute', 20) as r`,
        )).r;
        assertEquals(short.reserve_cover_usd, 3);
        assertEquals(short.goal_stage, "funded");
        assertEquals(short.goal_funded_usd, 21);
        const afterShort = await pool();
        assertEquals(afterShort.reserve_usd, "0.0000");
        assertEquals(
          (Number(afterShort.balance_usd) - Number(beforeShort.balance_usd)).toFixed(4),
          "-15.0000",
        );
        assertEquals(await identityOffsets(), shortOffsets);
      },
    );

    await t.step("reverse_contribution refuses bad inputs", async () => {
      await refuses(
        `select public.reverse_contribution('', 'cs_r', 'refund', 1)`,
        "p_stripe_event_id is required",
      );
      await refuses(
        `select public.reverse_contribution('evt_x', '', 'refund', 1)`,
        "p_stripe_session_id is required",
      );
      await refuses(
        `select public.reverse_contribution('evt_x', 'cs_r', 'release', 1)`,
        "p_kind must be refund or dispute",
      );
      await refuses(
        `select public.reverse_contribution('evt_x', 'cs_r', 'refund', -1)`,
        "p_kind_total_usd must be zero or more",
      );
      await refuses(
        `insert into public.contributions (entry, parent_id, rail, contributor_id) select 'refund', id, 'stripe', 'x' from public.contributions where stripe_event_id = 'evt_r'`,
        "contributions_reversal_event_check",
      );
    });

    await t.step(
      "function privileges: anon none, authenticated the ten board RPCs, service_role the fifteen, one file_card",
      async () => {
        const privileges = await rows<{
          proname: string;
          anon: boolean;
          authenticated: boolean;
          service_role: boolean;
        }>(
          `select p.proname,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                has_function_privilege('service_role', p.oid, 'execute') as service_role
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' order by 1`,
        );
        const board = [
          "board_aal2",
          "board_heartbeat",
          "board_role",
          "board_studio_state",
          "file_card",
          "file_directive",
          "file_note",
          "is_board_member",
          "set_agent_mode",
          "set_launched",
          "set_paused",
        ];
        const service = [
          "apply_contribution",
          "credit_held_contributions",
          "founder_credit",
          "record_usage",
          "reverse_contribution",
        ];
        assertEquals(
          privileges.map((p) => p.proname),
          [
            ...board,
            ...service,
            "restrict_auth_users_to_board",
            "set_updated_at",
          ].sort(),
        );
        // One file_card row: the eleven-argument version, granted like the old one.
        assertEquals(privileges.filter((p) => p.proname === "file_card"), [
          {
            proname: "file_card",
            anon: false,
            authenticated: true,
            service_role: true,
          },
        ]);
        for (const p of privileges) {
          assertEquals(p.anon, false, `anon may not run ${p.proname}`);
          assertEquals(
            p.authenticated,
            board.includes(p.proname),
            `authenticated on ${p.proname}`,
          );
          if (board.includes(p.proname) || service.includes(p.proname)) {
            assertEquals(p.service_role, true, `service_role on ${p.proname}`);
          }
        }
      },
    );

    await t.step("realtime publishes pool, cards and deploys", async () => {
      const published = await rows<{ tablename: string }>(
        `select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`,
      );
      assertEquals(published.map((r) => r.tablename), [
        "cards",
        "deploys",
        "pool",
      ]);
    });

    await t.step("updated_at advances on cards and stream_state", async () => {
      const before = await row<{ updated_at: Date }>(
        `select updated_at from public.cards where id = $1`,
        [oneoffCardId],
      );
      await db.query(
        `update public.cards set updated_at = updated_at - interval '1 hour', title = title where id = $1`,
        [oneoffCardId],
      );
      const after = await row<{ updated_at: Date }>(
        `select updated_at from public.cards where id = $1`,
        [oneoffCardId],
      );
      assert(after.updated_at.getTime() >= before.updated_at.getTime());

      const scene = await row<{ updated_at: Date }>(
        `select updated_at from public.stream_state where id = 1`,
      );
      await db.exec(
        `update public.stream_state set scene = 'devcam', updated_at = now() - interval '1 hour' where id = 1`,
      );
      const switched = await row<{ updated_at: Date; scene: string }>(
        `select updated_at, scene::text as scene from public.stream_state where id = 1`,
      );
      assertEquals(switched.scene, "devcam");
      assert(switched.updated_at.getTime() >= scene.updated_at.getTime());
    });
  } finally {
    await db.close();
  }
});
