// The card-follows migration on PGlite (docs/specs/card-follows.md): a signed-in player follows a
// public card that has not shipped, within the cap and the daily limit; follow_notices_due lists each
// open follow once its card goes live after the follow, claims once and settles once; a follow by
// the same email as a payer of the card waits for the payer's ship notice and is then covered; the
// unsubscribe ends every follow of the profile with its own token only; anon and authenticated read
// none of it, and no table holds an address. Every migration runs in order behind the Supabase shim,
// as ship_notices_test.ts runs them.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261017300000_card_follows.sql";
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

type Row = Record<string, unknown>;
type Json = Record<string, any>;
type User = { id: string; email: string };
type Due = { user_id: string; card_id: string; card_title: string; card_folder: string; cost_usd: string; unsubscribe_token: string; covered: boolean };

const APPLY10 =
  `select public.apply_contribution(p_stripe_event_id => $1, p_contributor_id => $2, p_display_name => null, p_amount_usd => $3, p_net_usd => $4, p_studio_pct => 0, p_goal_card_id => $5::uuid, p_stripe_session_id => $6, p_payer_key => null, p_session_created_at => null) as r`;

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function studio() {
  const db = new PGlite();
  const rows = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
  const row = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T> => {
    const all = await rows<T>(sql, params);
    assert(all.length > 0, `no row for: ${sql}`);
    return all[0]!;
  };
  const as = async <T>(role: string, run: () => Promise<T>): Promise<T> => {
    await db.exec(`set role ${role}`);
    try {
      return await run();
    } finally {
      await db.exec(`reset role`);
    }
  };
  const signIn = async (user: User | null) => {
    await db.query(`select set_config('request.jwt.claim.email', $1, false)`, [user?.email ?? ""]);
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [user === null ? "" : JSON.stringify({ sub: user.id, email: user.email, aal: "aal1" })]);
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
  await db.exec(`update public.ship_notice_settings set starts_at = '2026-01-01T00:00:00Z'`);
  const builder = (await row<{ id: string }>(
    `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, write_access, agent_class)
     values ('Builder A', 'Builder A', 'A small creature.', 'model-id', 0.1, 'plain', 'platform/agents/prompts/x.md', true, 'writer') returning id`,
  )).id;
  let created = 0;
  const card = async (title: string, more: { stage?: string; folder?: string } = {}) => {
    created += 1;
    return (await row<{ id: string }>(
      `insert into public.cards (bucket, source, shape, lane, folder, title, intent, funding_target_usd, stage, horizon, executor_role_id, created_at)
       values ('game', 'board', 'goal', 'config', $5::public.card_folder, $1, 'An intent.', 10, $2::public.card_stage, 'now', $3, timestamptz '2026-09-01T00:00:00Z' + make_interval(secs => $4)) returning id`,
      [title, more.stage ?? "proposed", builder, created, more.folder ?? "seed-1"],
    )).id;
  };
  const user = async (email: string): Promise<User> => {
    const id = (await row<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email])).id;
    return { id, email };
  };
  /** A player's RPC, as the authenticated role with their session. */
  const call = async <T = Json>(who: User | null, sql: string, params: unknown[] = []): Promise<T> => {
    await signIn(who);
    return await as("authenticated", async () => (await row<{ r: T }>(`select ${sql} as r`, params)).r);
  };
  const follow = (who: User, cardId: string) => call(who, `public.follow_card($1)`, [cardId]);
  const unfollow = (who: User, cardId: string) => call(who, `public.unfollow_card($1)`, [cardId]);
  const mine = (who: User) => call(who, `public.my_follows()`);
  const pay = async (key: string, cardId: string, email: string) =>
    (await row<{ r: Row }>(APPLY10, [`evt_${key}`, await sha256Hex(email.toLowerCase()), 5, 5, cardId, `cs_test_${key}0000000000`])).r;
  const paymentId = async (key: string) =>
    (await row<{ id: string }>(`select id from public.contributions where stripe_session_id = $1 and entry = 'payment'`, [`cs_test_${key}0000000000`])).id;
  const spend = async (cardId: string, usd: number) => {
    await db.query(`select public.record_usage($1, $2, 'model-id', 1, 0, 1, $3, 'studio'::public.ledger_billing)`, [cardId, builder, usd]);
  };
  const ship = async (cardId: string, at: string) => {
    await db.query(`update public.cards set stage = 'live' where id = $1`, [cardId]);
    await db.query(`update public.cards set live_at = $2::timestamptz where id = $1`, [cardId, at]);
  };
  /** Backdates a follow, as if it was made at `at`. */
  const followedAt = async (who: User, cardId: string, at: string) => {
    await db.query(`update community.card_follows set created_at = $3::timestamptz where user_id = $1 and card_id = $2`, [who.id, cardId, at]);
  };
  const service = <T>(sql: string, params: unknown[] = []) => as("service_role", () => rows<T & Row>(sql, params));
  const due = () => service<Due>(`select * from public.follow_notices_due(50)`);
  const claim = async (who: User, cardId: string) => (await service<{ ok: boolean }>(`select public.follow_notice_claim($1, $2) as ok`, [who.id, cardId]))[0]!.ok;
  const settle = async (who: User, cardId: string, status: string, provider: string | null = null) =>
    (await service<{ ok: boolean }>(`select public.follow_notice_settle($1, $2, $3, $4) as ok`, [who.id, cardId, status, provider]))[0]!.ok;
  const token = async (userId: string) => (await row<{ t: string }>(`select community.follow_token($1) as t`, [userId])).t;
  /** The site's call: anon, with the publishable key. */
  const unsubscribe = (userId: string, t: string) =>
    as("anon", async () => (await row<{ ok: boolean }>(`select public.follow_unsubscribe($1, $2) as ok`, [userId, t])).ok);
  const state = async (who: User, cardId: string) =>
    (await rows<{ state: string }>(`select state from community.card_follows where user_id = $1 and card_id = $2`, [who.id, cardId]))[0]?.state ?? null;
  return { db, rows, row, as, sqlOf, card, user, call, follow, unfollow, mine, pay, paymentId, spend, ship, followedAt, service, due, claim, settle, token, unsubscribe, state, close: () => db.close() };
}

Deno.test("a signed-in player follows a public card that has not shipped, and sees it on their profile", OPTS, async (t) => {
  const s = await studio();
  try {
    const p = await s.user("follower@example.com");
    const open = await s.card("An open card");
    const building = await s.card("A building card", { stage: "building" });

    await t.step("following answers the follow, and a second follow of the same card changes nothing", async () => {
      const first = await s.follow(p, open);
      assertEquals([first.cardId, first.following, first.state, first.title], [open, true, "open", "An open card"]);
      const again = await s.follow(p, open);
      assertEquals([again.following, again.state], [true, "open"]);
      assertEquals((await s.rows(`select 1 from community.card_follows`)).length, 1);
    });

    await t.step("any stage before live can be followed", async () => {
      assertEquals((await s.follow(p, building)).following, true);
    });

    await t.step("my_follows lists the player's follows, newest first, with the open count and the cap", async () => {
      await s.followedAt(p, open, "2026-10-01T00:00:00Z");
      const doc = await s.mine(p);
      assertEquals(doc.follows.map((f: Json) => [f.cardId, f.stage, f.state]), [[building, "building", "open"], [open, "proposed", "open"]]);
      assertEquals([doc.open, doc.cap], [2, 100]);
    });

    await t.step("another player sees only their own follows", async () => {
      const q = await s.user("other@example.com");
      assertEquals((await s.mine(q)).follows, []);
    });

    await t.step("unfollow ends the follow; unfollowing again is a no-op", async () => {
      assertEquals((await s.unfollow(p, building)).following, false);
      assertEquals((await s.unfollow(p, building)).following, false);
      assertEquals((await s.mine(p)).follows.map((f: Json) => f.cardId), [open]);
    });
  } finally {
    await s.close();
  }
});

Deno.test("follow_card refuses a signed-out caller, a shipped, rejected, hidden or unknown card, past the cap or the daily limit, and while closed", OPTS, async (t) => {
  const s = await studio();
  try {
    const p = await s.user("limits@example.com");
    const live = await s.card("Live", { stage: "live" });
    const rejected = await s.card("Rejected", { stage: "rejected" });
    const hidden = await s.card("Hidden");
    await s.db.query(`update public.cards set source = 'agent', drafter_role_id = executor_role_id where id = $1`, [hidden]);

    await t.step("anon cannot call the player RPCs, and a session with no user is told to sign in", async () => {
      for (const sql of ["public.follow_card(gen_random_uuid())", "public.unfollow_card(gen_random_uuid())", "public.my_follows()"]) {
        await assertRejects(() => s.as("anon", () => s.rows(`select ${sql}`)), Error, "permission denied", sql);
      }
      await assertRejects(() => s.call(null, `public.follow_card($1)`, [live]), Error, "Sign in first");
    });

    await t.step("a shipped, rejected, hidden or unknown card is refused", async () => {
      await assertRejects(() => s.follow(p, live), Error, "already shipped");
      await assertRejects(() => s.follow(p, rejected), Error, "will not be built");
      await assertRejects(() => s.follow(p, hidden), Error, "no card to follow");
      await assertRejects(() => s.follow(p, crypto.randomUUID()), Error, "no card to follow");
      assertEquals((await s.rows(`select 1 from community.card_follows`)).length, 0);
    });

    await t.step("at most 50 new follows a day", async () => {
      for (let i = 0; i < 50; i += 1) await s.follow(p, await s.card(`Card ${i}`));
      await assertRejects(async () => s.follow(p, await s.card("Card 51")), Error, "50 cards a day");
    });

    await t.step("at most 100 open follows at a time", async () => {
      await s.db.exec(`update community.card_follows set created_at = now() - interval '2 days'`);
      for (let i = 0; i < 50; i += 1) await s.follow(p, await s.card(`More ${i}`));
      await s.db.exec(`update community.card_follows set created_at = now() - interval '2 days'`);
      await assertRejects(async () => s.follow(p, await s.card("One too many")), Error, "100 cards at a time");
      // A follow that is no longer open does not count.
      await s.db.exec(`update community.card_follows set state = 'sent' where card_id = (select card_id from community.card_follows limit 1)`);
      assertEquals((await s.follow(p, await s.card("Room again"))).following, true);
    });

    await t.step("the follows_open flag closes new follows; unfollowing still works", async () => {
      await s.db.exec(`update community.flags set value = 'false' where key = 'follows_open'`);
      const another = await s.card("Closed");
      await assertRejects(() => s.follow(p, another), Error, "closed for now");
      const any = (await s.row<{ card_id: string }>(`select card_id from community.card_follows where state = 'open' limit 1`)).card_id;
      assertEquals((await s.unfollow(p, any)).following, false);
    });
  } finally {
    await s.close();
  }
});

Deno.test("follow_notices_due lists each open follow once its card ships after the follow, and a claim sends once", OPTS, async (t) => {
  const s = await studio();
  try {
    const p = await s.user("one@example.com");
    const q = await s.user("two@example.com");
    const shipped = await s.card("A shipped card", { folder: "platform" });
    const early = await s.card("Followed after it shipped");
    const waiting = await s.card("Still building");
    await s.follow(p, shipped);
    await s.follow(q, shipped);
    await s.follow(p, early);
    await s.follow(p, waiting);
    await s.followedAt(p, shipped, "2026-09-30T00:00:00Z");
    await s.followedAt(q, shipped, "2026-09-30T00:00:00Z");
    await s.followedAt(p, early, "2026-10-02T00:00:00Z");
    await s.spend(shipped, 2.5);
    await s.ship(shipped, "2026-10-01T00:00:00Z");
    await s.ship(early, "2026-10-01T00:00:00Z");

    await t.step("each follower of the shipped card is due, with its title, folder, spend and their own token", async () => {
      const due = await s.due();
      assertEquals(due.map((d) => d.user_id).sort(), [p.id, q.id].sort());
      for (const d of due) {
        assertEquals([d.card_id, d.card_title, d.card_folder, Number(d.cost_usd), d.covered], [shipped, "A shipped card", "platform", 2.5, false]);
        assert(/^[0-9a-f]{64}$/.test(d.unsubscribe_token), d.unsubscribe_token);
        assertEquals(d.unsubscribe_token, await s.token(d.user_id));
      }
      assert(due[0]!.unsubscribe_token !== due[1]!.unsubscribe_token, "each profile has its own token");
    });

    await t.step("a card that went live before the follow was made, and one not live, are not due", async () => {
      assert(!(await s.due()).some((d) => d.card_id === early || d.card_id === waiting));
    });

    await t.step("a claim is taken once, and a settle moves only a row still at sending", async () => {
      assertEquals(await s.claim(p, shipped), true);
      assertEquals(await s.claim(p, shipped), false);
      assertEquals((await s.due()).map((d) => d.user_id), [q.id]);
      assertEquals(await s.settle(p, shipped, "sent", "resend-1"), true);
      assertEquals(await s.settle(p, shipped, "failed"), false);
      const r = await s.row<{ state: string; provider_id: string }>(`select state, provider_id from community.card_follows where user_id = $1 and card_id = $2`, [p.id, shipped]);
      assertEquals([r.state, r.provider_id], ["sent", "resend-1"]);
      await assertRejects(() => s.settle(q, shipped, "sending"));
      await assertRejects(() => s.settle(q, shipped, "open"));
    });

    await t.step("a claim left at sending is never due again, and follow_notices_stuck names it once it is old", async () => {
      assertEquals(await s.claim(q, shipped), true);
      assertEquals(await s.due(), []);
      assertEquals(await s.service(`select * from public.follow_notices_stuck(now() - interval '1 hour')`), []);
      await s.db.query(`update community.card_follows set claimed_at = now() - interval '2 hours' where user_id = $1`, [q.id]);
      assertEquals(await s.service(`select user_id, card_id from public.follow_notices_stuck(now() - interval '1 hour')`), [{ user_id: q.id, card_id: shipped }]);
    });

    await t.step("the player sees the state on their profile", async () => {
      const doc = await s.mine(p);
      assertEquals(doc.follows.find((f: Json) => f.cardId === shipped).state, "sent");
      // The two still open: the card still building, and the one that shipped before its follow.
      assertEquals(doc.open, 2);
    });
  } finally {
    await s.close();
  }
});

Deno.test("a suspended profile and a card hidden after the follow are not due", OPTS, async (t) => {
  const s = await studio();
  try {
    const p = await s.user("suspended@example.com");
    const q = await s.user("hidden@example.com");
    const one = await s.card("One");
    const two = await s.card("Two");
    await s.follow(p, one);
    await s.follow(q, two);
    await s.db.exec(`update community.card_follows set created_at = '2026-09-30T00:00:00Z'`);
    await s.ship(one, "2026-10-01T00:00:00Z");
    await s.ship(two, "2026-10-01T00:00:00Z");
    assertEquals((await s.due()).length, 2);

    await t.step("a suspended profile gets no email", async () => {
      await s.db.query(`update community.profiles set suspended = true where user_id = $1`, [p.id]);
      assertEquals((await s.due()).map((d) => d.user_id), [q.id]);
    });

    await t.step("a card the public cannot see is not noticed", async () => {
      await s.db.query(`update public.cards set source = 'agent', drafter_role_id = executor_role_id where id = $1`, [two]);
      assertEquals(await s.due(), []);
    });
  } finally {
    await s.close();
  }
});

Deno.test("a follower who also paid for the card with the same email gets the payer's notice, not a second email", OPTS, async (t) => {
  const s = await studio();
  try {
    const payer = await s.user("Payer@Example.com");
    const other = await s.user("follower-only@example.com");
    const shipped = await s.card("Paid and followed");
    await s.pay("a", shipped, "payer@example.com");
    await s.pay("b", shipped, "someone-else@example.com");
    await s.follow(payer, shipped);
    await s.follow(other, shipped);
    await s.db.exec(`update community.card_follows set created_at = '2026-09-30T00:00:00Z'`);
    await s.ship(shipped, "2026-10-01T00:00:00Z");
    const a = await s.paymentId("a");

    await t.step("while the payer's ship notice is still due, their follow waits; the other follower is due", async () => {
      assertEquals((await s.due()).map((d) => [d.user_id, d.covered]), [[other.id, false]]);
    });

    await t.step("once the payer's notice is claimed and sent, their follow is due as covered", async () => {
      await s.as("service_role", () => s.rows(`select public.ship_notice_claim($1, $2)`, [a, shipped]));
      const due = await s.due();
      assertEquals(due.map((d) => [d.user_id, d.covered]).sort(), [[other.id, false], [payer.id, true]].sort());
      await s.as("service_role", () => s.rows(`select public.ship_notice_settle($1, $2, 'sent', 'r1')`, [a, shipped]));
      assertEquals((await s.due()).find((d) => d.user_id === payer.id)?.covered, true);
    });

    await t.step("a notice that found no address does not cover the follow", async () => {
      await s.db.query(`update public.ship_notices set status = 'no_address' where payment_id = $1`, [a]);
      assertEquals((await s.due()).find((d) => d.user_id === payer.id)?.covered, false);
    });

    await t.step("a payer who stopped ship notices still gets the follow email they asked for", async () => {
      await s.db.query(`delete from public.ship_notices where payment_id = $1`, [a]);
      assertEquals((await s.due()).some((d) => d.user_id === payer.id), false, "waiting on the payer's notice");
      await s.db.query(`insert into public.notice_unsubscribes (contributor_id) values ($1)`, [await sha256Hex("payer@example.com")]);
      assertEquals((await s.due()).find((d) => d.user_id === payer.id)?.covered, false);
    });

    await t.step("covered settles like any other state", async () => {
      assertEquals(await s.claim(payer, shipped), true);
      assertEquals(await s.settle(payer, shipped, "covered"), true);
      assertEquals(await s.state(payer, shipped), "covered");
    });
  } finally {
    await s.close();
  }
});

Deno.test("an unsubscribe with the profile's token ends every follow of that profile; a wrong token changes nothing", OPTS, async (t) => {
  const s = await studio();
  try {
    const p = await s.user("stop@example.com");
    const q = await s.user("keep@example.com");
    const one = await s.card("One");
    const two = await s.card("Two");
    await s.follow(p, one);
    await s.follow(p, two);
    await s.follow(q, one);

    await t.step("a wrong, malformed or another profile's token answers false and changes nothing", async () => {
      assertEquals(await s.unsubscribe(p.id, "0".repeat(64)), false);
      assertEquals(await s.unsubscribe(p.id, "not hex"), false);
      assertEquals(await s.unsubscribe(p.id, await s.token(q.id)), false);
      assertEquals((await s.rows(`select 1 from community.card_follows`)).length, 3);
    });

    await t.step("the profile's own token ends all its follows, and only its own; a second use still answers true", async () => {
      const t1 = await s.token(p.id);
      assertEquals(await s.unsubscribe(p.id, t1), true);
      assertEquals(await s.unsubscribe(p.id, t1), true);
      assertEquals((await s.rows<{ user_id: string }>(`select user_id from community.card_follows`)).map((r) => r.user_id), [q.id]);
    });

    await t.step("an id with no profile answers false, even with its own token", async () => {
      const nobody = crypto.randomUUID();
      assertEquals(await s.unsubscribe(nobody, await s.token(nobody)), false);
    });

    await t.step("following again afterwards is a new request", async () => {
      assertEquals((await s.follow(p, one)).following, true);
    });
  } finally {
    await s.close();
  }
});

Deno.test("no public role reads the follows or calls the job's functions, the secret stays in the database, and no column holds an address", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("anon, authenticated and service_role cannot read the tables or call the token function", async () => {
      for (const role of ["anon", "authenticated", "service_role"]) {
        for (const table of ["card_follows", "follow_settings"]) {
          await assertRejects(() => s.as(role, () => s.rows(`select * from community.${table}`)), Error, "permission denied", `${role} ${table}`);
        }
        await assertRejects(() => s.as(role, () => s.rows(`select community.follow_token(gen_random_uuid())`)), Error, "permission denied", role);
      }
    });

    await t.step("anon and authenticated cannot call the job's functions", async () => {
      for (const role of ["anon", "authenticated"]) {
        for (const sql of [
          "select * from public.follow_notices_due(1)",
          "select public.follow_notice_claim(gen_random_uuid(), gen_random_uuid())",
          "select public.follow_notice_settle(gen_random_uuid(), gen_random_uuid(), 'sent')",
          "select * from public.follow_notices_stuck(now())",
        ]) {
          await assertRejects(() => s.as(role, () => s.rows(sql)), Error, "permission denied", `${role}: ${sql}`);
        }
      }
    });

    await t.step("the service role holds none of the player RPCs", async () => {
      for (const sql of ["public.follow_card(gen_random_uuid())", "public.unfollow_card(gen_random_uuid())", "public.my_follows()"]) {
        await assertRejects(() => s.as("service_role", () => s.rows(`select ${sql}`)), Error, "permission denied", sql);
      }
    });

    await t.step("row level security is on, and no column is named for an email or an address", async () => {
      const rls = await s.rows<{ on: boolean }>(
        `select relrowsecurity as on from pg_class where oid in ('community.card_follows'::regclass, 'community.follow_settings'::regclass)`,
      );
      assertEquals(rls.map((r) => r.on), [true, true]);
      const columns = await s.rows<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'community' and table_name in ('card_follows', 'follow_settings')`,
      );
      assert(columns.length > 0);
      for (const c of columns) assert(!/mail|address/i.test(c.column_name), c.column_name);
    });

    await t.step("the migration applies a second time without error and keeps the secret", async () => {
      const secret = `select encode(unsubscribe_secret, 'hex') as h from community.follow_settings`;
      const before = (await s.row<{ h: string }>(secret)).h;
      assertEquals((await s.row<{ n: number }>(`select length(unsubscribe_secret) as n from community.follow_settings`)).n, 32);
      await s.db.exec(await s.sqlOf(MIGRATION));
      assertEquals((await s.rows(`select 1 from community.follow_settings`)).length, 1);
      assertEquals((await s.row<{ h: string }>(secret)).h, before, "a second apply keeps the secret, so links already sent still work");
      assertEquals((await s.row<{ v: unknown }>(`select value as v from community.flags where key = 'follows_open'`)).v, true);
    });
  } finally {
    await s.close();
  }
});
