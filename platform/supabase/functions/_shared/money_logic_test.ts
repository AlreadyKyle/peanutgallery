// The money-logic migration on PGlite (docs/specs/money-logic.md): one test step per acceptance
// criterion. Every migration runs in order behind the same Supabase shim as migration_test.ts,
// with the append-only triggers on. Most steps use a studio with no reserve and no incident
// carve-out, so a payment's credit is its net and the arithmetic reads plainly; the fee steps use
// the default split and the production payment's numbers.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { reconcile } from "../../../ops/jobs/controller.mjs";
import { applyContributionArgs, reverseContributionArgs } from "./handler.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const MONEY_LOGIC = "20260924200000_money_logic.sql";
const BOARD_TEST_SESSION = "cs_live_a1OkB7xDSosjVf25TF8aNhbzy8PoWHrjEpeRGDtUSMaFK0tG0NU5Zl5oOh";
const BOARD_EMAIL = "board@peanutgallery.games";

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
type Alloc = { destination: string; card_id: string | null; amount_usd: number; step: number | null };

async function readMigrations(): Promise<{ name: string; sql: string }[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  return await Promise.all(names.map(async (name) => ({ name, sql: (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "") })));
}

/** The deployed webhook's call: nine named arguments. */
const APPLY9 =
  `select public.apply_contribution(p_stripe_event_id => $1, p_contributor_id => $2, p_display_name => null, p_amount_usd => $3, p_net_usd => $4, p_studio_pct => $5, p_goal_card_id => $6::uuid, p_stripe_session_id => $7, p_payer_key => null) as r`;
/** The webhook's call after money-logic: the session's created time last. */
const APPLY10 =
  `select public.apply_contribution(p_stripe_event_id => $1, p_contributor_id => $2, p_display_name => null, p_amount_usd => $3, p_net_usd => $4, p_studio_pct => $5, p_goal_card_id => $6::uuid, p_stripe_session_id => $7, p_payer_key => null, p_session_created_at => $8::timestamptz) as r`;
const REVERSE = `select public.reverse_contribution($1, $2, $3::public.contribution_entry, $4) as r`;

interface Studio {
  db: PGlite;
  row: <T extends Row = Row>(sql: string, params?: unknown[]) => Promise<T>;
  rows: <T extends Row = Row>(sql: string, params?: unknown[]) => Promise<T[]>;
  refuses: (sql: string, message: string, params?: unknown[]) => Promise<void>;
  signInAs: (email: string | null, aal?: "aal1" | "aal2" | null) => Promise<void>;
  asRole: <T>(role: string, run: () => Promise<T>) => Promise<T>;
  roleId: string;
  /** A card; by default a proposed goal card on now that takes money. */
  card: (title: string, target: number, extra?: Partial<CardSpec>) => Promise<string>;
  /** A payment of amount (net = amount unless given, studio 0%); returns apply_contribution's result. */
  pay: (key: string, amount: number, goal?: string | null, extra?: { net?: number; pct?: number; session?: string; created?: string | null; contributor?: string }) => Promise<Row>;
  reverse: (key: string, session: string, kind: "refund" | "dispute", total: number) => Promise<Row>;
  spend: (card: string | null, usd: number) => Promise<void>;
  sweep: () => Promise<Row>;
  bar: (card: string) => Promise<number>;
  stage: (card: string) => Promise<string>;
  allocations: (payment: string) => Promise<(Alloc & { reason: string })[]>;
  notOnCard: () => Promise<number>;
  /** The ledger identity holds with I1 to I5, and public_money's columns add up. */
  books: () => Promise<void>;
  close: () => Promise<void>;
}

async function studio(opts: { upTo?: string; plain?: boolean; seed?: boolean } = {}): Promise<Studio> {
  const db = new PGlite();
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

  await db.exec(SHIM);
  const migrations = (await readMigrations()).filter((m) => opts.upTo === undefined || m.name < opts.upTo);
  for (const m of migrations) await db.exec(m.sql);

  let roleId = "";
  if (opts.seed !== false) {
    await db.exec(
      `insert into public.studio_state (id, credit_daily_cap_usd, credit_studio_daily_cap_usd) values (1, 10000, 10000);
       insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);
       insert into public.board_members (email, role) values ('${BOARD_EMAIL}', 'board');`,
    );
    if (opts.plain !== false) await db.exec(`update public.studio_state set reserve_pct = 0, incident_cap_usd = 0 where id = 1`);
    roleId = (await row<{ id: string }>(
      `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, write_access) values ('Builder A', 'Builder A', 'A small blue creature.', 'builder-model-id', 0.2, 'plain', 'platform/agents/prompts/builder-a.md', true) returning id`,
    )).id;
  }

  let created = 0;
  const card = async (title: string, target: number, extra: Partial<CardSpec> = {}) => {
    const c = { ...DEFAULT_CARD, ...extra };
    // Cards are created a second apart, oldest first, so "then oldest" is plain to read.
    created += 1;
    return (await row<{ id: string }>(
      `insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, funded_usd, stage, horizon, rank, director_stance, executor_role_id, estimate_usd, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, timestamptz '2026-09-01T00:00:00Z' + make_interval(secs => $15)) returning id`,
      [c.folder === "platform" ? "platform" : "game", c.source, c.shape, c.lane, c.folder, title, target, c.funded, c.stage, c.horizon, c.rank, c.stance, c.executor ? roleId : null, c.estimate, created],
    )).id;
  };
  const pay = async (key: string, amount: number, goal: string | null = null, extra: { net?: number; pct?: number; session?: string; created?: string | null; contributor?: string } = {}) =>
    (await row<{ r: Row }>(APPLY10, [`evt_${key}`, extra.contributor ?? `contrib_${key}`, amount, extra.net ?? amount, extra.pct ?? 0, goal, extra.session ?? `cs_${key}`, extra.created ?? null])).r;
  const reverse = async (key: string, session: string, kind: "refund" | "dispute", total: number) =>
    (await row<{ r: Row }>(REVERSE, [`evt_${key}`, session, kind, total])).r;
  const spend = async (cardId: string | null, usd: number) => {
    await db.query(`select public.record_usage($1, $2, 'builder-model-id', 1, 0, 1, $3)`, [cardId, roleId || null, usd]);
  };
  const sweep = async () => (await row<{ r: Row }>(`select public.waterfall_sweep() as r`)).r;
  const bar = async (id: string) => Number((await row<{ f: string }>(`select funded_usd as f from public.cards where id = $1`, [id])).f);
  const stage = async (id: string) => (await row<{ s: string }>(`select stage::text as s from public.cards where id = $1`, [id])).s;
  const allocations = async (payment: string) =>
    (await rows<{ destination: string; card_id: string | null; amount_usd: string; step: number | null; reason: string }>(
      `select destination::text as destination, card_id, amount_usd, step, reason from public.contribution_allocations where payment_id = $1 order by seq`,
      [payment],
    )).map((a) => ({ destination: a.destination, card_id: a.card_id, amount_usd: Number(a.amount_usd), step: a.step, reason: a.reason }));
  const notOnCard = async () => Number((await row<{ n: string }>(`select money.not_on_card_usd() as n`)).n);
  const books = async () => {
    const identity = (await row<{ r: { holds: boolean; lines: { name: string; holds: boolean; drift: number }[] } }>(`select public.ledger_identity() as r`)).r;
    assertEquals(identity.lines.map((l) => l.name), ["I1", "I2", "I3", "I4", "I5"]);
    assert(identity.holds, `the ledger identity drifts: ${JSON.stringify(identity.lines.filter((l) => !l.holds))}`);
    const m = await row<Record<string, string>>(`select * from public.public_money`);
    const n = (k: string) => Math.round(Number(m[k]) * 10000);
    assertEquals(
      n("received_usd") - n("stripe_fees_usd") - n("refunded_usd") - n("disputed_usd") + n("corrections_usd"),
      n("reserve_usd") + n("studio_usd") + n("incident_usd") + n("held_usd") + n("agent_credit_usd"),
      `public_money adds up: ${JSON.stringify(m)}`,
    );
  };
  return { db, row, rows, refuses, signInAs, asRole, roleId, card, pay, reverse, spend, sweep, bar, stage, allocations, notOnCard, books, close: () => db.close() };
}

interface CardSpec {
  stage: string;
  horizon: string;
  rank: number | null;
  source: string;
  shape: string;
  folder: string;
  lane: string;
  stance: string;
  executor: boolean;
  funded: number;
  estimate: number;
}
const DEFAULT_CARD: CardSpec = {
  stage: "proposed",
  horizon: "now",
  rank: null,
  source: "board",
  shape: "goal",
  folder: "seed-1",
  lane: "config",
  stance: "neutral",
  executor: true,
  funded: 0,
  estimate: 0,
};

const OPTS = { sanitizeOps: false, sanitizeResources: false };
const round4 = (n: number) => Math.round(n * 10000) / 10000;

// ---------------------------------------------------------------------------------------------

Deno.test("migration: production's state upgrades, and a forged drift rolls the whole file back", OPTS, async (t) => {
  await t.step("on production's state of 23 September 2026 it books the test payment apart, numbers nobody and says why the studio is paused", async () => {
    const s = await studio({ upTo: MONEY_LOGIC, seed: false });
    try {
      await s.db.exec(
        `insert into public.studio_state (id, paused, paused_by, paused_at) values (1, true, '${BOARD_EMAIL}', now());
         insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);
         insert into public.cards (bucket, source, shape, lane, folder, title, funding_target_usd, stage) values ('game', 'board', 'goal', 'config', 'seed-1', 'A card with an empty bar', 5, 'proposed');`,
      );
      // The board's own $1.00 at 80/20, net 0.7338: agents 0.5283, incident 0.0264, credit 0.5019.
      const paid = (await s.row<{ r: Row }>(APPLY9, ["evt_board_test", "contrib_board", 1, 0.7338, 20, null, BOARD_TEST_SESSION])).r;
      assertEquals([paid.agents_usd, paid.incident_usd, paid.pool_credit_usd], [0.5283, 0.0264, 0.5019]);
      const file = (await readMigrations()).find((m) => m.name === MONEY_LOGIC)!;
      await s.db.exec(file.sql);
      await s.db.exec(file.sql);
      assertEquals(await s.rows(`select destination::text as destination, card_id, amount_usd, reason from public.contribution_allocations order by seq`), [
        { destination: "board_test", card_id: null, amount_usd: "0.5019", reason: "backfill" },
      ]);
      assertEquals((await s.row<{ n: number }>(`select count(*)::int as n from public.supporters`)).n, 0);
      assertEquals(await s.row(`select pause_reason from public.studio_state`), { pause_reason: "awaiting_credit" });
      assertEquals(await s.row(`select paused, pause_reason from public.public_studio`), { paused: true, pause_reason: "awaiting_credit" });
      const money = await s.row(`select payments, received_usd, board_test_usd, not_on_card_usd, short_usd, funding_order from public.public_money`);
      assertEquals(money, { payments: 0, received_usd: "0.0000", board_test_usd: "0.5019", not_on_card_usd: "0.0000", short_usd: "0.0000", funding_order: [] });
      await s.books();
    } finally {
      await s.close();
    }
  });

  for (const [forgery, message] of [
    [`update public.pool set balance_usd = balance_usd + 1 where id = 1`, "money_logic: the ledger identity does not hold after the migration"],
    [`update public.cards set funded_usd = 1`, "money_logic: these cards' bars differ from their allocations"],
  ] as const) {
    await t.step(`a forged drift rolls it back: ${forgery}`, async () => {
      const s = await studio({ upTo: MONEY_LOGIC });
      try {
        await s.card("A card", 5);
        await s.row(APPLY9, ["evt_forged", "contrib_forged", 2, 2, 0, null, "cs_forged"]);
        await s.db.exec(forgery);
        const file = (await readMigrations()).find((m) => m.name === MONEY_LOGIC)!;
        await assertRejects(() => s.db.exec(file.sql), Error, message);
        // Nothing of the file is left: no table, no column, no schema.
        assertEquals(await s.row(`select to_regclass('public.contribution_allocations') as t`), { t: null });
        assertEquals(await s.rows(`select 1 from information_schema.columns where table_name = 'studio_state' and column_name = 'pause_reason'`), []);
        assertEquals(await s.rows(`select 1 from pg_namespace where nspname = 'money'`), []);
      } finally {
        await s.close();
      }
    });
  }
});

Deno.test("migration: the deployed webhook's nine named arguments and the deployed board's set_paused({p_paused}) still resolve", OPTS, async () => {
  const s = await studio();
  try {
    const r = (await s.row<{ r: Row }>(APPLY9, ["evt_nine", "contrib_nine", 3, 3, 0, null, "cs_nine"])).r;
    assertEquals([r.inserted, r.terms_version, r.pool_credit_usd], [true, null, 3]);
    await s.signInAs(BOARD_EMAIL, "aal2");
    await s.db.query(`select public.set_paused(p_paused => true)`);
    assertEquals(await s.row(`select paused, pause_reason from public.studio_state`), { paused: true, pause_reason: "board" });
    await s.db.query(`select public.set_paused(p_paused => false)`);
    assertEquals(await s.row(`select paused, pause_reason from public.studio_state`), { paused: false, pause_reason: null });
    assertEquals(
      await s.rows(`select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_paused'`),
      [{ args: "p_paused boolean, p_reason text" }],
    );
    await s.books();
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------------------------

Deno.test("the waterfall", OPTS, async (t) => {
  const s = await studio();
  const takes = async (id: string, lane = false) =>
    (await s.row<{ t: boolean }>(`select money.card_takes_money(c, $2) as t from public.cards c where c.id = $1`, [id, lane])).t;
  try {
    await t.step("money.card_takes_money: the one predicate, and funding_order lists exactly its cards in rank order with their room", async () => {
      const no: Record<string, string> = {
        vetoed: await s.card("Vetoed", 5, { stance: "vetoed" }),
        community: await s.card("Community", 5, { source: "community" }),
        "no executor": await s.card("No executor", 5, { executor: false }),
        "platform code, lane closed": await s.card("Site change", 5, { folder: "platform", lane: "code" }),
        full: await s.card("Full", 5, { funded: 5 }),
        "off now": await s.card("Next", 5, { horizon: "next" }),
        "no target": await s.card("No target", 0),
        oneoff: await s.card("Oneoff", 5, { shape: "oneoff" }),
      };
      for (const stage of ["live", "building", "gated", "rejected", "paused"]) no[stage] = await s.card(`A ${stage} card`, 5, { stage });
      for (const [why, id] of Object.entries(no)) assertEquals(await takes(id), false, why);
      assertEquals(await takes(no["platform code, lane closed"]!, true), true, "the platform code lane once open");

      const yes = {
        second: await s.card("Proposed, rank 2", 5, { rank: 2 }),
        first: await s.card("Designing, rank 1", 4, { stage: "designing", rank: 1 }),
        olderUnranked: await s.card("Voted, unranked, older", 3, { stage: "voted" }),
        newerUnranked: await s.card("Funded below its target, unranked, newer", 6, { stage: "funded", funded: 2.5 }),
      };
      for (const [why, id] of Object.entries(yes)) assertEquals(await takes(id), true, why);
      const order = (await s.row<{ funding_order: { position: number; card_id: string; room_usd: number }[] }>(`select funding_order from public.public_money`)).funding_order;
      assertEquals(order, [
        { position: 1, card_id: yes.first, room_usd: 4 },
        { position: 2, card_id: yes.second, room_usd: 5 },
        { position: 3, card_id: yes.olderUnranked, room_usd: 3 },
        { position: 4, card_id: yes.newerUnranked, room_usd: 3.5 },
      ]);
      // Close them for the steps below, and empty the bars set by hand, which no allocation holds (fixture writes).
      await s.db.exec(`update public.cards set funded_usd = 0 where funded_usd <> 0; update public.cards c set director_stance = 'vetoed' where money.card_takes_money(c, true);`);
    });

    await t.step("a payment fills its named card to its target, then funding_order's cards in order, then Not on a card yet", async () => {
      const named = await s.card("Named, rank 3", 5, { rank: 3 });
      const r1 = await s.card("Ranked 1", 4, { rank: 1, stage: "voted" });
      const r2 = await s.card("Ranked 2", 3, { rank: 2 });
      const paid = await s.pay("w1", 15, named);
      assertEquals(paid.allocations, [
        { destination: "card", card_id: named, amount_usd: 5, step: 1 },
        { destination: "card", card_id: r1, amount_usd: 4, step: 2 },
        { destination: "card", card_id: r2, amount_usd: 3, step: 2 },
        { destination: "unassigned", card_id: null, amount_usd: 3, step: 3 },
      ]);
      assertEquals([paid.goal_card_id, paid.goal_stage, paid.goal_funded_usd, paid.not_on_card_usd], [named, "funded", 5, 3]);
      // Each placement is one row, and the rows sum to the credit.
      const sum = (await s.allocations(String(paid.contribution_id))).reduce((t, a) => t + a.amount_usd, 0);
      assertEquals(round4(sum), 15);
      // A proposed or voted card whose bar reaches its target is funded.
      assertEquals([await s.stage(named), await s.stage(r1), await s.stage(r2)], ["funded", "funded", "funded"]);
      assertEquals([await s.bar(named), await s.bar(r1), await s.bar(r2)], [5, 4, 3]);
      await s.books();
    });

    await t.step("a payment naming no card, or a card that takes no money, starts at step 2 and keeps the card it asked for", async () => {
      const open = await s.card("Open", 2, { rank: 1 });
      const none = await s.pay("w2", 1);
      assertEquals(none.allocations, [{ destination: "card", card_id: open, amount_usd: 1, step: 2 }]);
      const full = (await s.row<{ id: string }>(`select id from public.cards where title = 'Named, rank 3'`)).id;
      const asked = await s.pay("w3", 1, full);
      assertEquals([asked.goal_card_id, asked.requested_card_id], [null, full]);
      assertEquals(asked.allocations, [{ destination: "card", card_id: open, amount_usd: 1, step: 2 }]);
      assertEquals(await s.row(`select goal_card_id, requested_card_id = $1 as requested from public.contributions where stripe_event_id = 'evt_w3'`, [full]), { goal_card_id: null, requested: true });
      // A card that does not exist is not kept.
      const ghost = await s.pay("w4", 1, "00000000-0000-4000-8000-000000000000");
      assertEquals([ghost.goal_card_id, ghost.requested_card_id], [null, null]);
      await s.books();
    });

    await t.step("released holds and reinstatements enter at step 1, or step 2 once their card takes no money; adjustments enter at step 2 or unwind", async () => {
      await s.db.exec(`update public.cards c set director_stance = 'vetoed' where money.card_takes_money(c, true)`);
      const next = await s.card("Next in line", 50, { rank: 1 });
      await s.db.exec(`update public.studio_state set credit_daily_cap_usd = 1 where id = 1`);
      const held = await s.card("Named with a hold", 10);
      const p1 = await s.pay("h1", 5, held, { contributor: "contrib_hold" });
      assertEquals([p1.pool_credit_usd, p1.held_usd], [1, 4]);
      const cancelled = await s.card("Named, then cancelled", 10);
      const p2 = await s.pay("h2", 5, cancelled, { contributor: "contrib_hold_2" });
      assertEquals([p2.pool_credit_usd, p2.held_usd], [1, 4]);
      await s.db.exec(`update public.studio_state set credit_daily_cap_usd = 10000 where id = 1`);
      await s.signInAs(BOARD_EMAIL, "aal2");
      await s.db.query(`select public.cancel_card($1, 'Out of scope')`, [cancelled]);
      // Holds end: the named card still takes money; the cancelled one does not.
      await s.db.exec(`alter table public.contributions disable trigger contributions_append_only;
        update public.contributions set hold_until = now() - interval '1 minute' where stripe_event_id in ('evt_h1', 'evt_h2');
        alter table public.contributions enable trigger contributions_append_only;`);
      assertEquals((await s.row<{ r: Row }>(`select public.credit_held_contributions() as r`)).r, { released: 2, released_usd: 8 });
      const release = async (payment: unknown) =>
        (await s.rows<{ card_id: string; step: number }>(
          `select a.card_id, a.step from public.contribution_allocations a join public.contributions r on r.id = a.entry_id where r.entry = 'release' and a.payment_id = $1`,
          [payment],
        ));
      assertEquals(await release(p1.contribution_id), [{ card_id: held, step: 1 }]);
      assertEquals(await release(p2.contribution_id), [{ card_id: next, step: 2 }]);
      assertEquals([await s.bar(held), await s.bar(cancelled)], [5, 0]);

      // A won dispute's reinstatement: step 1 while the card takes money, step 2 after it is cancelled.
      const won = await s.card("Disputed, won", 10);
      const p3 = await s.pay("d1", 3, won);
      await s.reverse("d1_dispute", "cs_d1", "dispute", 3);
      assertEquals(await s.bar(won), 0);
      const back = (await s.row<{ r: Row }>(`select public.record_dispute_reinstated('dp_one', 'cs_d1', 3) as r`)).r;
      assertEquals(back.allocations, [{ destination: "card", card_id: won, amount_usd: 3, step: 1 }]);
      const lost = await s.card("Disputed, then cancelled", 10);
      await s.pay("d2", 3, lost);
      await s.reverse("d2_dispute", "cs_d2", "dispute", 3);
      await s.db.query(`select public.cancel_card($1, 'Out of scope')`, [lost]);
      const moved = (await s.row<{ r: Row }>(`select public.record_dispute_reinstated('dp_two', 'cs_d2', 3) as r`)).r;
      assertEquals(moved.allocations, [{ destination: "card", card_id: next, amount_usd: 3, step: 2 }]);

      // A positive adjustment enters at step 2 even while the payment's card takes money; a negative one unwinds.
      const plus = (await s.row<{ r: Row }>(`select public.record_adjustment($1, 2, 0, 2, 0, 'Agent money booked short') as r`, [p3.contribution_id])).r;
      assertEquals(plus.allocations, [{ destination: "card", card_id: next, amount_usd: 2, step: 2 }]);
      const minus = (await s.row<{ r: Row }>(`select public.record_adjustment($1, -2, 0, -2, 0, 'Booked twice') as r`, [p3.contribution_id])).r;
      assertEquals(minus.allocations, [{ destination: "card", card_id: next, amount_usd: -2 }]);
      await s.signInAs(null);
      await s.books();
    });
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------------------------

Deno.test("spend, refunds and releases", OPTS, async (t) => {
  await t.step("a card's oldest money is spent first: $1 then $2 with $1.50 spent leaves $0 and $1.50 unspent", async () => {
    const s = await studio();
    try {
      const c = await s.card("Spent oldest first", 10);
      const p1 = await s.pay("o1", 1, c);
      const p2 = await s.pay("o2", 2, c);
      await s.spend(c, 1.5);
      const unspent = await s.rows<{ payment_id: string; net: string; unspent: string }>(`select payment_id, net, unspent from money.place_unspent($1) order by first_seq`, [c]);
      assertEquals(unspent, [
        { payment_id: String(p1.contribution_id), net: "1.0000", unspent: "0.0000" },
        { payment_id: String(p2.contribution_id), net: "2.0000", unspent: "1.5000" },
      ]);
      await s.books();
    } finally {
      await s.close();
    }
  });

  await t.step("a refund or dispute unwinds only its payment's allocations, newest first, only unspent money, and the spent rest is a shortfall", async () => {
    const s = await studio();
    try {
      // Pick for me across two cards and Not on a card yet, with some of card A spent.
      const a = await s.card("A", 2, { rank: 1 });
      const b = await s.card("B", 2, { rank: 2 });
      const other = await s.pay("other", 1);
      const pick = await s.pay("pick", 5);
      // A took other's 1 and pick's first 1: other 1 on A; pick 1 on A, 2 on B, 2 unassigned.
      assertEquals(other.allocations, [{ destination: "card", card_id: a, amount_usd: 1, step: 2 }]);
      assertEquals(pick.allocations, [
        { destination: "card", card_id: a, amount_usd: 1, step: 2 },
        { destination: "card", card_id: b, amount_usd: 2, step: 2 },
        { destination: "unassigned", card_id: null, amount_usd: 2, step: 3 },
      ]);
      await s.spend(a, 1.5); // other's 1 first, then 0.5 of pick's 1
      const before = await s.notOnCard();
      const refund = await s.reverse("pick_refund", "cs_pick", "refund", 5);
      // Newest place first: Not on a card yet 2, then B 2, then A's unspent 0.5; the spent 0.5 is short.
      assertEquals((refund.unwound as { rows: Omit<Alloc, "step">[] }).rows, [
        { destination: "unassigned", card_id: null, amount_usd: -2 },
        { destination: "card", card_id: b, amount_usd: -2 },
        { destination: "card", card_id: a, amount_usd: -0.5 },
        { destination: "unassigned", card_id: null, amount_usd: -0.5 },
      ]);
      assertEquals([await s.bar(a), await s.bar(b)], [1.5, 0]);
      // The pool loses 5 and the bars give back 2.5, so Not on a card yet loses pick's 2 there and
      // the 0.5 already spent: from 2 to -0.5, a shortfall of 0.5.
      assertEquals([before, await s.notOnCard()], [2, -0.5]);
      assertEquals(refund.shortfall_usd, 0.5);
      assertEquals(Number((await s.row<{ s: string }>(`select short_usd as s from public.public_money`)).s), refund.shortfall_usd);
      await s.books();

      // An overflow payment: the named card to its target, the rest on; a refund takes each back.
      const o = await s.card("Overflow", 1, { rank: 3 });
      const n = await s.card("After it", 10, { rank: 4 });
      const over = await s.pay("over", 3, o);
      // A and B are funded below their targets after the refund, so they take money again (rank 1, 2).
      assertEquals(over.allocations, [
        { destination: "card", card_id: o, amount_usd: 1, step: 1 },
        { destination: "card", card_id: a, amount_usd: 0.5, step: 2 },
        { destination: "card", card_id: b, amount_usd: 1.5, step: 2 },
      ]);
      const bars = async () => [await s.bar(o), await s.bar(a), await s.bar(b), await s.bar(n)];
      const reached = new Map<string, number>();
      for (const x of over.allocations as Alloc[]) if (x.card_id) reached.set(x.card_id, (reached.get(x.card_id) ?? 0) + x.amount_usd);
      const beforeBars = await bars();
      await s.reverse("over_refund", "cs_over", "refund", 3);
      const afterBars = await bars();
      [o, a, b, n].forEach((id, i) => assertEquals(round4(beforeBars[i]! - afterBars[i]!), reached.get(id) ?? 0, `card ${i}`));
      for (const v of afterBars) assert(v >= 0, "no bar below zero");
      await s.books();
    } finally {
      await s.close();
    }
  });

  await t.step("a refund after a release, a cancellation's move and a reinstatement lowers every bar it reached by its unspent money there", async () => {
    const s = await studio();
    try {
      await s.signInAs(BOARD_EMAIL, "aal2");
      // Released: a live card's unspent money moves on with the sweep.
      const shipped = await s.card("Ships under budget", 4);
      const p = await s.pay("rel", 4, shipped);
      await s.spend(shipped, 1);
      await s.db.query(`update public.cards set stage = 'live' where id = $1`, [shipped]);
      const next = await s.card("Next", 10);
      assertEquals((await s.sweep()).released_usd, 3);
      assertEquals([await s.bar(shipped), await s.bar(next)], [1, 3]);
      await s.reverse("rel_refund", "cs_rel", "refund", 4);
      // The moved 3 comes back off Next; the shipped card keeps the 1 it spent.
      assertEquals([await s.bar(shipped), await s.bar(next)], [1, 0]);
      assertEquals((await s.allocations(String(p.contribution_id))).at(-1), { destination: "unassigned", card_id: null, amount_usd: -1, step: null, reason: "unwind" });

      // Moved by a cancellation.
      const doomed = await s.card("Cancelled", 5);
      await s.pay("can", 3, doomed);
      const r = (await s.row<{ r: Row }>(`select public.cancel_card($1, 'Out of scope') as r`, [doomed])).r;
      assertEquals([r.moved_usd, (r.moved_to as Alloc[])[0]!.card_id], [3, next]);
      await s.reverse("can_refund", "cs_can", "refund", 3);
      assertEquals([await s.bar(doomed), await s.bar(next)], [0, 0]);

      // Reinstated, then refunded.
      const back = await s.card("Disputed and won", 5);
      await s.pay("rein", 2, back);
      await s.reverse("rein_dispute", "cs_rein", "dispute", 2);
      await s.row(`select public.record_dispute_reinstated('dp_rein', 'cs_rein', 2)`);
      assertEquals(await s.bar(back), 2);
      await s.reverse("rein_refund", "cs_rein", "refund", 2);
      assertEquals(await s.bar(back), 0);
      for (const { funded_usd } of await s.rows<{ funded_usd: string }>(`select funded_usd from public.cards`)) assert(Number(funded_usd) >= 0);
      await s.signInAs(null);
      await s.books();
    } finally {
      await s.close();
    }
  });

  await t.step("waterfall_sweep releases live and rejected cards' unspent money newest first, promotes, drains oldest first, then rests", async () => {
    const s = await studio();
    try {
      const live = await s.card("Live with spend", 10);
      const p1 = await s.pay("sw1", 3, live);
      const p2 = await s.pay("sw2", 4, live);
      await s.spend(live, 2); // p1 spent 2 of 3
      await s.db.query(`update public.cards set stage = 'live' where id = $1`, [live]);
      const designing = await s.card("Designing, fills", 2, { stage: "designing" });
      await s.pay("sw3", 2, designing);
      assertEquals(await s.stage(designing), "designing");
      await s.db.query(`update public.cards set stage = 'voted' where id = $1`, [designing]);
      // Money that reached no card: q1 (older), then q2.
      const q1 = await s.pay("q1", 1);
      const q2 = await s.pay("q2", 2);
      assertEquals([q1.allocations, q2.allocations].map((a) => (a as Alloc[])[0]!.destination), ["unassigned", "unassigned"]);
      const target = await s.card("Opens later", 6);
      const first = await s.sweep();
      // Released 5 (p2's 4, then p1's 1) onto the new card, the designing card promoted, then 1 drained.
      assertEquals(first, { released_cards: 1, released_usd: 5, promoted: 1, drained_usd: 1 });
      assertEquals(await s.stage(designing), "funded");
      assertEquals([await s.bar(live), await s.bar(target)], [2, 6]);
      const releaseOrder = await s.rows<{ payment_id: string }>(
        `select payment_id from public.contribution_allocations where reason = 'card_release' and amount_usd < 0 and card_id = $1 order by seq`,
        [live],
      );
      assertEquals(releaseOrder.map((x) => x.payment_id), [p2.contribution_id, p1.contribution_id]);
      // The drain takes the oldest payment's money first: q1's 1 fills the last room.
      assertEquals((await s.allocations(String(q1.contribution_id))).map((a) => [a.destination, a.amount_usd, a.reason]), [["unassigned", 1, "credit"], ["unassigned", -1, "drain"], ["card", 1, "drain"]]);
      assertEquals((await s.allocations(String(q2.contribution_id))).length, 1);
      assertEquals(await s.sweep(), { released_cards: 0, released_usd: 0, promoted: 0, drained_usd: 0 });
      await s.books();
    } finally {
      await s.close();
    }
  });

  await t.step("waterfall_sweep releases a card the dispatcher rejected directly: its unspent money moves on at step 2 and its spent money stays on the bar", async () => {
    const s = await studio();
    try {
      const rejected = await s.card("Rejected after a failed gate", 10);
      const p1 = await s.pay("rj1", 1, rejected);
      const p2 = await s.pay("rj2", 3, rejected);
      await s.spend(rejected, 1.5); // p1's 1 spent, then 0.5 of p2's 3
      // The dispatcher rejects a card by writing its stage, never through cancel_card.
      await s.db.query(`update public.cards set stage = 'rejected' where id = $1`, [rejected]);
      const next = await s.card("Next in line", 5);
      assertEquals(await s.sweep(), { released_cards: 1, released_usd: 2.5, promoted: 0, drained_usd: 0 });
      assertEquals(await s.stage(rejected), "rejected");
      assertEquals([await s.bar(rejected), await s.bar(next)], [1.5, 2.5]);
      assertEquals((await s.allocations(String(p1.contribution_id))).map((a) => [a.destination, a.card_id, a.amount_usd, a.step, a.reason]), [
        ["card", rejected, 1, 1, "credit"],
      ]);
      assertEquals((await s.allocations(String(p2.contribution_id))).map((a) => [a.destination, a.card_id, a.amount_usd, a.step, a.reason]), [
        ["card", rejected, 3, 1, "credit"],
        ["card", rejected, -2.5, null, "card_release"],
        ["card", next, 2.5, 2, "card_release"],
      ]);
      assertEquals(await s.sweep(), { released_cards: 0, released_usd: 0, promoted: 0, drained_usd: 0 });
      await s.books();
    } finally {
      await s.close();
    }
  });

  await t.step("cancel_card cancels a card holding money, moves its unspent money to the next cards in line, and refuses building and gated cards", async () => {
    const s = await studio();
    try {
      await s.signInAs(BOARD_EMAIL, "aal2");
      const next = await s.card("Next in line", 100, { rank: 1 });
      for (const stage of ["proposed", "designing", "voted", "funded", "paused"]) {
        const c = await s.card(`A ${stage} card holding money`, 5, { rank: 0 });
        await s.pay(`cc_${stage}`, 2, c);
        await s.spend(c, 0.5);
        await s.db.query(`update public.cards set stage = $2 where id = $1`, [c, stage]);
        const before = await s.bar(next);
        const r = (await s.row<{ r: Row }>(`select public.cancel_card($1, 'Out of scope') as r`, [c])).r;
        assertEquals([r.stage, r.moved_usd], ["rejected", 1.5], stage);
        assertEquals(r.moved_to, [{ destination: "card", card_id: next, amount_usd: 1.5, step: 2 }], stage);
        assertEquals([await s.bar(c), round4((await s.bar(next)) - before)], [0.5, 1.5], stage);
        assertEquals((await s.row<{ d: Row }>(`select details as d from public.board_actions where card_id = $1`, [c])).d.moved_usd, 1.5);
      }
      for (const stage of ["building", "gated"]) {
        const c = await s.card(`A ${stage} card`, 5, { stage });
        await s.refuses(`select public.cancel_card($1, 'Stop')`, "A building or gated card cannot be cancelled", [c]);
      }
      await s.books();
    } finally {
      await s.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------

Deno.test("Not on a card yet, the shortfall and the drain cap", OPTS, async () => {
  const s = await studio();
  try {
    const q = await s.pay("nc1", 5);
    assertEquals(q.not_on_card_usd, 5);
    // The pool less the unspent bars less the board's test money.
    const check = async () => {
      const f = await s.row<{ balance: string; bars: string; test: string }>(
        `select p.balance_usd as balance,
                (select coalesce(sum(greatest(c.funded_usd - money.card_studio_spend(c.id), 0)), 0) from public.cards c) as bars,
                money.board_test_usd() as test
         from public.pool p where p.id = 1`,
      );
      assertEquals(await s.notOnCard(), round4(Number(f.balance) - Number(f.bars) - Number(f.test)));
    };
    await check();
    // Spending past a bar lowers it by the overrun.
    const over = await s.card("Overruns its bar", 1);
    await s.pay("nc2", 1, over);
    await s.spend(over, 3);
    assertEquals(await s.notOnCard(), 3);
    // A directive's spend: a card with no bar.
    const directive = await s.card("A directive", 0, { shape: "oneoff", stage: "funded" });
    await s.spend(directive, 0.5);
    assertEquals(await s.notOnCard(), 2.5);
    // Metering after a release.
    const shipped = await s.card("Ships", 2);
    await s.pay("nc3", 2, shipped);
    await s.db.query(`update public.cards set stage = 'live' where id = $1`, [shipped]);
    await s.db.exec(`update public.cards c set director_stance = 'vetoed' where money.card_takes_money(c, true)`);
    await s.sweep();
    assertEquals([await s.bar(shipped), await s.notOnCard()], [0, 4.5]);
    await s.spend(shipped, 0.25);
    assertEquals(await s.notOnCard(), 4.25);
    await check();

    // The drain cap: Not on a card yet 4.25, less the studio reserve 0.25, less what a building card
    // may still draw beyond its bar (ceiling 1.5 x 2 = 3, bar 2, spent 0: 1), is 3.
    await s.db.exec(`update public.studio_state set studio_reserve_usd = 0.25, card_max_usd = 100 where id = 1`);
    await s.card("Building", 2, { stage: "building", funded: 0, estimate: 2 });
    const building = (await s.row<{ id: string }>(`select id from public.cards where title = 'Building'`)).id;
    // Its bar comes from a real payment, so I5 holds: 2 placed while it was open.
    await s.db.query(`update public.cards set stage = 'proposed' where id = $1`, [building]);
    await s.pay("nc4", 2, building);
    await s.db.query(`update public.cards set stage = 'building' where id = $1`, [building]);
    assertEquals(Number((await s.row<{ d: string }>(`select money.drainable_usd() as d`)).d), 3);
    const fresh = await s.card("Opened after the overrun", 10);
    assertEquals((await s.sweep()).drained_usd, 3);
    assertEquals(await s.bar(fresh), 3);

    // Below zero it is a shortfall, the same figure in reverse_contribution and public_money.
    const spent = await s.card("Spent in full", 4);
    await s.pay("nc5", 4, spent);
    await s.spend(spent, 4);
    const refund = await s.reverse("nc5_refund", "cs_nc5", "refund", 4);
    assert(Number(refund.shortfall_usd) > 0, JSON.stringify(refund));
    assertEquals("earmarked_usd" in refund, false);
    assertEquals(refund.shortfall_usd, round4(-(await s.notOnCard())));
    assertEquals(Number((await s.row<{ s: string }>(`select short_usd as s from public.public_money`)).s), refund.shortfall_usd);
    await s.books();
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------------------------

Deno.test("the fees Stripe keeps", OPTS, async (t) => {
  await t.step("a refund or dispute row's net is the whole amount reversed and the fee comes off the studio share; a reinstatement puts it all back", async () => {
    const s = await studio({ plain: false });
    try {
      // The production payment's numbers: $1.00, net 0.7338, at 80/20.
      await s.pay("fee1", 1, null, { net: 0.7338, pct: 20 });
      const refund = await s.reverse("fee1_refund", "cs_fee1", "refund", 1);
      assertEquals(refund.kept_fee_usd, 0.2662);
      const cols = `amount_usd, net_usd, reserve_usd, agents_usd, studio_usd, incident_usd`;
      const refundRow = await s.row<Record<string, string>>(`select ${cols} from public.contributions where stripe_event_id = 'evt_fee1_refund'`);
      assertEquals(refundRow, { amount_usd: "-1.0000", net_usd: "-1.0000", reserve_usd: "-0.0734", agents_usd: "-0.5283", studio_usd: "-0.3983", incident_usd: "-0.0264" });
      const netSum = (r: Record<string, string>) => round4(Number(r.reserve_usd) + Number(r.agents_usd) + Number(r.studio_usd));
      assertEquals(netSum(refundRow), Number(refundRow.net_usd));
      // A partial refund keeps its share of the fee, and net = reserve + agents + studio still holds.
      await s.pay("fee2", 10, null, { net: 9.41, pct: 20 });
      await s.reverse("fee2_part", "cs_fee2", "refund", 3);
      const part = await s.row<Record<string, string>>(`select ${cols} from public.contributions where stripe_event_id = 'evt_fee2_part'`);
      assertEquals([part.net_usd, netSum(part)], ["-3.0000", -3]);
      // A dispute, then its reinstatement: the row comes back whole, fee part included.
      await s.pay("fee3", 1, null, { net: 0.7338, pct: 20 });
      await s.reverse("fee3_dispute", "cs_fee3", "dispute", 1);
      await s.row(`select public.record_dispute_reinstated('dp_fee3', 'cs_fee3', 1)`);
      const pair = await s.rows<Record<string, string>>(`select entry::text as entry, ${cols} from public.contributions where parent_id = (select id from public.contributions where stripe_event_id = 'evt_fee3') order by entry`);
      const [dispute, reinstated] = [pair.find((r) => r.entry === "dispute")!, pair.find((r) => r.entry === "reinstated")!];
      assertEquals(dispute.net_usd, "-1.0000");
      for (const c of ["amount_usd", "net_usd", "reserve_usd", "agents_usd", "studio_usd", "incident_usd"]) assertEquals(Number(reinstated[c]), -Number(dispute[c]), c);
      await s.books();
    } finally {
      await s.close();
    }
  });

  await t.step("record_stripe_fee books a dispute fee once per balance transaction, a returned fee back, and refuses the rest", async () => {
    const s = await studio();
    try {
      await s.pay("sf", 10);
      const before = await s.row(`select * from public.pool`);
      const fee = (await s.row<{ r: Row }>(`select public.record_stripe_fee('txn_dispute1', 'cs_sf', 15) as r`)).r;
      assertEquals([fee.found, fee.inserted, fee.replay], [true, true, false]);
      assertEquals(await s.row(`select entry::text as entry, amount_usd, net_usd, studio_usd, agents_usd, reserve_usd, stripe_event_id from public.contributions where id = $1`, [fee.contribution_id]), {
        entry: "adjustment", amount_usd: "0.0000", net_usd: "-15.0000", studio_usd: "-15.0000", agents_usd: "0.0000", reserve_usd: "0.0000", stripe_event_id: "txn_dispute1:fee",
      });
      const replay = (await s.row<{ r: Row }>(`select public.record_stripe_fee('txn_dispute1', 'cs_sf', 15) as r`)).r;
      assertEquals([replay.inserted, replay.replay], [false, true]);
      const returned = (await s.row<{ r: Row }>(`select public.record_stripe_fee('txn_won1', 'cs_sf', -15) as r`)).r;
      assertEquals(returned.inserted, true);
      assertEquals(await s.row(`select * from public.pool`), before, "the pool does not move");
      assertEquals((await s.row<{ r: Row }>(`select public.record_stripe_fee('txn_x', 'cs_missing', 1) as r`)).r, { found: false, inserted: false, replay: false });
      await s.refuses(`select public.record_stripe_fee('dp_1', 'cs_sf', 15)`, "p_ref must be a Stripe balance transaction id");
      await s.refuses(`select public.record_stripe_fee('txn_2', 'cs_sf', 0)`, "p_fee_usd must be above zero");
      await s.refuses(`select public.record_stripe_fee('txn_3', 'cs_sf', 100.01)`, "p_fee_usd must be above zero");
      for (const role of ["anon", "authenticated"]) await s.asRole(role, () => s.refuses(`select public.record_stripe_fee('txn_4', 'cs_sf', 1)`, "permission denied"));
      await s.books();
    } finally {
      await s.close();
    }
  });

  await t.step("the Controller's stripe_costs_booked passes on the database's own rows after refunds, a dispute, its fee and the win", async () => {
    const s = await studio({ plain: false });
    try {
      const created = 1789905600;
      const session = (id: string) => ({ id, object: "checkout.session", mode: "payment", status: "complete", payment_status: "paid", amount_total: 1000, currency: "usd", payment_intent: `pi_${id}`, created });
      const charge = (id: string, refunded: number) => ({
        id: `ch_${id}`, object: "charge", amount: 1000, amount_refunded: refunded, currency: "usd", payment_intent: `pi_${id}`, status: "succeeded", created,
        balance_transaction: { id: `txn_${id}`, object: "balance_transaction", type: "charge", amount: 1000, fee: 59, net: 941, currency: "usd", exchange_rate: null },
      });
      await s.pay("cr", 10, null, { net: 9.41, pct: 20, session: "cs_cr" });
      await s.pay("cd", 10, null, { net: 9.41, pct: 20, session: "cs_cd" });
      const run = async (refunded: number, disputes: Row[]) => {
        const figures = (await s.row<{ f: Row }>(`select public.controller_figures() as f`)).f;
        const identity = (await s.row<{ r: Row }>(`select public.ledger_identity() as r`)).r;
        const result = reconcile({
          identity,
          figures,
          stripe: { sessions: [session("cs_cr"), session("cs_cd")], charges: [charge("cs_cr", refunded), charge("cs_cd", 0)], disputes, payouts: [], payoutTransactions: {}, undelivered: [], balance: { available: [{ amount: 100000, currency: "usd" }], pending: [] }, truncated: [] },
          now: new Date("2026-09-23T12:00:00Z"),
        });
        return result;
      };
      const costs = (result: { checks: { name: string; ok: boolean; items: unknown[] }[] }) => result.checks.find((c) => c.name === "stripe_costs_booked")!;
      assertEquals(costs(await run(0, [])).ok, true);
      await s.reverse("cr_part", "cs_cr", "refund", 4);
      assertEquals(costs(await run(400, [])).ok, true, "after a partial refund");
      await s.reverse("cr_full", "cs_cr", "refund", 10);
      assertEquals(costs(await run(1000, [])).ok, true, "after a full refund");

      const withdrawn = { id: "txn_dsp", object: "balance_transaction", type: "adjustment", amount: -1000, fee: 1500, net: -2500, currency: "usd", exchange_rate: null };
      const lost = [{ id: "dp_cd", object: "dispute", amount: 1000, currency: "usd", charge: "ch_cs_cd", payment_intent: "pi_cs_cd", status: "under_review", balance_transactions: [withdrawn] }];
      await s.reverse("cd_dispute", "cs_cd", "dispute", 10);
      const pending = await run(1000, lost);
      assertEquals(pending.fees, [{ ref: "txn_dsp", session_id: "cs_cd", fee_usd: 15 }]);
      assertEquals(costs(pending).ok, false, "the dispute fee is not booked yet");
      for (const fee of pending.fees) await s.row(`select public.record_stripe_fee($1, $2, $3)`, [fee.ref, fee.session_id, fee.fee_usd]);
      assertEquals(costs(await run(1000, lost)).ok, true, "after the dispute and its fee");

      const reinstated = { id: "txn_won", object: "balance_transaction", type: "adjustment", amount: 1000, fee: -1500, net: 2500, currency: "usd", exchange_rate: null };
      const won = [{ ...lost[0], status: "won", balance_transactions: [withdrawn, reinstated] }];
      await s.row(`select public.record_dispute_reinstated('dp_cd', 'cs_cd', 10)`);
      const after = await run(1000, won);
      for (const fee of after.fees) await s.row(`select public.record_stripe_fee($1, $2, $3)`, [fee.ref, fee.session_id, fee.fee_usd]);
      assertEquals(costs(await run(1000, won)).ok, true, "after the win and the returned fee");
      await s.books();
    } finally {
      await s.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------

Deno.test("the terms stamp", OPTS, async () => {
  const s = await studio();
  try {
    const versions = await s.rows<{ version: number; posted_at: Date }>(`select version, posted_at from public.terms_versions order by version`);
    assertEquals(versions.map((v) => v.version), [1, 2, 3]);
    const between = new Date(versions[0]!.posted_at.getTime() + 1000).toISOString();
    const stamp = async (key: string, created: string | null) => (await s.pay(key, 1, null, { created })).terms_version;
    assertEquals(await stamp("t1", between), 1);
    assertEquals(await stamp("t2", new Date(Date.now() + 86_400_000).toISOString()), 3, "a future time counts as now");
    assertEquals(await stamp("t3", null), null, "no time stamps nothing");
    assertEquals(await stamp("t4", "2026-09-01T00:00:00Z"), null, "no version was posted yet");
    assertEquals(await s.rows(`select terms_version from public.contributions where stripe_event_id in ('evt_t1', 'evt_t2', 'evt_t3', 'evt_t4') order by stripe_event_id`), [
      { terms_version: 1 }, { terms_version: 3 }, { terms_version: null }, { terms_version: null },
    ]);
    // No argument lets a caller choose a version.
    const args = (await s.row<{ a: string }>(`select pg_get_function_identity_arguments('public.apply_contribution'::regproc) as a`)).a;
    assert(!/version/.test(args), args);
    // The webhook's own arguments (handler.ts, sent as they are by index.ts) name exactly each RPC's
    // parameters, and its session time stamps the payment.
    const params = async (fn: string) => (await s.row<{ n: string[] }>(`select proargnames as n from pg_proc where oid = $1::regproc`, [fn])).n;
    const parsed = { event_id: "evt_t5", session_id: "cs_t5", amount_total: 100, currency: "usd", studio_pct: 0, display_name: null, contributor_id: "contrib_t5", goal_card_id: null, session_created_at: between };
    const sent = applyContributionArgs(parsed, { amount_usd: 1, fee_usd: 0, net_usd: 1 }, "email:payer_t5");
    assertEquals(Object.keys(sent), await params("public.apply_contribution"));
    const keys = Object.keys(sent);
    const viaWebhook = (await s.row<{ r: Row }>(`select public.apply_contribution(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => sent[k]))).r;
    assertEquals(viaWebhook.terms_version, 1);
    assertEquals(Object.keys(reverseContributionArgs({ event_id: "evt_t5r", session_id: "cs_t5", kind: "refund", kind_total_usd: 1 })), await params("public.reverse_contribution"));
    // Only a payment row carries a stamp.
    await s.refuses(
      `insert into public.contributions (entry, parent_id, rail, contributor_id, terms_version) select 'adjustment', id, 'stripe', 'x', 1 from public.contributions where stripe_event_id = 'evt_t1'`,
      "contributions_terms_version_check",
    );
  } finally {
    await s.close();
  }
});

Deno.test("the board's test payment is kept apart", OPTS, async () => {
  const s = await studio({ plain: false });
  try {
    const paid = await s.pay("board_test", 1, null, { net: 0.7338, pct: 20, session: BOARD_TEST_SESSION });
    assertEquals(paid.allocations, [{ destination: "board_test", card_id: null, amount_usd: 0.5019, step: null }]);
    assertEquals([paid.supporter_number, paid.not_on_card_usd], [null, 0]);
    // Drains, releases and sweeps never move it.
    await s.card("An open card", 10);
    await s.sweep();
    assertEquals(await s.allocations(String(paid.contribution_id)), [{ destination: "board_test", card_id: null, amount_usd: 0.5019, step: null, reason: "credit" }]);
    assertEquals(await s.row(`select payments, received_usd, stripe_fees_usd, agent_credit_usd, board_test_usd from public.public_money`), {
      payments: 0, received_usd: "0.0000", stripe_fees_usd: "0.0000", agent_credit_usd: "0.0000", board_test_usd: "0.5019",
    });
    assertEquals((await s.row<{ n: number }>(`select count(*)::int as n from public.supporters`)).n, 0);
    const families = (await s.row<{ f: { families: Row[] } }>(`select public.controller_figures() as f`)).f.families;
    assertEquals(families.map((f) => [f.session_id, f.board_test]), [[BOARD_TEST_SESSION, true]]);
    assertEquals((await s.row<{ c: boolean }>(`select money.payment_counts($1) as c`, [paid.contribution_id])).c, false);
    // Its refund removes it.
    await s.reverse("board_test_refund", BOARD_TEST_SESSION, "refund", 1);
    assertEquals((await s.allocations(String(paid.contribution_id))).map((a) => a.amount_usd), [0.5019, -0.5019]);
    assertEquals(await s.row(`select board_test_usd, not_on_card_usd from public.public_money`), { board_test_usd: "0.0000", not_on_card_usd: "0.0000" });
    await s.books();
  } finally {
    await s.close();
  }
});

Deno.test("supporter numbers", OPTS, async () => {
  const s = await studio();
  try {
    const a1 = await s.pay("sa1", 1, null, { contributor: "contrib_a" });
    const b = await s.pay("sb", 1, null, { contributor: "contrib_b" });
    const a2 = await s.pay("sa2", 1, null, { contributor: "contrib_a" });
    assertEquals([a1.supporter_number, b.supporter_number, a2.supporter_number], [1, 2, 1]);
    assertEquals([a1.founding, b.founding], [true, true]);
    await s.db.exec(`update public.studio_state set launched_at = now() - interval '1 hour' where id = 1`);
    const late = await s.pay("sc", 1, null, { contributor: "contrib_c", created: new Date().toISOString() });
    const early = await s.pay("sd", 1, null, { contributor: "contrib_d", created: new Date(Date.now() - 2 * 3_600_000).toISOString() });
    assertEquals([late.supporter_number, late.founding], [3, false]);
    assertEquals([early.supporter_number, early.founding], [4, true], "paid before the launch by its session's time");
    assertEquals(await s.rows(`select number, contributor_id, founding from public.supporters order by number`), [
      { number: 1, contributor_id: "contrib_a", founding: true },
      { number: 2, contributor_id: "contrib_b", founding: true },
      { number: 3, contributor_id: "contrib_c", founding: false },
      { number: 4, contributor_id: "contrib_d", founding: true },
    ]);
  } finally {
    await s.close();
  }
});

Deno.test("why the studio is paused", OPTS, async () => {
  const s = await studio();
  try {
    const reason = async () => (await s.row<{ r: string | null }>(`select pause_reason as r from public.studio_state`)).r;
    const shown = async () => (await s.asRole("anon", () => s.row<{ paused: boolean; pause_reason: string | null }>(`select paused, pause_reason from public.public_studio`)));
    await s.signInAs(BOARD_EMAIL, "aal2");
    for (const r of ["awaiting_credit", "spend_limit", "incident", "board"]) {
      await s.db.query(`select public.set_paused(true, $1)`, [r]);
      assertEquals(await reason(), r);
      assertEquals(await shown(), { paused: true, pause_reason: r });
    }
    await s.db.query(`select public.set_paused(true)`);
    assertEquals(await reason(), "board");
    await s.refuses(`select public.set_paused(true, 'bored')`, "The pause reason must be awaiting_credit, spend_limit, incident or board");
    await s.db.query(`select public.set_paused(false)`);
    assertEquals([await reason(), (await shown()).pause_reason], [null, null]);
    // The dispatcher's direct write with no reason is board; resuming clears any reason.
    await s.db.exec(`update public.studio_state set paused = true where id = 1`);
    assertEquals(await reason(), "board");
    await s.db.exec(`update public.studio_state set paused = true, pause_reason = 'spend_limit' where id = 1`);
    assertEquals(await reason(), "spend_limit");
    await s.db.exec(`update public.studio_state set paused = false where id = 1`);
    assertEquals(await reason(), null);
    await s.db.exec(`update public.studio_state set pause_reason = 'incident' where id = 1`);
    assertEquals((await shown()).pause_reason, null, "null while not paused");
    await s.refuses(`update public.studio_state set paused = true, pause_reason = 'bored' where id = 1`, "studio_state_pause_reason_check");
    const columns = (await s.rows<{ c: string }>(`select column_name as c from information_schema.columns where table_name = 'public_studio' order by ordinal_position`)).map((x) => x.c);
    assertEquals(columns, ["launched_at", "paused", "platform_lane_open", "pause_reason"]);
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------------------------

Deno.test("public reads", OPTS, async (t) => {
  await t.step("public_money's columns add up after a payment, a partial refund, a dispute and its win, a Stripe fee row and a board correction", async () => {
    const s = await studio({ plain: false });
    try {
      assertEquals(await s.row(`select reconciled_at, last_run_ok from public.public_money`), { reconciled_at: null, last_run_ok: null });
      const p = await s.pay("m1", 10, null, { net: 9.41, pct: 20 });
      await s.books();
      assertEquals(await s.row(`select payments, received_usd, stripe_fees_usd, studio_pct_avg from public.public_money`), { payments: 1, received_usd: "10.0000", stripe_fees_usd: "0.5900", studio_pct_avg: "20.00" });
      await s.reverse("m1_part", "cs_m1", "refund", 3);
      await s.books();
      await s.pay("m2", 5, null, { net: 4.6, pct: 30 });
      await s.reverse("m2_dispute", "cs_m2", "dispute", 5);
      await s.books();
      await s.row(`select public.record_dispute_reinstated('dp_m2', 'cs_m2', 5)`);
      await s.books();
      await s.row(`select public.record_stripe_fee('txn_m2', 'cs_m2', 15)`);
      await s.books();
      await s.signInAs(BOARD_EMAIL, "aal2");
      await s.row(`select public.record_adjustment($1, 0.5, 0.5, 0, 0, 'A correction')`, [p.contribution_id]);
      await s.books();
      const m = await s.row<Record<string, string>>(`select refunded_usd, disputed_usd, corrections_usd, stripe_fees_usd from public.public_money`);
      // Fees: 0.59 + 0.40 on the payments, 15 on the dispute fee row; the refund and the dispute's own fee parts net out through their rows.
      assertEquals([m.refunded_usd, m.disputed_usd, m.corrections_usd], ["3.0000", "0.0000", "0.5000"]);
      // Reconciliation: the latest reconcile run, and its finish time only when it passed.
      await s.db.exec(`insert into public.controller_runs (job, started_at, finished_at, ok) values ('reconcile', now(), '2026-09-23T10:00:00Z', true)`);
      const ok = await s.row<{ reconciled_at: Date; last_run_ok: boolean }>(`select reconciled_at, last_run_ok from public.public_money`);
      assertEquals([ok.reconciled_at.toISOString(), ok.last_run_ok], ["2026-09-23T10:00:00.000Z", true]);
      await s.db.exec(`insert into public.controller_runs (job, started_at, finished_at, ok, created_at) values ('reconcile', now(), '2026-09-23T11:00:00Z', false, now() + interval '1 second')`);
      assertEquals(await s.row(`select reconciled_at, last_run_ok from public.public_money`), { reconciled_at: null, last_run_ok: false });
    } finally {
      await s.close();
    }
  });

  await t.step("payment_counts, public_card_funding and public_stopped_cards", async () => {
    const s = await studio();
    try {
      const counts = async (payment: unknown) => (await s.row<{ c: boolean }>(`select money.payment_counts($1) as c`, [payment])).c;
      const c = await s.card("Funded by several", 10);
      const a = await s.pay("fa", 2, c, { contributor: "contrib_fa" });
      await s.pay("fa2", 1, c, { contributor: "contrib_fa" });
      const b = await s.pay("fb", 3, c, { contributor: "contrib_fb" });
      const d = await s.pay("fd", 1, c, { contributor: "contrib_fd" });
      const funding = async () => await s.asRole("anon", () => s.row<{ contributors: number; credited_usd: string; on_card_usd: string }>(`select contributors, credited_usd, on_card_usd from public.public_card_funding where card_id = $1`, [c]));
      assertEquals(await funding(), { contributors: 3, credited_usd: "7.0000", on_card_usd: "7.0000" });
      // Fully refunded, fully disputed: no longer counted; reinstated: counted again; partly refunded: still counted.
      await s.reverse("fb_refund", "cs_fb", "refund", 3);
      await s.reverse("fd_dispute", "cs_fd", "dispute", 1);
      assertEquals([await counts(b.contribution_id), await counts(d.contribution_id)], [false, false]);
      assertEquals(await funding(), { contributors: 1, credited_usd: "3.0000", on_card_usd: "3.0000" });
      await s.row(`select public.record_dispute_reinstated('dp_fd', 'cs_fd', 1)`);
      assertEquals(await counts(d.contribution_id), true);
      await s.reverse("fa_part", "cs_fa", "refund", 1);
      assertEquals(await counts(a.contribution_id), true);
      assertEquals(await funding(), { contributors: 2, credited_usd: "3.0000", on_card_usd: "3.0000" });
      // Shipped, with part spent: the sweep releases the rest, and the card keeps its funders and total.
      await s.spend(c, 1);
      await s.db.query(`update public.cards set stage = 'live' where id = $1`, [c]);
      const onward = await s.card("Onward", 10);
      await s.sweep();
      assertEquals(await s.bar(c), 1);
      assertEquals(await funding(), { contributors: 2, credited_usd: "3.0000", on_card_usd: "1.0000" });

      // Stopped cards: a rejected card lists where its money went, and the moves sum to what it released.
      await s.signInAs(BOARD_EMAIL, "aal2");
      await s.db.exec(`update public.cards c set director_stance = 'vetoed' where money.card_takes_money(c, true) and c.id <> '${onward}'`);
      const stop = await s.card("Stopped", 4);
      await s.pay("st", 4, stop);
      await s.spend(stop, 0.5);
      // Onward holds the 2 released above; with a target of 2.5 it has room for 0.5 more.
      await s.db.query(`update public.cards set funding_target_usd = 2.5 where id = $1`, [onward]);
      const r = (await s.row<{ r: Row }>(`select public.cancel_card($1, 'Out of scope') as r`, [stop])).r;
      assertEquals(r.moved_usd, 3.5);
      const paused = await s.card("Paused", 2, { stage: "paused" });
      const stopped = await s.asRole("anon", () => s.rows<Row>(`select * from public.public_stopped_cards order by title`));
      assertEquals(stopped.map((x) => [x.title, x.stage]), [["Paused", "paused"], ["Stopped", "rejected"]]);
      const rejected = stopped.find((x) => x.title === "Stopped")!;
      assertEquals([rejected.failing_check, rejected.spent_usd, rejected.funded_usd, rejected.credited_usd], ["cancelled_by_board", "0.5000", "0.5000", "4.0000"]);
      const moved = rejected.moved as { to_card_id: string | null; to_title: string | null; usd: number }[];
      assertEquals(moved, [
        { to_card_id: null, to_title: null, usd: 3.5 - 0.5 },
        { to_card_id: onward, to_title: "Onward", usd: 0.5 },
      ].sort((x, y) => y.usd - x.usd));
      assertEquals(round4(moved.reduce((t, m) => t + m.usd, 0)), 3.5);
      assertEquals(Object.keys(stopped[0]!), ["card_id", "title", "stage", "failing_check", "spent_usd", "funded_usd", "credited_usd", "moved", "stopped_at"]);
      assert(stopped.some((x) => x.card_id === paused));
      await s.books();
    } finally {
      await s.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------

Deno.test("guards and kernel checks", OPTS, async (t) => {
  const s = await studio();
  try {
    const c = await s.card("A card", 5);
    const p = await s.pay("g1", 2, c);

    await t.step("the three new tables are append-only for every role, and service_role may only read them", async () => {
      for (const [table, where] of [["contribution_allocations", "true"], ["supporters", "true"], ["board_test_payments", "true"]] as const) {
        await s.refuses(`update public.${table} set created_at = now() where ${where}`, `${table} is append-only: UPDATE`);
        await s.refuses(`delete from public.${table} where ${where}`, `${table} is append-only: DELETE is refused`);
        await s.refuses(`truncate public.${table} cascade`, "is append-only: TRUNCATE is refused");
        await s.asRole("service_role", async () => {
          await s.rows(`select * from public.${table}`);
          await s.refuses(`update public.${table} set created_at = now()`, "permission denied");
          await s.refuses(`delete from public.${table}`, "permission denied");
        });
        for (const role of ["anon", "authenticated"]) await s.asRole(role, () => s.refuses(`select * from public.${table}`, "permission denied"));
      }
      await s.asRole("service_role", async () => {
        await s.refuses(`insert into public.board_test_payments (stripe_session_id, reason) values ('cs_x', 'x')`, "permission denied");
        await s.refuses(`insert into public.supporters (number, contributor_id, first_payment_id, founding) values (99, 'x', $1, false)`, "permission denied", [p.contribution_id]);
        await s.refuses(`insert into public.contribution_allocations (payment_id, destination, amount_usd, reason, batch_id) values ($1, 'unassigned', 1, 'credit', gen_random_uuid())`, "permission denied", [p.contribution_id]);
      });
    });

    await t.step("no API role can call a money function: the schema is refused, and only the views' four readers carry EXECUTE", async () => {
      for (const role of ["anon", "authenticated", "service_role"]) {
        await s.asRole(role, async () => {
          await s.refuses(`select money.board_test_usd()`, "permission denied for schema money");
          await s.refuses(`select money.drain_unassigned()`, "permission denied for schema money");
        });
        const executable = await s.rows<{ proname: string }>(
          `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'money' and has_function_privilege($1, p.oid, 'execute') order by 1`,
          [role],
        );
        assertEquals(executable.map((x) => x.proname), ["board_test_usd", "funding_order", "not_on_card_usd", "payment_counts"], role);
        assertEquals((await s.row<{ u: boolean }>(`select has_schema_privilege($1, 'money', 'usage') as u`, [role])).u, false, role);
      }
      const helpers = await s.rows<{ proname: string; prosecdef: boolean; proconfig: string[] }>(
        `select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'money' order by 1`,
      );
      for (const h of helpers) assertEquals([h.proname, h.prosecdef, h.proconfig], [h.proname, true, ["search_path=public"]]);
    });

    await t.step("ledger_identity returns I1 to I5, and a forged allocation row names the lines that drift", async () => {
      await s.books();
      await s.db.query(`insert into public.contribution_allocations (payment_id, destination, card_id, amount_usd, reason, batch_id) values ($1, 'card', $2, 1, 'credit', gen_random_uuid())`, [p.contribution_id, c]);
      const identity = (await s.row<{ r: { holds: boolean; lines: { name: string; drift: number; holds: boolean }[] } }>(`select public.ledger_identity() as r`)).r;
      assertEquals(identity.holds, false);
      assertEquals(identity.lines.map((l) => [l.name, l.drift, l.holds]), [["I1", 0, true], ["I2", 0, true], ["I3", 0, true], ["I4", 1, false], ["I5", 1, false]]);
    });

    await t.step("anon reads every public view, and no public view has a contributor, an email, a name, a session or one payment", async () => {
      await s.asRole("anon", async () => {
        for (const view of ["public_money", "public_card_funding", "public_stopped_cards", "public_studio"]) await s.rows(`select * from public.${view}`);
        for (const call of [`select public.waterfall_sweep()`, `select public.record_stripe_fee('txn_1', 'cs_g1', 1)`, `select public.set_paused(false, 'board')`]) {
          await s.refuses(call, "permission denied");
        }
      });
      const columns = await s.rows<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('public_money', 'public_card_funding', 'public_stopped_cards', 'public_studio')`,
      );
      for (const { table_name, column_name } of columns) {
        // contributors is a count; nothing names or identifies one payer or one payment.
        assert(!/contributor_id|email|display_name|^name$|session|payment_id|number|supporter/.test(column_name), `${table_name}.${column_name}`);
      }
    });
  } finally {
    await s.close();
  }
});
