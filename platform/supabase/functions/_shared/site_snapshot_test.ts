// The site-snapshot migration on PGlite (docs/specs/site-snapshot.md): site_live() and
// site_cards() are stable and security invoker, executable by anon and not by public, return only
// the cards columns anon may select, hold exactly the listed set of cards (every card on an open
// stage or paused, the newest 200 live and the newest 50 rejected) with the same ids in both
// documents, carry every key the public site requires with its JSON type, and apply twice. Every
// migration runs in order behind the same Supabase shim as agent_workflows_test.ts.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20260924500000_site_snapshot.sql";
const SNAPSHOT_KEYS = new URL("../../../site/src/lib/snapshot-keys.json", import.meta.url);
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
  // PGlite hands jsonb back parsed; the documents are read as anon, as the function reads them.
  const live = () => asAnon(async () => (await row<{ d: Doc }>(`select public.site_live() as d`)).d);
  const cards = () => asAnon(async () => (await row<{ d: Doc }>(`select public.site_cards() as d`)).d);

  await db.exec(SHIM);
  const migrations = await readMigrations();
  for (const m of migrations) await db.exec(m.sql);
  await db.exec(
    `insert into public.studio_state (id, credit_daily_cap_usd, credit_studio_daily_cap_usd, card_max_usd, daily_cap_usd, monthly_cap_usd, reserve_pct, incident_cap_usd)
       values (1, 10000, 10000, 5, 100, 500, 0, 0);
     insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);`,
  );
  const roleId = (await row<{ id: string }>(
    `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, write_access, agent_class)
     values ('Builder A', 'Builder A', 'A small creature.', 'model-id', 0.1, 'plain', 'platform/agents/prompts/x.md', true, 'writer') returning id`,
  )).id;
  /** Inserts n board cards on one stage, the k-th made k minutes after the base time. */
  const insertCards = async (stage: string, n: number, base: string) => {
    await db.query(
      `insert into public.cards (bucket, source, shape, lane, folder, title, intent, stage, horizon, executor_role_id, created_at, updated_at, live_at)
       select 'game', 'board', 'goal', 'config', 'seed-1', $1 || ' ' || k, 'An intent.', $1::public.card_stage, 'now', $2,
         $3::timestamptz + make_interval(mins => k), $3::timestamptz + make_interval(mins => k),
         case when $1 = 'live' then $3::timestamptz + make_interval(mins => k) end
       from generate_series(1, $4::int) k`,
      [stage, roleId, base, n],
    );
  };
  return { db, row, rows, asAnon, live, cards, insertCards, migrations, roleId, close: () => db.close() };
}

Deno.test("site_live and site_cards are stable, security invoker, anon's and not public's, and apply twice", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("the migration applies a second time", async () => {
      await s.db.exec(s.migrations.find((m) => m.name === MIGRATION)!.sql);
    });

    await t.step("each is language sql, stable, security invoker, with search_path public", async () => {
      const fns = await s.rows<{ proname: string; prosecdef: boolean; provolatile: string; lang: string; config: string[] | null }>(
        `select p.proname, p.prosecdef, p.provolatile, l.lanname as lang, p.proconfig as config
         from pg_proc p join pg_language l on l.oid = p.prolang
         where p.pronamespace = 'public'::regnamespace and p.proname in ('site_live', 'site_cards') order by p.proname`,
      );
      assertEquals(fns.map((f) => [f.proname, f.prosecdef, f.provolatile, f.lang, f.config]), [
        ["site_cards", false, "s", "sql", ["search_path=public"]],
        ["site_live", false, "s", "sql", ["search_path=public"]],
      ]);
    });

    await t.step("anon, authenticated and the service role may execute each; public may not", async () => {
      for (const fn of ["site_live", "site_cards"]) {
        for (const role of ["anon", "authenticated", "service_role"]) {
          assertEquals((await s.row<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [role, `public.${fn}()`])).ok, true, `${role} ${fn}`);
        }
        const acl = (await s.row<{ acl: string[] }>(`select proacl::text[] as acl from pg_proc where proname = $1`, [fn])).acl;
        assert(!acl.some((entry) => entry.startsWith("=")), `public holds no grant on ${fn}: ${acl.join(" ")}`);
      }
    });
  } finally {
    await s.close();
  }
});

Deno.test("site_cards returns only the cards columns anon may select, and both documents carry every key the site requires", OPTS, async (t) => {
  const s = await studio();
  try {
    await s.insertCards("voted", 1, "2026-09-10T00:00:00Z");
    await s.insertCards("live", 1, "2026-09-11T00:00:00Z");

    await t.step("each card object's keys equal the anon-selectable cards columns", async () => {
      const granted = (await s.rows<{ column_name: string }>(
        `select column_name from information_schema.column_privileges
         where table_schema = 'public' and table_name = 'cards' and grantee = 'anon' and privilege_type = 'SELECT'
         order by column_name`,
      )).map((r) => r.column_name);
      assert(granted.length > 0, "anon holds a column grant on cards");
      assert(!granted.includes("actual_usd") && !granted.includes("priority") && !granted.includes("severity"), "the withheld columns stay withheld");
      const doc = await s.cards();
      const list = doc.cards as Doc[];
      assertEquals(list.length, 2);
      for (const card of list) assertEquals(Object.keys(card).sort(), granted);
    });

    await t.step("every key in snapshot-keys.json is present with its JSON type, in both documents and every card of the live map", async () => {
      const spec = JSON.parse(await Deno.readTextFile(SNAPSHOT_KEYS)) as { live: KeySpec; live_card: KeySpec; cards: KeySpec };
      const liveDoc = await s.live();
      const entries = Object.entries(liveDoc.cards as Record<string, Doc>).map(([id, entry]) => [`live.cards.${id}`, entry, spec.live_card] as const);
      assertEquals(entries.length, 2);
      for (const [name, doc, keys] of [["live", liveDoc, spec.live], ["cards", await s.cards(), spec.cards], ...entries] as const) {
        for (const [key, allowed] of Object.entries(keys)) {
          assert(key in doc, `${name} has ${key}`);
          const types = Array.isArray(allowed) ? allowed : [allowed];
          assert(types.includes(jsonType(doc[key])), `${name}.${key} is ${jsonType(doc[key])}, expected ${types.join(" or ")}`);
        }
      }
    });

    await t.step("the live map carries each card's state; events carry their card's title", async () => {
      const [card] = (await s.cards()).cards as Doc[];
      await s.db.query(`insert into public.agent_events (card_id, role_id, type) values ($1, $2, 'start')`, [card!.id, s.roleId]);
      const doc = await s.live();
      const entry = (doc.cards as Record<string, Doc>)[card!.id as string]!;
      assertEquals(Object.keys(entry).sort(), [
        "contributors", "credited_usd", "executor_role_id", "funded_usd", "funding_target_usd", "horizon", "live_at", "rank", "spent_usd", "stage", "updated_at",
      ]);
      assertEquals([entry.stage, entry.funded_usd, entry.spent_usd, entry.contributors, entry.credited_usd], ["voted", 0, 0, null, null]);
      const [event] = doc.events as Doc[];
      assertEquals([event!.card_id, event!.card_title, event!.type], [card!.id, card!.title, "start"]);
      assertEquals(Object.keys(doc.pool as Doc).sort(), ["balance_usd", "daily_spent_usd", "day", "held_usd", "incident_reserve_usd", "reserve_usd"]);
      assertEquals(Object.keys(doc.studio as Doc).sort(), ["launched_at", "pause_reason", "paused", "platform_lane_open"]);
      assert(Array.isArray((doc.money as Doc).funding_order), "money carries funding_order");
    });

    await t.step("a card that ships or is dealt to now shows its new ship time, horizon, rank, target and builder in the live map, as site_cards has them", async () => {
      // The site takes these from the live map (60 seconds) and a card's words from the card document
      // (300), so the two must hold the same values for every column the live map carries.
      const MOVING = ["stage", "horizon", "rank", "executor_role_id", "funding_target_usd", "funded_usd", "live_at", "updated_at"];
      const same = async () => {
        const liveMap = (await s.live()).cards as Record<string, Doc>;
        for (const row of (await s.cards()).cards as Doc[]) {
          const entry = liveMap[row.id as string]!;
          for (const key of MOVING) assertEquals(entry[key], row[key], `${row.title} ${key}`);
        }
        return liveMap;
      };
      await same();
      const voted = ((await s.cards()).cards as Doc[]).find((c) => c.stage === "voted")!;
      await s.db.query(`update public.cards set stage = 'live' where id = $1`, [voted.id]);
      const shipped = (await same())[voted.id as string]!;
      assertEquals(shipped.stage, "live");
      assert(typeof shipped.live_at === "string", "the ship stamps live_at, and the live map carries it");
      await s.db.query(
        `insert into public.cards (bucket, source, shape, lane, folder, title, intent, stage, horizon, rank)
         values ('game', 'board', 'goal', 'config', 'seed-1', 'Planned', 'An intent.', 'proposed', 'next', 4)`,
      );
      const planned = ((await s.cards()).cards as Doc[]).find((c) => c.title === "Planned")!;
      assertEquals([((await same())[planned.id as string]!).horizon, ((await same())[planned.id as string]!).rank], ["next", 4]);
      await s.db.query(`update public.cards set horizon = 'now', rank = 1, funding_target_usd = 4, executor_role_id = $2 where id = $1`, [planned.id, s.roleId]);
      const dealt = (await same())[planned.id as string]!;
      assertEquals([dealt.horizon, dealt.rank, dealt.funding_target_usd, dealt.executor_role_id], ["now", 1, 4, s.roleId]);
    });
  } finally {
    await s.close();
  }
});

Deno.test("with 1,100 live cards and cards on every other stage, both documents hold exactly the listed set", OPTS, async (t) => {
  const s = await studio();
  try {
    await s.insertCards("live", 1100, "2026-01-01T00:00:00Z");
    await s.insertCards("rejected", 60, "2026-02-01T00:00:00Z");
    for (const stage of ["proposed", "designing", "voted", "funded", "building", "gated", "paused"]) await s.insertCards(stage, 2, "2026-03-01T00:00:00Z");
    for (let k = 0; k < 25; k += 1) await s.db.query(`insert into public.agent_events (role_id, type, created_at) values ($1, 'message', now() - make_interval(mins => $2))`, [s.roleId, k]);
    for (let k = 0; k < 12; k += 1) await s.db.query(`insert into public.deploys (folder, sha, is_green, created_at) values ('seed-1', $1, true, now() - make_interval(mins => $2))`, [`sha${k}`, k]);

    const expected = async (stage: string, order: string, limit: number | null) =>
      (await s.rows<{ id: string }>(`select id from public.cards where stage = $1 order by ${order}, id desc ${limit === null ? "" : `limit ${limit}`}`, [stage])).map((r) => r.id);

    await t.step("site_cards holds every open and paused card, the newest 200 live and the newest 50 rejected", async () => {
      const list = (await s.cards()).cards as Doc[];
      const ids = list.map((c) => c.id as string);
      assertEquals(new Set(ids).size, ids.length, "no card twice");
      const want = [
        ...(await expected("live", "live_at desc", 200)),
        ...(await expected("rejected", "updated_at desc", 50)),
      ];
      for (const stage of ["proposed", "designing", "voted", "funded", "building", "gated", "paused"]) want.push(...(await expected(stage, "created_at", null)));
      assertEquals([...ids].sort(), [...want].sort());
      assertEquals(list.filter((c) => c.stage === "live").length, 200);
      assertEquals(list.filter((c) => c.stage === "rejected").length, 50);
      const created = list.map((c) => String(c.created_at));
      assertEquals(created, [...created].sort(), "oldest first");
    });

    await t.step("site_live's card map covers the same ids", async () => {
      const cardIds = ((await s.cards()).cards as Doc[]).map((c) => c.id as string).sort();
      const liveIds = Object.keys((await s.live()).cards as Doc).sort();
      assertEquals(liveIds, cardIds);
    });

    await t.step("the live document holds the newest 20 events, the newest 10 deploys and at most 12 stopped cards", async () => {
      const doc = await s.live();
      assertEquals((doc.events as Doc[]).length, 20);
      assertEquals((doc.deploys as Doc[]).length, 10);
      assertEquals((doc.deploys as Doc[])[0]!.sha, "sha0");
      assertEquals(Object.keys((doc.deploys as Doc[])[0]!).sort(), ["created_at", "folder", "id", "is_green", "sha"]);
      assert((doc.stopped as Doc[]).length <= 12);
      assertEquals((doc.stopped as Doc[]).length, 12, "62 stopped cards on now, the newest 12 listed");
    });
  } finally {
    await s.close();
  }
});

Deno.test("BOARD-SETUP's pause statement does what set_paused(true) does, and the live document shows it", OPTS, async (t) => {
  const s = await studio();
  try {
    const setup = await Deno.readTextFile(new URL("../../../../docs/BOARD-SETUP.md", import.meta.url));
    const section = setup.slice(setup.indexOf("## Pause when the board site is down"));
    const statement = section.match(/```sql\n\s*([^\n]+)\n\s*```/)?.[1]?.trim();
    assert(statement !== undefined && statement.startsWith("update public.studio_state set paused = true"), "BOARD-SETUP carries one pause statement");
    const state = async () =>
      await s.row<{ paused: boolean; pause_reason: string | null; paused_by: string | null; paused_set: boolean }>(
        `select paused, pause_reason, paused_by, paused_at is not null as paused_set from public.studio_state where id = 1`,
      );
    const email = "board@peanutgallery.games";
    await s.db.query(`insert into public.board_members (email, role) values ($1, 'board') on conflict do nothing`, [email]);
    await s.db.exec(`update public.studio_state set paused = false where id = 1`);

    await t.step("set_paused(true) from the board site: paused, the board's reason, who and when", async () => {
      const before = await state();
      assertEquals([before.paused, before.pause_reason], [false, null]);
      await s.db.query(`select set_config('request.jwt.claim.email', $1, false)`, [email]);
      await s.db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ email, aal: "aal2" })]);
      await s.db.exec(`set role authenticated`);
      try {
        await s.db.exec(`select public.set_paused(true)`);
      } finally {
        await s.db.exec(`reset role`);
      }
      const after = await state();
      assertEquals([after.paused, after.pause_reason, after.paused_by, after.paused_set], [true, "board", email, true]);
      console.log(`set_paused(true): before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
      await s.db.exec(`update public.studio_state set paused = false, paused_by = null, paused_at = null where id = 1`);
    });

    await t.step("the SQL editor statement: the same pause and reason, with the SQL editor as who", async () => {
      const before = await state();
      assertEquals([before.paused, before.pause_reason], [false, null]);
      await s.db.exec(statement!);
      const after = await state();
      assertEquals([after.paused, after.pause_reason, after.paused_by, after.paused_set], [true, "board", "sql-editor", true]);
      console.log(`BOARD-SETUP statement: before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
      const studioDoc = (await s.live()).studio as Doc;
      assertEquals([studioDoc.paused, studioDoc.pause_reason], [true, "board"]);
    });
  } finally {
    await s.close();
  }
});
