// The ledger-figures migration on PGlite (docs/specs/ledger-figures.md): /goals' lifetime total
// leaves out the studio's own test payment as Money in does; Agent spend counts a card the public may
// not read yet and names its part; public_money carries the test payment's shares, so the balances
// equal the money-in figures plus those shares, and reads the reconciliation from a run's books
// checks; a stopped card says how much of what reached it came from other cards. Every migration runs
// in order behind the Supabase shim, with the append-only triggers on, then this one runs again.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261020100000_ledger_figures.sql";
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const OPTS = { sanitizeOps: false, sanitizeResources: false };
// The studio's own test payment's session, the one row of board_test_payments (money-logic).
const TEST_SESSION = "cs_live_a1OkB7xDSosjVf25TF8aNhbzy8PoWHrjEpeRGDtUSMaFK0tG0NU5Zl5oOh";
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

const APPLY =
  `select public.apply_contribution(p_stripe_event_id => $1, p_contributor_id => $2, p_display_name => null, p_amount_usd => $3, p_net_usd => $4, p_studio_pct => 20, p_goal_card_id => $5::uuid, p_stripe_session_id => $6, p_payer_key => null, p_session_created_at => null) as r`;
const REVERSE = `select public.reverse_contribution($1, $2, $3::public.contribution_entry, $4) as r`;

type Row = Record<string, unknown>;

async function studio() {
  const db = new PGlite();
  const row = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T> => {
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
  await db.exec(SHIM);
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  const sqlOf = async (name: string) => (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "");
  for (const name of names) await db.exec(await sqlOf(name));
  // It applies twice, as a retried apply would.
  await db.exec(await sqlOf(MIGRATION));
  // The default split: the 10% reserve and the 5% emergency fund carve-out, as production.
  await db.exec(
    `insert into public.studio_state (id, credit_daily_cap_usd, credit_studio_daily_cap_usd) values (1, 10000, 10000);
     insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);
     insert into public.board_members (email, role) values ('${BOARD_EMAIL}', 'board');`,
  );
  const roleId = (await row<{ id: string }>(
    `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, write_access) values ('Builder A', 'Builder A', 'A small blue creature.', 'builder-model-id', 0.2, 'plain', 'platform/agents/prompts/builder-a.md', true) returning id`,
  )).id;
  let made = 0;
  const card = async (title: string, target: number, extra: { source?: string; horizon?: string } = {}) => {
    made += 1;
    return (await row<{ id: string }>(
      `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage, horizon, executor_role_id, created_at)
       values ('game', $1, 'goal', 'config', 'seed-1', $2, $3, 'proposed', $4, $5, timestamptz '2026-09-01T00:00:00Z' + make_interval(secs => $6)) returning id`,
      [extra.source ?? "board", title, target, extra.horizon ?? "now", roleId, made],
    )).id;
  };
  const pay = async (key: string, amount: number, net: number, goal: string | null = null, session = `cs_${key}`) =>
    (await row<{ r: Row }>(APPLY, [`evt_${key}`, `contrib_${key}`, amount, net, goal, session])).r;
  const reverse = async (key: string, session: string, kind: "refund" | "dispute", total: number) =>
    (await row<{ r: Row }>(REVERSE, [`evt_${key}`, session, kind, total])).r;
  const spend = async (cardId: string | null, usd: number) => {
    await db.query(`select public.record_usage($1, $2, 'builder-model-id', 1, 0, 1, $3)`, [cardId, roleId, usd]);
  };
  const signInBoard = async () => {
    await db.query(`select set_config('request.jwt.claim.email', $1, false)`, [BOARD_EMAIL]);
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ email: BOARD_EMAIL, aal: "aal2" })]);
  };
  const money = async () => await asAnon(() => row<Record<string, string | number | boolean | null>>(`select * from public.public_money`));
  return { db, row, asAnon, card, pay, reverse, spend, signInBoard, money, close: () => db.close() };
}

const cents = (value: unknown) => Math.round(Number(value) * 10000);

Deno.test("ledger figures", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("/goals' lifetime total leaves out the test payment and equals received - refunded - disputed", async () => {
      await s.pay("test", 1, 0.7338, null, TEST_SESSION);
      assertEquals(Number((await s.row<{ c: string }>(`select community.lifetime_cents() as c`)).c), 0);
      await s.pay("a", 10, 9.41);
      await s.pay("b", 5, 4.6);
      await s.reverse("a_part", "cs_a", "refund", 3);
      await s.reverse("b_dispute", "cs_b", "dispute", 5);
      await s.row(`select public.record_dispute_reinstated('dp_b', 'cs_b', 5)`);
      const m = await s.money();
      const lifetime = Number((await s.row<{ c: string }>(`select community.lifetime_cents() as c`)).c);
      assertEquals(lifetime, 1200);
      assertEquals(lifetime * 100, cents(m.received_usd) - cents(m.refunded_usd) - cents(m.disputed_usd));
      const goals = (await s.asAnon(() => s.row<{ g: { lifetimeCents: number } }>(`select public.community_goals() as g`))).g;
      assertEquals(goals.lifetimeCents, 1200);
    });

    await t.step("the balances are the money-in figures plus the test payment's shares, and the pool is credit plus its credit less spend", async () => {
      const m = await s.money();
      const pool = await s.row<Record<string, string>>(`select * from public.pool where id = 1`);
      assertEquals(Number(m.test_paid_usd), 1);
      assert(Number(m.test_reserve_usd) > 0 && Number(m.test_incident_usd) > 0, JSON.stringify(m));
      assertEquals(cents(pool.reserve_usd), cents(m.reserve_usd) + cents(m.test_reserve_usd));
      assertEquals(cents(pool.incident_reserve_usd), cents(m.incident_usd) + cents(m.test_incident_usd));
      const totals = await s.asAnon(() => s.row<Record<string, string>>(`select * from public.public_ledger_totals`));
      assertEquals(cents(pool.balance_usd), cents(m.agent_credit_usd) + cents(m.board_test_usd) - cents(totals.usd_total));
    });

    await t.step("Agent spend counts a card the public may not read yet, names its part, and still reads no hidden card", async () => {
      const open = await s.card("An open card", 2);
      const hidden = await s.card("A draft not approved yet", 0, { source: "agent", horizon: "next" });
      assertEquals((await s.row<{ p: boolean }>(`select public.card_is_public($1) as p`, [hidden])).p, false);
      await s.spend(open, 0.25);
      await s.spend(hidden, 0.2631);
      const totals = await s.asAnon(() => s.row<Record<string, string | number>>(`select * from public.public_ledger_totals`));
      const studioSpend = await s.row<{ u: string }>(`select sum(usd) as u from public.ledger where billed_to = 'studio'`);
      assertEquals(cents(totals.usd_total), cents(studioSpend.u));
      assertEquals(totals.unlisted_usd, "0.2631");
      assertEquals(Object.keys(totals), ["usd_total", "input_tokens", "cached_tokens", "output_tokens", "row_count", "overhead_usd", "unlisted_usd"]);
      // The rows themselves stay hidden from anon.
      const rows = await s.asAnon(() => s.db.query(`select 1 from public.ledger where card_id = $1`, [hidden]));
      assertEquals(rows.rows.length, 0);
      // The pool still equals agent credit plus the test payment's credit less every studio-billed row.
      const m = await s.money();
      const pool = await s.row<Record<string, string>>(`select * from public.pool where id = 1`);
      assertEquals(cents(pool.balance_usd), cents(m.agent_credit_usd) + cents(m.board_test_usd) - cents(totals.usd_total));
      // Unspent on card bars, as the page computes it, is every card's unspent bar.
      const bars = await s.row<{ u: string }>(
        `select coalesce(sum(greatest(c.funded_usd - coalesce((select sum(l.usd) from public.ledger l where l.billed_to = 'studio' and l.card_id = c.id), 0), 0)), 0) as u from public.cards c`,
      );
      assertEquals(cents(pool.balance_usd) - cents(m.board_test_usd) - cents(m.not_on_card_usd) + cents(m.short_usd), cents(bars.u));
    });

    await t.step("public_money keeps its columns in order and adds the test payment's three at the end", async () => {
      const m = await s.money();
      assertEquals(Object.keys(m), [
        "payments", "received_usd", "stripe_fees_usd", "refunded_usd", "disputed_usd", "corrections_usd", "studio_pct_avg",
        "reserve_usd", "studio_usd", "incident_usd", "held_usd", "agent_credit_usd", "not_on_card_usd", "short_usd",
        "board_test_usd", "reconciled_at", "last_run_ok", "funding_order", "test_paid_usd", "test_reserve_usd", "test_incident_usd",
      ]);
    });

    await t.step("the reconciliation reads a run's books checks: minimum_balance alone does not fail it", async () => {
      const read = async () => {
        const m = await s.money();
        return [m.reconciled_at === null ? null : new Date(m.reconciled_at as string).toISOString(), m.last_run_ok];
      };
      assertEquals(await read(), [null, null]);
      const run = async (at: string, ok: boolean, failing: string[]) => {
        const checks = ["ledger_identity", "payments_credited", "minimum_balance", "stripe_lists_complete"].map((name) => ({ name, ok: !failing.includes(name), detail: "", items: [] }));
        await s.db.query(
          `insert into public.controller_runs (job, started_at, finished_at, ok, mismatches, checks, created_at) values ('reconcile', $1, $1, $2, $3, $4::jsonb, $1)`,
          [at, ok, failing.length, JSON.stringify(checks)],
        );
      };
      await run("2026-10-12T16:40:53Z", true, []);
      assertEquals(await read(), ["2026-10-12T16:40:53.000Z", true]);
      await run("2026-10-20T12:40:49Z", false, ["minimum_balance"]);
      assertEquals(await read(), ["2026-10-20T12:40:49.000Z", true]);
      await run("2026-10-21T12:00:00Z", false, ["minimum_balance", "payments_credited"]);
      assertEquals(await read(), ["2026-10-20T12:40:49.000Z", false]);
      // A run with no checks recorded is its own ok.
      await s.db.query(`insert into public.controller_runs (job, started_at, finished_at, ok, created_at) values ('reconcile', $1, $1, true, $1)`, ["2026-10-22T12:00:00Z"]);
      assertEquals(await read(), ["2026-10-22T12:00:00.000Z", true]);
      // A quota run is not a reconciliation.
      await s.db.query(`insert into public.controller_runs (job, started_at, finished_at, ok, created_at) values ('quota', $1, $1, false, $1)`, ["2026-10-23T12:00:00Z"]);
      assertEquals(await read(), ["2026-10-22T12:00:00.000Z", true]);
    });

    await t.step("a stopped card's from_cards_usd is the counted money released to it from another card", async () => {
      await s.signInBoard();
      const first = await s.card("First to stop", 4);
      const second = await s.card("Second to stop", 10);
      // Every other card that takes money is vetoed, so the moves go only between these two.
      await s.db.query(`update public.cards c set director_stance = 'vetoed' where money.card_takes_money(c, true) and c.id not in ($1, $2)`, [first, second]);
      await s.pay("st", 4, 4, first);
      const firstBar = Number((await s.row<{ f: string }>(`select funded_usd as f from public.cards where id = $1`, [first])).f);
      await s.spend(first, 0.5);
      await s.row(`select public.cancel_card($1, 'Out of scope') as r`, [first]);
      const moved = Number((await s.row<{ u: string }>(
        `select coalesce(sum(amount_usd), 0) as u from public.contribution_allocations where reason = 'card_release' and amount_usd > 0 and card_id = $1 and from_card_id = $2`,
        [second, first],
      )).u);
      assert(moved > 0, "the first card's unspent money moved to the second");
      assertEquals(Math.round(moved * 10000), Math.round((firstBar - 0.5) * 10000));
      await s.row(`select public.cancel_card($1, 'Out of scope') as r`, [second]);
      const stopped = await s.asAnon(() => s.db.query<Row>(`select title, from_cards_usd, credited_usd, spent_usd from public.public_stopped_cards where card_id in ($1, $2) order by title`, [first, second]));
      assertEquals(stopped.rows.map((r) => [r.title, Number(r.from_cards_usd)]), [["First to stop", 0], ["Second to stop", moved]]);
      // Per card, what reached it = spent + unspent on its bar + moved on.
      for (const r of stopped.rows) assert(Number(r.credited_usd) >= Number(r.spent_usd), JSON.stringify(r));
    });

  } finally {
    await s.close();
  }
});
