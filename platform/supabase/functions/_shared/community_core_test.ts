// The community migrations on PGlite (docs/specs/community-core.md): the quarantine, row level
// security, the rarity and XP twins on the shared vectors, the XP cap, the rate limits, the feed's
// triggers, the claim, the public documents with their keyset cursors, trending order, the Scout's
// path and the admin functions. Every migration runs in order behind the Supabase shim, as
// play_counts_test.ts runs them.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const VECTORS = new URL("../../test/fixtures/community-vectors.json", import.meta.url);
const BADGES = new URL("../../seed/badges.json", import.meta.url);
const COMMUNITY = ["20261017000000_community_core.sql", "20261017000100_community_digests.sql", "20261017000200_community_admin.sql"];
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const OPTS = { sanitizeOps: false, sanitizeResources: false };
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

type Row = Record<string, unknown>;
type Json = Record<string, any>;

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
  const signIn = async (user: { id: string; email: string } | null, aal: "aal1" | "aal2" = "aal1") => {
    await db.query(`select set_config('request.jwt.claim.email', $1, false)`, [user?.email ?? ""]);
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [user === null ? "" : JSON.stringify({ sub: user.id, email: user.email, aal })]);
  };
  await db.exec(SHIM);
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  const sqlOf = async (name: string) => (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "");
  for (const name of names) await db.exec(await sqlOf(name));
  await db.query(`insert into public.board_members (email, role) values ($1, 'board')`, [BOARD_EMAIL]);
  const user = async (email: string) => {
    const id = (await row<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email])).id;
    return { id, email };
  };
  // A player's RPC, as the authenticated role with their session.
  const call = async <T = Json>(who: { id: string; email: string } | null, sql: string, params: unknown[] = []): Promise<T> => {
    await signIn(who);
    return await as("authenticated", async () => (await row<{ r: T }>(`select ${sql} as r`, params)).r);
  };
  const board = async <T = Json>(sql: string, params: unknown[] = []): Promise<T> => {
    await signIn({ id: crypto.randomUUID(), email: BOARD_EMAIL }, "aal2");
    return await as("authenticated", async () => (await row<{ r: T }>(`select ${sql} as r`, params)).r);
  };
  const anon = async <T = Json>(sql: string, params: unknown[] = []): Promise<T> => {
    await signIn(null);
    return await as("anon", async () => (await row<{ r: T }>(`select ${sql} as r`, params)).r);
  };
  const card = async (title: string, more: { folder?: string; stage?: string; source?: string; id?: string } = {}) =>
    (await row<{ id: string }>(
      `insert into public.cards (id, bucket, source, shape, lane, folder, title, stage, horizon)
       values (coalesce($5::uuid, gen_random_uuid()), 'game', $4::public.card_source, 'oneoff', 'config', $2::public.card_folder, $1, $3::public.card_stage, 'now') returning id`,
      [title, more.folder ?? "seed-1", more.stage ?? "proposed", more.source ?? "board", more.id ?? null],
    )).id;
  const pay = async (email: string | null, usd: number, cardId: string | null) => {
    const contributor = email === null ? await sha256Hex(crypto.randomUUID()) : await sha256Hex(email.toLowerCase());
    return (await row<{ id: string }>(
      `insert into public.contributions (rail, contributor_id, amount_usd, net_usd, goal_card_id, entry, payer_key, stripe_event_id)
       values ('stripe', $1, $2, $2, $3, 'payment', 'email:' || $1, 'evt_' || gen_random_uuid()) returning id`,
      [contributor, usd, cardId],
    )).id;
  };
  return { db, rows, row, as, signIn, sqlOf, user, call, board, anon, card, pay, close: () => db.close() };
}

Deno.test("the quarantine: no role the agents or the dispatcher use can read a suggestion", OPTS, async (t) => {
  const s = await studio();
  try {
    const p = await s.user("player@example.com");
    await s.call(p, `public.submit_suggestion('dust', 'Carts leave dust trails', 'Please')`);

    await t.step("anon, authenticated and service_role are refused every community table", async () => {
      for (const role of ["anon", "authenticated", "service_role"]) {
        for (const table of ["suggestions", "suggestion_triage", "profiles", "events", "admin_log", "xp_events"]) {
          await assertRejects(() => s.as(role, () => s.rows(`select * from community.${table}`)), Error, "permission denied", `${role} ${table}`);
        }
        await assertRejects(() => s.as(role, () => s.rows(`insert into community.suggestions (user_id, area, title) values ($1, 'dust', 'xyz')`, [p.id])), Error, "permission denied");
      }
    });

    await t.step("no role but the backup login holds select on community.suggestions", async () => {
      const holders = await s.rows<{ rolname: string }>(
        `select r.rolname from pg_roles r where not r.rolsuper and has_table_privilege(r.oid, 'community.suggestions', 'select') order by 1`,
      );
      assertEquals(holders.map((h) => h.rolname).filter((n) => !n.startsWith("pg_")), ["peanutgallery_backup"]);
      assertEquals((await s.row<{ on: boolean }>(`select relrowsecurity as on from pg_class where oid = 'community.suggestions'::regclass`)).on, true);
    });

    await t.step("the dispatcher's role reads no suggestion through the public documents or the player RPCs", async () => {
      for (const fn of ["public.community_suggestions('top', null, null)", "public.my_profile()", "public.community_profile('supporter-1')"]) {
        await assertRejects(() => s.as("service_role", () => s.rows(`select ${fn}`)), Error, "permission denied", fn);
      }
      // Its one read is the Scout's batch, empty while the flag is off.
      assertEquals(await s.as("service_role", async () => (await s.row<{ r: Json }>(`select public.scout_take_batch(10) as r`)).r), { enabled: false, items: [] });
    });

    await t.step("anon and a player cannot take the Scout's batch or write its triage", async () => {
      await assertRejects(() => s.as("anon", () => s.rows(`select public.scout_take_batch(10)`)), Error, "permission denied");
      await assertRejects(() => s.as("authenticated", () => s.rows(`select public.scout_record_triage(null, '[]')`)), Error, "permission denied");
    });
  } finally {
    await s.close();
  }
});

Deno.test("rarity and XP: the SQL twins give the shared vectors", OPTS, async (t) => {
  const s = await studio();
  try {
    const v = JSON.parse(await Deno.readTextFile(VECTORS));
    await t.step("card_rarity", async () => {
      for (const [id, rarity] of Object.entries(v.rarity)) {
        assertEquals((await s.row<{ r: string }>(`select community.card_rarity($1) as r`, [id])).r, rarity, id);
      }
    });
    await t.step("xp_for_level, tier_for, level_for and contribution_xp", async () => {
      for (const l of v.levels) {
        assertEquals((await s.row<{ x: number; t: string }>(`select community.xp_for_level($1) as x, community.tier_for($1) as t`, [l.level])), { x: l.xp, t: l.tier });
      }
      for (const l of v.levelFor) assertEquals((await s.row<{ n: number }>(`select community.level_for($1) as n`, [l.xp])).n, l.level, String(l.xp));
      for (const c of v.contributionXp) {
        assertEquals((await s.row<{ x: number }>(`select community.contribution_xp($1, $2) as x`, [c.cents, c.rarity])).x, c.xp, `${c.cents} ${c.rarity}`);
      }
    });
    await t.step("a new card takes its rarity from its id and its suit from its folder", async () => {
      const id = "00000000-0000-4000-8000-000000000007";
      await s.card("Game card", { id });
      const platform = await s.card("Platform card", { folder: "platform" });
      assertEquals(await s.row(`select suit, rarity from public.cards where id = $1`, [id]), { suit: "game", rarity: v.rarity[id] });
      assertEquals((await s.row<{ suit: string }>(`select suit from public.cards where id = $1`, [platform])).suit, "platform");
      const cards = await s.anon<{ cards: Json[] }>(`public.site_cards()`);
      assertEquals(cards.cards.find((c) => c.id === id)?.rarity, v.rarity[id]);
      assertEquals(cards.cards.find((c) => c.id === id)?.suit, "game");
    });
    await t.step("the badges are badges.json's", async () => {
      const json = JSON.parse(await Deno.readTextFile(BADGES)).badges as Json[];
      const inDb = await s.rows(`select id, name, glyph, rule from community.badges order by sort`);
      assertEquals(inDb, json.map((b) => ({ id: b.id, name: b.name, glyph: b.glyph, rule: b.rule })));
    });
  } finally {
    await s.close();
  }
});

Deno.test("profiles, claims, funding XP and the feed", OPTS, async (t) => {
  const s = await studio();
  try {
    const alice = await s.user("Alice@Example.com");
    const cardId = await s.card("Carts leave dust trails");

    await t.step("my_profile makes a Supporter n profile; anon has no player RPC", async () => {
      const me = await s.call(await s.user("first@example.com"), `public.my_profile()`);
      assert(/^supporter-\d+$/.test(me.handle), me.handle);
      assert(/^Supporter \d+$/.test(me.displayName));
      assertEquals([me.level, me.xp, me.tier, me.nextLevelXp], [1, 0, "Spectator", 100]);
      await assertRejects(() => s.as("anon", () => s.rows(`select public.my_profile()`)), Error, "permission denied");
      await s.signIn(null);
      await assertRejects(() => s.as("authenticated", () => s.rows(`select public.my_profile()`)), Error, "Sign in first");
    });

    await t.step("a payment before sign-in posts as Anonymous; the claim matches the receipt email and stays anonymous", async () => {
      const paid = await s.pay("alice@example.com", 12.5, cardId);
      await s.pay("bob@example.com", 3, cardId);
      const feed = await s.anon(`public.community_feed(null)`);
      const lines = feed.events.filter((e: Json) => e.kind === "contribution").map((e: Json) => e.text);
      assertEquals(lines, ["Anonymous supporter put $3.00 on Carts leave dust trails", "Anonymous supporter put $12.50 on Carts leave dust trails"]);
      assertEquals((await s.call(alice, `public.my_profile()`)).xp, 0, "a payment before the profile is not claimed by itself");
      assertEquals(await s.call(alice, `public.claim_contributions()`), { claimed: 1 });
      assertEquals(await s.call(alice, `public.claim_contributions()`), { claimed: 0 });
      const rarity = (await s.row<{ r: string }>(`select rarity as r from public.cards where id = $1`, [cardId])).r;
      const expected = (await s.row<{ x: number }>(`select community.contribution_xp(1250, $1) as x`, [rarity])).x;
      const me = await s.call(alice, `public.my_profile()`);
      assertEquals(me.xp, expected);
      assertEquals(me.contributions.map((c: Json) => [c.id, c.public]), [[paid, false]]);
      assertEquals(me.badges.map((b: Json) => b.id).includes("first_card"), true);
      // Making it public names her on the feed line from then on.
      await s.call(alice, `public.update_profile(display_name => 'Alice the Bold')`);
      await s.call(alice, `public.set_contribution_public($1, true)`, [paid]);
      const after = await s.anon(`public.community_feed(null)`);
      const mine = after.events.find((e: Json) => e.kind === "contribution" && e.amountCents === 1250);
      assertEquals(mine.text, "Alice the Bold put $12.50 on Carts leave dust trails");
      assertEquals(mine.actor.displayName, "Alice the Bold");
      // Bob's payment is not hers to make public.
      const bobs = (await s.row<{ id: string }>(`select id from public.contributions where amount_usd = 3`)).id;
      await assertRejects(() => s.call(alice, `public.set_contribution_public($1, true)`, [bobs]), Error, "not one of yours");
    });

    await t.step("a signed-in supporter's next payment is claimed at once, public by default, and the Machine takes a payment with no card", async () => {
      await s.pay("alice@example.com", 5, null);
      const feed = await s.anon(`public.community_feed(null)`);
      assertEquals(feed.events[0].text, "Alice the Bold put $5.00 into the Machine");
      assertEquals([feed.events[0].suit, feed.events[0].rarity], ["machine", "common"]);
      const me = await s.call(alice, `public.my_profile()`);
      assert(me.collection.some((c: Json) => c.cardId === "machine" && c.cents === 500));
    });

    await t.step("display names, flair and frames are filtered and checked", async () => {
      const bad = ["s", "h", "i", "t"].join("");
      await assertRejects(() => s.call(alice, `public.update_profile(display_name => $1)`, [`Big ${bad} energy`]), Error, "content filter");
      await assertRejects(() => s.call(alice, `public.update_profile(display_name => $1)`, [`${bad.split("").join(" ")} lord`]), Error, "content filter");
      await assertRejects(() => s.call(alice, `public.update_profile(frame => 'legend')`), Error, "not unlocked");
      const me = await s.call(alice, `public.update_profile(frame => 'spectator', flair => '<b>Dust fan</b> https://x.example')`);
      assertEquals([me.frame, me.flair], ["spectator", "Dust fan"]);
      await assertRejects(() => s.call(alice, `public.update_profile(avatar => '{"body":"round"}')`), Error, "exactly body");
    });

    await t.step("a stage change, a ship and a rare card opening post to the feed; a payment still lands if the feed cannot", async () => {
      await s.db.query(`update public.cards set stage = 'building' where id = $1`, [cardId]);
      await s.db.query(`update public.cards set stage = 'live', live_at = now() where id = $1`, [cardId]);
      const kinds = (await s.anon(`public.community_feed(null)`)).events.map((e: Json) => `${e.kind}:${e.text}`);
      assert(kinds.includes("shipped:Carts leave dust trails shipped"), kinds.join("\n"));
      assert(kinds.includes("stage:Carts leave dust trails is building"));
      const me = await s.call(alice, `public.my_profile()`);
      assert(me.badges.some((b: Json) => b.id === "card_shipped"));
      // A rare id from the vectors.
      const v = JSON.parse(await Deno.readTextFile(VECTORS));
      const rareId = Object.entries(v.rarity).find(([id, r]) => r === "rare" && /^0{8}-/.test(id))![0];
      await s.card("A shiny one", { id: rareId });
      const opened = (await s.anon(`public.community_feed(null)`)).events.find((e: Json) => e.kind === "card_opened" && e.cardId === rareId);
      assertEquals(opened.text, "A rare card appeared: A shiny one");
      assertEquals(opened.rarity, "rare");
      // The feed is append-only.
      await assertRejects(() => s.db.exec(`update community.events set text = 'x'`), Error, "append-only");
      await assertRejects(() => s.db.exec(`delete from community.xp_events`), Error, "append-only");
    });

    await t.step("the feed pages by keyset, newest first", async () => {
      for (let i = 0; i < 40; i += 1) await s.db.query(`select community.add_event('milestone', 'Line ' || $1::text, null)`, [i]);
      const first = await s.anon(`public.community_feed(null)`);
      assertEquals(first.events.length, 30);
      const second = await s.anon(`public.community_feed($1)`, [first.next]);
      const ids = [...first.events, ...second.events].map((e: Json) => Number(e.id));
      assertEquals(ids, [...ids].sort((a, b) => b - a));
      assertEquals(new Set(ids).size, ids.length);
      await assertRejects(() => s.anon(`public.community_feed('x; drop')`), Error, "Bad cursor");
    });

    await t.step("a suspended player's profile and name disappear from the public", async () => {
      const handle = (await s.call(alice, `public.my_profile()`)).handle;
      assertEquals((await s.anon(`public.community_profile($1)`, [handle])).displayName, "Alice the Bold");
      await s.board(`public.board_suspend_user($1, true, 'test')`, [handle]);
      assertEquals(await s.anon(`public.community_profile($1)`, [handle]), null);
      await assertRejects(() => s.call(alice, `public.my_profile()`), Error, "suspended");
      const line = (await s.anon(`public.community_feed(null)`)).events.find((e: Json) => e.amountCents === 1250);
      assertEquals(line.text, "Anonymous supporter put $12.50 on Carts leave dust trails");
    });
  } finally {
    await s.close();
  }
});

Deno.test("XP cap, rate limits, suggestions, votes and the Scout", OPTS, async (t) => {
  const s = await studio();
  try {
    const p = await s.user("p@example.com");
    const voters = await Promise.all(Array.from({ length: 3 }, (_, i) => s.user(`v${i}@example.com`)));

    await t.step("participation XP stops at 100 a UTC day; funding is not capped", async () => {
      await s.call(p, `public.my_profile()`);
      const award = (kind: string, amount: number, source: string) =>
        s.row<{ n: number }>(`select community.award_xp($1, $2, $3, 1, $4) as n`, [p.id, kind, amount, source]);
      assertEquals((await award("suggestion_accepted", 50, "a")).n, 50);
      assertEquals((await award("seed_featured", 50, "b")).n, 50);
      assertEquals((await award("upvote", 1, "c")).n, 0);
      assertEquals((await award("suggestion_shipped", 150, "d")).n, 150);
      assertEquals((await award("funding", 1000, "e")).n, 1000);
      assertEquals((await award("funding", 1000, "e")).n, 0, "once per source");
      assertEquals((await s.call(p, `public.my_profile()`)).xp, 1250);
    });

    await t.step("suggestions: links and markup stripped, the filter, 3 a day", async () => {
      const id = (await s.call(p, `public.submit_suggestion('dust', $1, $2)`, ["Faster carts <script>x</script>", "See https://evil.example and ```rm -rf```"])).id;
      const stored = await s.row(`select title, body, state from community.suggestions where id = $1`, [id]);
      assertEquals(stored, { title: "Faster carts x", body: "See and", state: "received" });
      await assertRejects(() => s.call(p, `public.submit_suggestion('elsewhere', 'Title here', '')`), Error, "from the list");
      await assertRejects(() => s.call(p, `public.submit_suggestion('dust', $1, '')`, ["x".repeat(81)]), Error, "80 characters");
      await assertRejects(() => s.call(p, `public.submit_suggestion('dust', $1, '')`, [`more ${["c", "o", "c", "a", "i", "n", "e"].join("")} please`]), Error, "content filter");
      await s.call(p, `public.submit_suggestion('site', 'Dark mode', '')`);
      await s.call(p, `public.submit_suggestion('studio', 'Hire a sound designer', '')`);
      await assertRejects(() => s.call(p, `public.submit_suggestion('dust', 'One more', '')`), Error, "3 suggestions a day");
    });

    await t.step("one vote per account; clearing takes it back; top order follows votes", async () => {
      const list = await s.anon(`public.community_suggestions('new', null, null)`);
      assertEquals(list.items.length, 3);
      const [newest, , oldest] = list.items;
      for (const v of voters) await s.call(v, `public.vote_suggestion($1, 1::smallint)`, [oldest.id]);
      await s.call(voters[0], `public.vote_suggestion($1, 1::smallint)`, [oldest.id]);
      await s.call(voters[0], `public.vote_suggestion($1, 1::smallint)`, [newest.id]);
      await s.call(voters[1], `public.vote_suggestion($1, 1::smallint)`, [newest.id]);
      await s.call(voters[1], `public.vote_suggestion($1, 0::smallint)`, [newest.id]);
      const top = await s.anon(`public.community_suggestions('top', null, null)`);
      assertEquals(top.items.map((i: Json) => [i.id, i.votes]), [[oldest.id, 3], [newest.id, 1], [list.items[1].id, 0]]);
      assertEquals((await s.anon(`public.community_suggestions('top', 'site', null)`)).items.length, 1);
      await assertRejects(() => s.call(voters[0], `public.vote_suggestion($1, 2::smallint)`, [oldest.id]), Error, "1, or 0");
    });

    await t.step("the Scout's batch is empty with the flag off, then hands out received items once an hour", async () => {
      assertEquals((await s.as("service_role", () => s.row<{ r: Json }>(`select public.scout_take_batch(10) as r`))).r.items, []);
      await s.board(`public.board_set_flag('scout_triage', 'true', 'start triage')`);
      const batch = (await s.as("service_role", () => s.row<{ r: Json }>(`select public.scout_take_batch(10) as r`))).r;
      assertEquals(batch.items.length, 3);
      assertEquals(Object.keys(batch.items[0]).sort(), ["area", "body", "id", "title"]);
      assertEquals((await s.as("service_role", () => s.row<{ r: Json }>(`select public.scout_take_batch(10) as r`))).r.items, []);
      const enq = (await s.as("service_role", () => s.row<{ r: Json }>(`select public.enqueue_scout_triage() as r`))).r;
      assertEquals(enq.queued, true);
      assertEquals((await s.as("service_role", () => s.row<{ r: Json }>(`select public.enqueue_scout_triage() as r`))).r.reason, "already_queued");
    });

    await t.step("the triage: an instruction is declined with no summary, a flag holds, the rest cluster", async () => {
      const ids = (await s.rows<{ id: string; title: string }>(`select id, title from community.suggestions order by created_at`));
      const [carts, dark, sound] = ids;
      const result = (await s.as("service_role", () => s.row<{ r: Json }>(`select public.scout_record_triage(null, $1) as r`, [JSON.stringify([
        { id: carts!.id, area: "dust", kind: "feature", cluster_key: "faster-carts", fit: 0.8, safety_flags: [], summary: "Carts move faster." },
        { id: dark!.id, area: "site", kind: "feature", cluster_key: "dark-mode", fit: 0.5, safety_flags: ["money_or_secrets"], summary: "Change the split." },
        { id: sound!.id, area: "studio", kind: "content", cluster_key: "sound-role", fit: 0.6, safety_flags: ["personal_data"], summary: "A sound role." },
        { id: crypto.randomUUID(), area: "dust", kind: "bug", cluster_key: "nope", fit: 0.1, safety_flags: [], summary: "Not a suggestion." },
      ])]))).r;
      assertEquals(result, { written: 3, skipped: 1, declined: 1, held: 1 });
      assertEquals(await s.row(`select state, decline_reason from community.suggestions where id = $1`, [dark!.id]), { state: "declined", decline_reason: "instruction_to_agents" });
      assertEquals(await s.row(`select summary, flags from community.suggestion_triage where suggestion_id = $1`, [dark!.id]), { summary: null, flags: ["money_or_secrets", "instruction_to_agents"] });
      assertEquals(await s.row(`select state, held from community.suggestions where id = $1`, [sound!.id]), { state: "reviewed", held: true });
      assertEquals((await s.row<{ state: string }>(`select state from community.suggestions where id = $1`, [carts!.id])).state, "clustered");
      // The public list shows neither the declined instruction nor the held item.
      const listed = (await s.anon(`public.community_suggestions('new', null, null)`)).items;
      assertEquals(listed.map((i: Json) => [i.id, i.summary, i.state]), [[carts!.id, "Carts move faster.", "clustered"]]);
      // A second answer for the same suggestion writes nothing.
      const again = (await s.as("service_role", () => s.row<{ r: Json }>(`select public.scout_record_triage(null, $1) as r`, [JSON.stringify([
        { id: carts!.id, area: "dust", kind: "bug", cluster_key: "other", fit: 0.1, safety_flags: [], summary: "Other." },
      ])]))).r;
      assertEquals(again.written, 0);
    });

    await t.step("a draft from a cluster takes the Scout's fields, never the player's words, and the ship rewards the suggester", async () => {
      const cluster = (await s.row<{ id: string }>(`select id from community.suggestion_clusters where key = 'faster-carts'`)).id;
      const out = await s.board(`public.board_draft_from_cluster($1, 'top cluster')`, [cluster]);
      assertEquals(out.cluster, { id: cluster, key: "faster-carts", area: "dust", kind: "feature", fit: 0.8, summary: "Carts move faster.", votes: 3, suggestions: 1 });
      const input = (await s.row<{ input: Json }>(`select input from public.job_runs where job_name = 'draft_card' order by created_at desc limit 1`)).input;
      assertEquals(input, { cluster: out.cluster });
      assert(!JSON.stringify(input).includes("Faster carts"), "no player title in the draft input");
      const before = (await s.call(p, `public.my_profile()`)).xp;
      const cardId = await s.card("Faster carts card");
      await s.board(`public.board_link_cluster_card($1, $2, 'drafted card')`, [cluster, cardId]);
      await s.db.query(`update public.cards set stage = 'live', live_at = now() where id = $1`, [cardId]);
      const me = await s.call(p, `public.my_profile()`);
      assertEquals(me.xp - before, 150);
      assert(me.badges.some((b: Json) => b.id === "suggestion_shipped"));
      assertEquals(me.suggestions.find((x: Json) => x.clusterId === cluster).state, "live");
    });
  } finally {
    await s.close();
  }
});

Deno.test("seeds: save, publish, vote and the four orders", OPTS, async (t) => {
  const s = await studio();
  try {
    const authors = await Promise.all(Array.from({ length: 2 }, (_, i) => s.user(`a${i}@example.com`)));
    const voters = await Promise.all(Array.from({ length: 4 }, (_, i) => s.user(`sv${i}@example.com`)));
    const seeds: string[] = [];

    await t.step("save_seed checks the code against its game and the title against the filter", async () => {
      await assertRejects(() => s.call(authors[0], `public.save_seed('dust', 'other:v3:abc', 'Run', true)`), Error, "not a seed code");
      await assertRejects(() => s.call(authors[0], `public.save_seed('dust', 'dust:v3:abc', null, true)`), Error, "needs a title");
      for (let i = 0; i < 4; i += 1) seeds.push((await s.call(authors[i % 2], `public.save_seed('dust', $1, $2, true)`, [`dust:v3:AbC_-${i}`, `Run ${i}`])).id);
      const priv = (await s.call(authors[0], `public.save_seed('dust', 'dust:v3:private', null, false)`)).id;
      const gallery = await s.anon(`public.community_seeds('new', null)`);
      assertEquals(gallery.items.length, 4);
      assert(!gallery.items.some((i: Json) => i.id === priv));
    });

    await t.step("votes are one per account and never on your own seed; trending, top and new order", async () => {
      await assertRejects(() => s.call(authors[0], `public.vote_seed($1, 1::smallint)`, [seeds[0]]), Error, "own seed");
      // Seed 0 is old with 4 up; seed 3 is new with 2 up and 1 down.
      await s.db.query(`update community.seeds set created_at = now() - interval '72 hours' where id = $1`, [seeds[0]]);
      for (const v of voters) await s.call(v, `public.vote_seed($1, 1::smallint)`, [seeds[0]]);
      await s.call(voters[0], `public.vote_seed($1, 1::smallint)`, [seeds[3]]);
      await s.call(voters[1], `public.vote_seed($1, 1::smallint)`, [seeds[3]]);
      await s.call(voters[2], `public.vote_seed($1, -1::smallint)`, [seeds[3]]);
      await s.call(voters[3], `public.vote_seed($1, -1::smallint)`, [seeds[2]]);
      await s.call(voters[3], `public.vote_seed($1, 0::smallint)`, [seeds[2]]);
      const order = async (sort: string) => (await s.anon(`public.community_seeds($1, null)`, [sort])).items.map((i: Json) => seeds.indexOf(i.id));
      assertEquals((await order("top_all"))[0], 0);
      assertEquals((await order("trending"))[0], 3, "a fresh seed with net 1 beats a 72-hour-old seed with net 4");
      assertEquals((await order("new"))[0], 3);
      const trending = (await s.anon(`public.community_seeds('trending', null)`)).items;
      for (let i = 1; i < trending.length; i += 1) assert(trending[i - 1].score >= trending[i].score);
      assertEquals(trending.find((i: Json) => i.id === seeds[3]), { ...trending.find((i: Json) => i.id === seeds[3]), up: 2, down: 1 });
    });

    await t.step("the gallery pages by keyset with no repeats", async () => {
      for (let i = 0; i < 30; i += 1) await s.call(authors[1], `public.save_seed('dust', $1, $2, true)`, [`dust:v3:p${i}`, `Page ${i}`]);
      for (const sort of ["trending", "top_all", "new"]) {
        const first = await s.anon(`public.community_seeds($1, null)`, [sort]);
        assertEquals(first.items.length, 24);
        const second = await s.anon(`public.community_seeds($1, $2)`, [sort, first.next]);
        const ids = [...first.items, ...second.items].map((i: Json) => i.id);
        assertEquals(new Set(ids).size, 34, sort);
        assertEquals(second.next, null);
      }
    });

    await t.step("featuring a seed posts it and earns its author XP and a badge; unpublishing hides it", async () => {
      await s.board(`public.board_feature_seed($1, true, 'great run')`, [seeds[3]]);
      const feed = (await s.anon(`public.community_feed(null)`)).events;
      assert(feed.some((e: Json) => e.kind === "seed_featured" && /seed Run 3 was featured$/.test(e.text)));
      const author = await s.call(authors[1], `public.my_profile()`);
      assert(author.badges.some((b: Json) => b.id === "seed_featured"));
      await s.board(`public.board_unpublish_seed($1, true, 'spam')`, [seeds[3]]);
      assert(!(await s.anon(`public.community_seeds('new', null)`)).items.some((i: Json) => i.id === seeds[3]));
    });
  } finally {
    await s.close();
  }
});

Deno.test("goals, eras and the admin", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("admin functions need a board member at the second factor and log every change", async () => {
      const outsider = await s.user("someone@example.com");
      await assertRejects(() => s.call(outsider, `public.board_flags()`), Error, "Board membership is required");
      await s.signIn({ id: crypto.randomUUID(), email: BOARD_EMAIL }, "aal1");
      await assertRejects(() => s.as("authenticated", () => s.rows(`select public.board_flags()`)), Error, "A second factor is required");
      await assertRejects(() => s.as("anon", () => s.rows(`select public.board_flags()`)), Error, "permission denied");
      await assertRejects(() => s.board(`public.board_set_flag('seeds_open', 'false', '')`), Error, "reason");
      await s.board(`public.board_set_flag('seeds_open', 'false', 'pause the gallery')`);
      const log = await s.board(`public.board_moderation_log(null)`);
      assertEquals(log.items[0].action, "set_flag");
      assertEquals(log.items[0].reason, "pause the gallery");
      await assertRejects(() => s.db.exec(`delete from community.admin_log`), Error, "append-only");
    });

    await t.step("a milestone is reached by the lifetime total and posts once; the Workshop era follows at $1,000", async () => {
      const goal = (await s.board(`public.board_save_goal(null, 50000, 'Hire a sound designer', 'A Sound Designer role joins the team.', '/team', 'first milestone')`)).id;
      let goals = await s.anon(`public.community_goals()`);
      assertEquals(goals.goals.map((g: Json) => g.state), ["next"]);
      await s.pay(null, 600, null);
      goals = await s.anon(`public.community_goals()`);
      assertEquals([goals.lifetimeCents, goals.goals[0].state], [60000, "reached"]);
      await assertRejects(() => s.board(`public.board_delete_goal($1, 'oops')`, [goal]), Error, "stays on the track");
      assertEquals((await s.anon(`public.community_studio()`)).era.id, "garage");
      await s.pay(null, 500, null);
      const studio = await s.anon(`public.community_studio()`);
      assertEquals(studio.era.id, "workshop");
      assertEquals(studio.eras.map((e: Json) => e.name), ["Garage", "Workshop", "Studio", "Campus"]);
      const feed = (await s.anon(`public.community_feed(null)`)).events.map((e: Json) => e.text);
      assert(feed.includes("Milestone reached: Hire a sound designer"));
      assert(feed.includes("The studio grew into the Workshop"));
      assertEquals(feed.filter((x: string) => x.startsWith("Milestone")).length, 1);
    });

    await t.step("the board sets the era and overrides a card's face with a reason", async () => {
      assertEquals((await s.board(`public.board_set_era('campus', 'demo')`)).era.id, "campus");
      assertEquals((await s.board(`public.board_set_era('studio', 'back one')`)).era.id, "studio");
      const id = await s.card("A card");
      await s.board(`public.board_set_card_face($1, 'studio', 'legendary', 'launch card')`, [id]);
      assertEquals(await s.row(`select suit, rarity from public.cards where id = $1`, [id]), { suit: "studio", rarity: "legendary" });
      const log = (await s.board(`public.board_moderation_log(null)`)).items[0];
      assertEquals([log.action, log.details.rarity.to], ["set_card_face", "legendary"]);
      await assertRejects(() => s.board(`public.board_set_card_face($1, 'gold', null, 'x')`, [id]), Error, "Bad suit");
    });

    await t.step("the community migrations apply a second time without error and keep their rows", async () => {
      const before = await s.rows(`select id from community.events order by id`);
      for (const name of COMMUNITY) await s.db.exec(await s.sqlOf(name));
      assertEquals(await s.rows(`select id from community.events order by id`), before);
      assertEquals((await s.row<{ n: number }>(`select count(*)::int as n from community.badges`)).n, 12);
    });
  } finally {
    await s.close();
  }
});
