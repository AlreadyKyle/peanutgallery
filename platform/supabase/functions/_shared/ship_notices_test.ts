// The ship-notices migration on PGlite (docs/specs/ship-notices.md): ship_notices_due lists each
// counting Stripe payment that reached a public card shipped since starts_at, once per (payment, card);
// a claim is taken once, so a second run sends nothing; an unsubscribe leaves out every payment of
// that contributor; the board's test payment, a full refund, a card that is not live, a card shipped
// before starts_at and a hidden card are left out; anon and authenticated can read none of it, and no
// table holds an address. Every migration runs in order behind the Supabase shim, as
// supporter_pages_test.ts runs them.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261011400000_ship_notices.sql";
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const BOARD_TEST_SESSION = "cs_live_a1OkB7xDSosjVf25TF8aNhbzy8PoWHrjEpeRGDtUSMaFK0tG0NU5Zl5oOh";
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

type Row = Record<string, unknown>;

const APPLY10 =
  `select public.apply_contribution(p_stripe_event_id => $1, p_contributor_id => $2, p_display_name => null, p_amount_usd => $3, p_net_usd => $4, p_studio_pct => 0, p_goal_card_id => $5::uuid, p_stripe_session_id => $6, p_payer_key => null, p_session_created_at => null) as r`;
const REVERSE = `select public.reverse_contribution($1, $2, $3::public.contribution_entry, $4) as r`;

async function studio() {
  const db = new PGlite();
  const row = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T> => {
    const result = await db.query<T>(sql, params);
    assert(result.rows.length > 0, `no row for: ${sql}`);
    return result.rows[0]!;
  };
  const rows = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
  const as = async <T>(role: string, run: () => Promise<T>): Promise<T> => {
    await db.exec(`set role ${role}`);
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
  await db.exec(
    `insert into public.studio_state (id, credit_daily_cap_usd, credit_studio_daily_cap_usd, reserve_pct, incident_cap_usd) values (1, 10000, 10000, 0, 0);
     insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);`,
  );
  // Notices start well before the fixtures' ship times, except where a step moves it.
  await db.exec(`update public.ship_notice_settings set starts_at = '2026-01-01T00:00:00Z'`);
  const builder = (await row<{ id: string }>(
    `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, write_access, agent_class)
     values ('Builder A', 'Builder A', 'A small creature.', 'model-id', 0.1, 'plain', 'platform/agents/prompts/x.md', true, 'writer') returning id`,
  )).id;
  let created = 0;
  const card = async (title: string, target: number) => {
    created += 1;
    return (await row<{ id: string }>(
      `insert into public.cards (bucket, source, shape, lane, folder, title, intent, funding_target_usd, stage, horizon, executor_role_id, created_at)
       values ('game', 'board', 'goal', 'config', 'seed-1', $1, 'An intent.', $2, 'proposed', 'now', $3, timestamptz '2026-09-01T00:00:00Z' + make_interval(secs => $4)) returning id`,
      [title, target, builder, created],
    )).id;
  };
  const pay = async (key: string, amount: number, goal: string | null, extra: { session?: string; contributor?: string } = {}) =>
    (await row<{ r: Row }>(APPLY10, [`evt_${key}`, extra.contributor ?? `contrib_${key}`, amount, amount, goal, extra.session ?? `cs_test_${key}0000000000`])).r;
  const paymentId = async (session: string) =>
    (await row<{ id: string }>(`select id from public.contributions where stripe_session_id = $1 and entry = 'payment'`, [session])).id;
  const spend = async (cardId: string, usd: number) => {
    await db.query(`select public.record_usage($1, $2, 'model-id', 1, 0, 1, $3, 'studio'::public.ledger_billing)`, [cardId, builder, usd]);
  };
  const ship = async (cardId: string, at: string) => {
    await db.query(`update public.cards set stage = 'live' where id = $1`, [cardId]);
    await db.query(`update public.cards set live_at = $2::timestamptz where id = $1`, [cardId, at]);
  };
  const due = async () =>
    await as("service_role", () =>
      rows<{ payment_id: string; card_id: string; stripe_session_id: string; card_title: string; card_folder: string; cost_usd: string }>(
        `select * from public.ship_notices_due(50)`,
      ));
  const claim = (payment: string, cardId: string) =>
    as("service_role", async () => (await row<{ ok: boolean }>(`select public.ship_notice_claim($1, $2) as ok`, [payment, cardId])).ok);
  const settle = (payment: string, cardId: string, status: string, provider: string | null = null) =>
    as("service_role", async () => (await row<{ ok: boolean }>(`select public.ship_notice_settle($1, $2, $3, $4) as ok`, [payment, cardId, status, provider])).ok);
  const unsubscribe = (payment: string) =>
    as("service_role", async () => (await row<{ ok: boolean }>(`select public.ship_notice_unsubscribe($1) as ok`, [payment])).ok);
  return { db, row, rows, as, card, pay, paymentId, spend, ship, due, claim, settle, unsubscribe, sqlOf, close: () => db.close() };
}

Deno.test("ship_notices_due lists each counting payment once per shipped card it reached, and a claim sends once", OPTS, async (t) => {
  const s = await studio();
  try {
    const shipped = await s.card("A shipped card", 10);
    const building = await s.card("Still building", 10);
    await s.pay("a", 5, shipped);
    await s.pay("b", 5, shipped);
    await s.pay("c", 5, building);
    await s.spend(shipped, 1.25);
    await s.ship(shipped, "2026-10-01T00:00:00Z");
    const a = await s.paymentId("cs_test_a0000000000");
    const b = await s.paymentId("cs_test_b0000000000");

    await t.step("each payment that reached the shipped card is due, with the card's title, folder and studio spend", async () => {
      const due = await s.due();
      assertEquals(due.map((d) => d.payment_id).sort(), [a, b].sort());
      for (const d of due) {
        assertEquals(d.card_id, shipped);
        assertEquals(d.card_title, "A shipped card");
        assertEquals(d.card_folder, "seed-1");
        assertEquals(Number(d.cost_usd), 1.25);
        assert(d.stripe_session_id.startsWith("cs_test_"));
      }
    });

    await t.step("a claim is taken once: the second claim of the same pair answers false", async () => {
      assertEquals(await s.claim(a, shipped), true);
      assertEquals(await s.claim(a, shipped), false);
      assertEquals((await s.due()).map((d) => d.payment_id), [b]);
    });

    await t.step("a settle moves only a row still at sending, and refuses an unknown status", async () => {
      assertEquals(await s.settle(a, shipped, "sent", "resend-id-1"), true);
      assertEquals(await s.settle(a, shipped, "failed"), false);
      const n = await s.row<{ status: string; provider_id: string }>(`select status, provider_id from public.ship_notices where payment_id = $1`, [a]);
      assertEquals([n.status, n.provider_id], ["sent", "resend-id-1"]);
      await assertRejects(() => s.settle(b, shipped, "sending"));
    });

    await t.step("a claim left at sending is never due again", async () => {
      assertEquals(await s.claim(b, shipped), true);
      assertEquals(await s.due(), []);
    });
  } finally {
    await s.close();
  }
});

Deno.test("an unsubscribe leaves out every payment of that contributor, and only Stripe payments can be named", OPTS, async (t) => {
  const s = await studio();
  try {
    const one = await s.card("Card one", 10);
    const two = await s.card("Card two", 10);
    await s.pay("x1", 5, one, { contributor: "contrib_same" });
    await s.pay("x2", 5, two, { contributor: "contrib_same" });
    await s.pay("y", 5, two);
    await s.ship(one, "2026-10-01T00:00:00Z");
    await s.ship(two, "2026-10-01T00:00:00Z");
    const x1 = await s.paymentId("cs_test_x10000000000");
    const y = await s.paymentId("cs_test_y0000000000");

    await t.step("the unsubscribe from one payment's link leaves out the contributor's other payment too", async () => {
      assertEquals((await s.due()).length, 3);
      assertEquals(await s.unsubscribe(x1), true);
      assertEquals(await s.unsubscribe(x1), true);
      assertEquals((await s.due()).map((d) => d.payment_id), [y]);
      const stored = await s.rows<{ contributor_id: string }>(`select contributor_id from public.notice_unsubscribes`);
      assertEquals(stored.map((r) => r.contributor_id), ["contrib_same"]);
    });

    await t.step("an unknown payment id answers false and records nothing", async () => {
      assertEquals(await s.unsubscribe("00000000-0000-0000-0000-000000000000"), false);
      assertEquals((await s.rows(`select 1 from public.notice_unsubscribes`)).length, 1);
    });
  } finally {
    await s.close();
  }
});

Deno.test("the board's test payment, a full refund, a card shipped before starts_at and a hidden card are left out", OPTS, async (t) => {
  const s = await studio();
  try {
    const shipped = await s.card("Shipped", 10);
    await s.pay("board", 1, shipped, { session: BOARD_TEST_SESSION });
    await s.pay("refunded", 5, shipped);
    await s.pay("kept", 2, shipped);
    await s.db.query(REVERSE, ["evt_refund", "cs_test_refunded0000000000", "refund", 5]);
    await s.ship(shipped, "2026-10-01T00:00:00Z");
    const kept = await s.paymentId("cs_test_kept0000000000");

    await t.step("only the payment that still counts is due", async () => {
      assertEquals((await s.due()).map((d) => d.payment_id), [kept]);
    });

    await t.step("a card that went live before starts_at is not noticed", async () => {
      await s.db.exec(`update public.ship_notice_settings set starts_at = '2026-10-02T00:00:00Z'`);
      assertEquals(await s.due(), []);
      await s.db.exec(`update public.ship_notice_settings set starts_at = '2026-01-01T00:00:00Z'`);
    });

    await t.step("a card the public cannot see is not noticed", async () => {
      // An agent-drafted card needs the board's approval before it is public.
      await s.db.query(`update public.cards set source = 'agent', drafter_role_id = executor_role_id where id = $1`, [shipped]);
      const isPublic = (await s.row<{ p: boolean }>(`select public.card_is_public($1) as p`, [shipped])).p;
      assertEquals(isPublic, false);
      assertEquals(await s.due(), []);
    });
  } finally {
    await s.close();
  }
});

Deno.test("no public role reads the notice tables or calls their functions, and no column holds an address", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("anon and authenticated cannot read the tables or call the functions", async () => {
      for (const role of ["anon", "authenticated"]) {
        for (const table of ["ship_notices", "notice_unsubscribes", "ship_notice_settings"]) {
          await assertRejects(() => s.as(role, () => s.rows(`select * from public.${table}`)), Error, "permission denied", `${role} ${table}`);
        }
        await assertRejects(() => s.as(role, () => s.rows(`select * from public.ship_notices_due(1)`)), Error, "permission denied", role);
        await assertRejects(() => s.as(role, () => s.rows(`select public.ship_notice_unsubscribe(gen_random_uuid())`)), Error, "permission denied", role);
        await assertRejects(() => s.as(role, () => s.rows(`select public.ship_notice_claim(gen_random_uuid(), gen_random_uuid())`)), Error, "permission denied", role);
      }
    });

    await t.step("row level security is on, and no column is named for an email or address", async () => {
      const rls = await s.rows<{ relname: string; relrowsecurity: boolean }>(
        `select relname, relrowsecurity from pg_class where relname in ('ship_notices', 'notice_unsubscribes', 'ship_notice_settings') order by relname`,
      );
      assertEquals(rls.map((r) => r.relrowsecurity), [true, true, true]);
      const columns = await s.rows<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name in ('ship_notices', 'notice_unsubscribes', 'ship_notice_settings')`,
      );
      for (const c of columns) assert(!/mail|address/i.test(c.column_name), c.column_name);
    });

    await t.step("the migration applies a second time without error", async () => {
      await s.db.exec(await s.sqlOf(MIGRATION));
      assertEquals((await s.rows(`select 1 from public.ship_notice_settings`)).length, 1);
    });
  } finally {
    await s.close();
  }
});
