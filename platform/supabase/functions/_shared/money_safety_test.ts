// The money-safety migrations on PGlite (docs/specs/money-safety.md), with the
// append-only triggers on throughout: every money path still runs, every
// forbidden change is refused, corrections are new rows, and the ledger
// identity holds after each. The shim is the same as migration_test.ts's.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const MONEY_SAFETY = "20260923";

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
const APPEND_ONLY = ["ledger", "contributions", "credit_purchases", "board_actions", "controller_runs"];

type Row = Record<string, unknown>;

async function readMigrations(): Promise<{ name: string; sql: string }[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  return await Promise.all(names.map(async (name) => ({ name, sql: await Deno.readTextFile(new URL(name, MIGRATIONS_DIR)) })));
}

function helpers(db: PGlite) {
  const row = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T> => {
    const result = await db.query<T>(sql, params);
    assert(result.rows.length > 0, `no row for: ${sql}`);
    return result.rows[0]!;
  };
  const rows = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
  const refuses = async (sql: string, message: string, params: unknown[] = []) => {
    await assertRejects(() => db.query(sql, params), Error, message, `expected "${message}" from: ${sql}`);
  };
  const signInAs = async (email: string | null, aal: "aal1" | "aal2" | null = null) => {
    await db.query(`select set_config('request.jwt.claim.email', $1, false)`, [email ?? ""]);
    const claims = email === null ? "" : JSON.stringify(aal === null ? { email } : { email, aal });
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  };
  const asRole = async <T>(role: string, run: () => Promise<T>): Promise<T> => {
    await db.exec(`set role ${role}`);
    try {
      return await run();
    } finally {
      await db.exec(`reset role`);
    }
  };
  const identity = async () => (await row<{ r: { holds: boolean; lines: { name: string; drift: number; holds: boolean }[] } }>(`select public.ledger_identity() as r`)).r;
  const pool = async () =>
    await row<{ balance_usd: string; reserve_usd: string; incident_reserve_usd: string; held_usd: string }>(
      `select balance_usd, reserve_usd, incident_reserve_usd, held_usd from public.pool where id = 1`,
    );
  return { row, rows, refuses, signInAs, asRole, identity, pool };
}

/** The deployed webhook's call: nine named arguments. */
const APPLY = `select public.apply_contribution(p_stripe_event_id => $1, p_contributor_id => $2, p_display_name => $3, p_amount_usd => $4, p_net_usd => $5, p_studio_pct => $6, p_goal_card_id => null, p_stripe_session_id => $7, p_payer_key => null) as r`;
const REVERSE = `select public.reverse_contribution(p_stripe_event_id => $1, p_stripe_session_id => $2, p_kind => $3::public.contribution_entry, p_kind_total_usd => $4) as r`;

Deno.test("the money tables are append-only, and corrections are new rows", {
  sanitizeOps: false,
  sanitizeResources: false,
}, async (t) => {
  const db = new PGlite();
  const { row, rows, refuses, signInAs, asRole, identity, pool } = helpers(db);
  try {
    await t.step("every migration applies twice in order, and the guard is on every money table", async () => {
      await db.exec(SHIM);
      for (const [index, m] of (await readMigrations()).entries()) {
        await db.exec(m.sql.replaceAll(PGCRYPTO_LINE, ""));
        if (index > 0) await db.exec(m.sql.replaceAll(PGCRYPTO_LINE, ""));
      }
      await db.exec(
        `insert into public.studio_state (id) values (1); insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);
         insert into public.board_members (email, role) values ('${BOARD_EMAIL}', 'board'), ('${MODERATOR_EMAIL}', 'moderator');`,
      );
      const triggers = await rows<{ trigger: string; table: string; enabled: string }>(
        `select t.tgname as trigger, c.relname as table, t.tgenabled as enabled from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where t.tgfoid = 'public.refuse_money_change()'::regprocedure order by 2, 1`,
      );
      assertEquals(
        triggers,
        APPEND_ONLY.flatMap((table) => [
          { trigger: `${table}_append_only`, table, enabled: "O" },
          { trigger: `${table}_no_truncate`, table, enabled: "O" },
        ]).sort((a, b) => a.table.localeCompare(b.table) || a.trigger.localeCompare(b.trigger)),
      );
      const labels = await rows<{ label: string }>(
        `select e.enumlabel as label from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'contribution_entry' order by e.enumsortorder`,
      );
      assertEquals(labels.map((l) => l.label), ["payment", "release", "refund", "dispute", "reinstated", "adjustment"]);
      assertEquals((await identity()).holds, true);
    });

    await t.step("apply_contribution still links an open decision, with the triggers on", async () => {
      await db.exec(`insert into public.decisions (size, title, config_key) values ('small', 'Name the first unit', 'spawn.gatherer.name')`);
      const { r } = await row<{ r: Row }>(APPLY, ["evt_dec", "contrib_dec", "Ada", 2, 1.65, 0, "cs_dec"]);
      assertEquals(r.inserted, true);
      const linked = await row(
        `select c.decision_id = d.id as linked, d.state::text as state, d.contribution_id = c.id as back
         from public.contributions c, public.decisions d where c.stripe_event_id = 'evt_dec'`,
      );
      assertEquals(linked, { linked: true, state: "assigned", back: true });
      assertEquals((await identity()).holds, true);
    });

    await t.step("every forbidden update, delete and truncate on a money table is refused, whoever asks", async () => {
      await db.exec(
        `select public.record_usage(null, null, 'builder-model-id', 1, 0, 1, 0.0100, 'overhead');
         insert into public.credit_purchases (amount_usd, reason, created_by) values (5, 'fixture purchase', 'board@peanutgallery.games');
         insert into public.board_actions (action, actor_email, reason) values ('set_caps', 'board@peanutgallery.games', 'fixture action');
         insert into public.controller_runs (job, started_at, ok) values ('reconcile', now(), true);`,
      );
      const forbidden: [string, string][] = [
        [`update public.contributions set amount_usd = amount_usd + 1 where stripe_event_id = 'evt_dec'`, "contributions is append-only: UPDATE of amount_usd is refused"],
        [`update public.contributions set agents_usd = 0, reserve_usd = 0 where stripe_event_id = 'evt_dec'`, "UPDATE of agents_usd, reserve_usd is refused"],
        [`update public.contributions set decision_id = gen_random_uuid() where stripe_event_id = 'evt_dec'`, "UPDATE of decision_id is refused"],
        [`update public.contributions set display_name = null where stripe_event_id = 'evt_dec'`, "UPDATE of display_name is refused"],
        [`update public.contributions set display_name = 'Someone else' where stripe_event_id = 'evt_dec'`, "UPDATE of display_name is refused"],
        [`delete from public.contributions where stripe_event_id = 'evt_dec'`, "contributions is append-only: DELETE is refused"],
        [`truncate public.contributions cascade`, "is append-only: TRUNCATE is refused"],
        [`update public.ledger set usd = 0`, "ledger is append-only: UPDATE of usd is refused"],
        [`delete from public.ledger`, "ledger is append-only: DELETE is refused"],
        [`truncate public.ledger`, "ledger is append-only: TRUNCATE is refused"],
        [`update public.credit_purchases set amount_usd = 50`, "credit_purchases is append-only: UPDATE of amount_usd is refused"],
        [`delete from public.credit_purchases`, "credit_purchases is append-only: DELETE is refused"],
        [`truncate public.credit_purchases`, "credit_purchases is append-only: TRUNCATE is refused"],
        [`update public.board_actions set reason = 'rewritten'`, "board_actions is append-only: UPDATE of reason is refused"],
        [`delete from public.board_actions`, "board_actions is append-only: DELETE is refused"],
        [`truncate public.board_actions`, "board_actions is append-only: TRUNCATE is refused"],
        [`update public.controller_runs set ok = false`, "controller_runs is append-only: UPDATE of ok is refused"],
        [`delete from public.controller_runs`, "controller_runs is append-only: DELETE is refused"],
        [`truncate public.controller_runs`, "controller_runs is append-only: TRUNCATE is refused"],
      ];
      for (const [sql, message] of forbidden) await refuses(sql, message);
      // The service role writes these tables directly and is refused the same way.
      await asRole("service_role", async () => {
        await refuses(`delete from public.ledger`, "ledger is append-only: DELETE is refused");
        await refuses(`update public.contributions set net_usd = 0 where stripe_event_id = 'evt_dec'`, "UPDATE of net_usd is refused");
        await refuses(`update public.credit_purchases set reason = 'rewritten'`, "UPDATE of reason is refused");
      });
      // An update that changes nothing passes, and so does decision_id set once from null.
      await db.exec(`update public.contributions set amount_usd = amount_usd`);
      const { r } = await row<{ r: Row }>(APPLY, ["evt_nodec", "contrib_nodec", null, 1, 0.66, 0, "cs_nodec"]);
      const id = String(r.contribution_id);
      const decision = (await row<{ id: string }>(`insert into public.decisions (size, title) values ('small', 'A later decision') returning id`)).id;
      await db.query(`update public.contributions set decision_id = $2 where id = $1`, [id, decision]);
      await refuses(`update public.contributions set decision_id = null where id = $1`, "UPDATE of decision_id is refused", [id]);
      assertEquals((await rows(`select 1 from public.ledger`)).length, 1);
      assertEquals((await identity()).holds, true);
    });

    await t.step("a board action keeps its row when the card it names is deleted", async () => {
      const card = (await row<{ id: string }>(
        `insert into public.cards (bucket, source, shape, lane, folder, title, stage) values ('game', 'board', 'goal', 'config', 'seed-1', 'A card to delete', 'proposed') returning id`,
      )).id;
      await db.query(`insert into public.board_actions (action, card_id, actor_email, reason) values ('file_card', $1, 'board@peanutgallery.games', 'filed')`, [card]);
      await refuses(`update public.board_actions set card_id = null where card_id = $1`, "board_actions is append-only", [card]);
      await db.query(`delete from public.cards where id = $1`, [card]);
      assertEquals(await rows(`select card_id, reason from public.board_actions where action = 'file_card'`), [{ card_id: null, reason: "filed" }]);
    });

    await t.step("redact_contribution_name nulls one name with the second factor and records the action without it", async () => {
      const id = (await row<{ id: string }>(`select id from public.contributions where stripe_event_id = 'evt_dec'`)).id;
      for (const [email, aal, message] of [
        [MODERATOR_EMAIL, "aal2", "Board membership is required"],
        [OUTSIDER_EMAIL, "aal2", "Board membership is required"],
        [BOARD_EMAIL, "aal1", "A second factor is required"],
      ] as const) {
        await signInAs(email, aal);
        await refuses(`select public.redact_contribution_name($1, 'privacy request')`, message, [id]);
      }
      await signInAs(BOARD_EMAIL, "aal2");
      await refuses(`select public.redact_contribution_name($1, ' ')`, "A reason is required", [id]);
      await refuses(`select public.redact_contribution_name(gen_random_uuid(), 'privacy request')`, "does not exist");
      assertEquals((await row<{ b: boolean }>(`select public.redact_contribution_name($1, 'privacy request') as b`, [id])).b, true);
      assertEquals((await row(`select display_name from public.contributions where id = $1`, [id])).display_name, null);
      assertEquals((await row<{ b: boolean }>(`select public.redact_contribution_name($1, 'asked again') as b`, [id])).b, false);
      const actions = await rows(`select actor_email, reason, details from public.board_actions where action = 'redact_display_name' order by created_at, reason desc`);
      assertEquals(actions, [
        { actor_email: BOARD_EMAIL, reason: "privacy request", details: { contribution_id: id, nulled: true } },
        { actor_email: BOARD_EMAIL, reason: "asked again", details: { contribution_id: id, nulled: false } },
      ]);
      assert(!JSON.stringify(actions).includes("Ada"), "the name is nowhere in the record");
      // Outside the RPC the flag is off, so a direct null is still refused.
      await row(APPLY, ["evt_named", "contrib_named", "Lin", 1, 0.66, 0, "cs_named"]);
      await refuses(`update public.contributions set display_name = null where stripe_event_id = 'evt_named'`, "UPDATE of display_name is refused");
      await signInAs(null);
      await asRole("anon", () => refuses(`select public.redact_contribution_name($1, 'x')`, "permission denied", [id]));
    });

    await t.step("a won dispute is reinstated exactly and once, and a later refund can still reverse the whole payment", async () => {
      const paid = (await row<{ r: Row }>(APPLY, ["evt_d", "contrib_d", null, 10, 9.41, 0, "cs_d"])).r;
      assertEquals(paid.inserted, true);
      const beforeDispute = await pool();
      const dispute = (await row<{ r: Row }>(REVERSE, ["evt_d_dispute", "cs_d", "dispute", 10])).r;
      assertEquals([dispute.inserted, dispute.reversed_usd], [true, 10]);
      assertEquals((await identity()).holds, true);

      await refuses(`select public.record_dispute_reinstated('not-a-dispute', 'cs_d', 10)`, "p_dispute_id must be a Stripe dispute id");
      await refuses(`select public.record_dispute_reinstated('dp_1', 'cs_d', 0)`, "p_amount_usd must be above zero");
      await refuses(`select public.record_dispute_reinstated('dp_1', 'cs_d', 9.99)`, "Stripe reinstated 9.9900 but 10.0000 is booked as disputed");
      assertEquals((await row<{ r: Row }>(`select public.record_dispute_reinstated('dp_1', 'cs_missing', 10) as r`)).r, { found: false, inserted: false });

      const back = (await row<{ r: Row }>(`select public.record_dispute_reinstated('dp_1', 'cs_d', 10) as r`)).r;
      assertEquals([back.inserted, back.reinstated_usd], [true, 10]);
      const rowsBack = await rows(
        `select entry::text as entry, amount_usd, net_usd, reserve_usd, agents_usd, studio_usd, incident_usd, held_usd, goal_card_id, stripe_event_id
         from public.contributions where parent_id = $1 order by created_at, entry`,
        [paid.contribution_id],
      );
      const disputeRow = rowsBack.find((r) => r.entry === "dispute")!;
      const reinstatedRow = rowsBack.find((r) => r.entry === "reinstated")!;
      for (const column of ["amount_usd", "net_usd", "reserve_usd", "agents_usd", "studio_usd", "incident_usd"]) {
        assertEquals(Number(reinstatedRow[column]), -Number(disputeRow[column]), column);
      }
      assertEquals([reinstatedRow.held_usd, reinstatedRow.goal_card_id, reinstatedRow.stripe_event_id], ["0.0000", null, "dp_1:reinstated"]);
      assertEquals(await pool(), beforeDispute);
      assertEquals((await identity()).holds, true);

      const replay = (await row<{ r: Row }>(`select public.record_dispute_reinstated('dp_1', 'cs_d', 10) as r`)).r;
      assertEquals([replay.inserted, replay.replay], [false, true]);
      const nothing = (await row<{ r: Row }>(`select public.record_dispute_reinstated('dp_2', 'cs_d', 10) as r`)).r;
      assertEquals([nothing.inserted, nothing.reinstated_usd], [false, 0]);
      // The dispute event replayed after the win reverses nothing.
      const again = (await row<{ r: Row }>(REVERSE, ["evt_d_withdrawn", "cs_d", "dispute", 10])).r;
      assertEquals([again.inserted, again.reversed_usd], [false, 0]);
      // A refund after the win reverses all of it, and the payment's columns sum to zero.
      const refund = (await row<{ r: Row }>(REVERSE, ["evt_d_refund", "cs_d", "refund", 10])).r;
      assertEquals([refund.inserted, refund.reversed_usd, refund.fully_reversed], [true, 10, true]);
      assertEquals(
        await row(
          `select sum(amount_usd) as amount, sum(net_usd) as net, sum(reserve_usd) as reserve, sum(agents_usd) as agents, sum(incident_usd) as incident, sum(held_usd) as held
           from public.contributions where id = $1 or parent_id = $1`,
          [paid.contribution_id],
        ),
        { amount: "0.0000", net: "0.0000", reserve: "0.0000", agents: "0.0000", incident: "0.0000", held: "0.0000" },
      );
      assertEquals((await identity()).holds, true);
      for (const role of ["anon", "authenticated"]) {
        await asRole(role, () => refuses(`select public.record_dispute_reinstated('dp_3', 'cs_d', 10)`, "permission denied"));
      }
    });

    await t.step("record_adjustment books a correction with the second factor and the ledger identity still holds", async () => {
      const parent = (await row<{ id: string }>(`select id from public.contributions where stripe_event_id = 'evt_nodec'`)).id;
      const call = `select public.record_adjustment($1, $2, $3, $4, $5, $6) as r`;
      for (const [email, aal, message] of [
        [MODERATOR_EMAIL, "aal2", "Board membership is required"],
        [BOARD_EMAIL, "aal1", "A second factor is required"],
      ] as const) {
        await signInAs(email, aal);
        await refuses(call, message, [parent, -0.33, -0.33, 0, 0, "fee"]);
      }
      await signInAs(BOARD_EMAIL, "aal2");
      await refuses(call, "A reason is required", [parent, -0.33, -0.33, 0, 0, ""]);
      await refuses(call, "net_usd must equal reserve_usd + agents_usd + studio_usd", [parent, -0.33, -0.3, 0, 0, "fee"]);
      await refuses(call, "An adjustment moves some money", [parent, 0, 0, 0, 0, "nothing"]);
      await refuses(call, "at most $10,000", [parent, -10001, -10001, 0, 0, "too much"]);
      await refuses(call, "The payment and every amount are required", [parent, -0.33, null, 0, 0, "fee"]);
      const refundRow = (await row<{ id: string }>(`select id from public.contributions where stripe_event_id = 'evt_d_refund'`)).id;
      await refuses(call, "p_parent_id must name a payment", [refundRow, -0.33, -0.33, 0, 0, "fee"]);

      const before = await pool();
      const fee = (await row<{ r: Row }>(call, [parent, -0.33, -0.33, 0, 0, "Stripe kept the fee on the refunded test payment"])).r;
      assertEquals(await pool(), before, "a studio-share adjustment moves no pool figure");
      const booked = await row(
        `select entry::text as entry, amount_usd, net_usd, studio_usd, agents_usd, reserve_usd, incident_usd, held_usd, parent_id from public.contributions where id = $1`,
        [fee.contribution_id],
      );
      assertEquals(booked, { entry: "adjustment", amount_usd: "0.0000", net_usd: "-0.3300", studio_usd: "-0.3300", agents_usd: "0.0000", reserve_usd: "0.0000", incident_usd: "0.0000", held_usd: "0.0000", parent_id: parent });
      const agents = (await row<{ r: Row }>(call, [parent, 1, 0, 0.9, 0.1, "Agent money booked short"])).r;
      assertEquals([Number(agents.pool_balance_usd) - Number(before.balance_usd), Number(agents.pool_reserve_usd) - Number(before.reserve_usd)].map((n) => n.toFixed(4)), ["0.9000", "0.1000"]);
      assertEquals((await identity()).holds, true);
      assertEquals(
        (await rows(`select reason, details->>'net_usd' as net from public.board_actions where action = 'record_adjustment' order by created_at`)).map((r) => r.net),
        ["-0.3300", "1.0000"],
      );
      await signInAs(null);
    });

    await t.step("ledger_identity reads the three lines in one statement and names the drift", async () => {
      const holding = await identity();
      assertEquals(holding.holds, true);
      assertEquals(holding.lines.map((l) => l.name), ["I1", "I2", "I3"]);
      await db.exec(`update public.pool set balance_usd = balance_usd + 1 where id = 1`);
      const drifting = await identity();
      assertEquals(drifting.holds, false);
      assertEquals(drifting.lines.map((l) => [l.name, Number(l.drift), l.holds]), [["I1", 0, true], ["I2", 1, false], ["I3", 0, true]]);
      await db.exec(`update public.pool set balance_usd = balance_usd - 1 where id = 1`);
      assertEquals((await identity()).holds, true);
    });

    await t.step("peanutgallery_backup has no password yet, reads every table, writes none and runs only ledger_identity", async () => {
      assertEquals(
        await row(
          `select r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolinherit, a.rolpassword is null as no_password, r.rolconfig
           from pg_roles r join pg_authid a on a.oid = r.oid where r.rolname = 'peanutgallery_backup'`,
        ),
        { rolcanlogin: true, rolsuper: false, rolbypassrls: true, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolinherit: true, no_password: true, rolconfig: ["default_transaction_read_only=on"] },
      );
      const tables = await rows<{ table_name: string; can_select: boolean; can_write: boolean }>(
        `select table_name,
                has_table_privilege('peanutgallery_backup', format('public.%I', table_name), 'select') as can_select,
                has_table_privilege('peanutgallery_backup', format('public.%I', table_name), 'insert, update, delete, truncate') as can_write
         from information_schema.tables where table_schema = 'public' order by 1`,
      );
      assert(tables.length > 20);
      for (const t of tables) assertEquals([t.table_name, t.can_select, t.can_write], [t.table_name, true, false]);
      assertEquals((await row(`select has_table_privilege('peanutgallery_backup', 'auth.users', 'select') as ok`)).ok, true);
      const definers = await rows<{ proname: string }>(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef and has_function_privilege('peanutgallery_backup', p.oid, 'execute') order by 1`,
      );
      assertEquals(definers.map((p) => p.proname), ["ledger_identity"]);
      await asRole("peanutgallery_backup", async () => {
        assert((await rows(`select id from public.contributions`)).length > 0, "row level security does not hide rows from the dump");
        assertEquals((await identity()).holds, true);
        await refuses(`insert into public.board_notes (author_email, text) values ('x', 'y')`, "permission denied");
        await refuses(`select public.record_dispute_reinstated('dp_9', 'cs_d', 10)`, "permission denied");
      });
      // A second run of the file keeps a password the board set.
      await db.exec(`alter role peanutgallery_backup with password 'fixture-password'`);
      const file = (await readMigrations()).find((m) => m.name === "20260923000010_backup_role.sql")!;
      await db.exec(file.sql);
      assertEquals((await row(`select rolpassword is not null as kept from pg_authid where rolname = 'peanutgallery_backup'`)).kept, true);
    });

    await t.step("controller_figures and ops_database_size give the jobs their figures, for the service role only", async () => {
      const card = (await row<{ id: string }>(
        `insert into public.cards (bucket, source, shape, lane, folder, title, stage, estimate_usd, funding_target_usd) values ('game', 'board', 'goal', 'config', 'seed-1', 'A funded card', 'funded', 4, 4) returning id`,
      )).id;
      await db.query(`select public.record_usage($1, null, 'builder-model-id', 1, 0, 1, 1.5)`, [card]);
      const figures = (await row<{ f: Record<string, any> }>(`select public.controller_figures() as f`)).f;
      // Ceiling min(1.5 x 4, card_max_usd) less the card's studio spend of 1.50.
      const cardMax = Number((await row<{ m: string }>(`select card_max_usd as m from public.studio_state`)).m);
      assertEquals(figures.funded_cards, { count: 1, remaining_ceilings_usd: Math.max(Math.min(6, cardMax) - 1.5, 0) });
      assertEquals([figures.credit.bought_usd, figures.credit.purchases, figures.credit.overhead_usd, figures.credit.studio_spend_usd], [5, 1, 0.01, 1.5]);
      assertEquals(figures.credit.overhead_since_last_purchase_usd, 0);
      const disputed = figures.families.find((f: Row) => f.session_id === "cs_d");
      assertEquals([disputed.refunded_usd, disputed.disputed_usd, disputed.reinstated_usd, disputed.agent_money_usd], [10, 10, 10, 0]);
      const adjusted = figures.families.find((f: Row) => f.session_id === "cs_nodec");
      assertEquals(adjusted.adjusted_net_usd, 0.67);
      assert(Number((await row<{ n: string }>(`select public.ops_database_size() as n`)).n) > 0);
      for (const role of ["anon", "authenticated"]) {
        await asRole(role, async () => {
          await refuses(`select public.controller_figures()`, "permission denied");
          await refuses(`select public.ops_database_size()`, "permission denied");
          await refuses(`select public.ledger_identity()`, "permission denied");
          await refuses(`select * from public.controller_runs`, "permission denied");
        });
      }
      await asRole("service_role", async () => {
        await db.exec(`insert into public.controller_runs (job, started_at, ok, mismatches, checks, figures) values ('quota', now(), false, 1, '[{"name":"database_size","ok":false}]', '{"database_bytes":1}')`);
        assertEquals((await rows(`select job from public.controller_runs order by created_at`)).length, 2);
      });
      await refuses(`insert into public.controller_runs (job, started_at, ok) values ('other', now(), true)`, "controller_runs_job_check");
    });
  } finally {
    await db.close();
  }
});

// Production applies the three files one at a time onto the live database,
// with the deployed webhook still calling apply_contribution and
// reverse_contribution by name.
Deno.test("the money-safety migrations upgrade a live database in production order", {
  sanitizeOps: false,
  sanitizeResources: false,
}, async (t) => {
  const db = new PGlite();
  const { row, rows, refuses, identity } = helpers(db);
  const exec = (sql: string) => db.exec(sql.replaceAll(PGCRYPTO_LINE, ""));
  try {
    const migrations = await readMigrations();
    const earlier = migrations.filter((m) => m.name < MONEY_SAFETY);
    const files = migrations.filter((m) => m.name.startsWith(MONEY_SAFETY));
    assertEquals(files.map((m) => m.name), ["20260923000000_contribution_entries.sql", "20260923000010_backup_role.sql", "20260923000020_append_only.sql"]);

    await t.step("the schema before holds a payment and a dispute", async () => {
      await db.exec(SHIM);
      for (const m of earlier) await exec(m.sql);
      await db.exec(`insert into public.studio_state (id) values (1); insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);`);
      await row(APPLY, ["evt_up1", "contrib_up", "Grace", 10, 9.41, 20, "cs_up1"]);
      await row(REVERSE, ["evt_up1_dispute", "cs_up1", "dispute", 10]);
    });

    await t.step("each file applies on its own, twice, and the deployed calls keep working with the triggers on", async () => {
      for (const m of files) {
        await exec(m.sql);
        await exec(m.sql);
      }
      await db.exec(`insert into public.decisions (size, title) values ('medium', 'A medium decision')`);
      const paid = (await row<{ r: Row }>(APPLY, ["evt_up2", "contrib_up", null, 10, 9.41, 20, "cs_up2"])).r;
      assertEquals(paid.inserted, true);
      assertEquals((await row(`select decision_id is not null as linked from public.contributions where stripe_event_id = 'evt_up2'`)).linked, true);
      const refund = (await row<{ r: Row }>(REVERSE, ["evt_up2_refund", "cs_up2", "refund", 4])).r;
      assertEquals([refund.inserted, refund.reversed_usd], [true, 4]);
      const reinstated = (await row<{ r: Row }>(`select public.record_dispute_reinstated('dp_up1', 'cs_up1', 10) as r`)).r;
      assertEquals(reinstated.inserted, true);
      assertEquals((await identity()).holds, true);
      assertEquals((await rows(`select 1 from public.contributions`)).length, 5);
      await refuses(`delete from public.contributions where stripe_event_id = 'evt_up1'`, "contributions is append-only: DELETE is refused");
    });
  } finally {
    await db.close();
  }
});
