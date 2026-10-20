// The marketing engine's migration on PGlite (docs/specs/marketing-engine.md): marketing_posts_due()
// lists the public cards that shipped or opened for funding since a time and the fresh weekly report,
// each with the channels it is already claimed on, and leaves out what every asked channel claimed;
// marketing_post_claim() answers true once per (channel, kind, ref); marketing_post_settle() moves only
// a sending row; the stop is the kill switch, then the pause; only the service role may call them; and
// the migration runs twice. Every migration runs in order first, as hold_drafting_test.ts runs them.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261020000000_marketing_posts.sql";
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

const APPLY =
  `select public.apply_contribution(p_stripe_event_id => $1, p_contributor_id => $2, p_display_name => null, p_amount_usd => $3, p_net_usd => $3, p_studio_pct => 0, p_goal_card_id => $4::uuid, p_stripe_session_id => $5, p_payer_key => null, p_session_created_at => null) as r`;

type Row = Record<string, unknown>;
type Item = Row & { kind: string; ref: string; claimed: string[] };
type Due = { stop: string | null; items: Item[] };

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
  await db.exec(
    `insert into public.studio_state (id, credit_daily_cap_usd, credit_studio_daily_cap_usd, card_max_usd, daily_cap_usd, monthly_cap_usd, reserve_pct, incident_cap_usd)
       values (1, 10000, 10000, 25, 100, 500, 0, 0);
     insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);`,
  );
  const builder = (await row<{ id: string }>(
    `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, write_access, agent_class)
     values ('Builder A', 'Builder A', 'A small creature.', 'model-id', 0.1, 'plain', 'platform/agents/prompts/x.md', true, 'writer') returning id`,
  )).id;
  let made = 0;
  const card = async (title: string, target: number, horizon = "now", folder = "seed-1") => {
    made += 1;
    return (await row<{ id: string }>(
      `insert into public.cards (bucket, source, shape, lane, folder, title, summary, intent, acceptance_test, funding_target_usd, estimate_usd, stage, horizon, executor_role_id, created_at)
       values ('game', 'board', 'goal', 'config', $5, $1, 'A summary.', 'An intent.', 'check: config seed-1/config/a.json x == 1', $2, $2, 'proposed', $3, $4,
         now() - interval '2 hours' + make_interval(secs => $6)) returning id`,
      [title, target, horizon, builder, folder, made],
    )).id;
  };
  let paid = 0;
  const pay = async (usd: number, cardId: string) => {
    paid += 1;
    return (await row<{ r: Row }>(APPLY, [`evt_mkt_${paid}`, `contrib_mkt_${paid}`, usd, cardId, `cs_test_mkt_${paid}000000000`])).r;
  };
  const due = async (channels: string[], since = "1 day", limit = 10) =>
    (await row<{ r: Due }>(`select public.marketing_posts_due($1::text[], now() - $2::interval, $3) as r`, [channels, since, limit])).r;
  const claim = async (channel: string, kind: string, ref: string, state = "sending", reason: string | null = null) =>
    (await row<{ r: boolean }>(`select public.marketing_post_claim($1, $2, $3, $4, $5) as r`, [channel, kind, ref, state, reason])).r;
  const settle = async (channel: string, kind: string, ref: string, state: string, status: number | null = 200, postId: string | null = "post-1") =>
    (await row<{ r: boolean }>(`select public.marketing_post_settle($1, $2, $3, $4, $5, $6) as r`, [channel, kind, ref, state, status, postId])).r;
  return { db, row, sqlOf, card, pay, due, claim, settle, close: () => db.close() };
}

Deno.test("marketing_posts_due lists ships, openings and the fresh weekly report, once per channel", OPTS, async (t) => {
  const s = await studio();
  try {
    let open = "";
    let shipped = "";
    let later = "";

    await t.step("an open card on now is due as opened, with its amounts; a card on next is not", async () => {
      open = await s.card("Dust storms on the map", 3);
      later = await s.card("A later card", 3, "next");
      await s.pay(1, open);
      const d = await s.due(["bsky", "mastodon"]);
      assertEquals(d.stop, null);
      assertEquals(d.items.map((i) => [i.kind, i.ref]), [["opened", open]]);
      const item = d.items[0]!;
      assertEquals([item.title, item.folder, Number(item.funded_usd), Number(item.funding_target_usd), item.claimed], ["Dust storms on the map", "seed-1", 1, 3, []]);
    });

    await t.step("a card that opened before the window and a vetoed card are not due", async () => {
      assertEquals((await s.due(["bsky"], "1 minute")).items.length, 0);
      await s.db.exec(`update public.cards set board_vetoed = true where id = '${later}'`);
      await s.db.exec(`update public.cards set horizon = 'now' where id = '${later}'`);
      assertEquals((await s.due(["bsky"])).items.map((i) => i.ref), [open]);
    });

    await t.step("a shipped card is due as ship with its supporter count, and no longer as opened", async () => {
      shipped = open;
      await s.pay(2, shipped);
      await s.db.exec(`update public.cards set stage = 'live', live_at = now() where id = '${shipped}'`);
      const d = await s.due(["bsky"]);
      assertEquals(d.items.map((i) => [i.kind, i.ref]), [["ship", shipped]]);
      assertEquals(d.items[0]!.supporter_count, 2);
    });

    await t.step("a claim on one channel shows in claimed; an item claimed on every asked channel is left out", async () => {
      assertEquals(await s.claim("bsky", "ship", shipped), true);
      assertEquals(await s.claim("bsky", "ship", shipped), false, "a second claim of the same triple is refused");
      assertEquals((await s.due(["bsky", "mastodon"])).items[0]!.claimed, ["bsky"]);
      assertEquals((await s.due(["bsky"])).items.length, 0);
      assertEquals(await s.claim("mastodon", "ship", shipped, "skipped", "deny_list"), true);
      assertEquals((await s.due(["bsky", "mastodon"])).items.length, 0);
      assertEquals((await s.due(["discord"])).items.length, 1, "discord is a channel of its own");
      assertEquals((await s.due([])).items.length, 0, "no channel asked, nothing due");
    });

    await t.step("settle moves only a sending row, to posted or failed", async () => {
      assertEquals(await s.settle("bsky", "ship", shipped, "posted", 200, "at://did:plc:x/app.bsky.feed.post/1"), true);
      assertEquals(await s.settle("bsky", "ship", shipped, "failed"), false, "a settled row stays as it is");
      assertEquals(await s.settle("mastodon", "ship", shipped, "posted"), false, "a skipped row is never posted");
      const r = await s.row<{ state: string; status: number; post_id: string }>(`select state, status, post_id from public.marketing_posts where channel = 'bsky' and kind = 'ship'`);
      assertEquals(r, { state: "posted", status: 200, post_id: "at://did:plc:x/app.bsky.feed.post/1" });
      await assertRejects(() => s.settle("bsky", "ship", shipped, "sending"), Error, "posted or failed");
      await assertRejects(() => s.claim("bsky", "ship", "x", "posted"), Error, "sending or skipped");
      await assertRejects(() => s.claim("bsky", "ship", "y", "skipped", null), Error, "a reason");
      await assertRejects(() => s.claim("x", "ship", "z"), Error, "marketing_posts_channel_check");
    });

    await t.step("the weekly report is due while its week is the last one ended, with its counts and titles", async () => {
      const week = (await s.row<{ w: string }>(`select money.last_ended_week(now())::text as w`)).w;
      await s.db.exec(
        `insert into public.studio_reports (week_start, facts) values
           ('${week}', '{"shipped_count": 2, "shipped": [{"title": "First"}, {"title": "Second"}], "open_count": 5}'),
           ('${week}'::date - 7, '{"shipped_count": 1, "shipped": [{"title": "Old"}], "open_count": 1}')`,
      );
      const weekly = (await s.due(["bsky"])).items.filter((i) => i.kind === "weekly");
      assertEquals(weekly.map((i) => [i.ref, i.shipped_count, i.shipped_titles, i.open_count]), [[week, 2, ["First", "Second"], 5]]);
      await s.db.exec(`delete from public.studio_reports where week_start = '${week}'`);
      assertEquals((await s.due(["bsky"])).items.filter((i) => i.kind === "weekly").length, 0, "an older week is never due");
    });

    await t.step("the stop is the kill switch, then the pause, and the items are still listed", async () => {
      await s.db.exec(`update public.studio_state set paused = true where id = 1`);
      assertEquals((await s.due(["discord"])).stop, "paused");
      await s.db.exec(`update public.studio_state set kill_switch_fired_at = now() where id = 1`);
      const d = await s.due(["discord"]);
      assertEquals([d.stop, d.items.length], ["kill_switch", 1]);
    });

    await t.step("the limit holds between 1 and 50", async () => {
      assertEquals((await s.due(["discord"], "1 day", 0)).items.length, 1);
    });
  } finally {
    await s.close();
  }
});

Deno.test("the marketing functions are the service role's alone, the table is read-only to it, and the migration runs twice", OPTS, async () => {
  const s = await studio();
  try {
    const fns = ["public.marketing_posts_due(text[], timestamptz, integer)", "public.marketing_post_claim(text, text, text, text, text)", "public.marketing_post_settle(text, text, text, text, integer, text)"];
    for (const fn of fns) {
      const rights = await s.row<{ anon: boolean; authenticated: boolean; service: boolean }>(
        `select has_function_privilege('anon', '${fn}', 'execute') as anon,
                has_function_privilege('authenticated', '${fn}', 'execute') as authenticated,
                has_function_privilege('service_role', '${fn}', 'execute') as service`,
      );
      assertEquals(rights, { anon: false, authenticated: false, service: true }, fn);
    }
    const table = await s.row<{ sel: boolean; ins: boolean; anon: boolean }>(
      `select has_table_privilege('service_role', 'public.marketing_posts', 'select') as sel,
              has_table_privilege('service_role', 'public.marketing_posts', 'insert') as ins,
              has_table_privilege('anon', 'public.marketing_posts', 'select') as anon`,
    );
    assertEquals(table, { sel: true, ins: false, anon: false });
    await s.db.exec(await s.sqlOf(MIGRATION));
    await s.db.exec(await s.sqlOf(MIGRATION));
    assertEquals((await s.row<{ n: number }>(`select count(*)::int as n from public.marketing_posts`)).n, 0);
  } finally {
    await s.close();
  }
});
