// The honest-status migration on PGlite (docs/specs/honest-status.md, docs/PLAN.md §10 decision 77):
// public_supply()'s drafting is true only while a draft_card run is running and the dispatcher checked
// in under 15 minutes ago, and its offline flag is true while the dispatcher has never checked in or
// not for 24 hours. The live document carries both as studio.supply, read as anon. Every migration
// runs in order, as site_snapshot_test.ts runs them.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals } from "jsr:@std/assert@1";
import { migrationOrder, forPglite, SHIM } from "../../lib/pglite-migrations.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261019000000_honest_status.sql";
const OPTS = { sanitizeOps: false, sanitizeResources: false };

type Doc = Record<string, unknown>;

async function studio() {
  const db = new PGlite();
  await db.exec(SHIM);
  const files: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) if (entry.isFile) files.push(entry.name);
  const sqlOf = async (name: string) => forPglite(await Deno.readTextFile(new URL(name, MIGRATIONS_DIR)));
  for (const name of migrationOrder(files)) await db.exec(await sqlOf(name));
  await db.exec(
    `insert into public.studio_state (id, credit_daily_cap_usd, credit_studio_daily_cap_usd, card_max_usd, daily_cap_usd, monthly_cap_usd, reserve_pct, incident_cap_usd)
       values (1, 10000, 10000, 5, 100, 500, 0, 0);
     insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);`,
  );
  const supply = async () => {
    await db.exec(`set role anon`);
    try {
      const live = (await db.query<{ d: Doc }>(`select public.site_live() as d`)).rows[0]!.d;
      return (live.studio as Doc).supply as Doc;
    } finally {
      await db.exec(`reset role`);
    }
  };
  /** Sets when the dispatcher last checked in: an interval before now, or null for never. */
  const seen = async (ago: string | null) => {
    await db.query(`update public.studio_state set dispatcher_seen_at = case when $1::text is null then null else now() - $1::interval end where id = 1`, [ago]);
  };
  /** Leaves exactly one draft_card run, in the status given and made `ago` before now; null leaves none. */
  const draftRun = async (status: "queued" | "running" | null, ago = "1 minute") => {
    await db.exec(`delete from public.job_runs where job_name = 'draft_card'`);
    if (status === null) return;
    await db.query(
      `insert into public.job_runs (job_name, idem_key, origin, status, created_at, started_at)
       values ('draft_card', gen_random_uuid()::text, 'schedule', $1, now() - $2::interval, case when $1 = 'running' then now() - $2::interval end)`,
      [status, ago],
    );
  };
  return { db, supply, seen, draftRun, sqlOf, close: () => db.close() };
}

Deno.test("honest-status: drafting needs a running draft and a dispatcher seen in 15 minutes, and offline follows 24 hours", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("public_supply keeps its signature, stable and security definer with search_path public, anon's and not public's", async () => {
      const fn = (await s.db.query<{ sec: boolean; v: string; config: string[]; args: string }>(
        `select prosecdef as sec, provolatile as v, proconfig as config, pg_get_function_identity_arguments(oid) as args from pg_proc where proname = 'public_supply'`,
      )).rows;
      assertEquals(fn.map((f) => [f.sec, f.v, f.config, f.args]), [[true, "s", ["search_path=public"], ""]]);
      for (const role of ["anon", "authenticated", "service_role"]) {
        assertEquals((await s.db.query<{ ok: boolean }>(`select has_function_privilege($1, 'public.public_supply()', 'execute') as ok`, [role])).rows[0]!.ok, true, role);
      }
      const acl = (await s.db.query<{ acl: string[] }>(`select proacl::text[] as acl from pg_proc where proname = 'public_supply'`)).rows[0]!.acl;
      assert(!acl.some((entry) => entry.startsWith("=")), `public holds no grant on public_supply: ${acl.join(" ")}`);
    });

    await t.step("as anon, studio.supply has exactly seven keys: the six before it and the offline flag", async () => {
      const doc = await s.supply();
      assertEquals(Object.keys(doc).sort(), ["drafting", "next_check_at", "offline", "reason", "run_limit", "runs_today", "short"]);
      assertEquals([typeof doc.drafting, typeof doc.offline], ["boolean", "boolean"]);
    });

    await t.step("a dispatcher that never checked in: offline, and nothing is drafting even with a running draft", async () => {
      await s.seen(null);
      await s.draftRun("running");
      const doc = await s.supply();
      assertEquals([doc.drafting, doc.offline], [false, true]);
    });

    await t.step("a queued draft with the dispatcher seen a minute ago is not drafting: nothing has picked it up", async () => {
      await s.seen("1 minute");
      await s.draftRun("queued");
      const doc = await s.supply();
      assertEquals([doc.drafting, doc.offline, doc.reason], [false, false, "already_queued"]);
    });

    await t.step("a running draft with the dispatcher seen a minute ago is drafting", async () => {
      await s.seen("1 minute");
      await s.draftRun("running");
      const doc = await s.supply();
      assertEquals([doc.drafting, doc.offline], [true, false]);
    });

    await t.step("the dispatcher seen 14 minutes ago still drafts; 16 minutes ago it does not, and is not yet offline", async () => {
      await s.draftRun("running");
      await s.seen("14 minutes");
      assertEquals((await s.supply()).drafting, true);
      await s.seen("16 minutes");
      const doc = await s.supply();
      assertEquals([doc.drafting, doc.offline], [false, false]);
    });

    await t.step("offline once the dispatcher has not checked in for 24 hours", async () => {
      await s.draftRun(null);
      await s.seen("23 hours 59 minutes");
      assertEquals((await s.supply()).offline, false);
      await s.seen("24 hours 1 minute");
      assertEquals((await s.supply()).offline, true);
    });

    await t.step("production on 19 October 2026: seen four days ago and a draft queued three days ago reads offline and not drafting", async () => {
      await s.seen("4 days");
      await s.draftRun("queued", "3 days");
      const doc = await s.supply();
      assertEquals([doc.drafting, doc.offline, doc.reason, doc.runs_today], [false, true, "already_queued", 0]);
    });

    await t.step("a paused studio with the dispatcher seen a minute ago is not offline: the pause shows nothing", async () => {
      await s.db.exec(`update public.studio_state set paused = true where id = 1`);
      await s.seen("1 minute");
      await s.draftRun(null);
      const doc = await s.supply();
      assertEquals([doc.drafting, doc.offline, doc.reason], [false, false, "studio_paused"]);
      await s.db.exec(`update public.studio_state set paused = false where id = 1`);
    });

    await t.step("the migration applies a second time", async () => {
      await s.db.exec(await s.sqlOf(MIGRATION));
      assertEquals(Object.keys(await s.supply()).length, 7);
    });
  } finally {
    await s.close();
  }
});
