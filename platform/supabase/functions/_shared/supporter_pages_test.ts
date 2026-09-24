// The supporter-pages migration on PGlite (docs/specs/supporter-pages.md): event line keys in both
// tool namings, public_agent_events' appended line_key, supporter credits that follow
// money.payment_counts (a refund after partial spend, a lost dispute, a won one, a hold, the board's
// test payment), count and list parity on every card, the exact keys of thanks_for_session in each
// state, site_card for a live, a building, a rejected, a hidden and an unknown card,
// public_role_stats ignoring founder-billed rows, the site documents' keys, and a second apply.
// Every migration runs in order behind the same Supabase shim as money_logic_test.ts, with the
// append-only triggers on.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20260924600000_supporter_pages.sql";
const SNAPSHOT_KEYS = new URL("../../../site/src/lib/snapshot-keys.json", import.meta.url);
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
type JsonType = "string" | "number" | "boolean" | "object" | "array" | "null";
type KeySpec = Record<string, JsonType | JsonType[]>;

async function readMigrations(): Promise<{ name: string; sql: string }[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  return await Promise.all(names.map(async (name) => ({ name, sql: (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "") })));
}

function jsonType(value: unknown): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as JsonType;
}

/** The webhook's call after money-logic: the session's created time last. */
const APPLY10 =
  `select public.apply_contribution(p_stripe_event_id => $1, p_contributor_id => $2, p_display_name => null, p_amount_usd => $3, p_net_usd => $4, p_studio_pct => 0, p_goal_card_id => $5::uuid, p_stripe_session_id => $6, p_payer_key => null, p_session_created_at => $7::timestamptz) as r`;
const REVERSE = `select public.reverse_contribution($1, $2, $3::public.contribution_entry, $4) as r`;

async function studio() {
  const db = new PGlite();
  const row = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T> => {
    const result = await db.query<T>(sql, params);
    assert(result.rows.length > 0, `no row for: ${sql}`);
    return result.rows[0]!;
  };
  const rows = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
  const asAnon = async <T>(run: () => Promise<T>): Promise<T> => {
    await db.exec(`set role anon`);
    try {
      return await run();
    } finally {
      await db.exec(`reset role`);
    }
  };
  await db.exec(SHIM);
  const migrations = await readMigrations();
  for (const m of migrations) await db.exec(m.sql);
  // No reserve and no incident carve-out, so a payment's credit is its net and the figures read plainly.
  await db.exec(
    `insert into public.studio_state (id, credit_daily_cap_usd, credit_studio_daily_cap_usd, reserve_pct, incident_cap_usd) values (1, 10000, 10000, 0, 0);
     insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);`,
  );
  const role = async (name: string) =>
    (await row<{ id: string }>(
      `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, write_access, agent_class)
       values ($1, $1, 'A small creature.', 'model-id', 0.1, 'plain', 'platform/agents/prompts/x.md', true, 'writer') returning id`,
      [name],
    )).id;
  const builder = await role("Builder A");
  let created = 0;
  /** A board goal card on now that takes money, a second apart, oldest first. */
  const card = async (title: string, target: number, extra: { stage?: string; source?: string; rank?: number | null } = {}) => {
    created += 1;
    return (await row<{ id: string }>(
      `insert into public.cards (bucket, source, shape, lane, folder, title, intent, funding_target_usd, stage, horizon, rank, executor_role_id, created_at)
       values ('game', $1, 'goal', 'config', 'seed-1', $2, 'An intent.', $3, $4::public.card_stage, 'now', $5, $6, timestamptz '2026-09-01T00:00:00Z' + make_interval(secs => $7)) returning id`,
      [extra.source ?? "board", title, target, extra.stage ?? "proposed", extra.rank ?? null, builder, created],
    )).id;
  };
  const pay = async (key: string, amount: number, goal: string | null = null, extra: { session?: string; contributor?: string; created?: string } = {}) =>
    (await row<{ r: Row }>(APPLY10, [`evt_${key}`, extra.contributor ?? `contrib_${key}`, amount, amount, goal, extra.session ?? `cs_test_${key}0000000000`, extra.created ?? null])).r;
  const reverse = async (key: string, session: string, kind: "refund" | "dispute", total: number) =>
    (await row<{ r: Row }>(REVERSE, [`evt_${key}`, session, kind, total])).r;
  const spend = async (cardId: string, usd: number, billed = "studio") => {
    await db.query(`select public.record_usage($1, $2, 'model-id', 1, 0, 1, $3, $4::public.ledger_billing)`, [cardId, builder, usd, billed]);
  };
  const event = async (cardId: string | null, type: string, payload: Row = {}, at?: string) => {
    await db.query(
      `insert into public.agent_events (card_id, role_id, type, payload_json, created_at) values ($1, $2, $3::public.agent_event_type, $4::jsonb, coalesce($5::timestamptz, now()))`,
      [cardId, builder, type, JSON.stringify(payload), at ?? null],
    );
  };
  const supporters = async (cardId: string) =>
    (await rows<{ n: number; f: boolean }>(`select supporter_number as n, founding as f from public.public_card_supporters where card_id = $1 order by 1`, [cardId]))
      .map((r) => r.n);
  const contributors = async (cardId: string) =>
    Number((await rows<{ c: number }>(`select contributors as c from public.public_card_funding where card_id = $1`, [cardId]))[0]?.c ?? 0);
  const thanks = (session: string) => asAnon(async () => (await row<{ d: Doc }>(`select public.thanks_for_session($1) as d`, [session])).d);
  const siteCard = (id: string) => asAnon(async () => (await row<{ d: Doc | null }>(`select public.site_card($1::uuid) as d`, [id])).d);
  const live = () => asAnon(async () => (await row<{ d: Doc }>(`select public.site_live() as d`)).d);
  const cards = () => asAnon(async () => (await row<{ d: Doc }>(`select public.site_cards() as d`)).d);
  return { db, row, rows, asAnon, builder, role, card, pay, reverse, spend, event, supporters, contributors, thanks, siteCard, live, cards, migrations, close: () => db.close() };
}

Deno.test("event_line_key gives every row of the Event lines table in both tool namings, and public_agent_events appends line_key", OPTS, async (t) => {
  const s = await studio();
  try {
    const key = async (type: string, payload: Row) =>
      (await s.row<{ k: string }>(`select public.event_line_key($1::public.agent_event_type, $2::jsonb) as k`, [type, JSON.stringify(payload)])).k;

    await t.step("tool calls as session.ts writes them (Claude Code) and as managed.ts writes them (Managed Agents) give the same key", async () => {
      const cases: [string, string][] = [
        ["Read", "read"], ["read", "read"], ["Grep", "read"], ["grep", "read"], ["Glob", "read"], ["glob", "read"], ["LS", "read"],
        ["Edit", "edited"], ["edit", "edited"], ["Write", "edited"], ["write", "edited"], ["MultiEdit", "edited"], ["NotebookEdit", "edited"],
        ["Bash", "ran"], ["bash", "ran"], ["submit_patch", "submitted"],
        ["WebFetch", "used_tool"], ["TodoWrite", "used_tool"], ["", "used_tool"],
      ];
      for (const [name, want] of cases) {
        assertEquals(await key("tool_call", { tool_use_id: "toolu_1", name, input: { file_path: "/secret/path" } }), want, name);
      }
      assertEquals(await key("tool_call", {}), "used_tool", "no name");
    });

    await t.step("message steps, the fallbacks, and every other type", async () => {
      const steps: [string, string][] = [
        ["smoke_pass", "smoke_passed"], ["requeue", "requeued"], ["infrastructure", "paused_infra"], ["patch_reused", "patch_reused"],
        ["dealt", "dealt"], ["held", "held"], ["ranked", "none"], ["resume_rule", "none"], ["ceiling_top_up", "none"],
      ];
      for (const [step, want] of steps) assertEquals(await key("message", { step, detail: "free text" }), want, step);
      assertEquals(await key("message", { text: "Anything an agent wrote" }), "none");
      const types: [string, string][] = [
        ["start", "started"], ["tool_result", "none"], ["gate_pass", "gate_passed"], ["gate_fail", "gate_failed"],
        ["ship", "shipped"], ["revert", "reverted"], ["error", "stopped"],
      ];
      for (const [type, want] of types) assertEquals(await key(type, { content: "tool output" }), want, type);
      // An unlisted type: the enum holds only the listed ones today, so the function's own else is checked by a new value.
      await s.db.exec(`alter type public.agent_event_type add value if not exists 'future_kind'`);
      assertEquals(await key("future_kind", {}), "other");
    });

    await t.step("the function is immutable and anon may execute it", async () => {
      const fn = await s.row<{ v: string }>(`select provolatile as v from pg_proc where proname = 'event_line_key'`);
      assertEquals(fn.v, "i");
      assertEquals((await s.row<{ ok: boolean }>(`select has_function_privilege('anon', 'public.event_line_key(public.agent_event_type, jsonb)', 'execute') as ok`)).ok, true);
    });

    await t.step("public_agent_events keeps its columns in order, appends line_key, and exposes no payload", async () => {
      const cols = (await s.rows<{ c: string }>(
        `select column_name as c from information_schema.columns where table_schema = 'public' and table_name = 'public_agent_events' order by ordinal_position`,
      )).map((r) => r.c);
      assertEquals(cols, ["id", "card_id", "role_id", "type", "created_at", "line_key"]);
    });

    await t.step("site_live()'s events never carry key none, and hold the newest 20 with a key", async () => {
      const c = await s.card("A card", 1);
      for (let k = 0; k < 30; k += 1) await s.event(c, "tool_result", { content: "output" }, `2026-09-20T00:${String(k).padStart(2, "0")}:00Z`);
      for (let k = 0; k < 22; k += 1) await s.event(c, "tool_call", { name: k % 2 ? "Read" : "read" }, `2026-09-19T00:${String(k).padStart(2, "0")}:00Z`);
      await s.event(c, "message", { step: "ranked" }, "2026-09-21T00:00:00Z");
      const events = (await s.live()).events as Doc[];
      assertEquals(events.length, 20);
      assert(events.every((e) => e.line_key === "read"), JSON.stringify(events.map((e) => e.line_key)));
      assertEquals(Object.keys(events[0]!).sort(), ["card_id", "card_title", "created_at", "id", "line_key", "role_id", "type"]);
    });
  } finally {
    await s.close();
  }
});

Deno.test("supporter credits follow money.payment_counts, leave out the board's test payment and agree with the contributor counts", OPTS, async (t) => {
  const s = await studio();
  try {
    const a = await s.card("Card A", 5);
    const b = await s.card("Card B", 5);
    const c = await s.card("Card C", 10);
    const d = await s.card("Card D", 2);

    // The board's own test payment, production-shaped: its session is the one row of board_test_payments.
    await s.pay("board", 1, a, { session: BOARD_TEST_SESSION, contributor: "contrib_board" });
    await s.pay("p1", 2, a);
    await s.pay("p2", 3, b);
    await s.spend(b, 1);
    await s.pay("p3", 2, c);
    await s.pay("p4", 2, c);
    // Overflow: 2 fills D, the other 2 goes on to the oldest card that takes money with room, A.
    await s.pay("p6", 4, d);

    await t.step("the board's test payment has no number, and the first other payer is Supporter 1", async () => {
      const numbered = await s.rows<{ contributor_id: string; number: number }>(`select contributor_id, number from public.supporters order by number`);
      assertEquals(numbered.map((r) => [r.contributor_id, r.number]), [
        ["contrib_p1", 1], ["contrib_p2", 2], ["contrib_p3", 3], ["contrib_p4", 4], ["contrib_p6", 5],
      ]);
    });

    await t.step("each counted payer is listed on every card their money reached, with number and founding", async () => {
      assertEquals(await s.supporters(a), [1, 5]);
      assertEquals(await s.supporters(b), [2]);
      assertEquals(await s.supporters(c), [3, 4]);
      assertEquals(await s.supporters(d), [5]);
      const founding = await s.rows<{ f: boolean }>(`select founding as f from public.public_card_supporters`);
      assert(founding.every((r) => r.f === true), "before Go live every supporter is founding");
      assertEquals(
        (await s.rows<{ c: string }>(`select column_name as c from information_schema.columns where table_name = 'public_card_supporters' order by ordinal_position`)).map((r) => r.c),
        ["card_id", "supporter_number", "founding"],
      );
    });

    await t.step("a full refund after part of the money was spent removes the payer from the card", async () => {
      await s.reverse("p2_refund", "cs_test_p20000000000", "refund", 3);
      assertEquals(await s.supporters(b), []);
    });

    await t.step("a lost full dispute removes the payer; a reinstatement restores them", async () => {
      await s.reverse("p3_dispute", "cs_test_p30000000000", "dispute", 2);
      await s.reverse("p4_dispute", "cs_test_p40000000000", "dispute", 2);
      assertEquals(await s.supporters(c), []);
      await s.row(`select public.record_dispute_reinstated('dp_p4', 'cs_test_p40000000000', 2)`);
      assertEquals(await s.supporters(c), [4]);
    });

    await t.step("a held payment is credited for the part that reached a card", async () => {
      await s.db.exec(`update public.studio_state set credit_daily_cap_usd = 1 where id = 1`);
      const held = await s.pay("p5", 3, c);
      await s.db.exec(`update public.studio_state set credit_daily_cap_usd = 10000 where id = 1`);
      assertEquals([Number(held.pool_credit_usd), Number(held.held_usd)], [1, 2]);
      assertEquals(await s.supporters(c), [4, 6]);
    });

    await t.step("for every card, public_card_funding.contributors equals its row count in public_card_supporters, and the board payer is on none", async () => {
      for (const id of [a, b, c, d]) {
        assertEquals(await s.contributors(id), (await s.supporters(id)).length, id);
      }
      const all = await s.rows<{ n: number }>(`select distinct supporter_number as n from public.public_card_supporters order by 1`);
      assertEquals(all.map((r) => r.n), [1, 4, 5, 6]);
      const board = await s.rows(`select 1 from public.supporters where contributor_id = 'contrib_board'`);
      assertEquals(board.length, 0);
    });

    await t.step("anon reads the view; the supporters table stays closed", async () => {
      const seen = await s.asAnon(() => s.rows(`select * from public.public_card_supporters`));
      assert(seen.length > 0);
      let refused = false;
      await s.asAnon(async () => {
        try {
          await s.rows(`select * from public.supporters`);
        } catch {
          refused = true;
        }
      });
      assert(refused, "anon cannot read supporters");
    });
  } finally {
    await s.close();
  }
});

Deno.test("thanks_for_session answers exactly its keys in each state, as a security definer anon may execute", OPTS, async (t) => {
  const s = await studio();
  try {
    const a = await s.card("Card A", 5);
    const d = await s.card("Card D", 2);
    await s.pay("board", 1, a, { session: BOARD_TEST_SESSION, contributor: "contrib_board" });
    await s.pay("p1", 2, a, { created: new Date(Date.now() - 60_000).toISOString() });
    await s.pay("p6", 4, d);
    const RECORDED_KEYS = ["credit", "held_until", "named_card_id", "reached", "status", "supporter", "terms_version", "waiting"];

    await t.step("security definer, search_path public, anon and authenticated may execute, public may not", async () => {
      const fn = await s.row<{ sec: boolean; config: string[]; v: string }>(
        `select prosecdef as sec, proconfig as config, provolatile as v from pg_proc where proname = 'thanks_for_session'`,
      );
      assertEquals([fn.sec, fn.config, fn.v], [true, ["search_path=public"], "s"]);
      for (const role of ["anon", "authenticated", "service_role"]) {
        assertEquals((await s.row<{ ok: boolean }>(`select has_function_privilege($1, 'public.thanks_for_session(text)', 'execute') as ok`, [role])).ok, true, role);
      }
      const acl = (await s.row<{ acl: string[] }>(`select proacl::text[] as acl from pg_proc where proname = 'thanks_for_session'`)).acl;
      assert(!acl.some((entry) => entry.startsWith("=")), `public holds no grant: ${acl.join(" ")}`);
    });

    await t.step("a malformed or unknown session is exactly pending", async () => {
      for (const session of ["", "nope", "cs_live_short", "cs_test_bad-characters!!!!", "pi_test_1234567890abc", "cs_test_unknown0000000000"]) {
        assertEquals(await s.thanks(session), { status: "pending" }, session);
      }
    });

    await t.step("the board's test payment is exactly not_counted", async () => {
      assertEquals(await s.thanks(BOARD_TEST_SESSION), { status: "not_counted" });
    });

    await t.step("a recorded payment: supporter, the named card, reached, credited, the terms version", async () => {
      const answer = await s.thanks("cs_test_p10000000000");
      assertEquals(Object.keys(answer).sort(), RECORDED_KEYS);
      const terms = (await s.row<{ v: number | null }>(`select terms_version as v from public.contributions where stripe_session_id = 'cs_test_p10000000000'`)).v;
      assert(terms !== null, "a payment with a session time is stamped");
      assertEquals(answer, {
        status: "recorded",
        supporter: { number: 1, founding: true },
        named_card_id: a,
        reached: [a],
        waiting: false,
        credit: "credited",
        held_until: null,
        terms_version: terms,
      });
    });

    await t.step("reached names the card first, then the cards the rest went to, at most five", async () => {
      const answer = await s.thanks("cs_test_p60000000000");
      assertEquals(answer.reached, [d, a]);
      assertEquals(answer.terms_version, null, "no session time stamps nothing");
      const many = [];
      for (let k = 0; k < 7; k += 1) many.push(await s.card(`Small ${k}`, 1));
      await s.pay("wide", 9, many[3]!);
      const wide = await s.thanks("cs_test_wide0000000000");
      assertEquals((wide.reached as string[]).length, 5);
      assertEquals((wide.reached as string[])[0], many[3]);
    });

    await t.step("money beyond every card's room waits: waiting is true", async () => {
      await s.pay("over", 100, a);
      assertEquals((await s.thanks("cs_test_over0000000000")).waiting, true);
    });

    await t.step("a held payment says held with a New York date", async () => {
      await s.db.exec(`update public.studio_state set credit_daily_cap_usd = 1 where id = 1`);
      const c = await s.card("Card for the hold", 50);
      await s.pay("held", 5, c);
      await s.db.exec(`update public.studio_state set credit_daily_cap_usd = 10000 where id = 1`);
      const answer = await s.thanks("cs_test_held0000000000");
      assertEquals(answer.credit, "held");
      const want = (await s.row<{ d: string }>(
        `select to_char((hold_until at time zone 'America/New_York')::date, 'YYYY-MM-DD') as d from public.contributions where stripe_session_id = 'cs_test_held0000000000'`,
      )).d;
      assertEquals(answer.held_until, want);
      assertEquals(Object.keys(answer).sort(), RECORDED_KEYS);
    });

    await t.step("a refunded payment is reversed and reaches no card", async () => {
      await s.pay("gone", 2, a);
      await s.reverse("gone_refund", "cs_test_gone0000000000", "refund", 2);
      const answer = await s.thanks("cs_test_gone0000000000");
      assertEquals([answer.credit, answer.reached, answer.waiting, answer.held_until], ["reversed", [], false, null]);
      assertEquals(Object.keys(answer).sort(), RECORDED_KEYS);
    });

    await t.step("no answer carries an amount, an email, a contributor id or a payer key", async () => {
      for (const session of ["cs_test_p10000000000", "cs_test_held0000000000", "cs_test_gone0000000000"]) {
        const text = JSON.stringify(await s.thanks(session));
        assert(!/amount|usd|email|contrib_|payer|name"/i.test(text), text);
      }
    });
  } finally {
    await s.close();
  }
});

Deno.test("site_card returns a public card's document, and public_role_stats counts only studio-billed rows and live cards", OPTS, async (t) => {
  const s = await studio();
  try {
    const shipped = await s.card("Shipped card", 50);
    const building = await s.card("Building card", 5);
    const rejected = await s.card("Rejected card", 5);
    const hidden = await s.card("Agent card with no approval", 5, { source: "agent" });

    // 26 supporters on the shipped card, one payment each.
    for (let k = 1; k <= 26; k += 1) await s.pay(`s${k}`, 1, shipped);
    await s.spend(shipped, 0.5);
    await s.spend(shipped, 0.25, "founder");
    // 205 lines on the shipped card, and tool results that never show.
    await s.event(shipped, "start", {}, "2026-09-10T00:00:00Z");
    for (let k = 0; k < 204; k += 1) {
      await s.event(shipped, "tool_call", { name: k % 2 ? "Read" : "read" }, new Date(Date.parse("2026-09-10T00:01:00Z") + k * 1000).toISOString());
      await s.event(shipped, "tool_result", { content: "output" }, new Date(Date.parse("2026-09-10T00:01:00Z") + k * 1000 + 500).toISOString());
    }
    await s.event(shipped, "gate_fail", {}, "2026-09-10T01:00:00Z");
    await s.event(shipped, "gate_pass", {}, "2026-09-10T02:00:00Z");
    await s.db.query(
      `update public.cards set stage = 'live', commit_sha = 'abc1234def5678900000000000000000000000ff',
         acceptance_test = 'check: config seed-1/src/config.json $.unlocks[0].cost == 10' where id = $1`,
      [shipped],
    );
    // Going live stamps live_at with the time of the update; the fixture sets its own afterwards.
    await s.db.query(`update public.cards set live_at = '2026-09-10T03:00:00Z' where id = $1`, [shipped]);
    await s.event(shipped, "ship", {}, "2026-09-10T03:00:00Z");
    await s.db.query(`update public.cards set stage = 'building' where id = $1`, [building]);
    await s.event(building, "start", {}, "2026-09-11T00:00:00Z");
    await s.db.query(`update public.cards set stage = 'rejected', failing_check = 'smoke' where id = $1`, [rejected]);

    await t.step("site_card is stable, security invoker, anon's and not public's", async () => {
      const fn = await s.row<{ sec: boolean; v: string; config: string[] }>(`select prosecdef as sec, provolatile as v, proconfig as config from pg_proc where proname = 'site_card'`);
      assertEquals([fn.sec, fn.v, fn.config], [false, "s", ["search_path=public"]]);
      assertEquals((await s.row<{ ok: boolean }>(`select has_function_privilege('anon', 'public.site_card(uuid)', 'execute') as ok`)).ok, true);
      const acl = (await s.row<{ acl: string[] }>(`select proacl::text[] as acl from pg_proc where proname = 'site_card'`)).acl;
      assert(!acl.some((entry) => entry.startsWith("=")), acl.join(" "));
    });

    await t.step("an unknown id, and a card the public may not read, answer null", async () => {
      assertEquals(await s.siteCard("00000000-0000-4000-8000-000000000000"), null);
      assertEquals(await s.siteCard(hidden), null);
    });

    await t.step("a live card: public columns, funding, cost, the first 24 supporters and their count, the newest 200 lines and their total, milestones", async () => {
      const doc = (await s.siteCard(shipped))!;
      assertEquals(Object.keys(doc).sort(), ["card", "funding", "line_count", "lines", "milestones", "roles", "spent_usd", "stopped", "supporter_count", "supporters"]);
      const card = doc.card as Doc;
      assertEquals([card.id, card.title, card.stage, card.commit_sha, card.failing_check], [shipped, "Shipped card", "live", "abc1234def5678900000000000000000000000ff", null]);
      assertEquals(card.acceptance_test, "check: config seed-1/src/config.json $.unlocks[0].cost == 10");
      assert(!("actual_usd" in card) && !("priority" in card) && !("severity" in card), "withheld columns stay withheld");
      assertEquals((doc.funding as Doc).contributors, 26);
      assertEquals(doc.spent_usd, 0.5, "founder-billed spend is not public");
      const supporters = doc.supporters as Doc[];
      assertEquals(supporters.length, 24);
      assertEquals(supporters.map((x) => x.number), Array.from({ length: 24 }, (_, k) => k + 1));
      assertEquals(Object.keys(supporters[0]!).sort(), ["founding", "number"]);
      assertEquals(doc.supporter_count, 26);
      const lines = doc.lines as Doc[];
      assertEquals(doc.line_count, 208, "start, 204 reads, two gate results and the ship");
      assertEquals(lines.length, 200);
      assert(lines.every((l) => l.line_key !== "none"));
      assertEquals(lines.at(-1)!.line_key, "shipped", "oldest first, the newest last");
      const times = lines.map((l) => String(l.created_at));
      assertEquals(times, [...times].sort());
      assertEquals(Object.keys(lines[0]!).sort(), ["created_at", "line_key", "role_id"]);
      const milestones = doc.milestones as Doc;
      assertEquals(milestones.gate, "passed", "the latest gate result");
      assert(String(milestones.started_at).startsWith("2026-09-10T00:00:00"), String(milestones.started_at));
      assert(String(milestones.gate_at).startsWith("2026-09-10T02:00:00"), String(milestones.gate_at));
      assert(String(milestones.live_at).startsWith("2026-09-10T03:00:00"), String(milestones.live_at));
      assertEquals((doc.roles as Doc[]).map((r) => r.name), ["Builder A"]);
      assertEquals(doc.stopped, null);
    });

    await t.step("a building card has its start and no live time; a rejected card carries its public_stopped_cards row", async () => {
      const b = (await s.siteCard(building))!;
      assertEquals(((b.card as Doc).stage), "building");
      assertEquals((b.milestones as Doc).live_at, null);
      assertEquals((b.lines as Doc[]).map((l) => l.line_key), ["started"]);
      assertEquals(b.supporters, []);
      assertEquals(b.supporter_count, 0);
      const r = (await s.siteCard(rejected))!;
      const stopped = r.stopped as Doc;
      assertEquals([stopped.card_id, stopped.stage, stopped.failing_check], [rejected, "rejected", "smoke"]);
    });

    await t.step("public_role_stats sums only studio-billed rows and counts only live cards", async () => {
      // A studio row from ten days ago counts in the total, not in the last seven days.
      await s.db.query(
        `insert into public.ledger (card_id, role_id, model, usd, billed_to, created_at) values ($1, $2, 'model-id', 1, 'studio', now() - interval '10 days')`,
        [building, s.builder],
      );
      const stats = await s.asAnon(() => s.rows<Doc>(`select * from public.public_role_stats where role_id = $1`, [s.builder]));
      assertEquals(stats.length, 1);
      assertEquals([Number(stats[0]!.spent_usd), Number(stats[0]!.spent_7d_usd), stats[0]!.shipped_cards], [1.5, 0.5, 1]);
      const doc = await s.live();
      const entry = (doc.role_stats as Doc[]).find((r) => r.role_id === s.builder)!;
      assertEquals(Object.keys(entry).sort(), ["role_id", "shipped_cards", "spent_7d_usd", "spent_usd"]);
    });

    await t.step("both documents carry every key in snapshot-keys.json with its type; roles carry status, trigger and the pause", async () => {
      const spec = JSON.parse(await Deno.readTextFile(SNAPSHOT_KEYS)) as { live: KeySpec; cards: KeySpec };
      for (const [name, doc] of [["live", await s.live()], ["cards", await s.cards()]] as const) {
        for (const [key, allowed] of Object.entries(spec[name])) {
          assert(key in doc, `${name} document has ${key}`);
          const types = Array.isArray(allowed) ? allowed : [allowed];
          assert(types.includes(jsonType(doc[key])), `${name}.${key} is ${jsonType(doc[key])}, expected ${types.join(" or ")}`);
        }
      }
      const [role] = (await s.cards()).roles as Doc[];
      for (const k of ["status", "trigger", "paused", "paused_reason"]) assert(k in role!, `roles carry ${k}`);
    });

    await t.step("the migration applies a second time", async () => {
      await s.db.exec(s.migrations.find((m) => m.name === MIGRATION)!.sql);
      assert((await s.siteCard(shipped)) !== null);
    });
  } finally {
    await s.close();
  }
});
