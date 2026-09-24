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

/** Every cards column anon and authenticated may select, sorted. */
const PUBLIC_CARD_COLUMNS = [
  "acceptance_test",
  "board_reason",
  "board_veto_reason",
  "board_vetoed",
  "branch",
  "bucket",
  "check_author_role_id",
  "commit_sha",
  "confidence",
  "created_at",
  "design_spec_url",
  "director_stance",
  "drafter_role_id",
  "estimate_usd",
  "executor_role_id",
  "failing_check",
  "folder",
  "funded_usd",
  "funding_target_usd",
  "horizon",
  "id",
  "intent",
  "lane",
  "live_at",
  "opens_at",
  "proposer_role_id",
  "rank",
  "shape",
  "source",
  "stage",
  "summary",
  "title",
  "updated_at",
  "veto_reason",
];

/** The keys board_studio_state returns, sorted. */
const BOARD_STATE_KEYS = [
  "agent_hourly_rate_usd",
  "agent_mode",
  "anthropic_tier_cap_usd",
  "card_max_usd",
  "cooling_window_minutes",
  "credit_bought_usd",
  "credit_daily_cap_usd",
  "credit_spent_usd",
  "credit_studio_daily_cap_usd",
  "daily_cap_usd",
  "dispatcher_seen_at",
  "launched_at",
  "monthly_cap_usd",
  "paused",
  "paused_at",
  "paused_by",
  "platform_lane_open",
];

/** The tables 20260923000020_append_only.sql guards, each with a <table>_append_only trigger. */
// money-logic.md adds its three tables to the guard; terms_versions keeps its own triggers.
// agent-system-core.md adds card_approvals.
const APPEND_ONLY_TABLES = ["ledger", "contributions", "credit_purchases", "board_actions", "controller_runs", "contribution_allocations", "supporters", "board_test_payments", "card_approvals"];

/** SQL that turns every append-only row trigger off or back on (fixture writes only). */
function setAppendOnly(state: "disable" | "enable"): string {
  return APPEND_ONLY_TABLES.map((table) => `alter table public.${table} ${state} trigger ${table}_append_only;`).join("\n");
}

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
   * SQL that removes the contributions matching a where clause, with their
   * allocations and supporter numbers, for steps that undo a fixture payment
   * (docs/specs/money-logic.md: allocations and supporters reference them).
   */
  function forget(where: string): string {
    const ids = `select id from public.contributions where ${where}`;
    return `delete from public.contribution_allocations where payment_id in (${ids}) or entry_id in (${ids});
      delete from public.supporters where first_payment_id in (${ids});
      delete from public.contributions where ${where};`;
  }

  /**
   * Stops every card that takes money from taking more (a fixture write), so a
   * step's payments reach only the cards it opens. money-logic.md's waterfall
   * sends credit beyond a card's target, and a payment naming no card, to the
   * cards that take money in rank order, so an earlier step's open card would
   * otherwise take it.
   */
  async function quietCards() {
    await db.exec(
      `update public.cards c set director_stance = 'vetoed' where money.card_takes_money(c, true)`,
    );
  }

  /** A goal card that takes money: on now, with a target, an executor and a board source. */
  async function openGoal(title: string, target: number, stage = "proposed", lane = "config"): Promise<string> {
    return (await row<{ id: string }>(
      `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage, executor_role_id) values ('game', 'board', 'goal', $4, 'seed-1', $1, $2, $3, $5) returning id`,
      [title, target, stage, lane, roleId],
    )).id;
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

  /** Each money column summed over one payment and its child rows. */
  async function familySums(eventId: string) {
    return await row(
      `select sum(c.amount_usd) as amount, sum(c.net_usd) as net, sum(c.reserve_usd) as reserve, sum(c.agents_usd) as agents, sum(c.studio_usd) as studio, sum(c.incident_usd) as incident, sum(c.held_usd) as held
       from public.contributions c, (select id from public.contributions where stripe_event_id = $1) p
       where c.id = p.id or c.parent_id = p.id`,
      [eventId],
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
        "20260921000000_open_goal_funding.sql",
        "20260921000100_public_card_columns.sql",
        "20260921000200_ledger_request_id.sql",
        "20260922000000_ledger_overhead.sql",
        "20260922000100_money_fixes.sql",
        "20260922000200_dispatcher_lease.sql",
        "20260922000300_backlog.sql",
        "20260922000400_public_roles.sql",
        "20260922000500_roles_revoke.sql",
        "20260923000000_contribution_entries.sql",
        "20260923000010_backup_role.sql",
        "20260923000020_append_only.sql",
        "20260923000100_spend_totals.sql",
        "20260923000200_rename_biz_dev.sql",
        "20260924000000_board_site.sql",
        "20260924100000_terms_versions.sql",
        "20260924100100_terms_version_2.sql",
        "20260924200000_money_logic.sql",
        "20260924300000_agent_system_core.sql",
        "20260924400000_agent_workflows.sql",
        "20260924500000_site_snapshot.sql",
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
      // Every migration after the first is written to run twice, so each one
      // runs again straight after itself, the way a retried apply would. Each
      // exec is one transaction, as each Management API request is.
      for (const [index, m] of migrations.entries()) {
        await db.exec(m.sql.replaceAll(PGCRYPTO_LINE, ""));
        if (index > 0) await db.exec(m.sql.replaceAll(PGCRYPTO_LINE, ""));
      }
      // The steps below rewrite fixtures by hand (a hold that has ended, a
      // payment made before midnight, a row removed so a call can run again),
      // which the append-only triggers refuse. They run with those triggers
      // off; "the money tables are append-only" runs every money path with
      // them on.
      await db.exec(setAppendOnly("disable"));

      const tables = await rows<{ table_name: string }>(
        `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
      );
      assertEquals(tables.map((r) => r.table_name), [
        "agent_events",
        "board_actions",
        "board_members",
        "board_notes",
        "board_test_payments",
        "card_approvals",
        "card_drafts",
        "card_patches",
        "cards",
        "contribution_allocations",
        "contributions",
        "controller_runs",
        "credit_purchases",
        "decisions",
        "deploys",
        "dispatcher_lease",
        "images",
        "job_runs",
        "jobs",
        "ledger",
        "pool",
        "roles",
        "scores",
        "standing_costs",
        "stream_state",
        "studio_state",
        "supporters",
        "terms_versions",
        "votes",
      ]);
      const views = await rows<{ table_name: string }>(
        `select table_name from information_schema.views where table_schema = 'public' order by 1`,
      );
      assertEquals(views.map((r) => r.table_name), [
        "dispatcher_cards",
        "last_green",
        "public_agent_events",
        "public_card_funding",
        "public_card_spend",
        "public_ledger_totals",
        "public_money",
        "public_roles",
        "public_stopped_cards",
        "public_studio",
        "public_terms_versions",
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
      const liveAt = await row<{ data_type: string; is_nullable: string }>(
        `select data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'cards' and column_name = 'live_at'`,
      );
      assertEquals(liveAt, { data_type: "timestamp with time zone", is_nullable: "YES" });
      const sessionKey = await rows(
        `select c.conname from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) where c.conrelid = 'public.contributions'::regclass and c.contype = 'u' and a.attname = 'stripe_session_id'`,
      );
      assertEquals(sessionKey.length, 1);
      const applySignatures = await rows(
        `select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'apply_contribution'`,
      );
      // money-logic.md adds p_session_created_at last and drops the nine-argument signature.
      assertEquals(applySignatures, [{
        args:
          "p_stripe_event_id text, p_contributor_id text, p_display_name text, p_amount_usd numeric, p_net_usd numeric, p_studio_pct integer, p_goal_card_id uuid, p_stripe_session_id text, p_payer_key text, p_session_created_at timestamp with time zone",
      }]);
      // Every card column added for launch is nullable or defaulted, so the
      // deployed dispatcher's inserts and the week-1 seed keep working.
      assertEquals(
        await rows(
          `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and ((table_name = 'cards' and column_name in ('horizon', 'rank')) or (table_name = 'roles' and column_name = 'description') or (table_name = 'contributions' and column_name = 'payer_key')) order by table_name, column_name`,
        ),
        [
          { column_name: "horizon", data_type: "USER-DEFINED", is_nullable: "NO", column_default: "'now'::card_horizon" },
          { column_name: "rank", data_type: "integer", is_nullable: "YES", column_default: null },
          { column_name: "payer_key", data_type: "text", is_nullable: "YES", column_default: null },
          { column_name: "description", data_type: "text", is_nullable: "YES", column_default: null },
        ],
      );
      assertEquals(
        await rows(
          `select column_name, column_default from information_schema.columns where table_schema = 'public' and table_name = 'studio_state' and column_name in ('credit_studio_daily_cap_usd', 'monthly_cap_usd') order by 1`,
        ),
        [
          { column_name: "credit_studio_daily_cap_usd", column_default: "500" },
          { column_name: "monthly_cap_usd", column_default: "500" },
        ],
      );
      assertEquals(
        (await rows<{ label: string }>(
          `select e.enumlabel as label from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'ledger_billing' order by e.enumsortorder`,
        )).map((r) => r.label),
        ["studio", "founder", "overhead"],
      );
      const withoutRls = await rows(
        `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
      );
      assertEquals(withoutRls, []);

      // The steps below pay far more than $500 in one New York day, so the
      // studio-wide room on immediate credit starts at the $10,000 most set_caps
      // allows; its own step sets it back to the $500 default.
      await db.exec(
        `insert into public.studio_state (id, credit_studio_daily_cap_usd) values (1, 10000); insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);`,
      );
      // The builder every money step's goal cards name as their executor: a card
      // takes money only when the dispatcher could start it (docs/specs/money-logic.md).
      roleId = (await row<{ id: string }>(
        `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, tools_json, write_access) values ('Builder A', 'Builder A', 'A small blue creature.', 'builder-model-id', 0.2, 'plain', 'platform/agents/prompts/builder-a.md', '["Read"]', true) returning id`,
      )).id;
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
          `${forget("stripe_session_id = 'cs_s'")}
           update public.pool set balance_usd = ${before.balance_usd}, reserve_usd = ${before.reserve_usd}, incident_reserve_usd = ${before.incident_reserve_usd} where id = 1;`,
        );
      },
    );

    await t.step(
      "a goal card's bar rises by the net amount and an open decision of matching size is assigned",
      async () => {
        goalCardId = await openGoal("A goal card with a 100 target", 100, "voted", "code");
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
        // The card keeps room under its target; the steps below open their own cards.
        await quietCards();
      },
    );

    await t.step(
      "a voted goal that reaches its target moves to funded with the estimate seeded from the target",
      async () => {
        votedGoalId = await openGoal("A voted goal with a 1 target", 1, "voted");
        const before = await pool();
        const first = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_e', 'contrib_e', null, 2.00, 1.65, 0, $1) as r`,
          [votedGoalId],
        )).r;
        // net 1.65 at 0%: reserve 0.1650, agents 1.4850, incident 0.0743, credit 1.4107.
        // Superseded (money-logic.md, uncapped bars): a card takes money up to its
        // target, 1.0000, and the rest goes on down the waterfall, here to Not on a
        // card yet, since no other card takes money.
        assertEquals(first.pool_credit_usd, 1.4107);
        assertEquals(first.goal_stage, "funded");
        assertEquals(first.goal_funded_usd, 1);
        assertEquals(first.allocations, [
          { destination: "card", card_id: votedGoalId, amount_usd: 1, step: 1 },
          { destination: "unassigned", card_id: null, amount_usd: 0.4107, step: 3 },
        ]);
        assertEquals(
          await row(
            `select funded_usd, estimate_usd, stage::text as stage from public.cards where id = $1`,
            [votedGoalId],
          ),
          { funded_usd: "1.0000", estimate_usd: "1.0000", stage: "funded" },
        );
        const second = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_f', 'contrib_f', null, 1.00, 0.71, 20, $1) as r`,
          [votedGoalId],
        )).r;
        // net 0.71 at 20%: agents 0.5112, incident 0.0256, credit 0.4856. The card
        // is full, so it takes no money: the payment keeps the card it asked for in
        // requested_card_id and names none, and its credit starts at step 2.
        assertEquals(second.inserted, true);
        assertEquals(second.pool_credit_usd, 0.4856);
        assertEquals(second.goal_card_id, null);
        assertEquals(second.requested_card_id, votedGoalId);
        assertEquals(second.goal_stage, null);
        assertEquals(second.goal_funded_usd, null);
        assertEquals(
          await row(
            `select goal_card_id, requested_card_id = $1 as requested from public.contributions where stripe_event_id = 'evt_f'`,
            [votedGoalId],
          ),
          { goal_card_id: null, requested: true },
        );
        assertEquals(
          await row(
            `select funded_usd, estimate_usd, stage::text as stage from public.cards where id = $1`,
            [votedGoalId],
          ),
          { funded_usd: "1.0000", estimate_usd: "1.0000", stage: "funded" },
        );
        // The pool still rose by both credits.
        const after = await pool();
        assertEquals(
          (Number(after.balance_usd) - Number(before.balance_usd)).toFixed(4),
          "1.8963",
        );

        // A proposed card flips too, and an estimate that was already set is left alone.
        const proposed = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, estimate_usd, stage, executor_role_id) values ('game', 'board', 'goal', 'code', 'seed-1', 'A proposed goal with a 1 target', 1, 0.5, 'proposed', $1) returning id`,
          [roleId],
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
          { funded_usd: "1.0000", estimate_usd: "0.5000", stage: "funded" },
        );
      },
    );

    await t.step(
      "a replay names the card stored on the payment, even after the card has closed",
      async () => {
        const card = { id: await openGoal("A voted goal that closes before a replay", 100, "voted") };
        const start = await pool();
        const paid = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_rp1', 'contrib_rp', null, 2.00, 1.65, 0, $1, 'cs_rp') as r`,
          [card.id],
        )).r;
        assertEquals(paid.goal_card_id, card.id);
        await db.query(`update public.cards set stage = 'funded' where id = $1`, [card.id]);
        const before = await pool();
        const replay = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_rp2', 'contrib_rp', null, 2.00, 1.65, 0, $1, 'cs_rp') as r`,
          [card.id],
        )).r;
        assertEquals(replay.inserted, false);
        assertEquals(replay.contribution_id, paid.contribution_id);
        assertEquals(replay.goal_card_id, card.id);
        assertEquals(await pool(), before);
        // A replay of a payment that went to the pool names no card, even with an open card's id.
        const pooled = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_a', 'contrib_a', 'Board', 1.00, 0.71, 20, $1) as r`,
          [goalCardId],
        )).r;
        assertEquals(pooled.inserted, false);
        assertEquals(pooled.goal_card_id, null);
        await db.exec(
          `${forget("stripe_session_id = 'cs_rp'")}
           update public.cards set funded_usd = 0, director_stance = 'vetoed' where id = '${card.id}';
           update public.pool set balance_usd = ${start.balance_usd}, reserve_usd = ${start.reserve_usd}, incident_reserve_usd = ${start.incident_reserve_usd}, held_usd = ${start.held_usd} where id = 1;`,
        );
      },
    );

    await t.step(
      "only a card that takes money is credited: live and building goals send it on, and a funded goal below its target takes it",
      async () => {
        // Superseded (money-logic.md): a funded card below its target (after a
        // refund) takes money again at steps 1 and 2; live and building cards
        // never do, and their payments keep the card they asked for in
        // requested_card_id.
        for (const stage of ["live", "building"]) {
          const card = await openGoal(`A ${stage} goal with a 1 target`, 1, stage);
          const before = await pool();
          const { r } = await row<{ r: Row }>(
            `select public.apply_contribution($1, $2, null, 2.00, 1.65, 0, $3) as r`,
            [`evt_h_${stage}`, `contrib_h_${stage}`, card],
          );
          assertEquals(r.inserted, true, stage);
          assertEquals(r.pool_credit_usd, 1.4107, stage);
          assertEquals(r.goal_card_id, null, stage);
          assertEquals(r.requested_card_id, card, stage);
          assertEquals(r.goal_stage, null, stage);
          assertEquals(r.goal_funded_usd, null, stage);
          assertEquals(
            await row(
              `select goal_card_id from public.contributions where stripe_event_id = $1`,
              [`evt_h_${stage}`],
            ),
            { goal_card_id: null },
            stage,
          );
          assertEquals(
            await row(
              `select funded_usd, estimate_usd, stage::text as stage from public.cards where id = $1`,
              [card],
            ),
            { funded_usd: "0.0000", estimate_usd: "0.0000", stage },
          );
          const after = await pool();
          assertEquals(
            (Number(after.balance_usd) - Number(before.balance_usd)).toFixed(4),
            "1.4107",
            stage,
          );
        }
        const funded = await openGoal("A funded goal below its 1 target", 1, "funded");
        const paid = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_h_funded', 'contrib_h_funded', null, 2.00, 1.65, 0, $1) as r`,
          [funded],
        )).r;
        assertEquals(paid.goal_card_id, funded);
        assertEquals(paid.goal_stage, "funded");
        assertEquals(paid.goal_funded_usd, 1);

        // A designing card is open: its bar rises to its target, and only proposed or voted flips to funded.
        const designing = await openGoal("A designing goal with a 1 target", 1, "designing");
        const { r } = await row<{ r: Row }>(
          `select public.apply_contribution('evt_h_designing', 'contrib_h_designing', null, 2.00, 1.65, 0, $1) as r`,
          [designing],
        );
        assertEquals(r.goal_card_id, designing);
        assertEquals(r.goal_stage, "designing");
        assertEquals(r.goal_funded_usd, 1);
        assertEquals(
          await row(
            `select funded_usd, estimate_usd, stage::text as stage from public.cards where id = $1`,
            [designing],
          ),
          { funded_usd: "1.0000", estimate_usd: "1.0000", stage: "designing" },
        );
      },
    );

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
      "founder_credit is gone, so nothing but a customer payment raises the pool",
      async () => {
        assertEquals(
          await rows(
            `select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'founder_credit'`,
          ),
          [],
        );
        await refuses(
          `select public.founder_credit(50, 'cash', 'Founder')`,
          "does not exist",
        );
      },
    );

    await t.step(
      "record_usage meters the ledger, resets the day and charges the card",
      async () => {
        // roleId is the builder the first step added.
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
      "record_usage refuses a studio row with no card, writes a founder row with none, and refuses bad inputs",
      async () => {
        // agent-system-core.md: studio money is spent only on a card.
        await refuses(
          `select public.record_usage(null, $1, 'builder-model-id', 1, 0, 1, 0.01)`,
          "A studio row names a card",
          [roleId],
        );
        const { r } = await row<{ r: Row }>(
          `select public.record_usage(null, $1, 'builder-model-id', 1, 0, 1, 0.01, 'founder') as r`,
          [roleId],
        );
        assertEquals(r.actual_usd, null);
        assertNotEquals(r.ledger_id, null);
        // Later steps pin the ledger's billing, so the founder row is taken back out.
        await db.query(`delete from public.ledger where id = $1`, [r.ledger_id]);
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
      "record_usage writes a request id once, and without one as before",
      async () => {
        const ledgerCount = async (where: string, params: unknown[] = []) =>
          Number((await row<{ n: string }>(`select count(*)::text as n from public.ledger where ${where}`, params)).n);
        const studio = (requestId: string | null) =>
          row<{ r: Row }>(
            `select public.record_usage($3, $1, 'builder-model-id', 10, 0, 10, 0.25, 'studio', $2) as r`,
            [roleId, requestId, oneoffCardId],
          );
        const before = await pool();
        const cardBefore = await row<{ actual_usd: string }>(`select actual_usd from public.cards where id = $1`, [oneoffCardId]);
        const ledgerBefore = await rows<{ id: string }>(`select id from public.ledger`);
        const debited = async (usd: string) => {
          const now = await pool();
          assertEquals((Number(before.balance_usd) - Number(now.balance_usd)).toFixed(4), usd);
          assertEquals((Number(now.daily_spent_usd) - Number(before.daily_spent_usd)).toFixed(4), usd);
        };

        const first = await studio("probe/one/turn/1");
        const again = await studio("probe/one/turn/1");
        assertEquals(again.r.ledger_id, first.r.ledger_id);
        assertEquals(again.r.balance_usd, first.r.balance_usd);
        assertEquals(again.r.daily_spent_usd, first.r.daily_spent_usd);
        assertEquals(await ledgerCount("request_id = $1", ["probe/one/turn/1"]), 1);
        await debited("0.2500");

        const other = await studio("probe/one/turn/2");
        assertNotEquals(other.r.ledger_id, first.r.ledger_id);
        await debited("0.5000");

        const nullsBefore = await ledgerCount("request_id is null");
        await studio(null);
        await studio(null);
        assertEquals(await ledgerCount("request_id is null"), nullsBefore + 2);
        await debited("1.0000");

        // A founder row on a card: the card is charged once and the retry reports its total.
        const card = await row<{ actual_usd: string }>(`select actual_usd from public.cards where id = $1`, [oneoffCardId]);
        const founder = (requestId: string) =>
          row<{ r: Row }>(
            `select public.record_usage($1, $2, 'builder-model-id', 5, 0, 5, 0.1, 'founder', $3) as r`,
            [oneoffCardId, roleId, requestId],
          );
        const charged = await founder("card/one/settle/1");
        const retried = await founder("card/one/settle/1");
        assertEquals(retried.r, charged.r);
        const after = await row<{ actual_usd: string }>(`select actual_usd from public.cards where id = $1`, [oneoffCardId]);
        assertEquals((Number(after.actual_usd) - Number(card.actual_usd)).toFixed(4), "0.1000");
        await debited("1.0000");

        // The old named-argument call, as supabase-js sends it before the dispatcher passes an id.
        const named = await row<{ r: Row }>(
          `select public.record_usage(p_card_id => $2, p_role_id => $1, p_model => 'builder-model-id', p_input_tokens => 1, p_cached_tokens => 0, p_output_tokens => 1, p_usd => 0.01, p_billed_to => 'studio') as r`,
          [roleId, oneoffCardId],
        );
        const namedRow = await row(`select request_id, usd from public.ledger where id = $1`, [named.r.ledger_id]);
        assertEquals(namedRow, { request_id: null, usd: "0.0100" });
        await debited("1.0100");

        // The same id with any other value is refused, and nothing changes.
        const stable = await pool();
        const conflicts: Array<[string, unknown[]]> = [
          ["another amount", [oneoffCardId, roleId, "builder-model-id", 0.26, "studio"]],
          ["another model", [oneoffCardId, roleId, "other-model-id", 0.25, "studio"]],
          ["another payer", [oneoffCardId, roleId, "builder-model-id", 0.25, "founder"]],
          ["another card", [goalCardId, roleId, "builder-model-id", 0.25, "studio"]],
        ];
        for (const [what, [cardId, role, model, usd, billedTo]] of conflicts) {
          await refuses(
            `select public.record_usage($1, $2, $3, 10, 0, 10, $4, $5, 'probe/one/turn/1')`,
            "request id probe/one/turn/1 was written with different values",
            [cardId, role, model, usd, billedTo],
          );
          assertEquals(await ledgerCount("request_id = $1", ["probe/one/turn/1"]), 1, what);
        }
        assertEquals(await pool(), stable);
        // The amount is compared after rounding, as it is stored.
        const rounded = await row<{ r: Row }>(
          `select public.record_usage($2, $1, 'builder-model-id', 10, 0, 10, 0.25004, 'studio', 'probe/one/turn/1') as r`,
          [roleId, oneoffCardId],
        );
        assertEquals(rounded.r.ledger_id, first.r.ledger_id);

        const signatures = await rows(
          `select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'record_usage'`,
        );
        assertEquals(signatures, [{
          args:
            "p_card_id uuid, p_role_id uuid, p_model text, p_input_tokens integer, p_cached_tokens integer, p_output_tokens integer, p_usd numeric, p_billed_to ledger_billing, p_request_id text",
        }]);

        // Later steps pin the ledger totals, so the rows this step wrote are taken back out.
        await db.query(`delete from public.ledger where not (id = any($1::uuid[]))`, [ledgerBefore.map((l) => l.id)]);
        await db.query(`update public.pool set balance_usd = $1, daily_spent_usd = $2 where id = 1`, [before.balance_usd, before.daily_spent_usd]);
        await db.query(`update public.cards set actual_usd = $1 where id = $2`, [cardBefore.actual_usd, oneoffCardId]);
        assertEquals(await pool(), before);
      },
    );

    await t.step(
      "an overhead row is public, names no card and leaves the pool alone, and a founder row stays private",
      async () => {
        const before = await pool();
        const offsets = await identityOffsets();
        const ledgerBefore = await rows<{ id: string }>(`select id from public.ledger`);
        const anonTotals = async () => {
          await db.exec(`set role anon`);
          try {
            return await row<Row>(`select * from public.public_ledger_totals`);
          } finally {
            await db.exec(`reset role`);
          }
        };
        const totalsBefore = await anonTotals();

        const probe = (requestId: string) =>
          row<{ r: Row }>(
            `select public.record_usage(null, $1, 'probe-model-id', 100, 0, 20, 0.0312, 'overhead', $2) as r`,
            [roleId, requestId],
          );
        const first = await probe("probe/overhead/1");
        assertEquals(await pool(), before);
        assertEquals(first.r.balance_usd, Number(before.balance_usd));
        assertEquals(first.r.daily_spent_usd, Number(before.daily_spent_usd));
        assertEquals(first.r.actual_usd, null);
        // A retry of the same request writes nothing.
        const retry = await probe("probe/overhead/1");
        assertEquals(retry.r.ledger_id, first.r.ledger_id);
        assertEquals(
          (await row<{ n: number }>(`select count(*)::int as n from public.ledger where request_id = 'probe/overhead/1'`)).n,
          1,
        );
        await refuses(
          `select public.record_usage($1, $2, 'probe-model-id', 1, 0, 1, 0.01, 'overhead')`,
          "An overhead row names no card",
          [oneoffCardId, roleId],
        );
        const founder = await row<{ r: Row }>(
          `select public.record_usage(null, $1, 'builder-model-id', 1, 0, 1, 0.05, 'founder') as r`,
          [roleId],
        );
        assertEquals(await pool(), before);
        // Neither kind of row moves the identity, which counts studio rows only.
        assertEquals(await identityOffsets(), offsets);

        await db.exec(`set role anon`);
        try {
          const seen = await rows<{ billed_to: string; usd: string }>(
            `select billed_to::text as billed_to, usd from public.ledger where id = any($1::uuid[]) order by billed_to`,
            [[first.r.ledger_id, founder.r.ledger_id]],
          );
          assertEquals(seen, [{ billed_to: "overhead", usd: "0.0312" }]);
          assertEquals(
            await rows(`select distinct billed_to::text as billed_to from public.ledger order by 1`),
            [{ billed_to: "overhead" }, { billed_to: "studio" }],
          );
        } finally {
          await db.exec(`reset role`);
        }
        const totalsAfter = await anonTotals();
        assertEquals(totalsAfter, { ...totalsBefore, overhead_usd: "0.0312" });

        // Later steps pin the ledger totals, so the rows this step wrote are taken back out.
        await db.query(`delete from public.ledger where not (id = any($1::uuid[]))`, [ledgerBefore.map((l) => l.id)]);
        assertEquals(await pool(), before);
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
        // Filing a card is a board action and is recorded, with a plain note when no reason was given.
        assertEquals(
          await row(`select action, actor_email, reason, details->>'horizon' as horizon from public.board_actions where card_id = $1`, [configCard.id]),
          { action: "file_card", actor_email: BOARD_EMAIL, reason: "No reason given", horizon: "now" },
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
        // A card filed without a horizon is on now; the eleven-argument call still works.
        assertEquals(
          await row(`select horizon::text as horizon, rank from public.cards where id = $1`, [configCard.id]),
          { horizon: "now", rank: null },
        );
        // The platform code lane is closed on now, whichever way the horizon arrives.
        for (const horizon of ["", ", 'now'"]) {
          await refuses(
            `select public.file_card('platform', 'code', 'platform', 'A platform code card', 'Summary.', null, 'No check line is needed on the code lane.', 25, 'voted', $1, ' Board reason '${horizon})`,
            "The platform code lane is closed until the board has its own site",
            [roleId],
          );
        }
        const codeCard = await row<{ id: string }>(
          `select public.file_card('platform', 'code', 'platform', 'A platform code card', 'Summary.', null, 'No check line is needed on the code lane.', 25, 'voted', $1, ' Board reason ', 'next') as id`,
          [roleId],
        );
        assertEquals(
          await row(
            `select stage::text as stage, lane::text as lane, folder::text as folder, intent, board_reason, funding_target_usd, estimate_usd, horizon::text as horizon from public.cards where id = $1`,
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
            horizon: "next",
          },
        );
        // The target is no longer capped by the per-card maximum, which stays the
        // spend ceiling; $10,000 guards against a mistyped amount.
        const above = await row<{ id: string }>(
          `select public.file_card(p_bucket => 'game', p_lane => 'config', p_folder => 'seed-1', p_title => 'A target above the per-card maximum', p_summary => 'Summary.', p_intent => 'Intent', p_acceptance_test => 'check: config seed-1/config/spawn-table.json rows[id=cart].baseCost == 120', p_funding_target_usd => 26, p_stage => 'proposed', p_executor_role_id => $1, p_board_reason => null, p_horizon => 'later') as id`,
          [roleId],
        );
        assertEquals(
          await row(`select funding_target_usd, estimate_usd, horizon::text as horizon from public.cards where id = $1`, [above.id]),
          { funding_target_usd: "26.0000", estimate_usd: "26.0000", horizon: "later" },
        );
        // A card a board action names cannot be deleted (20260923000020_append_only.sql); the
        // fixture's own action goes first, with the append-only triggers off in this test.
        await db.query(`delete from public.board_actions where card_id = $1`, [above.id]);
        await db.query(`delete from public.cards where id = $1`, [above.id]);

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
          `select public.file_card('game', 'config', 'seed-1', 'Title', 'Summary.', 'Intent', ${CHECK}, 10000.01, 'proposed', $1, null)`,
          "The funding target must be at most $10,000",
          [roleId],
        );
        await refuses(
          `select public.file_card('game', 'config', 'seed-1', 'Title', 'Summary.', 'Intent', ${CHECK}, 3, 'proposed', $1, null, null)`,
          "A horizon is required",
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
        // Only the twelve-argument signature exists: the ten-argument live-cut one
        // and the eleven-argument summary one are gone, so no named call is ambiguous.
        assertEquals(
          await rows<{ args: string }>(
            `select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'file_card'`,
          ),
          [{
            args:
              "p_bucket card_bucket, p_lane card_lane, p_folder card_folder, p_title text, p_summary text, p_intent text, p_acceptance_test text, p_funding_target_usd numeric, p_stage card_stage, p_executor_role_id uuid, p_board_reason text, p_horizon card_horizon",
          }],
        );
        // The deployed /board sends these eleven named arguments; they reach the new function.
        const named = await row<{ id: string }>(
          `select public.file_card(p_bucket => 'game', p_lane => 'config', p_folder => 'seed-1', p_title => 'Filed by name', p_summary => 'Summary.', p_intent => 'Intent', p_acceptance_test => ${CHECK}, p_funding_target_usd => 3, p_stage => 'proposed', p_executor_role_id => $1, p_board_reason => null) as id`,
          [roleId],
        );
        assertEquals(
          await row(`select horizon::text as horizon from public.cards where id = $1`, [named.id]),
          { horizon: "now" },
        );
        await db.query(`delete from public.board_actions where card_id = $1`, [named.id]);
        await db.query(`delete from public.cards where id = $1`, [named.id]);
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
        assertEquals(Object.keys(s).sort(), BOARD_STATE_KEYS);
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
          `delete from public.board_actions where card_id in ('${directive.id}', '${card.id}');
           delete from public.cards where id in ('${directive.id}', '${card.id}'); delete from public.board_notes where id = '${note.id}';`,
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
        assertEquals(Object.keys(s).sort(), BOARD_STATE_KEYS);
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
      "every board RPC added for launch refuses a moderator at aal1 and aal2, an outsider, a board session without the second factor, and anon",
      async () => {
        const CHECK = "check: config seed-1/config/spawn-table.json rows[id=cart].baseCost == 120";
        const calls: [string, string, unknown[]][] = [
          ["set_caps", `select public.set_caps(p_daily_cap_usd => 100, p_reason => 'Caps')`, []],
          ["record_credit_purchase", `select public.record_credit_purchase(10, null, 'Credit')`, []],
          ["set_card_horizon", `select public.set_card_horizon($1, 'later', 1, 'Park')`, [oneoffCardId]],
          ["cancel_card", `select public.cancel_card($1, 'Cancel')`, [oneoffCardId]],
          ["resume_card", `select public.resume_card($1, 1, 'Resume')`, [oneoffCardId]],
          [
            "file_card",
            `select public.file_card('game', 'config', 'seed-1', 'Refused card', 'Summary.', 'Intent', $2, 2, 'proposed', $1, null, 'now')`,
            [roleId, CHECK],
          ],
        ];
        const state = async () =>
          await row(
            `select (select count(*)::int from public.board_actions) as actions, (select count(*)::int from public.credit_purchases) as purchases, (select count(*)::int from public.cards) as cards, (select to_jsonb(s) - 'dispatcher_seen_at' from public.studio_state s where id = 1) as studio, (select jsonb_agg(to_jsonb(c) order by id) from public.cards c) as all_cards`,
          );
        const before = await state();
        const sessions: [string, "aal1" | "aal2" | null, string][] = [
          [MODERATOR_EMAIL, "aal1", "Board membership is required"],
          [MODERATOR_EMAIL, "aal2", "Board membership is required"],
          [OUTSIDER_EMAIL, "aal2", "Board membership is required"],
          [BOARD_EMAIL, "aal1", "A second factor is required"],
          [BOARD_EMAIL, null, "A second factor is required"],
        ];
        for (const [email, aal, message] of sessions) {
          await signInAs(email, aal);
          for (const [name, sql, params] of calls) {
            await assertRejects(() => db.query(sql, params), Error, message, `${name} as ${email} at ${aal}`);
          }
        }
        await signInAs(null);
        for (const role of ["anon", "authenticated"]) {
          await db.exec(`set role ${role}`);
          try {
            for (const [name, sql, params] of calls) {
              if (role === "authenticated") continue;
              await assertRejects(() => db.query(sql, params), Error, "permission denied", `${name} as ${role}`);
            }
            for (const table of ["board_actions", "credit_purchases"]) {
              await refuses(`select * from public.${table}`, "permission denied");
              await refuses(`insert into public.${table} (reason) values ('x')`, "permission denied");
            }
          } finally {
            await db.exec(`reset role`);
          }
        }
        assertEquals(await state(), before);
      },
    );

    await t.step(
      "set_caps changes only the caps it names, within their bounds, and records the board's reason",
      async () => {
        await signInAs(BOARD_EMAIL, "aal2");
        const caps = async () =>
          await row(
            `select daily_cap_usd, card_max_usd, agent_hourly_rate_usd, monthly_cap_usd, credit_studio_daily_cap_usd from public.studio_state where id = 1`,
          );
        const actions = async () => (await row<{ n: number }>(`select count(*)::int as n from public.board_actions`)).n;
        const start = await caps();
        const r = (await row<{ r: Row }>(
          `select public.set_caps(p_daily_cap_usd => 100, p_card_max_usd => 25, p_agent_hourly_rate_usd => 5, p_reason => '  Launch caps ', p_monthly_cap_usd => 500) as r`,
        )).r;
        assertEquals(r, {
          daily_cap_usd: 100,
          card_max_usd: 25,
          agent_hourly_rate_usd: 5,
          monthly_cap_usd: 500,
          credit_studio_daily_cap_usd: 10000,
          anthropic_tier_cap_usd: null,
        });
        const action = await row(
          `select action, card_id, actor_email, reason, details from public.board_actions order by created_at desc, id limit 1`,
        );
        assertEquals(action, {
          action: "set_caps",
          card_id: null,
          actor_email: BOARD_EMAIL,
          reason: "Launch caps",
          details: {
            before: {
              daily_cap_usd: Number(start.daily_cap_usd),
              card_max_usd: Number(start.card_max_usd),
              agent_hourly_rate_usd: Number(start.agent_hourly_rate_usd),
              monthly_cap_usd: Number(start.monthly_cap_usd),
              credit_studio_daily_cap_usd: Number(start.credit_studio_daily_cap_usd),
              anthropic_tier_cap_usd: null,
            },
            after: r,
          },
        });

        // A null cap is left alone.
        await row(`select public.set_caps(p_card_max_usd => 20, p_reason => 'A lower ceiling') as r`);
        assertEquals(await caps(), {
          daily_cap_usd: "100.0000",
          card_max_usd: "20.0000",
          agent_hourly_rate_usd: "5.0000",
          monthly_cap_usd: "500.0000",
          credit_studio_daily_cap_usd: "10000.0000",
        });

        const settled = await caps();
        const count = await actions();
        const refusals: [string, string][] = [
          [`select public.set_caps(p_daily_cap_usd => 90)`, "A reason is required"],
          [`select public.set_caps(p_daily_cap_usd => 90, p_reason => '  ')`, "A reason is required"],
          [`select public.set_caps(p_reason => 'Nothing')`, "Name at least one cap to change"],
          [`select public.set_caps(p_daily_cap_usd => -1, p_reason => 'x')`, "A cap must be zero or more"],
          [`select public.set_caps(p_credit_studio_daily_cap_usd => -1, p_reason => 'x')`, "A cap must be zero or more"],
          [`select public.set_caps(p_agent_hourly_rate_usd => 0, p_reason => 'x')`, "The hourly rate must be above zero"],
          [`select public.set_caps(p_monthly_cap_usd => 10000.01, p_reason => 'x')`, "A cap must be at most $10,000"],
          [`select public.set_caps(p_card_max_usd => 150, p_reason => 'x')`, "The per-card maximum must not exceed the daily cap"],
          [`select public.set_caps(p_daily_cap_usd => 600, p_reason => 'x')`, "The daily cap must not exceed the monthly cap"],
          [`select public.set_caps(p_daily_cap_usd => 10, p_reason => 'x')`, "The per-card maximum must not exceed the daily cap"],
        ];
        for (const [sql, message] of refusals) {
          await refuses(sql, message);
        }
        assertEquals(await caps(), settled);
        assertEquals(await actions(), count);

        const { s } = await row<{ s: Row }>(`select public.board_studio_state() as s`);
        assertEquals(
          [s.daily_cap_usd, s.card_max_usd, s.agent_hourly_rate_usd, s.monthly_cap_usd, s.credit_daily_cap_usd, s.credit_studio_daily_cap_usd],
          [100, 20, 5, 500, 50, 10000],
        );
      },
    );

    await t.step(
      "record_credit_purchase records Console credit the board bought, and /board reads credit bought and spent",
      async () => {
        await signInAs(BOARD_EMAIL, "aal2");
        const { id } = await row<{ id: string }>(
          `select public.record_credit_purchase(40, '  po_launch_1 ', ' Credit for the first payout ') as id`,
        );
        assertEquals(
          await row(`select amount_usd, stripe_payout_id, reason, created_by from public.credit_purchases where id = $1`, [id]),
          { amount_usd: "40.0000", stripe_payout_id: "po_launch_1", reason: "Credit for the first payout", created_by: BOARD_EMAIL },
        );
        assertEquals(
          await row(`select action, reason, details from public.board_actions where details->>'credit_purchase_id' = $1`, [id]),
          {
            action: "record_credit_purchase",
            reason: "Credit for the first payout",
            details: { credit_purchase_id: id, amount_usd: 40, stripe_payout_id: "po_launch_1" },
          },
        );
        const topUp = await row<{ id: string }>(
          `select public.record_credit_purchase(p_amount_usd => 5.5, p_reason => 'Top up') as id`,
        );
        assertEquals(
          await row(`select stripe_payout_id from public.credit_purchases where id = $1`, [topUp.id]),
          { stripe_payout_id: null },
        );
        for (const [sql, message] of [
          [`select public.record_credit_purchase(0, null, 'x')`, "The amount must be above zero"],
          [`select public.record_credit_purchase(null, null, 'x')`, "The amount must be above zero"],
          [`select public.record_credit_purchase(10000.01, null, 'x')`, "The amount must be at most $10,000"],
          [`select public.record_credit_purchase(10, 'po_x')`, "A reason is required"],
        ] as const) {
          await refuses(sql, message);
        }
        const spent = await row<{ usd: string }>(
          `select coalesce(sum(usd), 0)::text as usd from public.ledger where billed_to in ('studio', 'overhead')`,
        );
        const { s } = await row<{ s: Row }>(`select public.board_studio_state() as s`);
        assertEquals(s.credit_bought_usd, 45.5);
        assertEquals(s.credit_spent_usd, Number(spent.usd));
        // A moderator reads the same state.
        await signInAs(MODERATOR_EMAIL, "aal1");
        assertEquals((await row<{ s: Row }>(`select public.board_studio_state() as s`)).s.credit_bought_usd, 45.5);
        await signInAs(BOARD_EMAIL, "aal2");
      },
    );

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

        // agent-system-core.md: the card-less row an earlier step wrote is the founder's now, since a
        // studio row names a card.
        const totals = await row(`select * from public.public_ledger_totals`);
        assertEquals(totals, {
          usd_total: "0.2234",
          input_tokens: 1020,
          cached_tokens: 200,
          output_tokens: 320,
          row_count: 3,
          overhead_usd: "0.0000",
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
      "anon holds select on three public tables, the eight views and the public columns of cards, and nothing else",
      async () => {
        const expected = [
          "deploys",
          "last_green",
          "ledger",
          "pool",
          "public_agent_events",
          "public_card_funding",
          "public_card_spend",
          "public_ledger_totals",
          "public_money",
          "public_roles",
          "public_stopped_cards",
          "public_studio",
          "public_terms_versions",
        ].map((table_name) => ({ table_name, privilege_type: "SELECT" }));
        for (const grantee of ["anon", "authenticated"]) {
          const grants = await rows<
            { table_name: string; privilege_type: string }
          >(
            `select table_name, privilege_type from information_schema.role_table_grants where grantee = $1 and table_schema = 'public' order by 1, 2`,
            [grantee],
          );
          assertEquals(grants, expected, grantee);
          // cards is granted column by column. actual_usd counts founder-billed
          // turns, and severity and priority mark incidents, which stay private
          // until post-mortem.
          const columns = await rows<{ column_name: string }>(
            `select column_name from information_schema.column_privileges where grantee = $1 and table_schema = 'public' and table_name = 'cards' and privilege_type = 'SELECT' order by 1`,
            [grantee],
          );
          assertEquals(columns.map((c) => c.column_name), PUBLIC_CARD_COLUMNS, grantee);
          const other = await rows(
            `select column_name, privilege_type from information_schema.column_privileges where grantee = $1 and table_schema = 'public' and table_name = 'cards' and privilege_type <> 'SELECT'`,
            [grantee],
          );
          assertEquals(other, [], grantee);
          // No table-level privilege is left, MAINTAIN included (Postgres 17).
          for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]) {
            assertEquals(
              (await row<{ has: boolean }>(
                `select has_table_privilege($1, 'public.cards', $2) as has`,
                [grantee, privilege],
              )).has,
              false,
              `${grantee} ${privilege} on cards`,
            );
          }
          // The withheld columns are exactly the table's columns that are not granted,
          // read from the live table rather than a list kept in the test.
          const withheld = await rows<{ column_name: string }>(
            `select c.column_name from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = 'cards'
               and not has_column_privilege($1, 'public.cards', c.column_name, 'SELECT')
             order by 1`,
            [grantee],
          );
          assertEquals(withheld.map((c) => c.column_name), ["actual_usd", "priority", "severity"], grantee);
        }
        const acl = await row<{ acl: string }>(
          `select relacl::text as acl from pg_class where oid = 'public.cards'::regclass`,
        );
        assert(!/(^|[{,])(anon|authenticated)=/.test(acl.acl), `no table-level entry for anon or authenticated: ${acl.acl}`);
        // Superseded (money-logic.md, "no view reads cards"): public_stopped_cards
        // is the one public view that reads cards, and every cards column it reads is
        // one anon already selects, so no view can hand a withheld column to anon.
        // dispatcher_cards (agent-system-core.md) reads every column for the service
        // role alone; anon and authenticated hold nothing on it.
        assertEquals(
          await rows(
            `select view_name from information_schema.view_table_usage where table_schema = 'public' and table_name = 'cards' order by 1`,
          ),
          [{ view_name: "dispatcher_cards" }, { view_name: "public_stopped_cards" }],
        );
        for (const grantee of ["anon", "authenticated"]) {
          assertEquals((await row<{ has: boolean }>(`select has_table_privilege($1, 'public.dispatcher_cards', 'SELECT') as has`, [grantee])).has, false, grantee);
        }
        const read = await rows<{ column_name: string }>(
          `select distinct column_name from information_schema.view_column_usage where view_name = 'public_stopped_cards' and table_name = 'cards' order by 1`,
        );
        assert(read.length > 0, "public_stopped_cards reads cards columns");
        for (const { column_name } of read) assert(PUBLIC_CARD_COLUMNS.includes(column_name), `public_stopped_cards reads ${column_name}`);
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
          assertEquals(totals.row_count, 3);
          const green = await rows(`select * from public.last_green`);
          assertEquals(green.length, 2);
          const cards = await rows(`select id from public.cards`);
          assertEquals(cards.length, total.n);
          const shipped = await rows(
            `select id, title, live_at from public.cards order by created_at limit 1`,
          );
          assertEquals(Object.keys(shipped[0]!), ["id", "title", "live_at"]);
          for (const column of ["actual_usd", "severity", "priority", "*"]) {
            await refuses(
              `select ${column} from public.cards`,
              "permission denied",
            );
          }
          const summaries = await rows<{ summary: string | null }>(
            `select summary from public.cards where summary is not null order by summary`,
          );
          assert(
            summaries.some((c) => c.summary === "Rename the first unit to Sweeper."),
            "anon reads cards.summary",
          );

          const studio = await rows(`select * from public.public_studio`);
          assertEquals(studio.length, 1);
          assertEquals(Object.keys(studio[0]!), ["launched_at", "paused", "platform_lane_open", "pause_reason"]);
          assertEquals(studio[0]!.pause_reason, null);
          assertEquals(studio[0]!.platform_lane_open, false);
          assertEquals(studio[0]!.paused, false);
          assertNotEquals(studio[0]!.launched_at, null);

          const funding = await rows<{
            card_id: string;
            contributors: number;
            credited_usd: string;
            on_card_usd: string;
          }>(`select * from public.public_card_funding`);
          // Five goal cards took money: the 100-target card, the voted card (up to
          // its 1 target; its second payment arrived once it was full and went on
          // down the waterfall), the proposed card, the funded card below its target
          // and the designing card (money-logic.md).
          assertEquals(funding.length, 5);
          assertEquals(Object.keys(funding[0]!).sort(), [
            "card_id",
            "contributors",
            "credited_usd",
            "on_card_usd",
          ]);
          const byCard = new Map(funding.map((f) => [f.card_id, f]));
          assertEquals(byCard.get(goalCardId), {
            card_id: goalCardId,
            contributors: 1,
            credited_usd: "1.4107",
            on_card_usd: "1.4107",
          });
          assertEquals(byCard.get(votedGoalId), {
            card_id: votedGoalId,
            contributors: 1,
            credited_usd: "1.0000",
            on_card_usd: "1.0000",
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
      "anon and authenticated read public_roles, the pause and every card's horizon and rank, and not roles, the lease or the patches",
      async () => {
        await db.query(
          `update public.roles set description = 'Builds funded game cards as small, tested changes to Dust.' where id = $1`,
          [roleId],
        );
        for (const role of ["anon", "authenticated"]) {
          await db.exec(`set role ${role}`);
          try {
            const roles = await rows(`select * from public.public_roles`);
            assertEquals(roles.length, 1, role);
            assertEquals(Object.keys(roles[0]!), [
              "id",
              "name",
              "title",
              "description",
              "species_note",
              "avatar_url",
              "model",
              "write_access",
              "state",
              "hired_at",
              "status",
              "trigger",
              "agent_class",
              "paused",
              "paused_reason",
            ]);
            assertEquals(roles[0]!.description, "Builds funded game cards as small, tested changes to Dust.");
            for (const table of ["roles", "dispatcher_lease", "card_patches", "board_actions", "credit_purchases"]) {
              await refuses(`select * from public.${table}`, "permission denied");
            }
            // public_roles is a simple view over one table, and no write goes through it.
            await refuses(`update public.public_roles set model = 'other-model-id'`, "permission denied");
            await refuses(`update public.public_studio set paused = true`, "permission denied");
            assertEquals(await row(`select paused from public.public_studio`), { paused: false });
            await refuses(`select paused_by from public.public_studio`, "does not exist");
            await refuses(`select paused_at from public.public_studio`, "does not exist");
            const planned = await rows<{ horizon: string; rank: number | null }>(
              `select horizon::text as horizon, rank from public.cards where horizon <> 'now'`,
            );
            assert(planned.some((c) => c.horizon === "next"), `${role} reads a next card's horizon`);
          } finally {
            await db.exec(`reset role`);
          }
        }
        // The description is one plain line of at most 200 characters.
        await refuses(`update public.roles set description = 'one' || chr(10) || 'two' where id = $1`, "roles_description_check", [roleId]);
        await refuses(`update public.roles set description = repeat('a', 201) where id = $1`, "roles_description_check", [roleId]);
        await refuses(`update public.roles set description = '  ' where id = $1`, "roles_description_check", [roleId]);
      },
    );

    await t.step(
      "public_card_funding counts a contributor who funds one card twice once",
      async () => {
        await quietCards();
        const card = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage, executor_role_id) values ('game', 'board', 'goal', 'config', 'seed-1', 'A goal card funded twice by one contributor', 100, 'proposed', '${roleId}') returning id`,
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
            on_card_usd: string;
          }>(`select * from public.public_card_funding where card_id = $1`, [
            card.id,
          ]);
          assertEquals(funding, [
            { card_id: card.id, contributors: 1, credited_usd: credited, on_card_usd: credited },
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
      },
    );

    await t.step(
      "a $120 payment credits $50 today, holds the rest, and the release credits it once after 14 days",
      async () => {
        await quietCards();
        // The incident reserve at its cap keeps the agents share whole as pool credit.
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        const offsets = await identityOffsets();
        const card = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage, executor_role_id) values ('game', 'board', 'goal', 'config', 'seed-1', 'A goal card funded past the daily hold', 100, 'proposed', '${roleId}') returning id`,
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
        // Superseded (money-logic.md, uncapped bars): the release enters the
        // waterfall at step 1, so the card takes 50 up to its 100 target and the
        // other 17 goes on to Not on a card yet.
        const funded = await row(
          `select stage::text as stage, funded_usd from public.cards where id = $1`,
          [card.id],
        );
        assertEquals(funded, { stage: "funded", funded_usd: "100.0000" });
        assertEquals(
          await rows(
            `select a.destination::text as destination, a.amount_usd, a.step from public.contribution_allocations a join public.contributions r on r.id = a.entry_id where r.entry = 'release' and a.payment_id in (select id from public.contributions where stripe_event_id in ('evt_hold1', 'evt_hold2')) order by a.seq`,
          ),
          [
            { destination: "card", amount_usd: "50.0000", step: 1 },
            { destination: "unassigned", amount_usd: "8.0000", step: 3 },
            { destination: "unassigned", amount_usd: "9.0000", step: 3 },
          ],
        );
        await refuses(
          `insert into public.contributions (entry, parent_id, rail, contributor_id) select 'release', id, 'stripe', 'x' from public.contributions where stripe_event_id = 'evt_hold1'`,
          "contributions_one_release",
        );
        assertEquals(await identityOffsets(), offsets);
      },
    );

    await t.step(
      "a refund cancels the hold first, follows Stripe's cumulative total and a replay changes nothing",
      async () => {
        await quietCards();
        // The incident reserve at its cap keeps the agents share whole as pool credit.
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        const offsets = await identityOffsets();
        const card = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage, executor_role_id) values ('game', 'board', 'goal', 'config', 'seed-1', 'A goal card whose funding is refunded', 50, 'proposed', '${roleId}') returning id`,
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
        await quietCards();
        // The incident reserve at its cap keeps the agents share whole as pool credit.
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        const offsets = await identityOffsets();
        const card = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage, executor_role_id) values ('game', 'board', 'goal', 'config', 'seed-1', 'A goal card with a disputed payment', 30, 'proposed', '${roleId}') returning id`,
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

    await t.step(
      "below the incident cap at a 20% studio share, a refund and a dispute keep the payment's proportions",
      async () => {
        await quietCards();
        await db.exec(
          `update public.pool set incident_reserve_usd = 0, reserve_usd = 100 where id = 1`,
        );
        const offsets = await identityOffsets();
        const card = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage, executor_role_id) values ('game', 'board', 'goal', 'config', 'seed-1', 'A goal card funded below the incident cap', 100, 'proposed', '${roleId}') returning id`,
        );
        const pay = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_w', 'contrib_w', null, 40.00, 40.00, 20, $1, 'cs_w') as r`,
          [card.id],
        )).r;
        // net 40: reserve 4, remainder 36, studio 7.2, agents 28.8, incident 5% = 1.44, credit 27.36.
        assertEquals(pay.reserve_usd, 4);
        assertEquals(pay.studio_usd, 7.2);
        assertEquals(pay.agents_usd, 28.8);
        assertEquals(pay.incident_usd, 1.44);
        assertEquals(pay.pool_credit_usd, 27.36);
        assertEquals(pay.held_usd, 0);
        assertEquals(pay.goal_funded_usd, 27.36);
        const before = await pool();

        const refund = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_wr', 'cs_w', 'refund', 10) as r`,
        )).r;
        assertEquals(refund.reversed_usd, 10);
        assertEquals(refund.held_cancelled_usd, 0);
        assertEquals(refund.reserve_cover_usd, 0);
        assertEquals(refund.goal_funded_usd, 20.52);
        assertEquals(refund.pool_reserve_usd, 103);
        assertEquals(refund.pool_incident_reserve_usd, 1.08);
        assertEquals(
          await row(
            `select entry::text as entry, amount_usd, net_usd, reserve_usd, agents_usd, studio_usd, incident_usd, held_usd from public.contributions where stripe_event_id = 'evt_wr'`,
          ),
          {
            entry: "refund",
            amount_usd: "-10.0000",
            net_usd: "-10.0000",
            reserve_usd: "-1.0000",
            agents_usd: "-7.2000",
            studio_usd: "-1.8000",
            incident_usd: "-0.3600",
            held_usd: "0.0000",
          },
        );
        const afterRefund = await pool();
        // The balance and the bar fall by the agents' credit share: 7.2 - 0.36 = 6.84.
        assertEquals(
          (Number(afterRefund.balance_usd) - Number(before.balance_usd)).toFixed(4),
          "-6.8400",
        );
        assertEquals(
          (Number(afterRefund.incident_reserve_usd) - Number(before.incident_reserve_usd)).toFixed(4),
          "-0.3600",
        );
        assertEquals(
          (Number(afterRefund.reserve_usd) - Number(before.reserve_usd)).toFixed(4),
          "-1.0000",
        );
        assertEquals(refund.pool_balance_usd, Number(afterRefund.balance_usd));
        assertEquals(await identityOffsets(), offsets);

        // A dispute for the whole 40 reverses the 30 still due. The reserve covers
        // the agents share of it in full, so the balance, the incident reserve and
        // the bar do not move.
        const dispute = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_wd', 'cs_w', 'dispute', 40) as r`,
        )).r;
        assertEquals(dispute.reversed_usd, 30);
        assertEquals(dispute.fully_reversed, true);
        assertEquals(dispute.reserve_cover_usd, 21.6);
        assertEquals(dispute.goal_funded_usd, 20.52);
        assertEquals(dispute.pool_reserve_usd, 78.4);
        assertEquals(dispute.pool_incident_reserve_usd, 1.08);
        assertEquals(
          await row(
            `select entry::text as entry, amount_usd, net_usd, reserve_usd, agents_usd, studio_usd, incident_usd, held_usd from public.contributions where stripe_event_id = 'evt_wd'`,
          ),
          {
            entry: "dispute",
            amount_usd: "-30.0000",
            net_usd: "-30.0000",
            reserve_usd: "-24.6000",
            agents_usd: "0.0000",
            studio_usd: "-5.4000",
            incident_usd: "0.0000",
            held_usd: "0.0000",
          },
        );
        const afterDispute = await pool();
        assertEquals(afterDispute.balance_usd, afterRefund.balance_usd);
        assertEquals(afterDispute.incident_reserve_usd, afterRefund.incident_reserve_usd);
        assertEquals(
          (Number(afterDispute.reserve_usd) - Number(afterRefund.reserve_usd)).toFixed(4),
          "-24.6000",
        );
        // The payment is gone from amount, net and studio; the reserve's cover
        // moved 21.6 from agents to reserve, and the incident share it covered stays.
        assertEquals(await familySums("evt_w"), {
          amount: "0.0000",
          net: "0.0000",
          reserve: "-21.6000",
          agents: "21.6000",
          studio: "0.0000",
          incident: "1.0800",
          held: "0.0000",
        });
        assertEquals(await identityOffsets(), offsets);
      },
    );

    await t.step(
      "a refund before and after the hold's release returns every column to zero",
      async () => {
        await quietCards();
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        const offsets = await identityOffsets();
        const card = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage, executor_role_id) values ('game', 'board', 'goal', 'config', 'seed-1', 'A goal card refunded around a release', 200, 'proposed', '${roleId}') returning id`,
        );
        const before = await pool();
        const pay = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_rh', 'contrib_rh', null, 100.00, 100.00, 0, $1, 'cs_rh') as r`,
          [card.id],
        )).r;
        assertEquals(pay.pool_credit_usd, 50);
        assertEquals(pay.held_usd, 40);

        // A 20 refund cancels 18 of the held 40.
        const first = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_rh1', 'cs_rh', 'refund', 20) as r`,
        )).r;
        assertEquals(first.held_cancelled_usd, 18);
        assertEquals(first.goal_funded_usd, 50);

        // The release moves the 22 still held to the balance and the bar.
        await db.exec(
          `update public.contributions set hold_until = now() - interval '1 minute' where stripe_event_id = 'evt_rh'`,
        );
        const released = (await row<{ r: Row }>(
          `select public.credit_held_contributions() as r`,
        )).r;
        assertEquals(released, { released: 1, released_usd: 22 });
        assertEquals(
          await row(`select funded_usd from public.cards where id = $1`, [card.id]),
          { funded_usd: "72.0000" },
        );

        // Nothing is held any more, so both refunds come off the balance and the bar.
        const partial = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_rh2', 'cs_rh', 'refund', 60) as r`,
        )).r;
        assertEquals(partial.reversed_usd, 40);
        assertEquals(partial.held_cancelled_usd, 0);
        assertEquals(partial.goal_funded_usd, 36);
        const full = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_rh3', 'cs_rh', 'refund', 100) as r`,
        )).r;
        assertEquals(full.reversed_usd, 40);
        assertEquals(full.fully_reversed, true);
        assertEquals(full.goal_funded_usd, 0);

        assertEquals(await familySums("evt_rh"), {
          amount: "0.0000",
          net: "0.0000",
          reserve: "0.0000",
          agents: "0.0000",
          studio: "0.0000",
          incident: "0.0000",
          held: "0.0000",
        });
        const after = await pool();
        for (const key of ["balance_usd", "reserve_usd", "incident_reserve_usd", "held_usd"] as const) {
          assertEquals(after[key], before[key], key);
        }
        assertEquals(await identityOffsets(), offsets);
      },
    );

    await t.step(
      "a dispute on a payment with money still held cancels the hold and covers only the credited part",
      async () => {
        await quietCards();
        await db.exec(
          `update public.pool set incident_reserve_usd = 500, reserve_usd = 1000 where id = 1`,
        );
        const offsets = await identityOffsets();
        const card = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage, executor_role_id) values ('game', 'board', 'goal', 'config', 'seed-1', 'A goal card with a disputed hold', 200, 'proposed', '${roleId}') returning id`,
        );
        const pay = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_dh', 'contrib_dh', null, 100.00, 100.00, 0, $1, 'cs_dh') as r`,
          [card.id],
        )).r;
        assertEquals(pay.pool_credit_usd, 50);
        assertEquals(pay.held_usd, 40);
        const before = await pool();

        const dispute = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_dhd', 'cs_dh', 'dispute', 100) as r`,
        )).r;
        // Agents 90: the held 40 is cancelled, and the reserve covers the credited 50.
        assertEquals(dispute.held_cancelled_usd, 40);
        assertEquals(dispute.reserve_cover_usd, 50);
        assertEquals(dispute.goal_funded_usd, 50);
        assertEquals(dispute.pool_reserve_usd, 950);
        assertEquals(
          await row(
            `select amount_usd, reserve_usd, agents_usd, incident_usd, held_usd from public.contributions where stripe_event_id = 'evt_dhd'`,
          ),
          {
            amount_usd: "-100.0000",
            reserve_usd: "-60.0000",
            agents_usd: "-40.0000",
            incident_usd: "0.0000",
            held_usd: "-40.0000",
          },
        );
        const after = await pool();
        assertEquals(after.balance_usd, before.balance_usd);
        assertEquals(
          (Number(after.held_usd) - Number(before.held_usd)).toFixed(4),
          "-40.0000",
        );
        assertEquals(
          (Number(after.reserve_usd) - Number(before.reserve_usd)).toFixed(4),
          "-60.0000",
        );

        // The cancelled hold releases nothing.
        await db.exec(
          `update public.contributions set hold_until = now() - interval '1 minute' where stripe_event_id = 'evt_dh'`,
        );
        const released = (await row<{ r: Row }>(
          `select public.credit_held_contributions() as r`,
        )).r;
        assertEquals(released, { released: 0, released_usd: 0 });
        assertEquals(await pool(), after);
        assertEquals(await identityOffsets(), offsets);
      },
    );

    await t.step(
      "reverse_contribution reports the kind's earlier reversals and the total asked, so nothing left to reverse can be told apart",
      async () => {
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        const offsets = await identityOffsets();
        await row(
          `select public.apply_contribution('evt_kt', 'contrib_kt', null, 20.00, 20.00, 0, null, 'cs_kt') as r`,
        );
        const first = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_ktd1', 'cs_kt', 'dispute', 20) as r`,
        )).r;
        assertEquals(first.inserted, true);
        assertEquals(first.kind_reversed_usd, 0);
        assertEquals(first.kind_total_usd, 20);
        // The other event for the same dispute, with the same total: this kind already reversed it.
        const second = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_ktd2', 'cs_kt', 'dispute', 20) as r`,
        )).r;
        assertEquals(second.inserted, false);
        assertEquals(second.replay, false);
        assertEquals(second.reversed_usd, 0);
        assertEquals(second.kind_reversed_usd, 20);
        assertEquals(second.kind_total_usd, 20);
        assert(
          (second.kind_reversed_usd as number) >= (second.kind_total_usd as number),
          "the dispute kind already covers the total",
        );

        await row(
          `select public.apply_contribution('evt_kt2', 'contrib_kt2', null, 10.00, 10.00, 0, null, 'cs_kt2') as r`,
        );
        const partial = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_ktr1', 'cs_kt2', 'refund', 4) as r`,
        )).r;
        assertEquals(partial.kind_reversed_usd, 0);
        assertEquals(partial.kind_total_usd, 4);
        const refund = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_ktr2', 'cs_kt2', 'refund', 10) as r`,
        )).r;
        assertEquals(refund.inserted, true);
        assertEquals(refund.kind_reversed_usd, 4);
        assertEquals(refund.kind_total_usd, 10);
        assertEquals(refund.fully_reversed, true);
        // A dispute after the full refund: a refund took it, and the dispute kind reversed nothing.
        const dispute = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_ktd3', 'cs_kt2', 'dispute', 10) as r`,
        )).r;
        assertEquals(dispute.inserted, false);
        assertEquals(dispute.replay, false);
        assertEquals(dispute.reversed_usd, 0);
        assertEquals(dispute.reversed_total_usd, 10);
        assertEquals(dispute.fully_reversed, true);
        assertEquals(dispute.kind_reversed_usd, 0);
        assertEquals(dispute.kind_total_usd, 10);
        assertEquals(await identityOffsets(), offsets);
      },
    );

    await t.step(
      "a refund of a payment that went to the pool because its card was closed leaves the card alone",
      async () => {
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        const offsets = await identityOffsets();
        const card = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, funded_usd, estimate_usd, stage) values ('game', 'board', 'goal', 'config', 'seed-1', 'A funded goal named by a late payment', 5, 5, 5, 'funded') returning id`,
        );
        const pay = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_cl', 'contrib_cl', null, 10.00, 10.00, 0, $1, 'cs_cl') as r`,
          [card.id],
        )).r;
        assertEquals(pay.goal_card_id, null);
        assertEquals(pay.pool_credit_usd, 9);
        const before = await pool();
        const refund = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_clr', 'cs_cl', 'refund', 10) as r`,
        )).r;
        assertEquals(refund.inserted, true);
        assertEquals(refund.goal_card_id, null);
        assertEquals(refund.goal_funded_usd, null);
        assertEquals(
          await row(`select goal_card_id from public.contributions where stripe_event_id = 'evt_clr'`),
          { goal_card_id: null },
        );
        assertEquals(
          await row(`select funded_usd, stage::text as stage from public.cards where id = $1`, [card.id]),
          { funded_usd: "5.0000", stage: "funded" },
        );
        assertEquals(
          (Number((await pool()).balance_usd) - Number(before.balance_usd)).toFixed(4),
          "-9.0000",
        );
        assertEquals(await identityOffsets(), offsets);
      },
    );

    await t.step(
      "a dispute on held money with a short reserve cancels the hold, covers what the reserve holds and takes the rest off the pool and the bar",
      async () => {
        await quietCards();
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        const card = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage, executor_role_id) values ('game', 'board', 'goal', 'config', 'seed-1', 'A goal card with a disputed hold and a short reserve', 200, 'proposed', '${roleId}') returning id`,
        );
        const pay = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_ds', 'contrib_ds', null, 100.00, 100.00, 0, $1, 'cs_ds') as r`,
          [card.id],
        )).r;
        assertEquals(pay.pool_credit_usd, 50);
        assertEquals(pay.held_usd, 40);
        // 30 in the reserve: 10 goes back with the payment's own share, 20 covers.
        await db.exec(`update public.pool set reserve_usd = 30 where id = 1`);
        const offsets = await identityOffsets();
        const before = await pool();
        const dispute = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_dsd', 'cs_ds', 'dispute', 100) as r`,
        )).r;
        assertEquals(dispute.held_cancelled_usd, 40);
        assertEquals(dispute.reserve_cover_usd, 20);
        assertEquals(dispute.goal_funded_usd, 20);
        assertEquals(dispute.pool_reserve_usd, 0);
        assertEquals(
          await row(
            `select reserve_usd, agents_usd, incident_usd, held_usd from public.contributions where stripe_event_id = 'evt_dsd'`,
          ),
          { reserve_usd: "-30.0000", agents_usd: "-70.0000", incident_usd: "0.0000", held_usd: "-40.0000" },
        );
        const after = await pool();
        assertEquals((Number(after.balance_usd) - Number(before.balance_usd)).toFixed(4), "-30.0000");
        assertEquals((Number(after.held_usd) - Number(before.held_usd)).toFixed(4), "-40.0000");
        assertEquals(after.reserve_usd, "0.0000");
        assertEquals(await identityOffsets(), offsets);
      },
    );

    await t.step(
      "a payment that fills only part of the incident reserve's room reverses that part exactly",
      async () => {
        await db.exec(`update public.pool set incident_reserve_usd = 499.5 where id = 1`);
        const offsets = await identityOffsets();
        const before = await pool();
        const pay = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_ip', 'contrib_ip', null, 20.00, 20.00, 0, null, 'cs_ip') as r`,
        )).r;
        // agents 18: 5% would be 0.9, the room is 0.5, so incident 0.5 and credit 17.5.
        assertEquals(pay.agents_usd, 18);
        assertEquals(pay.incident_usd, 0.5);
        assertEquals(pay.pool_credit_usd, 17.5);
        assertEquals((await pool()).incident_reserve_usd, "500.0000");
        const half = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_ipr1', 'cs_ip', 'refund', 10) as r`,
        )).r;
        assertEquals(half.pool_incident_reserve_usd, 499.75);
        assertEquals(
          await row(`select agents_usd, incident_usd from public.contributions where stripe_event_id = 'evt_ipr1'`),
          { agents_usd: "-9.0000", incident_usd: "-0.2500" },
        );
        const rest = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_ipr2', 'cs_ip', 'refund', 20) as r`,
        )).r;
        assertEquals(rest.fully_reversed, true);
        assertEquals(rest.pool_incident_reserve_usd, 499.5);
        assertEquals(await familySums("evt_ip"), {
          amount: "0.0000",
          net: "0.0000",
          reserve: "0.0000",
          agents: "0.0000",
          studio: "0.0000",
          incident: "0.0000",
          held: "0.0000",
        });
        const after = await pool();
        for (const key of ["balance_usd", "reserve_usd", "incident_reserve_usd", "held_usd"] as const) {
          assertEquals(after[key], before[key], key);
        }
        assertEquals(await identityOffsets(), offsets);
      },
    );

    await t.step(
      "a refund larger than the reserve takes the reserve below zero and reports it",
      async () => {
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        await row(
          `select public.apply_contribution('evt_neg', 'contrib_neg', null, 10.00, 10.00, 0, null, 'cs_neg') as r`,
        );
        // The payment put 1 in the reserve; leave 0.5 of it.
        await db.exec(`update public.pool set reserve_usd = 0.5 where id = 1`);
        const offsets = await identityOffsets();
        const before = await pool();
        const refund = (await row<{ r: Row }>(
          `select public.reverse_contribution('evt_negr', 'cs_neg', 'refund', 10) as r`,
        )).r;
        assertEquals(refund.pool_reserve_usd, -0.5);
        assertEquals(refund.pool_incident_reserve_usd, 500);
        assertEquals(
          refund.pool_balance_usd,
          Number((Number(before.balance_usd) - 9).toFixed(4)),
        );
        assertEquals((await pool()).reserve_usd, "-0.5000");
        assertEquals(await identityOffsets(), offsets);
      },
    );

    await t.step(
      "the daily cap counts payments from New York midnight on, not the second before",
      async () => {
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        const midnight =
          `(date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York')`;

        // Credit 54 against a cap of 50: 50 now and 4 held.
        const early = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_ny1', 'contrib_ny1', null, 60.00, 60.00, 0, null, 'cs_ny1') as r`,
        )).r;
        assertEquals(early.pool_credit_usd, 50);
        assertEquals(early.held_usd, 4);
        await db.exec(
          `update public.contributions set created_at = ${midnight} - interval '1 second' where stripe_event_id = 'evt_ny1'`,
        );
        const nextDay = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_ny2', 'contrib_ny1', null, 20.00, 20.00, 0, null, 'cs_ny2') as r`,
        )).r;
        assertEquals(nextDay.pool_credit_usd, 18);
        assertEquals(nextDay.held_usd, 0);

        const atMidnight = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_ny3', 'contrib_ny3', null, 60.00, 60.00, 0, null, 'cs_ny3') as r`,
        )).r;
        assertEquals(atMidnight.pool_credit_usd, 50);
        await db.exec(
          `update public.contributions set created_at = ${midnight} where stripe_event_id = 'evt_ny3'`,
        );
        const sameDay = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_ny4', 'contrib_ny3', null, 20.00, 20.00, 0, null, 'cs_ny4') as r`,
        )).r;
        assertEquals(sameDay.pool_credit_usd, 0);
        assertEquals(sameDay.held_usd, 18);
      },
    );

    await t.step(
      "the $50 window keys on the card and the email: one card across two emails, or one email across two cards, shares $50",
      async () => {
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        const offsets = await identityOffsets();
        const pay = async (event: string, contributor: string, amount: number, payerKey: string | null) =>
          (await row<{ r: Row }>(
            `select public.apply_contribution($1, $2, null, $3, $3, 0, null, $4, $5) as r`,
            [event, contributor, amount, `cs_${event}`, payerKey],
          )).r;
        const keyOf = async (event: string) =>
          (await row<{ k: string }>(`select payer_key as k from public.contributions where stripe_event_id = $1`, [event])).k;

        // One card, two emails: the second payment finds $36 of the day's $50 used.
        const a = await pay("pk1", "contrib_pk_a", 40, "card:fingerprint-one");
        assertEquals([a.pool_credit_usd, a.held_usd], [36, 0]);
        const b = await pay("pk2", "contrib_pk_b", 40, "card:fingerprint-one");
        assertEquals([b.pool_credit_usd, b.held_usd], [14, 22]);
        assertEquals(await keyOf("pk2"), "card:fingerprint-one");

        // One email, two cards: the same.
        const c = await pay("pk3", "contrib_pk_c", 40, "card:fingerprint-two");
        assertEquals([c.pool_credit_usd, c.held_usd], [36, 0]);
        const d = await pay("pk4", "contrib_pk_c", 40, "card:fingerprint-three");
        assertEquals([d.pool_credit_usd, d.held_usd], [14, 22]);

        // A payment with no card fingerprint (Link, for one) keys on the email and shares its window.
        const e = await pay("pk5", "contrib_pk_c", 10, null);
        assertEquals([e.pool_credit_usd, e.held_usd], [0, 9]);
        assertEquals(await keyOf("pk5"), "email:contrib_pk_c");
        const blank = await pay("pk6", "contrib_pk_e", 10, "  ");
        assertEquals([blank.pool_credit_usd, blank.held_usd], [9, 0]);
        assertEquals(await keyOf("pk6"), "email:contrib_pk_e");

        // The deployed webhook's eight named arguments still credit, keyed on the email.
        const named = (await row<{ r: Row }>(
          `select public.apply_contribution(p_stripe_event_id => 'pk7', p_contributor_id => 'contrib_pk_f', p_display_name => null, p_amount_usd => 10, p_net_usd => 10, p_studio_pct => 0, p_goal_card_id => null, p_stripe_session_id => 'cs_pk7') as r`,
        )).r;
        assertEquals([named.inserted, named.pool_credit_usd], [true, 9]);
        assertEquals(await keyOf("pk7"), "email:contrib_pk_f");

        await refuses(
          `select public.apply_contribution('pk8', 'contrib_pk_g', null, 10, 10, 0, null, 'cs_pk8', 'fingerprint-four')`,
          "p_payer_key must start with card: or email:",
        );
        await refuses(
          `insert into public.contributions (rail, contributor_id, entry) values ('stripe', 'contrib_pk_h', 'payment')`,
          "contributions_payer_key_check",
        );
        // Every payment row carries a key; child rows need none.
        assertEquals(
          await rows(`select id from public.contributions where entry = 'payment' and payer_key is null`),
          [],
        );
        assertEquals(await identityOffsets(), offsets);
      },
    );

    await t.step(
      "the studio-wide room on immediate credit holds what is left once the day's room is used",
      async () => {
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        const offsets = await identityOffsets();
        const used = await row<{ usd: string }>(
          `select coalesce(sum(agents_usd - incident_usd - held_usd), 0)::text as usd from public.contributions
           where entry = 'payment' and created_at >= (date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York')`,
        );
        await db.query(`update public.studio_state set credit_studio_daily_cap_usd = $1::numeric + 30 where id = 1`, [used.usd]);
        const first = (await row<{ r: Row }>(
          `select public.apply_contribution('sc1', 'contrib_sc_a', null, 60, 60, 0, null, 'cs_sc1', 'card:studio-room-a') as r`,
        )).r;
        // $54 of credit: the payer has $50 of room and the studio $30, so $30 now and $24 held.
        assertEquals([first.pool_credit_usd, first.held_usd], [30, 24]);
        const second = (await row<{ r: Row }>(
          `select public.apply_contribution('sc2', 'contrib_sc_b', null, 5, 5, 0, null, 'cs_sc2', 'card:studio-room-b') as r`,
        )).r;
        assertEquals([second.pool_credit_usd, second.held_usd], [0, 4.5]);
        await db.exec(`update public.studio_state set credit_studio_daily_cap_usd = 10000 where id = 1`);
        assertEquals(await identityOffsets(), offsets);
      },
    );

    await t.step(
      "a card off now takes no credit, and a card moves to now only when it meets the definition of ready",
      async () => {
        await quietCards();
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        await signInAs(BOARD_EMAIL, "aal2");
        const offsets = await identityOffsets();
        const CHECK = "check: config seed-1/config/spawn-table.json rows[id=cart].baseCost == 120";
        const card = async (id: string) =>
          await row(
            `select stage::text as stage, horizon::text as horizon, rank, lane::text as lane, funding_target_usd, estimate_usd, funded_usd, acceptance_test, executor_role_id, intent from public.cards where id = $1`,
            [id],
          );
        const lastAction = async (id: string) =>
          await row(`select action, reason, details from public.board_actions where card_id = $1 order by created_at desc, id desc limit 1`, [id]);

        // A backlog card as file-backlog files it: proposed on later, no target, executor or acceptance test.
        const backlog = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, summary, intent, stage, horizon, rank)
           values ('game', 'board', 'goal', 'code', 'seed-1', 'A planned change to Dust', 'A planned change.', 'Not built yet.', 'proposed', 'later', 1) returning id`,
        );
        const paid = (await row<{ r: Row }>(
          `select public.apply_contribution('hz1', 'contrib_hz_a', null, 10, 10, 0, $1, 'cs_hz1') as r`,
          [backlog.id],
        )).r;
        assertEquals([paid.goal_card_id, paid.requested_card_id, paid.pool_credit_usd], [null, backlog.id, 9]);
        assertEquals((await card(backlog.id)).funded_usd, "0.0000");

        const move = (extra = "") => `select public.set_card_horizon(p_card => $1, p_horizon => 'now', p_rank => 2, p_reason => 'Ready for funding'${extra}) as r`;
        await refuses(move(), "A funding target is required to move a card to now", [backlog.id]);
        await refuses(move(", p_target_usd => 0"), "The funding target must be above zero", [backlog.id]);
        await refuses(move(", p_target_usd => 10000.01"), "The funding target must be at most $10,000", [backlog.id]);
        await refuses(move(", p_target_usd => 3"), "A card on now needs a check: line in its acceptance test", [backlog.id]);
        await refuses(
          move(", p_target_usd => 3, p_acceptance_test => $2"),
          "A card on now needs an executor role",
          [backlog.id, CHECK],
        );
        await db.query(`update public.roles set state = 'retired' where id = $1`, [roleId]);
        await refuses(
          move(", p_target_usd => 3, p_acceptance_test => $2, p_executor_role_id => $3"),
          "The executor must be an active role",
          [backlog.id, CHECK, roleId],
        );
        await db.query(`update public.roles set state = 'active' where id = $1`, [roleId]);
        // A refused move changes nothing.
        assertEquals((await card(backlog.id)).horizon, "later");

        const moved = (await row<{ r: Row }>(
          move(", p_target_usd => 3, p_acceptance_test => $2, p_executor_role_id => $3, p_lane => 'config'"),
          [backlog.id, CHECK, roleId],
        )).r;
        assertEquals(moved, { card_id: backlog.id, horizon: "now", rank: 2, stage: "proposed", funding_target_usd: 3 });
        assertEquals(await card(backlog.id), {
          stage: "proposed",
          horizon: "now",
          rank: 2,
          lane: "config",
          funding_target_usd: "3.0000",
          estimate_usd: "3.0000",
          funded_usd: "0.0000",
          acceptance_test: CHECK,
          executor_role_id: roleId,
          intent: "Not built yet.",
        });
        assertEquals(await lastAction(backlog.id), {
          action: "set_card_horizon",
          reason: "Ready for funding",
          details: { from_horizon: "later", to_horizon: "now", from_rank: 1, to_rank: 2, from_target_usd: 0, to_target_usd: 3 },
        });

        // Now a payment reaches its bar and fills it, up to its target (superseded,
        // money-logic.md: bars were uncapped); the other 6 goes on down the waterfall.
        const filled = (await row<{ r: Row }>(
          `select public.apply_contribution('hz2', 'contrib_hz_b', null, 10, 10, 0, $1, 'cs_hz2') as r`,
          [backlog.id],
        )).r;
        assertEquals([filled.goal_card_id, filled.goal_stage, filled.goal_funded_usd], [backlog.id, "funded", 3]);
        // A funded card keeps its horizon; the board cancels it instead.
        await refuses(
          `select public.set_card_horizon($1, 'later', 1, 'Park it')`,
          "Only a card open for funding changes horizon; cancel it with a reason instead",
          [backlog.id],
        );

        // An open card with money on its bar stays on now.
        const open = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, summary, funding_target_usd, stage, executor_role_id) values ('game', 'board', 'goal', 'config', 'seed-1', 'An open card with money', 'Summary.', 100, 'voted', $1) returning id`,
          [roleId],
        );
        await row(`select public.apply_contribution('hz3', 'contrib_hz_c', null, 10, 10, 0, $1, 'cs_hz3') as r`, [open.id]);
        await refuses(
          `select public.set_card_horizon($1, 'later', 1, 'Park it')`,
          "A card with money on its bar stays on now; cancel it with a reason instead",
          [open.id],
        );

        // An open card whose only money is on hold stays on now until the hold is gone.
        const held = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, summary, funding_target_usd, stage, executor_role_id) values ('game', 'board', 'goal', 'config', 'seed-1', 'An open card with money on hold', 'Summary.', 100, 'proposed', $1) returning id`,
          [roleId],
        );
        await row(`select public.apply_contribution('hz4', 'contrib_hz_d', null, 60, 60, 0, null, 'cs_hz4', 'card:hold-card') as r`);
        const onHold = (await row<{ r: Row }>(
          `select public.apply_contribution('hz5', 'contrib_hz_d', null, 10, 10, 0, $1, 'cs_hz5', 'card:hold-card') as r`,
          [held.id],
        )).r;
        assertEquals([onHold.goal_card_id, onHold.pool_credit_usd, onHold.held_usd], [held.id, 0, 9]);
        assertEquals((await card(held.id)).funded_usd, "0.0000");
        await refuses(
          `select public.set_card_horizon($1, 'later', 1, 'Park it')`,
          "A card with money on hold stays on now; cancel it with a reason instead",
          [held.id],
        );
        // A full refund cancels the hold, and the card can then be parked.
        await row(`select public.reverse_contribution('hz5r', 'cs_hz5', 'refund', 10) as r`);
        await row(`select public.set_card_horizon($1, 'later', 4, 'Park it') as r`, [held.id]);
        assertEquals((await card(held.id)).horizon, "later");

        // A voted card with nothing on it parks, then moves along the backlog.
        const voted = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, summary, funding_target_usd, stage) values ('game', 'board', 'goal', 'config', 'seed-1', 'A voted card with no money', 'Summary.', 5, 'voted') returning id`,
        );
        await row(`select public.set_card_horizon($1, 'later', 3, 'Not yet') as r`, [voted.id]);
        await row(`select public.set_card_horizon($1, 'next', 1, 'Sooner') as r`, [voted.id]);
        await row(`select public.set_card_horizon($1, 'next', 0, 'First') as r`, [voted.id]);
        assertEquals(
          [(await card(voted.id)).stage, (await card(voted.id)).horizon, (await card(voted.id)).rank],
          ["voted", "next", 0],
        );
        await refuses(
          `select public.set_card_horizon(p_card => $1, p_horizon => 'later', p_rank => 1, p_reason => 'x', p_target_usd => 3)`,
          "Card fields are set only when a card moves to now",
          [voted.id],
        );
        await refuses(`select public.set_card_horizon($1, 'later', -1, 'x')`, "The rank must be zero or more", [voted.id]);
        await refuses(`select public.set_card_horizon($1, 'later', 1, ' ')`, "A reason is required", [voted.id]);
        await refuses(`select public.set_card_horizon(null, 'later', 1, 'x')`, "A card is required");
        await refuses(`select public.set_card_horizon($1, null, 1, 'x')`, "A horizon is required", [voted.id]);
        await refuses(
          `select public.set_card_horizon($1, 'later', 1, 'x')`,
          "does not exist",
          [voted.id.replace(/^[0-9a-f]{8}/, "00000000")],
        );

        // A release never moves a card off now to funded. Superseded (money-logic.md,
        // card-columns-and-open-funding.md's release to the named card whatever its
        // stage): a card off now takes no money, so the release enters at step 2.
        const parked = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, summary, funding_target_usd, stage, executor_role_id) values ('game', 'board', 'goal', 'config', 'seed-1', 'A card parked with a hold', 'Summary.', 5, 'proposed', $1) returning id`,
          [roleId],
        );
        const parkedHold = (await row<{ r: Row }>(
          `select public.apply_contribution('hz6', 'contrib_hz_d', null, 10, 10, 0, $1, 'cs_hz6', 'card:hold-card') as r`,
          [parked.id],
        )).r;
        assertEquals(parkedHold.held_usd, 9);
        // Only the service role can put a card with money on hold off now.
        await db.query(`update public.cards set horizon = 'later' where id = $1`, [parked.id]);
        await db.exec(
          `update public.contributions set hold_until = now() - interval '1 minute' where stripe_event_id = 'hz6'`,
        );
        const released = (await row<{ r: Row }>(`select public.credit_held_contributions() as r`)).r;
        assertEquals(released, { released: 1, released_usd: 9 });
        assertEquals(
          [(await card(parked.id)).stage, (await card(parked.id)).funded_usd],
          ["proposed", "0.0000"],
        );
        assertEquals(
          await rows(
            `select a.step from public.contribution_allocations a join public.contributions r on r.id = a.entry_id where r.entry = 'release' and r.parent_id = (select id from public.contributions where stripe_event_id = 'hz6')`,
          ),
          [{ step: 2 }],
        );

        // The platform code lane stays closed on now.
        const platform = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, summary, intent, acceptance_test, executor_role_id, stage, horizon)
           values ('platform', 'board', 'goal', 'code', 'platform', 'A site change', 'Summary.', 'Intent.', $1, $2, 'proposed', 'next') returning id`,
          [CHECK, roleId],
        );
        await refuses(
          `select public.set_card_horizon(p_card => $1, p_horizon => 'now', p_rank => null, p_reason => 'Open it', p_target_usd => 3)`,
          "The platform code lane is closed until the board has its own site",
          [platform.id],
        );
        // A config lane outside seed-1 is refused as file_card refuses it.
        await refuses(
          `select public.set_card_horizon(p_card => $1, p_horizon => 'now', p_rank => null, p_reason => 'Open it', p_target_usd => 3, p_lane => 'config')`,
          "The config lane exists only for seed-1",
          [platform.id],
        );
        assertEquals(await identityOffsets(), offsets);
      },
    );

    await t.step(
      "cancel_card rejects a card no agent is working on, with the board's reason, moves its unspent money on, and refuses the rest",
      async () => {
        await quietCards();
        await signInAs(BOARD_EMAIL, "aal2");
        const make = async (stage: string) =>
          (await row<{ id: string }>(
            `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage, executor_role_id) values ('game', 'board', 'goal', 'config', 'seed-1', $1, 5, $2, $3) returning id`,
            [`A ${stage} card for cancelling`, stage, roleId],
          )).id;
        for (const stage of ["proposed", "designing", "voted", "funded", "paused"]) {
          const id = await make(stage);
          const r = (await row<{ r: Row }>(`select public.cancel_card($1, '  Out of scope for Dust ') as r`, [id])).r;
          assertEquals(r, { card_id: id, stage: "rejected", from_stage: stage, moved_usd: 0, moved_to: [] });
          assertEquals(
            await row(`select stage::text as stage, failing_check, funded_usd from public.cards where id = $1`, [id]),
            { stage: "rejected", failing_check: "cancelled_by_board", funded_usd: "0.0000" },
          );
          assertEquals(
            await row(`select action, actor_email, reason, details from public.board_actions where card_id = $1`, [id]),
            {
              action: "cancel_card",
              actor_email: BOARD_EMAIL,
              reason: "Out of scope for Dust",
              details: { from_stage: stage, funded_usd: 0, moved_usd: 0, moved_to: [] },
            },
          );
          // Superseded (money-logic.md, launch-db.md's "cancel refuses money"): a card
          // holding supporters' money is cancelled too, and its unspent money moves at
          // once to the next cards in line (here none takes money, so Not on a card yet).
          const funded = await make("proposed");
          await row(`select public.apply_contribution($1, $2, null, 2, 2, 0, $3) as r`, [`evt_cancel_${stage}`, `contrib_cancel_${stage}`, funded]);
          await db.query(`update public.cards set stage = $2 where id = $1`, [funded, stage]);
          const moved = (await row<{ r: Row }>(`select public.cancel_card($1, 'Stop it') as r`, [funded])).r;
          assertEquals(moved.moved_usd, 1.8, stage);
          assertEquals(moved.moved_to, [{ destination: "unassigned", card_id: null, amount_usd: 1.8, step: 3 }], stage);
          assertEquals(
            await row(`select stage::text as stage, funded_usd from public.cards where id = $1`, [funded]),
            { stage: "rejected", funded_usd: "0.0000" },
          );
        }
        for (const stage of ["building", "gated"]) {
          const id = await make(stage);
          await refuses(
            `select public.cancel_card($1, 'Stop it')`,
            "A building or gated card cannot be cancelled; pause the studio and cancel it once it shows paused",
            [id],
          );
          assertEquals((await row<{ stage: string }>(`select stage::text as stage from public.cards where id = $1`, [id])).stage, stage);
        }
        for (const stage of ["live", "rejected"]) {
          await refuses(`select public.cancel_card($1, 'Stop it')`, `A ${stage} card cannot be cancelled`, [await make(stage)]);
        }
        const open = await make("proposed");
        await refuses(`select public.cancel_card($1, '')`, "A reason is required", [open]);
        await refuses(`select public.cancel_card(null, 'x')`, "A card is required");
        await quietCards();
      },
    );

    await t.step(
      "resume_card sends a paused card back to funded with an estimate of at least what it has cost",
      async () => {
        await signInAs(BOARD_EMAIL, "aal2");
        const paused = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, estimate_usd, actual_usd, stage, failing_check) values ('game', 'board', 'oneoff', 'config', 'seed-1', 'A card paused at its ceiling', 1, 1.5, 'paused', 'ceiling') returning id`,
        );
        await refuses(
          `select public.resume_card($1, 1.4, 'Try again')`,
          "The estimate must be at least the card's cost so far of 1.5000",
          [paused.id],
        );
        await refuses(`select public.resume_card($1, 0, 'Try again')`, "The estimate must be above zero", [paused.id]);
        await refuses(`select public.resume_card($1, 10000.01, 'Try again')`, "The estimate must be at most $10,000", [paused.id]);
        await refuses(`select public.resume_card($1, 3, null)`, "A reason is required", [paused.id]);
        const r = (await row<{ r: Row }>(`select public.resume_card($1, 3, ' More room ') as r`, [paused.id])).r;
        assertEquals(r, { card_id: paused.id, stage: "funded", estimate_usd: 3 });
        assertEquals(
          await row(`select stage::text as stage, estimate_usd, actual_usd from public.cards where id = $1`, [paused.id]),
          { stage: "funded", estimate_usd: "3.0000", actual_usd: "1.5000" },
        );
        assertEquals(
          (await row(`select reason, details from public.board_actions where card_id = $1 and action = 'resume_card'`, [paused.id])),
          { reason: "More room", details: { from_estimate_usd: 1, to_estimate_usd: 3, actual_usd: 1.5, failing_check: "ceiling" } },
        );
        await refuses(`select public.resume_card($1, 3, 'Again')`, "Only a paused card can be resumed", [paused.id]);
        const later = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, stage, horizon) values ('game', 'board', 'oneoff', 'config', 'seed-1', 'A paused card off now', 'paused', 'later') returning id`,
        );
        await refuses(`select public.resume_card($1, 3, 'Again')`, "Only a card on now can be resumed", [later.id]);
        const site = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, stage) values ('platform', 'board', 'oneoff', 'code', 'platform', 'A paused site card', 'paused') returning id`,
        );
        await refuses(
          `select public.resume_card($1, 3, 'Again')`,
          "The platform code lane is closed until the board has its own site",
          [site.id],
        );
      },
    );

    await t.step(
      "a refund of money already spent leaves Not on a card yet short, and reverse_contribution says by how much",
      async () => {
        // Superseded (money-logic.md, refunds-and-holds.md's earmarked shortfall):
        // the shortfall is the negative part of Not on a card yet, the pool balance
        // less every card's unspent bar, and earmarked_usd is gone.
        await quietCards();
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        const shipped = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage, executor_role_id) values ('game', 'board', 'goal', 'config', 'seed-1', 'A card funded, built and shipped', 10, 'proposed', '${roleId}') returning id`,
        );
        const paid = (await row<{ r: Row }>(
          `select public.apply_contribution('sf1', 'contrib_sf', null, 20, 20, 0, $1, 'cs_sf1', 'card:shortfall') as r`,
          [shipped.id],
        )).r;
        // 18 of credit: 10 fills the card, 8 goes to Not on a card yet.
        assertEquals([paid.pool_credit_usd, paid.goal_stage, paid.goal_funded_usd], [18, "funded", 10]);
        // The agents spend 18 on the card, past its bar, and it ships.
        await row(`select public.record_usage($1, $2, 'builder-model-id', 10, 0, 10, 18) as r`, [shipped.id, roleId]);
        await db.query(`update public.cards set stage = 'live' where id = $1`, [shipped.id]);
        // $5 of the pool is Not on a card yet (a fixture write).
        await db.exec(`update public.pool set balance_usd = balance_usd - money.not_on_card_usd() + 5 where id = 1`);
        const before = await pool();
        const offsets = await identityOffsets();
        const refund = (await row<{ r: Row }>(`select public.reverse_contribution('sf1r', 'cs_sf1', 'refund', 20) as r`)).r;
        // $18 comes off the balance and the card gives up nothing, since all its money
        // was spent: Not on a card yet goes from 5 to -13.
        assertEquals("earmarked_usd" in refund, false);
        assertEquals(refund.not_on_card_usd, -13);
        assertEquals(refund.shortfall_usd, 13);
        assertEquals(refund.pool_balance_usd, Number((Number(before.balance_usd) - 18).toFixed(4)));
        assertEquals(refund.goal_stage, "live");
        assertEquals(refund.goal_funded_usd, 10);
        assertEquals(await row(`select not_on_card_usd, short_usd from public.public_money`), { not_on_card_usd: "0.0000", short_usd: "13.0000" });
        assertEquals(await identityOffsets(), offsets);

        // A refund Not on a card yet covers leaves no shortfall.
        await db.exec(`update public.pool set balance_usd = balance_usd - money.not_on_card_usd() + 50 where id = 1`);
        await row(`select public.apply_contribution('sf2', 'contrib_sf2', null, 10, 10, 0, null, 'cs_sf2', 'card:shortfall-two') as r`);
        const covered = (await row<{ r: Row }>(`select public.reverse_contribution('sf2r', 'cs_sf2', 'refund', 10) as r`)).r;
        assertEquals(covered.shortfall_usd, 0);
        assertEquals(covered.not_on_card_usd, 50);
      },
    );

    await t.step(
      "live_at is stamped when a card goes live and moves with nothing else",
      async () => {
        await quietCards();
        await db.exec(`update public.pool set incident_reserve_usd = 500 where id = 1`);
        const card = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage, executor_role_id) values ('game', 'board', 'goal', 'config', 'seed-1', 'A goal card that ships with money held', 200, 'proposed', '${roleId}') returning id`,
        );
        const pay = (await row<{ r: Row }>(
          `select public.apply_contribution('evt_la', 'contrib_la', null, 100.00, 100.00, 0, $1, 'cs_la') as r`,
          [card.id],
        )).r;
        assertEquals(pay.held_usd, 40);
        const liveAt = async () =>
          (await row<{ t: Date | null }>(
            `select live_at as t from public.cards where id = $1`,
            [card.id],
          )).t;
        assertEquals(await liveAt(), null);

        await db.query(`update public.cards set stage = 'building' where id = $1`, [card.id]);
        assertEquals(await liveAt(), null);
        await db.query(`update public.cards set stage = 'live' where id = $1`, [card.id]);
        const stamped = await liveAt();
        assert(stamped instanceof Date);
        assert(Math.abs(stamped.getTime() - Date.now()) < 60_000, "stamped now");

        // Pin a known stamp, then nothing but a new move to live changes it.
        const pinned = "2026-09-01T12:00:00.000Z";
        await db.query(`update public.cards set live_at = $2 where id = $1`, [card.id, pinned]);
        await db.query(`update public.cards set funded_usd = funded_usd + 1 where id = $1`, [card.id]);
        await db.query(`update public.cards set funded_usd = funded_usd - 1, title = title where id = $1`, [card.id]);
        await db.query(`update public.cards set stage = 'live' where id = $1`, [card.id]);
        assertEquals((await liveAt())?.toISOString(), pinned);

        // Superseded (money-logic.md, card-columns-and-open-funding.md's release to
        // the named card whatever its stage): money pledged while the card was open
        // enters the waterfall on release, and a live card takes no money, so it
        // goes on to Not on a card yet and the bar keeps what it had.
        await db.exec(
          `update public.contributions set hold_until = now() - interval '1 minute' where stripe_event_id = 'evt_la'`,
        );
        const released = (await row<{ r: Row }>(
          `select public.credit_held_contributions() as r`,
        )).r;
        assertEquals(released, { released: 1, released_usd: 40 });
        assertEquals(
          await row(
            `select funded_usd, stage::text as stage from public.cards where id = $1`,
            [card.id],
          ),
          { funded_usd: "50.0000", stage: "live" },
        );
        assertEquals((await liveAt())?.toISOString(), pinned);

        // Shipping again restamps.
        await db.query(`update public.cards set stage = 'rejected' where id = $1`, [card.id]);
        assertEquals((await liveAt())?.toISOString(), pinned);
        await db.query(`update public.cards set stage = 'live' where id = $1`, [card.id]);
        assert(((await liveAt())?.getTime() ?? 0) > Date.parse(pinned), "restamped");

        // A card inserted live is stamped too.
        const inserted = await row<{ t: Date | null }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, stage) values ('game', 'board', 'oneoff', 'config', 'seed-1', 'A card inserted live', 'live') returning live_at as t`,
        );
        assert(inserted.t instanceof Date);
        const explicit = await row<{ t: Date }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, stage, live_at) values ('game', 'board', 'oneoff', 'config', 'seed-1', 'A card inserted live with its ship time', 'live', '2026-08-01T09:00:00Z') returning live_at as t`,
        );
        assertEquals(explicit.t.toISOString(), "2026-08-01T09:00:00.000Z");
        // A move to live stamps now, even when the update names a live_at of its own.
        const moved = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, stage) values ('game', 'board', 'oneoff', 'config', 'seed-1', 'A card that ships with a live_at in the update', 'gated') returning id`,
        );
        await db.query(
          `update public.cards set stage = 'live', live_at = '2026-08-01T09:00:00Z' where id = $1`,
          [moved.id],
        );
        const movedAt = await row<{ t: Date }>(`select live_at as t from public.cards where id = $1`, [moved.id]);
        assert(Math.abs(movedAt.t.getTime() - Date.now()) < 60_000, "a move to live stamps now");
        assertEquals(
          await row(
            `select proconfig, prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_live_at'`,
          ),
          { proconfig: ['search_path=""'], prosecdef: false },
        );
      },
    );

    await t.step(
      "the backfill stamps a live card with its last ship event, or its updated_at, and leaves updated_at alone",
      async () => {
        const migration = (await readMigrations()).find((m) =>
          m.name === "20260921000100_public_card_columns.sql"
        );
        assert(migration, "the public card columns migration");
        const already = await rows<{ id: string; live_at: Date }>(
          `select id, live_at from public.cards where live_at is not null order by id`,
        );
        assert(already.length > 0, "an earlier step stamped a card");

        await db.exec(`alter table public.cards disable trigger cards_set_live_at`);
        const shipped = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, stage, updated_at) values ('game', 'board', 'oneoff', 'config', 'seed-1', 'Live before live_at, with ship events', 'live', '2026-09-12T08:00:00Z') returning id`,
        );
        const quiet = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, stage, updated_at) values ('game', 'board', 'oneoff', 'config', 'seed-1', 'Live before live_at, no ship event', 'live', '2026-09-05T08:00:00Z') returning id`,
        );
        const open = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, stage, updated_at) values ('game', 'board', 'goal', 'config', 'seed-1', 'Voted, with a ship event', 'voted', '2026-09-06T08:00:00Z') returning id`,
        );
        await db.query(
          `insert into public.agent_events (card_id, role_id, type, created_at) values
             ($1, $3, 'ship', '2026-09-01T10:00:00Z'),
             ($1, $3, 'ship', '2026-09-10T10:00:00Z'),
             ($1, $3, 'gate_pass', '2026-09-11T10:00:00Z'),
             ($2, $3, 'ship', '2026-09-11T10:00:00Z')`,
          [shipped.id, open.id, roleId],
        );
        const stamps = async (id: string) =>
          await row<{ live_at: string | null; updated_at: string }>(
            `select to_char(live_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as live_at, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as updated_at from public.cards where id = $1`,
            [id],
          );
        assertEquals((await stamps(shipped.id)).live_at, null);

        await db.exec(migration.sql);

        assertEquals(await stamps(shipped.id), {
          live_at: "2026-09-10T10:00:00",
          updated_at: "2026-09-12T08:00:00",
        });
        assertEquals(await stamps(quiet.id), {
          live_at: "2026-09-05T08:00:00",
          updated_at: "2026-09-05T08:00:00",
        });
        assertEquals(await stamps(open.id), {
          live_at: null,
          updated_at: "2026-09-06T08:00:00",
        });
        assertEquals(
          await rows(
            `select id, live_at from public.cards where id = any($1::uuid[]) order by id`,
            [already.map((a) => a.id)],
          ),
          already,
        );
        // Both card triggers are enabled after the run, beside agent-system-core's text guard.
        assertEquals(
          await rows(
            `select tgname, tgenabled from pg_trigger where tgrelid = 'public.cards'::regclass and not tgisinternal order by 1`,
          ),
          [
            { tgname: "cards_agent_text_guard", tgenabled: "O" },
            { tgname: "cards_set_live_at", tgenabled: "O" },
            { tgname: "cards_set_updated_at", tgenabled: "O" },
          ],
        );
        await db.query(`update public.cards set stage = 'live' where id = $1`, [open.id]);
        assertNotEquals((await stamps(open.id)).live_at, null);
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
      "board-site: the platform code lane opens only with studio_state.platform_lane_open, which anon reads and cannot write",
      async () => {
        const CLOSED = "The platform code lane is closed until the board has its own site";
        await signInAs(BOARD_EMAIL, "aal2");
        assertEquals((await row<{ o: boolean }>(`select platform_lane_open as o from public.studio_state where id = 1`)).o, false);
        const LANE_CHECK = 'check: config seed-1/config/spawn-table.json rows[id=cart].baseCost == 120';
        await refuses(
          `select public.file_card('platform', 'code', 'platform', 'Lane card now', 'Summary.', 'Intent.', $2, 5, 'proposed', $1, 'r', 'now')`,
          CLOSED,
          [roleId, LANE_CHECK],
        );
        const next = await row<{ id: string }>(
          `select public.file_card('platform', 'code', 'platform', 'Lane card next', 'Summary.', 'Intent.', $2, 5, 'proposed', $1, 'r', 'next') as id`,
          [roleId, LANE_CHECK],
        );
        await refuses(
          `select public.set_card_horizon(p_card => $1, p_horizon => 'now', p_rank => null, p_reason => 'Open it', p_target_usd => 5)`,
          CLOSED,
          [next.id],
        );
        const paused = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, stage) values ('platform', 'board', 'oneoff', 'code', 'platform', 'A paused lane card', 'paused') returning id`,
        );
        await refuses(`select public.resume_card($1, 3, 'Go')`, CLOSED, [paused.id]);

        // The board's production step opens the lane once its own site is live.
        await db.exec(`update public.studio_state set platform_lane_open = true where id = 1`);
        const now = await row<{ id: string }>(
          `select public.file_card('platform', 'code', 'platform', 'Lane card now', 'Summary.', 'Intent.', $2, 5, 'proposed', $1, 'r', 'now') as id`,
          [roleId, LANE_CHECK],
        );
        assertEquals((await row(`select horizon::text as h, stage::text as s from public.cards where id = $1`, [now.id])), { h: "now", s: "proposed" });
        await row(`select public.set_card_horizon(p_card => $1, p_horizon => 'now', p_rank => null, p_reason => 'Open it', p_target_usd => 5)`, [next.id]);
        assertEquals((await row<{ h: string }>(`select horizon::text as h from public.cards where id = $1`, [next.id])).h, "now");
        await row(`select public.resume_card($1, 3, 'Go')`, [paused.id]);
        assertEquals((await row<{ s: string }>(`select stage::text as s from public.cards where id = $1`, [paused.id])).s, "funded");
        // Every other rule still holds on an open lane.
        await refuses(
          `select public.file_card('platform', 'config', 'platform', 'Lane config', 'Summary.', null, 'check: x', 5, 'proposed', $1, 'r', 'now')`,
          "The config lane exists only for seed-1",
          [roleId],
        );
        const { s } = await row<{ s: Row }>(`select public.board_studio_state() as s`);
        assertEquals(s.platform_lane_open, true);

        // Anyone reads the flag through public_studio; nobody but the service role writes it.
        await signInAs(null);
        for (const role of ["anon", "authenticated"]) {
          await db.exec(`set role ${role}`);
          try {
            const studio = await rows(`select * from public.public_studio`);
            assertEquals(Object.keys(studio[0]!), ["launched_at", "paused", "platform_lane_open", "pause_reason"]);
            assertEquals(studio[0]!.platform_lane_open, true);
            await refuses(`update public.public_studio set platform_lane_open = false`, "permission denied");
            await refuses(`update public.studio_state set platform_lane_open = false`, "permission denied");
          } finally {
            await db.exec(`reset role`);
          }
        }

        await db.exec(`update public.studio_state set platform_lane_open = false where id = 1`);
        await db.query(`delete from public.board_actions where card_id = any($1::uuid[])`, [[next.id, paused.id, now.id]]);
        await db.query(`delete from public.cards where id = any($1::uuid[])`, [[next.id, paused.id, now.id]]);
      },
    );

    await t.step(
      "board-site: set_caps sets and clears the usage tier cap only when asked, within its bounds, and records it",
      async () => {
        await signInAs(BOARD_EMAIL, "aal2");
        const tier = async () =>
          (await row<{ t: string | null }>(`select anthropic_tier_cap_usd::text as t from public.studio_state where id = 1`)).t;
        const lastDetails = async () =>
          (await row<{ d: Row }>(`select details as d from public.board_actions where action = 'set_caps' order by created_at desc, id desc limit 1`)).d;
        assertEquals(await tier(), null);
        const r = (await row<{ r: Row }>(
          `select public.set_caps(p_reason => 'Tier on the Console', p_anthropic_tier_cap_usd => 100, p_set_anthropic_tier_cap => true) as r`,
        )).r;
        assertEquals(r.anthropic_tier_cap_usd, 100);
        assertEquals(await tier(), "100.0000");
        assertEquals([(await lastDetails()).before, (await lastDetails()).after].map((d) => (d as Row).anthropic_tier_cap_usd), [null, 100]);
        // Another cap leaves it as it is.
        await row(`select public.set_caps(p_card_max_usd => 20, p_reason => 'Same ceiling')`);
        assertEquals(await tier(), "100.0000");
        assertEquals((await row<{ s: Row }>(`select public.board_studio_state() as s`)).s.anthropic_tier_cap_usd, 100);
        const count = (await row<{ n: number }>(`select count(*)::int as n from public.board_actions`)).n;
        for (const [sql, message] of [
          [`select public.set_caps(p_reason => 'x', p_anthropic_tier_cap_usd => 200)`, "Pass p_set_anthropic_tier_cap to change the usage tier cap"],
          [`select public.set_caps(p_reason => 'x', p_anthropic_tier_cap_usd => 0, p_set_anthropic_tier_cap => true)`, "The usage tier cap must be above zero and at most $1,000,000, or null for none"],
          [`select public.set_caps(p_reason => 'x', p_anthropic_tier_cap_usd => 1000000.01, p_set_anthropic_tier_cap => true)`, "The usage tier cap must be above zero and at most $1,000,000, or null for none"],
          [`select public.set_caps(p_anthropic_tier_cap_usd => 200, p_set_anthropic_tier_cap => true)`, "A reason is required"],
        ] as const) {
          await refuses(sql, message);
        }
        assertEquals(await tier(), "100.0000");
        assertEquals((await row<{ n: number }>(`select count(*)::int as n from public.board_actions`)).n, count);
        // Null with the flag removes it.
        await row(`select public.set_caps(p_reason => 'No tier limit', p_set_anthropic_tier_cap => true)`);
        assertEquals(await tier(), null);
        assertEquals((await lastDetails()).after && ((await lastDetails()).after as Row).anthropic_tier_cap_usd, null);
        // One set_caps, the eight-argument version.
        assertEquals(
          await rows(`select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_caps'`),
          [{
            args:
              "p_daily_cap_usd numeric, p_card_max_usd numeric, p_agent_hourly_rate_usd numeric, p_reason text, p_monthly_cap_usd numeric, p_credit_studio_daily_cap_usd numeric, p_anthropic_tier_cap_usd numeric, p_set_anthropic_tier_cap boolean",
          }],
        );
        for (const [email, aal, message] of [
          [MODERATOR_EMAIL, "aal2", "Board membership is required"],
          [BOARD_EMAIL, "aal1", "A second factor is required"],
        ] as const) {
          await signInAs(email, aal);
          await refuses(`select public.set_caps(p_reason => 'x', p_anthropic_tier_cap_usd => 5, p_set_anthropic_tier_cap => true)`, message);
        }
      },
    );

    await t.step(
      "board-site: board_needs_you gives the board, at aal1, the Controller's latest figures, the last purchase and the S1 cards",
      async () => {
        await signInAs(BOARD_EMAIL, "aal1");
        const needs = async () => (await row<{ n: Row }>(`select public.board_needs_you() as n`)).n;
        const lastPurchase = await rows<{ created_at: Date; amount_usd: string }>(
          `select created_at, amount_usd from public.credit_purchases order by created_at desc, id desc limit 1`,
        );
        const incident = Number((await row<{ i: string }>(`select incident_reserve_usd as i from public.pool where id = 1`)).i);
        const empty = await needs();
        // agent-system-core.md adds rule_blocked and approval_void.
        assertEquals(Object.keys(empty).sort(), ["approval_void", "controller", "incident_reserve_usd", "last_credit_purchase", "rule_blocked", "s1_cards"]);
        assertEquals(empty.controller, null);
        // The S1 cards earlier steps left in a spending stage, oldest first.
        const earlier = await rows(
          `select id, title, stage::text as stage from public.cards where severity = 's1' and stage in ('funded', 'building', 'gated', 'paused') order by created_at, id`,
        );
        assertEquals(empty.s1_cards, earlier);
        assertEquals(empty.incident_reserve_usd, incident);
        assertEquals(
          empty.last_credit_purchase,
          lastPurchase.length === 0 ? null : { created_at: (empty.last_credit_purchase as Row).created_at, amount_usd: Number(lastPurchase[0]!.amount_usd) },
        );

        const figures = (credit: number) => JSON.stringify({
          credit_purchase_usd: credit,
          minimum_balance_usd: 3.25,
          minimum_balance: { settlement_amount: 4.5, settlement_currency: "cad", reserve_usd: 1, held_usd: 0 },
          disputes_to_answer: [{ dispute: "du_1", status: "needs_response", due_by: "2026-10-01", amount_usd: 5 }],
          latest_payout: { id: "po_1", arrival_date: "2026-09-23", amount: 1000, currency: "cad" },
          families_private: "not for the board screen",
        });
        await db.query(
          `insert into public.controller_runs (job, started_at, finished_at, ok, mismatches, figures, created_at) values
             ('reconcile', now() - interval '2 days', now() - interval '2 days', true, 0, $1::jsonb, now() - interval '2 days'),
             ('reconcile', now() - interval '1 hour', now() - interval '1 hour', false, 2, $2::jsonb, now() - interval '1 hour'),
             ('quota', now(), now(), true, 0, '{"database_bytes": 1}'::jsonb, now())`,
          [figures(99), figures(12.5)],
        );
        const cards = await rows<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, stage, severity) values
             ('qa', 'board', 'oneoff', 'code', 'seed-1', 'An S1 fix', 'funded', 's1'),
             ('qa', 'board', 'oneoff', 'code', 'seed-1', 'An S1 fix that shipped', 'live', 's1'),
             ('qa', 'board', 'oneoff', 'code', 'seed-1', 'An S2 fix', 'funded', 's2')
           returning id`,
        );
        const full = await needs();
        const controller = full.controller as Row;
        assertEquals(Object.keys(controller).sort(), [
          "credit_purchase_usd",
          "disputes_to_answer",
          "finished_at",
          "latest_payout",
          "minimum_balance_usd",
          "mismatches",
          "ok",
          "settlement_amount",
          "settlement_currency",
        ]);
        assertEquals(
          [controller.ok, controller.mismatches, controller.credit_purchase_usd, controller.minimum_balance_usd, controller.settlement_amount, controller.settlement_currency],
          [false, 2, 12.5, 3.25, 4.5, "cad"],
        );
        assertEquals(controller.disputes_to_answer, [{ dispute: "du_1", status: "needs_response", due_by: "2026-10-01", amount_usd: 5 }]);
        assertEquals(controller.latest_payout, { id: "po_1", arrival_date: "2026-09-23", amount: 1000, currency: "cad" });
        assertEquals(full.s1_cards, [...earlier, { id: cards[0]!.id, title: "An S1 fix", stage: "funded" }]);

        // Board members only: a moderator, an outsider and anon are refused.
        for (const [email, aal] of [[MODERATOR_EMAIL, "aal2"], [OUTSIDER_EMAIL, "aal2"]] as const) {
          await signInAs(email, aal);
          await refuses(`select public.board_needs_you()`, "Board membership is required");
        }
        await signInAs(null);
        await db.exec(`set role anon`);
        try {
          await refuses(`select public.board_needs_you()`, "permission denied");
        } finally {
          await db.exec(`reset role`);
        }
        await db.exec(`delete from public.controller_runs`);
        await db.query(`delete from public.cards where id = any($1::uuid[])`, [cards.map((c) => c.id)]);
      },
    );

    await t.step(
      "function privileges: anon only card_is_public and the site's two documents, authenticated the board RPCs and those three, service_role the rest, one file_card",
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
          "board_jobs",
          "board_needs_you",
          "board_role",
          "board_roles",
          "board_studio_state",
          "cancel_card",
          "enqueue_manual_job",
          "file_card",
          "file_directive",
          "file_note",
          "is_board_member",
          "record_adjustment",
          "record_credit_purchase",
          "redact_contribution_name",
          "resume_card",
          "set_agent_mode",
          "set_caps",
          "set_card_horizon",
          "set_card_veto",
          "set_cooling_window",
          "set_launched",
          "set_paused",
          "set_role_pause",
        ];
        const service = [
          "apply_card_ranking",
          "apply_contribution",
          "approve_card_draft",
          "card_approved",
          "card_content_hash",
          "card_content_hash_of",
          "card_from_draft",
          "card_ledger_usd",
          "card_money_held",
          "card_needs_approval",
          "card_ready_problem",
          "claim_dispatcher_lease",
          "claim_job_run",
          "controller_figures",
          "credit_held_contributions",
          "deal_due_cards",
          "enqueue_job_run",
          "fail_running_job_runs",
          "finish_job_run",
          "ledger_identity",
          "ops_database_size",
          "record_card_approval",
          "record_card_draft",
          "record_dispute_reinstated",
          "record_stripe_fee",
          "record_usage",
          "release_dispatcher_lease",
          "resume_card_by_rule",
          "resume_due_by_rule",
          "reverse_contribution",
          "studio_spend_totals",
          "terms_version_at",
          "waterfall_sweep",
          "withdraw_card_draft",
        ];
        // A policy's functions run as the caller, so anon and authenticated execute the one
        // the cards policy calls (agent-system-core.md), and the public site's two documents,
        // which run as the caller too (site-snapshot.md).
        const everyone = ["card_is_public", "site_cards", "site_live"];
        assertEquals(
          privileges.map((p) => p.proname),
          [
            ...board,
            ...service,
            ...everyone,
            "cards_agent_text_guard",
            "refuse_money_change",
            "restrict_auth_users_to_board",
            "set_live_at",
            "set_updated_at",
            "studio_pause_reason",
          ].sort(),
        );
        // One file_card row: the twelve-argument version, granted like the old one.
        assertEquals(privileges.filter((p) => p.proname === "file_card"), [
          {
            proname: "file_card",
            anon: false,
            authenticated: true,
            service_role: true,
          },
        ]);
        for (const p of privileges) {
          assertEquals(p.anon, everyone.includes(p.proname), `anon on ${p.proname}`);
          assertEquals(
            p.authenticated,
            board.includes(p.proname) || everyone.includes(p.proname),
            `authenticated on ${p.proname}`,
          );
          if (board.includes(p.proname) || service.includes(p.proname) || everyone.includes(p.proname)) {
            assertEquals(p.service_role, true, `service_role on ${p.proname}`);
          }
        }
        // Every board RPC is security definer, so it reads cards with the owner's
        // rights and the column grants do not limit it. The four trigger functions,
        // terms_version_at, which only the service role and security definer
        // functions call, and the site's two documents, which read as anon under
        // anon's own grants, run with the caller's rights.
        const invoker = await rows<{ proname: string }>(
          `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not p.prosecdef order by 1`,
        );
        assertEquals(invoker.map((p) => p.proname), ["refuse_money_change", "set_live_at", "set_updated_at", "site_cards", "site_live", "studio_pause_reason", "terms_version_at"]);
      },
    );

    await t.step(
      "the dispatcher lease has one holder at a time, and only the service role can take it",
      async () => {
        const claim = async (holder: string, ttl = 60) =>
          (await row<{ ok: boolean }>(`select public.claim_dispatcher_lease($1, $2) as ok`, [holder, ttl])).ok;
        const release = async (holder: string) =>
          (await row<{ ok: boolean }>(`select public.release_dispatcher_lease($1) as ok`, [holder])).ok;
        const lease = async () =>
          await row<{ holder: string | null; live: boolean | null; claimed_at: Date | null }>(
            `select holder, expires_at > now() as live, claimed_at from public.dispatcher_lease where id = 1`,
          );
        assertEquals((await lease()).holder, null);
        assertEquals(await claim("vps"), true);
        assertEquals(await claim("mac"), false);
        const held = await lease();
        assertEquals([held.holder, held.live], ["vps", true]);
        // Renewing keeps the start of the hold.
        await db.exec(`update public.dispatcher_lease set claimed_at = claimed_at - interval '1 hour' where id = 1`);
        const started = (await lease()).claimed_at;
        assertEquals(await claim("vps", 120), true);
        assertEquals((await lease()).claimed_at?.getTime(), started?.getTime());
        assertEquals(await release("mac"), false);
        assertEquals((await lease()).holder, "vps");
        assertEquals(await release("vps"), true);
        assertEquals(await lease(), { holder: null, live: null, claimed_at: null });
        assertEquals(await claim("mac"), true);
        // An expired lease goes to the next claimant, whose hold starts now.
        await db.exec(`update public.dispatcher_lease set expires_at = now() - interval '1 second', claimed_at = now() - interval '1 hour' where id = 1`);
        assertEquals(await claim("vps"), true);
        const taken = await lease();
        assertEquals([taken.holder, taken.live], ["vps", true]);
        assert(Math.abs((taken.claimed_at?.getTime() ?? 0) - Date.now()) < 60_000, "a new hold starts now");
        assertEquals(await claim("mac"), false);
        await refuses(`select public.claim_dispatcher_lease('  ', 60)`, "p_holder is required");
        await refuses(`select public.claim_dispatcher_lease('mac', 0)`, "p_ttl_seconds must be between 1 and 3600");
        await refuses(`select public.claim_dispatcher_lease('mac', 3601)`, "p_ttl_seconds must be between 1 and 3600");
        await refuses(`select public.release_dispatcher_lease(null)`, "p_holder is required");
        await refuses(
          `update public.dispatcher_lease set holder = 'mac', expires_at = null where id = 1`,
          "dispatcher_lease_holder_check",
        );
        for (const role of ["anon", "authenticated"]) {
          await db.exec(`set role ${role}`);
          try {
            await refuses(`select public.claim_dispatcher_lease('anon-negative-test', 1)`, "permission denied");
            await refuses(`select public.release_dispatcher_lease('vps')`, "permission denied");
            await refuses(`update public.dispatcher_lease set expires_at = now() + interval '1 year'`, "permission denied");
          } finally {
            await db.exec(`reset role`);
          }
        }
        assertEquals((await lease()).holder, "vps");
        assertEquals(await release("vps"), true);
      },
    );

    await t.step(
      "card_patches keeps a submitted patch only with its true digest and length, for the service role only",
      async () => {
        const patch = "diff --git a/seed-1/config/unlocks.json b/seed-1/config/unlocks.json\n+  { \"id\": \"quiet-rooms\" }\n";
        const bytes = new TextEncoder().encode(patch);
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const base = "0123456789abcdef0123456789abcdef01234567";
        const insert = `insert into public.card_patches (card_id, base_sha, patch, sha256, bytes, summary) values ($1, $2, $3, $4, $5, 'Adds the quiet rooms unlock') returning id`;
        const stored = await row<{ id: string }>(insert, [oneoffCardId, base, patch, digest, bytes.length]);
        assertNotEquals(stored.id, null);
        await refuses(insert, "card_patches_digest_check", [oneoffCardId, base, patch, digest.replace(/^./, digest[0] === "a" ? "b" : "a"), bytes.length]);
        await refuses(insert, "card_patches_digest_check", [oneoffCardId, base, patch, digest, bytes.length + 1]);
        await refuses(insert, "card_patches_base_sha_check", [oneoffCardId, "main", patch, digest, bytes.length]);
        // An upper-case digest breaks the format check and the digest check alike.
        await refuses(insert, "violates check constraint \"card_patches_", [oneoffCardId, base, patch, digest.toUpperCase(), bytes.length]);
        for (const role of ["anon", "authenticated"]) {
          await db.exec(`set role ${role}`);
          try {
            await refuses(`select * from public.card_patches`, "permission denied");
            await refuses(`delete from public.card_patches`, "permission denied");
          } finally {
            await db.exec(`reset role`);
          }
        }
        await db.query(`delete from public.card_patches where id = $1`, [stored.id]);
      },
    );

    await t.step(
      "terms_versions posts version 1 at #47's merge and version 2 when applied, append-only, readable only through public_terms_versions",
      async () => {
        const versions = async () =>
          await rows<{ version: number; posted_at: Date }>(`select version, posted_at from public.terms_versions order by version`);
        const posted = await versions();
        assertEquals(posted.map((r) => r.version), [1, 2]);
        assertEquals(posted[0]!.posted_at.toISOString(), "2026-09-23T01:32:51.000Z");
        // Version 2 is posted at the time its migration is applied: at the start of this run.
        assert(Math.abs(posted[1]!.posted_at.getTime() - Date.now()) < 10 * 60_000, "version 2 posted when applied");
        // Each migration runs again without changing a row.
        const migrations = await readMigrations();
        for (const name of ["20260924100000_terms_versions.sql", "20260924100100_terms_version_2.sql"]) {
          await db.exec(migrations.find((m) => m.name === name)!.sql);
          const again = await versions();
          assertEquals(again.map((r) => [r.version, r.posted_at.toISOString()]), posted.map((r) => [r.version, r.posted_at.toISOString()]), name);
        }

        // Append-only, through the money tables' guard; an update that changes nothing passes.
        await refuses(`update public.terms_versions set posted_at = now() where version = 1`, "terms_versions is append-only: UPDATE of posted_at is refused");
        await refuses(`update public.terms_versions set version = 3 where version = 2`, "terms_versions is append-only: UPDATE of version is refused");
        await refuses(`delete from public.terms_versions where version = 2`, "terms_versions is append-only: DELETE is refused");
        // contributions.terms_version references it (money-logic.md), so a plain
        // truncate is refused by that foreign key, and one that cascades by the guard.
        await refuses(`truncate public.terms_versions`, "cannot truncate a table referenced in a foreign key constraint");
        await refuses(`truncate public.terms_versions cascade`, "is append-only: TRUNCATE is refused");
        await db.exec(`update public.terms_versions set posted_at = posted_at where version = 1`);
        await refuses(`insert into public.terms_versions (version) values (0)`, "terms_versions_version_check");
        await refuses(`insert into public.terms_versions (version) values (10000)`, "terms_versions_version_check");
        assertEquals((await versions()).length, 2);
        const triggers = await rows<{ tgname: string }>(
          `select tgname from pg_trigger where tgrelid = 'public.terms_versions'::regclass and not tgisinternal order by 1`,
        );
        assertEquals(triggers.map((r) => r.tgname), ["terms_versions_append_only", "terms_versions_no_truncate"]);
        assertEquals(await row(`select relrowsecurity from pg_class where oid = 'public.terms_versions'::regclass`), { relrowsecurity: true });

        // terms_version_at: the newest version posted at or before a time, else null.
        const at = async (time: string | null) =>
          (await row<{ v: number | null }>(`select public.terms_version_at($1::timestamptz) as v`, [time])).v;
        const v2At = posted[1]!.posted_at;
        assertEquals(await at("2026-09-23T01:32:51Z"), 1);
        assertEquals(await at("2026-09-23T01:32:50.999Z"), null);
        assertEquals(await at("2000-01-01T00:00:00Z"), null);
        assertEquals(await at(null), null);
        assertEquals(await at(new Date(v2At.getTime() - 1).toISOString()), 1);
        assertEquals(await at(v2At.toISOString()), 2);
        assertEquals(await at("2099-01-01T00:00:00Z"), 2);

        const privileges = await row(
          `select has_table_privilege('service_role', 'public.terms_versions', 'insert') as service_insert,
                  has_table_privilege('service_role', 'public.terms_versions', 'select') as service_select,
                  has_function_privilege('anon', 'public.terms_version_at(timestamptz)', 'execute') as anon_execute,
                  has_function_privilege('authenticated', 'public.terms_version_at(timestamptz)', 'execute') as authenticated_execute,
                  has_function_privilege('service_role', 'public.terms_version_at(timestamptz)', 'execute') as service_execute`,
        );
        assertEquals(privileges, {
          service_insert: false,
          service_select: true,
          anon_execute: false,
          authenticated_execute: false,
          service_execute: true,
        });

        const refusedWith42501 = async (sql: string) => {
          const error = await assertRejects(() => db.query(sql), Error, "permission denied");
          assertEquals((error as Error & { code?: string }).code, "42501", sql);
        };
        for (const role of ["anon", "authenticated"]) {
          await db.exec(`set role ${role}`);
          try {
            await refusedWith42501(`select * from public.terms_versions`);
            await refusedWith42501(`select public.terms_version_at(now())`);
            const view = await rows(`select * from public.public_terms_versions order by version`);
            assertEquals(view.map((r) => Object.keys(r)), [["version", "posted_at"], ["version", "posted_at"]], role);
            await refusedWith42501(`insert into public.public_terms_versions (version) values (9999)`);
            await refusedWith42501(`update public.public_terms_versions set posted_at = now() where version = 0`);
            await refusedWith42501(`delete from public.public_terms_versions where version = 0`);
          } finally {
            await db.exec(`reset role`);
          }
        }
        await db.exec(`set role service_role`);
        try {
          assertEquals((await rows(`select version from public.terms_versions`)).length, 2);
          assertEquals(await row(`select public.terms_version_at('2026-09-23T01:32:51Z') as v`), { v: 1 });
          await refusedWith42501(`insert into public.terms_versions (version) values (9999)`);
          await refusedWith42501(`update public.terms_versions set posted_at = now() where version = 1`);
          await refusedWith42501(`delete from public.terms_versions where version = 1`);
          await refusedWith42501(`insert into public.public_terms_versions (version) values (9999)`);
        } finally {
          await db.exec(`reset role`);
        }
        assertEquals((await versions()).length, 2);
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

    await t.step(
      "studio_spend_totals and card_ledger_usd sum the ledger in SQL for the service role only, and the tier cap is optional and positive",
      async () => {
        // Everything here is rolled back, so later steps see the database as it was.
        await db.exec(`begin`);
        try {
          const totals = async (monthStart: string, tierStart: string) =>
            (await row<{ t: Record<string, number> }>(
              `select public.studio_spend_totals($1::timestamptz, $2::timestamptz) as t`,
              [monthStart, tierStart],
            )).t;
          const MONTH = "2100-01-01T05:00:00Z";
          const TIER = "2100-01-01T00:00:00Z";
          const before = await totals(MONTH, TIER);
          assertEquals([before.month_usd, before.tier_usd], [0, 0]);
          const cardBefore = Number((await row<{ usd: string }>(`select public.card_ledger_usd($1) as usd`, [oneoffCardId])).usd);
          const insert = (billedTo: string, usd: number, createdAt: string, cardId: string | null) =>
            db.query(
              `insert into public.ledger (card_id, model, usd, billed_to, created_at) values ($1, 'builder-class', $2, $3::public.ledger_billing, $4::timestamptz)`,
              [cardId, usd, billedTo, createdAt],
            );
          // Before both starts, between them (tier month only), after both, a founder row, and
          // an overhead row with no card.
          await insert("studio", 2, "2099-12-31T12:00:00Z", oneoffCardId);
          await insert("studio", 1.5, "2100-01-01T02:00:00Z", oneoffCardId);
          await insert("studio", 0.75, "2100-01-10T12:00:00Z", oneoffCardId);
          await insert("overhead", 0.25, "2100-01-10T12:00:00Z", null);
          await insert("founder", 9, "2100-01-10T12:00:00Z", oneoffCardId);
          await db.query(`insert into public.credit_purchases (amount_usd, reason, created_by) values (12.5, 'Test credit', 'board@peanutgallery.games')`);
          const after = await totals(MONTH, TIER);
          assertEquals(
            {
              credit: Number((after.credit_purchased_usd - before.credit_purchased_usd).toFixed(4)),
              spent: Number((after.spent_usd - before.spent_usd).toFixed(4)),
              month: after.month_usd,
              tier: after.tier_usd,
            },
            { credit: 12.5, spent: 4.5, month: 1, tier: 2.5 },
          );
          // Every row of the card, the founder's included, as sumLedger always read it.
          const cardAfter = Number((await row<{ usd: string }>(`select public.card_ledger_usd($1) as usd`, [oneoffCardId])).usd);
          assertEquals(Number((cardAfter - cardBefore).toFixed(4)), 13.25);
          // A null start is refused as null, never read as zero.
          assertEquals((await row(`select public.studio_spend_totals(null, now()) as t`)).t, null);
          // The service role reads through row level security; anon and authenticated cannot call either.
          await db.exec(`set role service_role`);
          try {
            assertEquals((await totals(MONTH, TIER)).tier_usd, 2.5);
          } finally {
            await db.exec(`reset role`);
          }
          const grants = await row(
            `select has_function_privilege('anon', 'public.studio_spend_totals(timestamptz, timestamptz)', 'execute') as anon_totals,
                    has_function_privilege('authenticated', 'public.studio_spend_totals(timestamptz, timestamptz)', 'execute') as authenticated_totals,
                    has_function_privilege('service_role', 'public.studio_spend_totals(timestamptz, timestamptz)', 'execute') as service_totals,
                    has_function_privilege('anon', 'public.card_ledger_usd(uuid)', 'execute') as anon_card,
                    has_function_privilege('authenticated', 'public.card_ledger_usd(uuid)', 'execute') as authenticated_card,
                    has_function_privilege('service_role', 'public.card_ledger_usd(uuid)', 'execute') as service_card`,
          );
          assertEquals(grants, {
            anon_totals: false,
            authenticated_totals: false,
            service_totals: true,
            anon_card: false,
            authenticated_card: false,
            service_card: true,
          });
          // Each refusal inside a savepoint, since an error aborts the transaction around it.
          for (const role of ["anon", "authenticated"]) {
            for (const sql of [`select public.studio_spend_totals(now(), now())`, `select public.card_ledger_usd(gen_random_uuid())`]) {
              await db.exec(`savepoint refused`);
              await db.exec(`set role ${role}`);
              await refuses(sql, "permission denied");
              await db.exec(`rollback to savepoint refused`);
              await db.exec(`reset role`);
            }
          }
          // The index the totals read.
          assertEquals(
            await rows(`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'ledger_billed_created_idx'`),
            [{ indexdef: "CREATE INDEX ledger_billed_created_idx ON public.ledger USING btree (billed_to, created_at) INCLUDE (usd)" }],
          );
          // The tier cap: null by default, positive when set.
          assertEquals(await row(`select anthropic_tier_cap_usd from public.studio_state where id = 1`), { anthropic_tier_cap_usd: null });
          await db.exec(`update public.studio_state set anthropic_tier_cap_usd = 500 where id = 1`);
          assertEquals(Number((await row<{ c: string }>(`select anthropic_tier_cap_usd as c from public.studio_state where id = 1`)).c), 500);
          await db.exec(`savepoint tier`);
          await refuses(`update public.studio_state set anthropic_tier_cap_usd = 0 where id = 1`, "studio_state_anthropic_tier_cap_check");
          await db.exec(`rollback to savepoint tier`);
        } finally {
          await db.exec(`rollback`);
        }
        assertEquals(await row(`select anthropic_tier_cap_usd from public.studio_state where id = 1`), { anthropic_tier_cap_usd: null });
      },
    );

    await t.step(
      "the request-id rollback restores the eight-argument record_usage, and the migration applies again after it",
      async () => {
        const args = async () =>
          (await rows<{ args: string }>(
            `select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'record_usage'`,
          )).map((r) => r.args);
        const rollbackSql = await Deno.readTextFile(
          new URL("../../rollbacks/20260921000200_ledger_request_id_rollback.sql", import.meta.url),
        );
        const migrationSql = await Deno.readTextFile(
          new URL("20260921000200_ledger_request_id.sql", MIGRATIONS_DIR),
        );
        await db.exec(rollbackSql);
        await db.exec(rollbackSql);
        assertEquals(await args(), [
          "p_card_id uuid, p_role_id uuid, p_model text, p_input_tokens integer, p_cached_tokens integer, p_output_tokens integer, p_usd numeric, p_billed_to ledger_billing",
        ]);
        assertEquals(
          await rows(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'ledger' and column_name = 'request_id'`),
          [],
        );
        const service = await row<{ anon: boolean; service_role: boolean }>(
          `select has_function_privilege('anon', 'public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing)', 'execute') as anon,
                  has_function_privilege('service_role', 'public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing)', 'execute') as service_role`,
        );
        assertEquals(service, { anon: false, service_role: true });
        await db.exec(migrationSql);
        assertEquals(await args(), [
          "p_card_id uuid, p_role_id uuid, p_model text, p_input_tokens integer, p_cached_tokens integer, p_output_tokens integer, p_usd numeric, p_billed_to ledger_billing, p_request_id text",
        ]);
      },
    );
  } finally {
    await db.close();
  }
});

// Production applies the launch files one at a time onto a database that already
// holds payments, cards and roles, with the deployed site, webhook and dispatcher
// still running the old code, and applies 20260922000500 only after the site
// reads public_roles (docs/specs/launch-db.md). This walks the same order.
Deno.test("the launch migrations upgrade a live database in production order", {
  sanitizeOps: false,
  sanitizeResources: false,
}, async (t) => {
  const db = new PGlite();
  const LAUNCH = "20260922";
  const exec = (sql: string) => db.exec(sql.replaceAll(PGCRYPTO_LINE, ""));
  const one = async <T extends Row = Row>(sql: string, params: unknown[] = []) => {
    const result = await db.query<T>(sql, params);
    assert(result.rows.length > 0, `no row for: ${sql}`);
    return result.rows[0]!;
  };
  const asAnon = async <T>(run: () => Promise<T>): Promise<T> => {
    await db.exec(`set role anon`);
    try {
      return await run();
    } finally {
      await db.exec(`reset role`);
    }
  };
  try {
    const migrations = await readMigrations();
    const earlier = migrations.filter((m) => m.name < LAUNCH);
    // The launch files only; later files have tests of their own.
    const launch = migrations.filter((m) => m.name.startsWith(LAUNCH));
    assertEquals(launch.map((m) => m.name.slice(0, 14)), [
      "20260922000000",
      "20260922000100",
      "20260922000200",
      "20260922000300",
      "20260922000400",
      "20260922000500",
    ]);
    let cardId = "";

    await t.step("the schema before launch holds a payment, a card and a role", async () => {
      await db.exec(SHIM);
      for (const m of earlier) await exec(m.sql);
      await db.exec(
        `insert into public.studio_state (id) values (1); insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);`,
      );
      await db.exec(
        `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path) values ('Builder A', 'Builder A', 'A small blue creature.', 'builder-model-id', 0.2, 'plain', 'platform/agents/prompts/builder-a.md')`,
      );
      cardId = (await one<{ id: string }>(
        `insert into public.cards (bucket, source, shape, lane, folder, title, summary, funding_target_usd, stage) values ('game', 'board', 'goal', 'config', 'seed-1', 'An open card', 'Summary.', 100, 'voted') returning id`,
      )).id;
      // The deployed webhook's call: eight named arguments.
      const paid = (await one<{ r: Row }>(
        `select public.apply_contribution(p_stripe_event_id => 'evt_up1', p_contributor_id => 'contrib_up', p_display_name => null, p_amount_usd => 10, p_net_usd => 10, p_studio_pct => 0, p_goal_card_id => $1, p_stripe_session_id => 'cs_up1') as r`,
        [cardId],
      )).r;
      assertEquals(paid.goal_card_id, cardId);
      assertEquals((await asAnon(() => db.query(`select id from public.roles`))).rows.length, 1);
    });

    await t.step("000000 to 000400 apply one file at a time, and the old callers keep working", async () => {
      for (const m of launch.slice(0, 5)) {
        await exec(m.sql);
      }
      // The existing payment took its email key.
      assertEquals(
        await one(`select payer_key from public.contributions where stripe_event_id = 'evt_up1'`),
        { payer_key: "email:contrib_up" },
      );
      // The existing card is on now, and anon reads the new columns and the old ones.
      assertEquals(
        await asAnon(() => one(`select horizon::text as horizon, rank, title from public.cards where id = $1`, [cardId])),
        { horizon: "now", rank: null, title: "An open card" },
      );
      // The deployed webhook's eight named arguments still credit the card.
      const again = (await one<{ r: Row }>(
        `select public.apply_contribution(p_stripe_event_id => 'evt_up2', p_contributor_id => 'contrib_up', p_display_name => null, p_amount_usd => 10, p_net_usd => 10, p_studio_pct => 0, p_goal_card_id => $1, p_stripe_session_id => 'cs_up2') as r`,
        [cardId],
      )).r;
      // $10 at 0%: reserve $1, agents $9, the 5% incident share $0.45, credit $8.55.
      assertEquals([again.inserted, again.goal_card_id, again.pool_credit_usd], [true, cardId, 8.55]);
      // The deployed site still reads roles, and the new site's view is there too.
      await asAnon(async () => {
        assertEquals((await db.query(`select id, title, write_access, state from public.roles`)).rows.length, 1);
        assertEquals((await db.query(`select id, description from public.public_roles`)).rows.length, 1);
        assertEquals(await one(`select launched_at, paused from public.public_studio`), { launched_at: null, paused: false });
      });
    });

    await t.step("000500, once the site reads public_roles, closes roles to anon and leaves public_roles open", async () => {
      await exec(launch[5]!.sql);
      await exec(launch[5]!.sql);
      await asAnon(async () => {
        await assertRejects(() => db.query(`select id from public.roles`), Error, "permission denied");
        assertEquals((await db.query(`select id from public.public_roles`)).rows.length, 1);
      });
    });
  } finally {
    await db.close();
  }
});

// 20260923000200 renames the Scout's row in place on a database that already holds the launch
// roles, so the seed's upsert on name updates it instead of adding Biz Dev beside it
// (docs/specs/carry-over.md).
Deno.test("the Biz Dev rename keeps the Scout's row and adds status and trigger", {
  sanitizeOps: false,
  sanitizeResources: false,
}, async (t) => {
  const RENAME = "20260923000200_rename_biz_dev.sql";
  const exec = (db: PGlite, sql: string) => db.exec(sql.replaceAll(PGCRYPTO_LINE, ""));
  const migrations = await readMigrations();
  const rename = migrations.find((m) => m.name === RENAME);
  assert(rename, `${RENAME} exists`);
  const before = migrations.filter((m) => m.name < RENAME);
  const fresh = async () => {
    const db = new PGlite();
    await db.exec(SHIM);
    for (const m of before) await exec(db, m.sql);
    return db;
  };
  const role = (name: string, prompt: string) =>
    `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path) values ('${name}', '${name}', 'A slim teal creature.', 'model-id', 0.025, 'curious', '${prompt}') returning id`;

  await t.step("the Scout's row becomes Biz Dev in place, once, and a second run changes nothing", async () => {
    const db = await fresh();
    try {
      const scout = (await db.query<{ id: string }>(role("Scout", "platform/agents/prompts/scout.md"))).rows[0]!.id;
      await exec(db, rename.sql);
      await exec(db, rename.sql);
      const rows = (await db.query<Row>(`select id, name, title, prompt_path, state, status, trigger from public.roles order by name`)).rows;
      assertEquals(rows, [{ id: scout, name: "Biz Dev", title: "Biz Dev", prompt_path: "platform/agents/prompts/biz-dev.md", state: "active", status: null, trigger: null }]);
      // What the seed then writes on the same row.
      await db.query(`update public.roles set status = 'starts', trigger = 'Starts last, once every other role is built.' where name = 'Biz Dev'`);
      await db.exec(`set role anon`);
      try {
        assertEquals(
          (await db.query<Row>(`select name, status, trigger from public.public_roles`)).rows,
          [{ name: "Biz Dev", status: "starts", trigger: "Starts last, once every other role is built." }],
        );
      } finally {
        await db.exec(`reset role`);
      }
      await assertRejects(() => db.query(`update public.roles set status = 'busy'`), Error, "roles_status_check");
      await assertRejects(() => db.query(`update public.roles set trigger = 'one' || chr(10) || 'two'`), Error, "roles_trigger_check");
      await assertRejects(() => db.query(`update public.roles set trigger = repeat('a', 201)`), Error, "roles_trigger_check");
    } finally {
      await db.close();
    }
  });

  await t.step("the Scout's planned roadmap card takes the new backlog title; a card past proposed keeps its title", async () => {
    const db = await fresh();
    try {
      const card = (title: string, stage: string, horizon: string) =>
        db.query<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, stage, horizon) values ('agents', 'board', 'goal', 'code', 'platform', $1, $2, $3) returning id`,
          [title, stage, horizon],
        );
      const planned = (await card("Scout agent for outside tools and trends", "proposed", "later")).rows[0]!.id;
      await exec(db, rename.sql);
      await exec(db, rename.sql);
      assertEquals((await db.query<Row>(`select title from public.cards where id = $1`, [planned])).rows, [{ title: "Biz Dev agent for outside tools and trends" }]);
      const other = await fresh();
      try {
        const building = (await other.query<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, stage, horizon) values ('agents', 'board', 'goal', 'code', 'platform', 'Scout agent for outside tools and trends', 'funded', 'now') returning id`,
        )).rows[0]!.id;
        await exec(other, rename.sql);
        assertEquals((await other.query<Row>(`select title from public.cards where id = $1`, [building])).rows, [{ title: "Scout agent for outside tools and trends" }]);
      } finally {
        await other.close();
      }
    } finally {
      await db.close();
    }
  });

  await t.step("when the seed wrote Biz Dev first, the Scout's row is retired, not duplicated or deleted", async () => {
    const db = await fresh();
    try {
      await db.query(role("Scout", "platform/agents/prompts/scout.md"));
      await db.query(role("Biz Dev", "platform/agents/prompts/biz-dev.md"));
      await exec(db, rename.sql);
      await exec(db, rename.sql);
      const rows = (await db.query<Row>(`select name, state, retired_at is not null as retired from public.roles order by name`)).rows;
      assertEquals(rows, [
        { name: "Biz Dev", state: "active", retired: false },
        { name: "Scout", state: "retired", retired: true },
      ]);
    } finally {
      await db.close();
    }
  });
});
