// The studio-reports migration on PGlite (docs/specs/studio-reports.md): publish_weekly_report's
// refusals, its one row per week and its null for a week with no ship; the last ended New York week
// across both DST changes; a report's facts on a fixture with a founder-billed card, the board's test
// payment and contributors with names and email-shaped ids, none of which reach the facts;
// site_reports newest first; card_supply over the funding order with cards above, below and between
// the thresholds and a full and a vetoed card left out; the grants; and a second apply. Every
// migration runs in order behind the same Supabase shim as supporter_pages_test.ts.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20260925100000_reports_supply.sql";
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
type Doc = Record<string, unknown>;

async function readMigrations(): Promise<{ name: string; sql: string }[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  return await Promise.all(names.map(async (name) => ({ name, sql: (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "") })));
}

const APPLY10 =
  `select public.apply_contribution(p_stripe_event_id => $1, p_contributor_id => $2, p_display_name => $3, p_amount_usd => $4, p_net_usd => $5, p_studio_pct => 0, p_goal_card_id => $6::uuid, p_stripe_session_id => $7, p_payer_key => null, p_session_created_at => null) as r`;

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
  const migrations = await readMigrations();
  for (const m of migrations) await db.exec(m.sql);
  await db.exec(
    `insert into public.studio_state (id, credit_daily_cap_usd, credit_studio_daily_cap_usd, reserve_pct, incident_cap_usd) values (1, 10000, 10000, 0, 0);
     insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);`,
  );
  const builder = (await row<{ id: string }>(
    `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, write_access, agent_class)
     values ('Builder A', 'Builder A', 'A small creature.', 'model-id', 0.1, 'plain', 'platform/agents/prompts/x.md', true, 'writer') returning id`,
  )).id;
  let created = 0;
  /** A board goal card on now that takes money, a second apart, oldest first. */
  const card = async (title: string, target: number, extra: { stage?: string; vetoed?: boolean } = {}) => {
    created += 1;
    return (await row<{ id: string }>(
      `insert into public.cards (bucket, source, shape, lane, folder, title, intent, funding_target_usd, stage, horizon, executor_role_id, board_vetoed, created_at)
       values ('game', 'board', 'goal', 'config', 'seed-1', $1, 'An intent.', $2, $3::public.card_stage, 'now', $4, $5, timestamptz '2026-09-01T00:00:00Z' + make_interval(secs => $6)) returning id`,
      [title, target, extra.stage ?? "proposed", builder, extra.vetoed ?? false, created],
    )).id;
  };
  const pay = async (key: string, amount: number, goal: string | null, extra: { session?: string; contributor?: string; name?: string } = {}) =>
    (await row<{ r: Row }>(APPLY10, [`evt_${key}`, extra.contributor ?? `contrib_${key}`, extra.name ?? null, amount, amount, goal, extra.session ?? `cs_test_${key}0000000000`])).r;
  const spend = async (cardId: string | null, usd: number, billed = "studio", at?: string) => {
    await db.query(`select public.record_usage($1, $2, 'model-id', 1, 0, 1, $3, $4::public.ledger_billing)`, [cardId, builder, usd, billed]);
    if (at) await rewrite(`update public.ledger set created_at = '${at}' where id = (select id from public.ledger order by created_at desc, id desc limit 1)`);
  };
  /** A fixture write to an append-only table (ledger, supporters), with its guard off for that write alone. */
  const rewrite = async (sql: string) => {
    await db.exec(`alter table public.ledger disable trigger ledger_append_only; alter table public.supporters disable trigger supporters_append_only;`);
    try {
      await db.exec(sql);
    } finally {
      await db.exec(`alter table public.ledger enable trigger ledger_append_only; alter table public.supporters enable trigger supporters_append_only;`);
    }
  };
  /** Ships a card at a given time: live, then its live_at set, since going live stamps now. */
  const ship = async (cardId: string, at: string) => {
    await db.query(`update public.cards set stage = 'live' where id = $1`, [cardId]);
    await db.query(`update public.cards set live_at = $2::timestamptz where id = $1`, [cardId, at]);
  };
  const publish = async (week: string | null) => (await row<{ r: Row | null }>(`select to_jsonb(public.publish_weekly_report($1::date)) as r`, [week])).r;
  const reportCount = async () => Number((await row<{ n: number }>(`select count(*)::int as n from public.studio_reports`)).n);
  return { db, row, rows, as, builder, card, pay, spend, rewrite, ship, publish, reportCount, migrations, close: () => db.close() };
}

// The Monday of a past week the fixtures ship in, and the Tuesday after it.
const WEEK = "2026-09-14";
const IN_WEEK = "2026-09-16T15:00:00Z";

Deno.test("publish_weekly_report publishes an ended week with a ship once, and refuses the rest", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("the migration applies a second time", async () => {
      const m = s.migrations.find((x) => x.name === MIGRATION)!;
      await s.db.exec(m.sql);
    });

    await t.step("a week with no card gone live gets null and no row", async () => {
      assertEquals(await s.publish(WEEK), null);
      assertEquals(await s.reportCount(), 0);
    });

    await t.step("a date that is not a Monday is refused", async () => {
      await assertRejects(() => s.publish("2026-09-15"), Error, "is not a Monday");
    });

    await t.step("the week under way in New York is refused", async () => {
      const monday = (await s.row<{ d: string }>(`select (money.last_ended_week(now()) + 7)::text as d`)).d;
      await assertRejects(() => s.publish(monday), Error, "has not ended");
    });

    const a = await s.card("Shipped card A", 1);
    await s.pay("p1", 1, a);
    await s.ship(a, IN_WEEK);

    await t.step("a week with a ship inserts one row, and a second call changes nothing", async () => {
      const first = await s.publish(WEEK);
      assertEquals(first?.week_start, WEEK);
      assertEquals(((first?.facts as Doc).shipped_count), 1);
      const at = (await s.row<{ t: string }>(`select published_at::text as t from public.studio_reports`)).t;
      const second = await s.publish(WEEK);
      assertEquals(second?.week_start, WEEK);
      assertEquals(await s.reportCount(), 1);
      assertEquals((await s.row<{ t: string }>(`select published_at::text as t from public.studio_reports`)).t, at);
    });

    await t.step("a card shipped just before the week's New York start or at its end belongs to the week beside it", async () => {
      const b = await s.card("Shipped Sunday night", 1);
      // Monday 14 September 00:00 in New York is 04:00 UTC (daylight time).
      await s.ship(b, "2026-09-14T03:59:59Z");
      const facts = (await s.row<{ f: Doc }>(`select money.report_facts('2026-09-07') as f`)).f;
      assertEquals(facts.shipped_count, 1);
      assertEquals(((facts.shipped as Doc[])[0]!).title, "Shipped Sunday night");
      await s.ship(b, "2026-09-21T04:00:00Z");
      assertEquals((await s.row<{ f: Doc }>(`select money.report_facts('2026-09-14') as f`)).f.shipped_count, 1);
      assertEquals((await s.row<{ f: Doc }>(`select money.report_facts('2026-09-21') as f`)).f.shipped_count, 1);
    });

    await t.step("with no argument it takes the last ended week", async () => {
      const last = (await s.row<{ d: string }>(`select money.last_ended_week(now())::text as d`)).d;
      const r = await s.publish(null);
      // The fixtures ship no card in the last ended week, so it gets no row.
      if (last !== WEEK) assertEquals(r, null);
      assertEquals(await s.rows(`select week_start from public.studio_reports where week_start = $1::date and $1::date <> $2::date`, [last, WEEK]), []);
    });
  } finally {
    await s.close();
  }
});

Deno.test("the last ended New York week is right on both sides of each DST change", OPTS, async () => {
  const s = await studio();
  try {
    const last = async (at: string) => (await s.row<{ d: string }>(`select money.last_ended_week($1::timestamptz)::text as d`, [at])).d;
    // Daylight time ends on Sunday 1 November 2026: Monday 2 November 00:00 in New York is 05:00 UTC.
    assertEquals(await last("2026-11-02T04:59:59Z"), "2026-10-19");
    assertEquals(await last("2026-11-02T05:00:00Z"), "2026-10-26");
    // Daylight time starts on Sunday 14 March 2027: Monday 15 March 00:00 in New York is 04:00 UTC.
    assertEquals(await last("2027-03-15T03:59:59Z"), "2027-03-01");
    assertEquals(await last("2027-03-15T04:00:00Z"), "2027-03-08");
    // Any hour of a week gives the Monday before it.
    assertEquals(await last("2026-09-24T12:00:00Z"), "2026-09-14");
    assertEquals(await last("2026-09-21T04:00:00Z"), "2026-09-14");
    assertEquals(await last("2026-09-21T03:59:59Z"), "2026-09-07");
  } finally {
    await s.close();
  }
});

Deno.test("a report's facts hold the public figures and none of the private ones", OPTS, async (t) => {
  const s = await studio();
  try {
    const shipped = await s.card("A plant grows | faster", 3);
    const founder = await s.card("A founder-billed ship", 1);
    const open1 = await s.card("Open one", 1);
    const open2 = await s.card("Open two", 5);
    const open3 = await s.card("Open three", 1.5);
    const open4 = await s.card("Open four", 8);

    // The board's own test payment on the shipped card, then two named contributors with email-shaped ids.
    await s.pay("board", 1, shipped, { session: BOARD_TEST_SESSION, contributor: "board-member@example.org", name: "The Board" });
    await s.pay("p1", 1, shipped, { contributor: "ada.person@example.org", name: "Ada Person" });
    await s.pay("p2", 1.25, shipped, { contributor: "bea.person@example.org", name: "Bea Person" });
    // Twenty-six more supporters on the shipped card, so its list stops at 24 and the count goes on.
    for (let k = 0; k < 26; k += 1) await s.pay(`q${k}`, 0.01, shipped, { contributor: `many${k}@example.org`, name: `Person ${k}` });
    await s.rewrite(`update public.supporters set created_at = '${IN_WEEK}'`);
    // A supporter from before the week.
    await s.pay("old", 0.5, open1, { contributor: "old@example.org", name: "Old Person" });
    await s.rewrite(`update public.supporters set created_at = '2026-09-01T00:00:00Z' where contributor_id = 'old@example.org'`);

    await s.spend(shipped, 0.29, "studio", IN_WEEK);
    await s.spend(shipped, 7.77, "founder", IN_WEEK);
    await s.spend(founder, 4.44, "founder", IN_WEEK);
    await s.spend(open1, 0.1, "studio", "2026-09-01T00:00:00Z");
    await s.ship(shipped, "2026-09-16T12:00:00Z");
    await s.ship(founder, "2026-09-17T12:00:00Z");

    const facts = (await s.publish(WEEK))!.facts as Doc;

    await t.step("each shipped card's title, folder, live time, studio-billed cost and supporters", async () => {
      const cards = facts.shipped as Doc[];
      assertEquals(cards.map((c) => c.title), ["A plant grows | faster", "A founder-billed ship"]);
      assertEquals(Object.keys(cards[0]!).sort(), ["cost_usd", "folder", "id", "live_at", "supporter_count", "supporters", "title"]);
      assertEquals(cards[0]!.folder, "seed-1");
      assert(String(cards[0]!.live_at).startsWith("2026-09-16T12:00:00"), String(cards[0]!.live_at));
      assertEquals(Number(cards[0]!.cost_usd), 0.29);
      assertEquals(Number(cards[1]!.cost_usd), 0);
      const supporters = cards[0]!.supporters as { number: number; founding: boolean }[];
      assertEquals(supporters.length, 24);
      assertEquals(cards[0]!.supporter_count, 28);
      assertEquals(supporters.map((p) => p.number), Array.from({ length: 24 }, (_, i) => i + 1));
      assertEquals(Object.keys(supporters[0]!).sort(), ["founding", "number"]);
      assertEquals(cards[1]!.supporters, []);
      assertEquals(cards[1]!.supporter_count, 0);
    });

    await t.step("the shipped count, the open count equal to the funding order, its first three, the new supporters and the spend", async () => {
      assertEquals(facts.shipped_count, 2);
      const order = (await s.row<{ o: { card_id: string }[] }>(`select funding_order as o from public.public_money`)).o;
      assertEquals(facts.open_count, order.length);
      assertEquals(facts.open_count, 4);
      assertEquals((facts.open_first as Doc[]).map((c) => c.id), order.slice(0, 3).map((o) => o.card_id));
      assertEquals((facts.open_first as Doc[]).map((c) => c.title), ["Open one", "Open two", "Open three"]);
      assertEquals(facts.new_supporters, 28);
      assertEquals(Number(facts.spend_usd), 0.29);
      assert(open4.length > 0 && open2.length > 0 && open3.length > 0);
    });

    await t.step("no per-supporter amount, name, email, contributor id, founder-billed cost or board payment", async () => {
      const text = JSON.stringify(facts);
      for (const secret of ["@example.org", "Person", "The Board", "7.77", "4.44", "12.21", "1.25", "contrib_", "cs_", "evt_", "amount", "net_", "display", "email"]) {
        assert(!text.includes(secret), `${secret} in ${text}`);
      }
      assertEquals(Object.keys(facts).sort(), ["new_supporters", "open_count", "open_first", "shipped", "shipped_count", "spend_usd"]);
    });

    await t.step("site_reports gives the reports newest first, to anon", async () => {
      await s.ship(open4, "2026-09-02T12:00:00Z");
      await s.publish("2026-08-31");
      const doc = await s.as("anon", async () => (await s.row<{ d: Doc }>(`select public.site_reports() as d`)).d);
      assertEquals(Object.keys(doc), ["reports"]);
      const reports = doc.reports as Doc[];
      assertEquals(reports.map((r) => r.week_start), [WEEK, "2026-08-31"]);
      assertEquals(Object.keys(reports[0]!).sort(), ["facts", "published_at", "week_start"]);
      assertEquals((reports[0]!.facts as Doc).shipped_count, 2);
      const one = await s.as("anon", async () => (await s.row<{ d: Doc }>(`select public.site_reports(1) as d`)).d);
      assertEquals((one.reports as Doc[]).length, 1);
    });
  } finally {
    await s.close();
  }
});

Deno.test("card_supply counts the funding order against the floor", OPTS, async (t) => {
  const s = await studio();
  try {
    const supply = async () => (await s.row<{ d: Doc }>(`select public.card_supply() as d`)).d;

    await t.step("the floor's defaults, with nothing open", async () => {
      const d = await supply();
      assertEquals(
        [d.open, d.big, d.small, d.floor_open, d.floor_big, d.floor_small, d.short_open, d.short_big, d.short_small, d.open_cards],
        [0, 0, 0, 6, 1, 1, 6, 1, 1, []],
      );
      assertEquals([Number(d.big_min_usd), Number(d.small_max_usd)], [5, 2]);
    });

    const big = await s.card("Big card", 5);
    const bigger = await s.card("Bigger card", 12);
    const between = await s.card("Between card", 3);
    const small = await s.card("Small card", 1.99);
    const edge = await s.card("Two dollar card", 2);
    const full = await s.card("Full card", 1);
    await s.pay("fill", 1, full);
    const vetoed = await s.card("Vetoed card", 0.5, { vetoed: true });

    await t.step("cards above, below and between the thresholds; a full and a vetoed card are left out", async () => {
      const d = await supply();
      const ids = (d.open_cards as Doc[]).map((c) => c.id);
      assertEquals(ids, [big, bigger, between, small, edge]);
      assert(!ids.includes(full) && !ids.includes(vetoed));
      assertEquals([d.open, d.big, d.small], [5, 2, 1]);
      assertEquals([d.short_open, d.short_big, d.short_small], [1, 0, 0]);
      assertEquals(Object.keys((d.open_cards as Doc[])[0]!).sort(), ["id", "target_usd", "title"]);
      assertEquals(Number((d.open_cards as Doc[])[0]!.target_usd), 5);
      const order = (await s.row<{ o: { card_id: string }[] }>(`select funding_order as o from public.public_money`)).o;
      assertEquals(order.map((o) => o.card_id), ids);
    });

    await t.step("the floor comes from studio_state, and its checks hold", async () => {
      await s.db.exec(`update public.studio_state set card_floor_open = 3, card_floor_big = 3, card_floor_small = 2 where id = 1`);
      const d = await supply();
      assertEquals([d.short_open, d.short_big, d.short_small], [0, 1, 1]);
      await assertRejects(() => s.db.exec(`update public.studio_state set card_floor_open = 51 where id = 1`), Error, "card_floor_open_check");
      await assertRejects(() => s.db.exec(`update public.studio_state set card_big_min_usd = 0 where id = 1`), Error, "card_big_min_usd_check");
    });
  } finally {
    await s.close();
  }
});

Deno.test("grants: the report, the outbox and the supply are private, site_reports is anon's", OPTS, async (t) => {
  const s = await studio();
  try {
    const can = async (role: string, fn: string) => (await s.row<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn])).ok;
    const tableCan = async (role: string, table: string, priv: string) => (await s.row<{ ok: boolean }>(`select has_table_privilege($1, $2, $3) as ok`, [role, table, priv])).ok;

    await t.step("RLS is on for both tables", async () => {
      const rls = await s.rows<{ relname: string; on: boolean }>(`select relname, relrowsecurity as on from pg_class where relname in ('studio_reports', 'outbound_posts') order by 1`);
      assertEquals(rls, [{ relname: "outbound_posts", on: true }, { relname: "studio_reports", on: true }]);
    });

    await t.step("anon and authenticated hold nothing on the tables; the service role selects reports and writes the outbox", async () => {
      for (const role of ["anon", "authenticated"]) {
        for (const table of ["public.studio_reports", "public.outbound_posts"]) {
          for (const priv of ["select", "insert", "update", "delete"]) assertEquals(await tableCan(role, table, priv), false, `${role} ${priv} ${table}`);
        }
      }
      assertEquals(await tableCan("service_role", "public.studio_reports", "select"), true);
      assertEquals(await tableCan("service_role", "public.studio_reports", "insert"), false);
      for (const priv of ["select", "insert", "update"]) assertEquals(await tableCan("service_role", "public.outbound_posts", priv), true);
      assertEquals(await tableCan("service_role", "public.outbound_posts", "delete"), false);
    });

    await t.step("each function's grants, and each is security definer with its search_path", async () => {
      assertEquals(await can("anon", "public.site_reports(integer)"), true);
      assertEquals(await can("anon", "public.publish_weekly_report(date)"), false);
      assertEquals(await can("authenticated", "public.publish_weekly_report(date)"), false);
      assertEquals(await can("service_role", "public.publish_weekly_report(date)"), true);
      assertEquals(await can("anon", "public.card_supply()"), false);
      assertEquals(await can("authenticated", "public.card_supply()"), true);
      assertEquals(await can("service_role", "public.card_supply()"), true);
      for (const fn of ["money.report_facts(date)", "money.last_ended_week(timestamptz)"]) {
        for (const role of ["anon", "authenticated", "service_role"]) assertEquals(await can(role, fn), false, `${role} ${fn}`);
      }
      const defs = await s.rows<{ proname: string; sec: boolean; config: string[] }>(
        `select proname, prosecdef as sec, proconfig as config from pg_proc where proname in ('site_reports', 'publish_weekly_report', 'card_supply', 'report_facts') order by 1`,
      );
      for (const d of defs) assertEquals([d.sec, d.config], [true, ["search_path=public"]], d.proname);
      assertEquals(defs.length, 4);
    });

    await t.step("anon is refused the tables and the private functions", async () => {
      await s.as("anon", async () => {
        for (const sql of [
          `select * from public.studio_reports`,
          `select * from public.outbound_posts`,
          `insert into public.outbound_posts (kind, ref, state) values ('ship', 'x', 'sending')`,
          `select public.publish_weekly_report('2000-01-04')`,
          `select public.card_supply()`,
        ]) {
          await assertRejects(() => s.db.query(sql), Error, "permission denied", sql);
        }
      });
    });

    await t.step("the outbox's primary key refuses a second claim, and its checks hold", async () => {
      await s.db.exec(`insert into public.outbound_posts (kind, ref, state) values ('ship', 'card-1', 'sending')`);
      await assertRejects(() => s.db.exec(`insert into public.outbound_posts (kind, ref, state) values ('ship', 'card-1', 'sending')`), Error, "duplicate key");
      await assertRejects(() => s.db.exec(`insert into public.outbound_posts (kind, ref, state) values ('open', 'card-2', 'sending')`), Error, "check");
      await assertRejects(() => s.db.exec(`insert into public.outbound_posts (kind, ref, state) values ('ship', 'card-3', 'retry')`), Error, "check");
    });

    await t.step("studio_reports refuses a week that does not start on a Monday", async () => {
      await assertRejects(() => s.db.exec(`insert into public.studio_reports (week_start, facts) values ('2026-09-15', '{}')`), Error, "check");
    });

    await t.step("public_studio exposes none of the floor", async () => {
      const cols = (await s.rows<{ c: string }>(`select column_name as c from information_schema.columns where table_name = 'public_studio'`)).map((r) => r.c);
      assert(!cols.some((c) => c.startsWith("card_floor") || c.startsWith("card_big") || c.startsWith("card_small")), cols.join(","));
    });
  } finally {
    await s.close();
  }
});
