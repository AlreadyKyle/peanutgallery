// The supply-every-minute migration on PGlite (docs/specs/always-open.md, docs/PLAN.md §10 decision
// 71): supply_draft_check() answers no_money after a draft run failed for want of money until a
// contribution is credited, and for a cap only on the New York day it failed; public_supply()'s next
// check is the next minute. Every migration runs in order, as supply_refill_test.ts runs them.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
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

// Every migration, then the studio row, the pool and the two drafting roles, and the migrations that
// link jobs to roles run again with the roles in place, as supply_refill_test.ts seeds its studio.
async function migrated(): Promise<PGlite> {
  const db = new PGlite();
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
  for (const [name, klass] of [["Game Designer", "planner"], ["Game Director", "reviewer"]]) {
    await db.query(
      `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, write_access, agent_class)
       values ($1, $1, 'A small creature.', 'model-id', 0.1, 'plain', 'platform/agents/prompts/x.md', $2, $3)`,
      [name, klass === "planner", klass],
    );
  }
  for (const name of ["20260924400000_agent_workflows.sql", "20261010200000_supply_refill.sql", "20261011200000_supply_every_minute.sql"]) {
    await db.exec(await sqlOf(name));
  }
  return db;
}

const check = async (db: PGlite) => (await db.query<{ r: Row }>(`select public.supply_draft_check() as r`)).rows[0]!.r;
const failRun = async (db: PGlite, reason: string, finishedAt = "now()") => {
  await db.exec(`update public.job_runs set status = 'skipped', reason = 'test' where job_name = 'draft_card' and status in ('queued', 'running')`);
  await db.query(
    `insert into public.job_runs (job_name, idem_key, origin, status, reason, started_at, finished_at)
     values ('draft_card', gen_random_uuid()::text, 'schedule', 'failed', $1, ${finishedAt}, ${finishedAt})`,
    [reason],
  );
};

Deno.test("no_money holds after a draft fails for want of money, until a contribution is credited", OPTS, async (t) => {
  const db = await migrated();
  try {
    await t.step("a short supply with no failure may draft", async () => {
      const c = await check(db);
      assertEquals([c.short, c.reason], [true, null]);
    });

    await t.step("after an insufficient_balance failure: no_money, and enqueue queues nothing", async () => {
      await failRun(db, "insufficient_balance: a draft session's budget of 0.75 USD is more than the 0.7447 USD left");
      assertEquals((await check(db)).reason, "no_money");
      const r = (await db.query<{ r: Row }>(`select public.enqueue_supply_draft() as r`)).rows[0]!.r;
      assertEquals([r.queued, r.reason], [false, "no_money"]);
    });

    await t.step("a contribution credited after the failure clears it", async () => {
      await db.exec(`insert into public.contributions (rail, contributor_id, entry, payer_key, credited_at) values ('stripe', 'contrib_test', 'payment', 'email:test', now() + interval '1 second')`);
      assertEquals((await check(db)).reason, null);
    });

    await t.step("a money failure over an hour old no longer holds, since a finished build frees money", async () => {
      await failRun(db, "insufficient_balance: budget", "now() - interval '61 minutes'");
      assertEquals((await check(db)).reason, null);
    });

    await t.step("a daily cap holds only on the New York day it failed", async () => {
      await failRun(db, "daily_cap: the daily cap of 100 USD");
      assertEquals((await check(db)).reason, "no_money");
      const yesterday = `(((now() at time zone 'America/New_York')::date)::timestamp at time zone 'America/New_York') - interval '1 minute'`;
      await failRun(db, "daily_cap: the daily cap of 100 USD", yesterday);
      await db.exec(`delete from public.job_runs where job_name = 'draft_card' and finished_at >= (((now() at time zone 'America/New_York')::date)::timestamp at time zone 'America/New_York')`);
      assertEquals((await check(db)).reason, null);
    });

    await t.step("a failure that is not for money does not hold", async () => {
      await failRun(db, "stream_lost");
      assertEquals((await check(db)).reason, null);
    });

    await t.step("public_supply's next check is the next minute", async () => {
      const doc = (await db.query<{ r: Row }>(`select public.public_supply() as r`)).rows[0]!.r;
      const next = new Date(doc.next_check_at as string).getTime();
      const now = Date.now();
      assert(next > now - 1000 && next - now <= 61_000, `${doc.next_check_at} is within the next minute`);
    });
  } finally {
    await db.close();
  }
});
