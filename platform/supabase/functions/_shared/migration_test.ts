// Runs migrations/20260914000000_week1_schema.sql on PGlite (Postgres in WASM)
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

const MIGRATION = new URL(
  "../../migrations/20260914000000_week1_schema.sql",
  import.meta.url,
);
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";

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
create publication supabase_realtime;
`;

const BOARD_EMAIL = "board@peanutgallery.games";
const MODERATOR_EMAIL = "mod@peanutgallery.games";
const OUTSIDER_EMAIL = "someone@peanutgallery.games";

type Row = Record<string, unknown>;

Deno.test("week-1 migration on PGlite", {
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

  async function signInAs(email: string | null) {
    await db.query(
      `select set_config('request.jwt.claim.email', $1, false)`,
      [email ?? ""],
    );
  }

  async function pool() {
    return await row<{
      balance_usd: string;
      reserve_usd: string;
      incident_reserve_usd: string;
      daily_spent_usd: string;
      day: string;
    }>(
      `select balance_usd, reserve_usd, incident_reserve_usd, daily_spent_usd, day::text as day from public.pool where id = 1`,
    );
  }

  let goalCardId = "";
  let oneoffCardId = "";
  let roleId = "";

  try {
    await t.step("applies after the Supabase shim", async () => {
      const sql = await Deno.readTextFile(MIGRATION);
      assert(sql.includes(PGCRYPTO_LINE), "migration creates pgcrypto");
      await db.exec(SHIM);
      // gen_random_uuid() is core Postgres; PGlite ships no pgcrypto build.
      await db.exec(sql.replace(PGCRYPTO_LINE, ""));

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
        "public_ledger_totals",
      ]);
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
      "a goal card is funded and an open decision of matching size is assigned",
      async () => {
        const goal = await row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage) values ('platform', 'board', 'goal', 'code', 'platform', 'Week 1: the loop', 100, 'voted') returning id`,
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
        const funded = await row<{ funded_usd: string }>(
          `select funded_usd from public.cards where id = $1`,
          [goalCardId],
        );
        assertEquals(funded.funded_usd, "2.0000");
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
      "the incident carve-out stops at the cap and the rest reaches the pool",
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
        assertEquals(r.pool_credit_usd, 89.99);
        const after = await pool();
        assertEquals(after.incident_reserve_usd, "500.0000");
        assertEquals(
          (Number(after.balance_usd) - Number(before.balance_usd)).toFixed(4),
          "89.9900",
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
      "a board member can heartbeat, pause, resume, file a directive and file a note",
      async () => {
        await db.exec(
          `insert into public.board_members (email, role) values ('${BOARD_EMAIL}', 'board'), ('${MODERATOR_EMAIL}', 'moderator')`,
        );
        await signInAs("Board@PeanutGallery.games");
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
      "a moderator can pause and heartbeat but not file",
      async () => {
        await signInAs(MODERATOR_EMAIL);
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
        await db.exec(`select public.set_paused(true)`);
        assertEquals(
          await row(`select paused, paused_by from public.studio_state`),
          { paused: true, paused_by: MODERATOR_EMAIL },
        );
        await db.exec(`select public.set_paused(false)`);
        await row(`select public.board_heartbeat()`);
      },
    );

    await t.step("an outsider is refused by every board RPC", async () => {
      await signInAs(OUTSIDER_EMAIL);
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
      "anon holds select on the five public tables and the three views and nothing else",
      async () => {
        const expected = [
          "cards",
          "deploys",
          "last_green",
          "ledger",
          "pool",
          "public_agent_events",
          "public_ledger_totals",
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
        await db.exec(`set role anon`);
        try {
          const events = await rows(`select * from public.public_agent_events`);
          assertEquals(events.length, 1);
          const green = await rows(`select * from public.last_green`);
          assertEquals(green.length, 2);
          const cards = await rows(`select id from public.cards`);
          assertEquals(cards.length, 3);
          await refuses(
            `select * from public.agent_events`,
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
      "function privileges: anon none, authenticated the six board RPCs, service_role the nine",
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
          "board_heartbeat",
          "board_role",
          "file_directive",
          "file_note",
          "is_board_member",
          "set_paused",
        ];
        const service = [
          "apply_contribution",
          "founder_credit",
          "record_usage",
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
