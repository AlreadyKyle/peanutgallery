// The agent-upkeep migration on PGlite (docs/specs/agent-upkeep.md): the findings table and its two
// RPCs, schema_fingerprint(), producer_signals() and the two jobs. Every migration runs in order
// behind the shared Supabase shim (lib/pglite-migrations.ts), and this one a second time.
// - record_finding returns true for a new finding, false while it stays open, and true again after
//   close_finding; it refuses a blank fingerprint or subject, an unknown kind and a detail that is
//   not an object.
// - schema_fingerprint() gives the same answer twice, and a changed column type, function body,
//   policy, RLS flag or anon grant changes that object's entry and no other.
// - producer_signals() names one signal per fixture (unclaimed, overrun, throughput) and none on a
//   quiet studio.
// - findings and the four functions are closed to anon; only a board member reads a finding, and
//   only the service role executes the functions.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert@1";
import { forPglite, migrationOrder, SHIM } from "../../lib/pglite-migrations.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20260925300000_agent_upkeep.sql";
const OPTS = { sanitizeOps: false, sanitizeResources: false };
const BOARD_EMAIL = "board@peanutgallery.games";

type Row = Record<string, unknown>;

async function readMigrations(): Promise<{ name: string; sql: string }[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) if (entry.isFile) files.push(entry.name);
  return await Promise.all(migrationOrder(files).map(async (name) => ({ name, sql: forPglite(await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))) })));
}

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
  const fingerprint = async () => (await row<{ fp: Record<string, string> }>(`select public.schema_fingerprint() as fp`)).fp;
  const record = async (fp: string, kind = "schema", subject = "table:public.cards", detail: unknown = {}) =>
    (await row<{ opened: boolean }>(`select public.record_finding($1, $2, $3, $4::jsonb) as opened`, [fp, kind, subject, JSON.stringify(detail)])).opened;
  const close = async (fp: string) => (await row<{ closed: boolean }>(`select public.close_finding($1) as closed`, [fp])).closed;
  const signals = async () =>
    await rows<{ kind: string; card_id: string | null; executor: string | null; figures: Record<string, unknown> }>(`select * from public.producer_signals() order by kind, card_id`);
  return { db, row, rows, as, migrations, fingerprint, record, close, signals, closeDb: () => db.close() };
}

/** The keys whose entry differs between two fingerprints, or that only one of them has. */
function changedKeys(a: Record<string, string>, b: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => a[key] !== b[key]).sort();
}

Deno.test("agent-upkeep: findings, the schema fingerprint and the producer signals", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("the migration applies a second time, and a Janitor role row is picked up for both jobs", async () => {
      assertEquals(s.migrations.at(-1)?.name, MIGRATION);
      const janitor = (await s.row<{ id: string }>(
        `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path) values ('Janitor', 'Janitor', 'A short orange creature.', 'model-id', 0, 'tidy', 'platform/agents/prompts/janitor.md') returning id`,
      )).id;
      await s.db.exec(s.migrations.at(-1)!.sql);
      const jobs = await s.rows<{ name: string; role_id: string; calls_model: boolean; runs_when_paused: boolean }>(
        `select name, role_id, calls_model, runs_when_paused from public.jobs where name in ('janitor', 'upkeep_merge') order by name`,
      );
      assertEquals(jobs, [
        { name: "janitor", role_id: janitor, calls_model: false, runs_when_paused: true },
        { name: "upkeep_merge", role_id: janitor, calls_model: false, runs_when_paused: false },
      ]);
      // pg_cron queues each through enqueue_job_run; PGlite has no pg_cron, so the call it makes runs here.
      const queued = await s.row<{ r: { created: boolean } }>(`select public.enqueue_job_run('janitor', 'schedule') as r`);
      assertEquals(queued.r.created, true);
      assertEquals((await s.row<{ r: { created: boolean } }>(`select public.enqueue_job_run('upkeep_merge', 'schedule') as r`)).r.created, true);
    });

    await t.step("record_finding returns true when new, false while open, and true again after close_finding", async () => {
      assertEquals(await s.record("schema:table:public.cards", "schema", "table:public.cards", { production: "a", pglite: "b" }), true);
      assertEquals(await s.record("schema:table:public.cards", "schema", "table:public.cards", { production: "a", pglite: "c" }), false);
      const open = await s.row<{ detail: Row; closed_at: string | null; seen_later: boolean }>(
        `select detail, closed_at, last_seen_at >= opened_at as seen_later from public.findings where fingerprint = 'schema:table:public.cards'`,
      );
      assertEquals(open, { detail: { production: "a", pglite: "c" }, closed_at: null, seen_later: true });
      assertEquals(await s.close("schema:table:public.cards"), true);
      assertEquals(await s.close("schema:table:public.cards"), false);
      assertEquals(await s.close("never:recorded"), false);
      assertEquals(await s.record("schema:table:public.cards", "schema", "table:public.cards"), true);
      assertEquals((await s.row<{ closed_at: string | null }>(`select closed_at from public.findings where fingerprint = 'schema:table:public.cards'`)).closed_at, null);
      await s.close("schema:table:public.cards");
    });

    await t.step("record_finding refuses a blank fingerprint or subject, an unknown kind and a detail that is not an object", async () => {
      await assertRejects(() => s.record(" "), Error, "A finding needs a fingerprint");
      await assertRejects(() => s.record("x:1", "stale"), Error, "The kind must be schema, model, cli, scan or producer");
      await assertRejects(() => s.record("x:1", "scan", " "), Error, "A finding needs a subject");
      await assertRejects(() => s.record("x:1", "scan", "osv", [1]), Error, "The detail must be a JSON object");
      assertEquals((await s.row<{ n: number }>(`select count(*)::int as n from public.findings where fingerprint = 'x:1'`)).n, 0);
    });

    await t.step("schema_fingerprint gives one entry per object, the same twice", async () => {
      const first = await s.fingerprint();
      const second = await s.fingerprint();
      assertEquals(first, second);
      for (
        const key of [
          "table:public.findings",
          "table:public.cards",
          "function:money.lane_open()",
          "view:public.dispatcher_cards",
          "function:public.record_finding(p_fingerprint text, p_kind text, p_subject text, p_detail jsonb)",
          "function:public.schema_fingerprint()",
          "trigger:public.cards.cards_agent_text_guard",
          "policy:public.findings.findings_board_read",
        ]
      ) assert(key in first, `${key} is fingerprinted`);
      for (const [key, hash] of Object.entries(first)) {
        assert(/^(table|view|function|trigger|policy):(public|money)\./.test(key), `${key} is an app object`);
        assert(/^[0-9a-f]{32}$/.test(hash), `${key} is an md5`);
      }
      assert(Object.keys(first).length > 150, `${Object.keys(first).length} objects`);
    });

    await t.step("a changed column type, function body, policy, RLS flag or anon grant changes that object's entry and no other", async () => {
      const cases: Array<{ what: string; change: string; undo: string; key: string }> = [
        {
          what: "column type",
          change: `alter table public.findings alter column subject type varchar(500)`,
          undo: `alter table public.findings alter column subject type text`,
          key: "table:public.findings",
        },
        {
          what: "function body",
          change: `create or replace function public.close_finding(p_fingerprint text) returns boolean language plpgsql security definer set search_path = public as $$ begin return false; end; $$`,
          undo: s.migrations.at(-1)!.sql.slice(
            s.migrations.at(-1)!.sql.indexOf("create or replace function public.close_finding"),
            s.migrations.at(-1)!.sql.indexOf("-- c. schema_fingerprint"),
          ),
          key: "function:public.close_finding(p_fingerprint text)",
        },
        {
          what: "policy",
          change: `alter policy findings_board_read on public.findings using (true)`,
          undo: `alter policy findings_board_read on public.findings using (public.is_board_member())`,
          key: "policy:public.findings.findings_board_read",
        },
        {
          what: "RLS flag",
          change: `alter table public.findings disable row level security`,
          undo: `alter table public.findings enable row level security`,
          key: "table:public.findings",
        },
        {
          what: "anon grant",
          change: `grant select on public.findings to anon`,
          undo: `revoke select on public.findings from anon`,
          key: "table:public.findings",
        },
        {
          what: "anon execute grant",
          change: `grant execute on function public.producer_signals() to anon`,
          undo: `revoke execute on function public.producer_signals() from anon`,
          key: "function:public.producer_signals()",
        },
      ];
      const before = await s.fingerprint();
      for (const c of cases) {
        await s.db.exec(c.change);
        const changed = await s.fingerprint();
        assertEquals(changedKeys(before, changed), [c.key], c.what);
        await s.db.exec(c.undo);
        assertEquals(await s.fingerprint(), before, `${c.what} undone`);
      }
      // A new object is one key that only one side has.
      await s.db.exec(`create table public.stray (id integer)`);
      assertEquals(changedKeys(before, await s.fingerprint()), ["table:public.stray"]);
      await s.db.exec(`drop table public.stray`);
      // An event trigger function, such as the one Supabase's ensure_rls trigger puts in production's
      // public schema, is not part of the app and is left out.
      await s.db.exec(`create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin null; end; $$`);
      assertEquals(changedKeys(before, await s.fingerprint()), []);
      await s.db.exec(`drop function public.rls_auto_enable()`);
    });

    await t.step("producer_signals is empty on a quiet studio", async () => {
      assertEquals(await s.signals(), []);
    });

    await t.step("producer_signals names each signal on its fixture", async () => {
      const builder = (await s.row<{ id: string }>(
        `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path) values ('Builder A', 'Builder A', 'A small blue creature.', 'model-id', 0.2, 'plain', 'platform/agents/prompts/builder-a.md') returning id`,
      )).id;
      // The studio runs. Fixture writes: updated_at and live_at are set by triggers, so user triggers
      // are off while the rows are written.
      await s.db.exec(`insert into public.studio_state (id, paused) values (1, false)`);
      await s.db.exec(`alter table public.cards disable trigger user`);
      const card = async (title: string, stage: string, updatedAgo: string, extra: { failing?: string; liveAgo?: string } = {}) =>
        (await s.row<{ id: string }>(
          `insert into public.cards (bucket, source, shape, lane, folder, title, intent, funding_target_usd, funded_usd, estimate_usd, actual_usd, stage, horizon, executor_role_id, failing_check, updated_at, live_at)
           values ('game', 'board', 'goal', 'code', 'seed-1', $1, 'An intent.', 5, 5, 2, 3, $2::public.card_stage, 'now', $3, $4, now() - $5::interval, case when $6::text is null then null else now() - $6::interval end) returning id`,
          [title, stage, builder, extra.failing ?? null, updatedAgo, extra.liveAgo ?? null],
        )).id;
      const unclaimed = await card("Waiting a day", "funded", "25 hours");
      await card("Funded an hour ago", "funded", "1 hour");
      const overrun = await card("Over its ceiling", "paused", "2 days", { failing: "ceiling" });
      await card("Paused long ago", "paused", "9 days", { failing: "ceiling" });
      await card("Paused for another reason", "paused", "1 day", { failing: "paused_by_board" });
      // Four ships the week before, one this week: fewer than half, while funded cards wait.
      for (const ago of ["8 days", "9 days", "10 days", "12 days"]) await card(`Shipped ${ago} ago`, "live", ago, { liveAgo: ago });
      await card("Shipped yesterday", "live", "1 day", { liveAgo: "1 day" });
      await s.db.exec(`alter table public.cards enable trigger user`);

      const found = await s.signals();
      assertEquals(found.map((f) => [f.kind, f.card_id, f.executor]), [
        ["overrun", overrun, "Builder A"],
        ["throughput", null, null],
        ["unclaimed", unclaimed, "Builder A"],
      ]);
      const throughput = found.find((f) => f.kind === "throughput")!.figures;
      assertEquals([throughput.last_7_days, throughput.previous_7_days, throughput.funded_waiting], [1, 4, 2]);
      assert(/^\d{4}-W\d{2}$/.test(String(throughput.week)), `week ${throughput.week}`);
      assertEquals(found.find((f) => f.kind === "unclaimed")!.figures.hours, 25);

      // A paused studio is not running, so a funded card waiting is no signal then.
      await s.db.exec(`update public.studio_state set paused = true where id = 1`);
      assertEquals((await s.signals()).map((f) => f.kind), ["overrun", "throughput"]);
      await s.db.exec(`update public.studio_state set paused = false where id = 1`);
      // With no funded card waiting, fewer ships is no signal.
      await s.db.exec(`alter table public.cards disable trigger user; update public.cards set stage = 'building' where stage = 'funded'; alter table public.cards enable trigger user;`);
      assertEquals((await s.signals()).map((f) => f.kind), ["overrun"]);
    });

    await t.step("findings and the four functions are closed to anon; only a board member reads a finding", async () => {
      await s.record("scan:osv", "scan", "osv", { run: "https://github.com/x/y/actions/runs/1" });
      await s.as("anon", async () => {
        await assertRejects(() => s.db.query(`select * from public.findings`), Error, "permission denied");
        await assertRejects(() => s.db.query(`select public.record_finding('x', 'scan', 'x', '{}')`), Error, "permission denied");
        await assertRejects(() => s.db.query(`select public.close_finding('scan:osv')`), Error, "permission denied");
        await assertRejects(() => s.db.query(`select public.schema_fingerprint()`), Error, "permission denied");
        await assertRejects(() => s.db.query(`select * from public.producer_signals()`), Error, "permission denied");
      });
      await s.db.query(`insert into public.board_members (email, role) values ($1, 'board')`, [BOARD_EMAIL]);
      const readAs = async (email: string) => {
        await s.db.query(`select set_config('request.jwt.claim.email', $1, false)`, [email]);
        try {
          return await s.as("authenticated", async () => (await s.rows<{ fingerprint: string }>(`select fingerprint from public.findings where closed_at is null`)).map((r) => r.fingerprint));
        } finally {
          await s.db.query(`select set_config('request.jwt.claim.email', '', false)`);
        }
      };
      assertEquals(await readAs("someone@peanutgallery.games"), []);
      assertEquals(await readAs(BOARD_EMAIL), ["scan:osv"]);
      await s.as("authenticated", async () => {
        await assertRejects(() => s.db.query(`select public.close_finding('scan:osv')`), Error, "permission denied");
        await assertRejects(() => s.db.query(`insert into public.findings (fingerprint, kind, subject) values ('x', 'scan', 'x')`), Error, "permission denied");
      });
      await s.as("service_role", async () => {
        await assertRejects(() => s.db.query(`insert into public.findings (fingerprint, kind, subject) values ('x', 'scan', 'x')`), Error, "permission denied");
        assertEquals((await s.row<{ closed: boolean }>(`select public.close_finding('scan:osv') as closed`)).closed, true);
        assertNotEquals(Object.keys((await s.row<{ fp: Row }>(`select public.schema_fingerprint() as fp`)).fp).length, 0);
      });
    });
  } finally {
    await s.closeDb();
  }
});
