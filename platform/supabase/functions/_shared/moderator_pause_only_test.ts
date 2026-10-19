// The moderator-pause-only migration on PGlite (docs/specs/moderator-pause-only.md): the moderator
// pauses at the first factor and never resumes, whatever the pause; only the board resumes, at the
// second factor; and studio_pause_log records every change of studio_state.paused, from set_paused,
// the dispatcher's service-role writes and plain SQL, append-only and readable by the board and the
// moderator alone. Every migration runs in order behind the same Supabase shim as migration_test.ts.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261019010000_moderator_pause_only.sql";
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const BOARD_EMAIL = "board@mobmachine.games";
const MODERATOR_EMAIL = "mod@mobmachine.games";
const OUTSIDER_EMAIL = "someone@mobmachine.games";
const DISPATCHER = "dispatcher: Console credit needed (card 1234abcd)";
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
type LogRow = { action: string; actor: string; actor_role: string; pause_reason: string | null };

Deno.test("the moderator pauses only, the board resumes at the second factor, and every pause and resume is logged", OPTS, async (t) => {
  const db = new PGlite();
  const row = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T> => {
    const all = (await db.query<T>(sql, params)).rows;
    assert(all.length > 0, `no row for: ${sql}`);
    return all[0]!;
  };
  const rows = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
  const refuses = async (sql: string, message: string) => {
    await assertRejects(() => db.query(sql), Error, message);
  };
  // A signed-in caller: the email and, at a second factor, aal2; null signs out.
  const signInAs = async (email: string | null, aal: "aal1" | "aal2" = "aal1") => {
    await db.query(`select set_config('request.jwt.claim.email', $1, false)`, [email ?? ""]);
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [email === null ? "" : JSON.stringify({ email, aal, role: "authenticated" })]);
  };
  // The dispatcher's key: the service role's claims and no email.
  const asService = async () => {
    await db.query(`select set_config('request.jwt.claim.email', '', false)`);
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: "service_role" })]);
  };
  const asRole = async <T>(role: string, run: () => Promise<T>): Promise<T> => {
    await db.exec(`set role ${role}`);
    try {
      return await run();
    } finally {
      await db.exec(`reset role`);
    }
  };
  const state = async () => await row<{ paused: boolean; pause_reason: string | null; paused_by: string | null }>(`select paused, pause_reason, paused_by from public.studio_state where id = 1`);
  const log = async () => await rows<LogRow>(`select action, actor, actor_role, pause_reason from public.studio_pause_log order by id`);
  let seen = 0;
  // The log rows written since the last call.
  const logged = async () => {
    const all = await log();
    const fresh = all.slice(seen);
    seen = all.length;
    return fresh;
  };

  try {
    await db.exec(SHIM);
    const names: string[] = [];
    for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
      if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
    }
    names.sort();
    const sqlOf = async (name: string) => (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "");
    for (const name of names) await db.exec(await sqlOf(name));
    await db.exec(
      `insert into public.studio_state (id) values (1); insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);
       insert into public.board_members (email, role) values ('${BOARD_EMAIL}', 'board'), ('${MODERATOR_EMAIL}', 'moderator');`,
    );

    await t.step("the migration applies a second time, and a studio inserted running logs nothing", async () => {
      await db.exec(await sqlOf(MIGRATION));
      assertEquals(await logged(), []);
      assertEquals(
        await rows(`select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_paused'`),
        [{ args: "p_paused boolean, p_reason text" }],
      );
    });

    await t.step("the moderator pauses at aal1 with a reason, and cannot resume at aal1 or aal2", async () => {
      await signInAs(MODERATOR_EMAIL);
      await db.query(`select public.set_paused(true, 'incident')`);
      assertEquals(await state(), { paused: true, pause_reason: "incident", paused_by: MODERATOR_EMAIL });
      assertEquals(await logged(), [{ action: "paused", actor: MODERATOR_EMAIL, actor_role: "moderator", pause_reason: "incident" }]);
      for (const aal of ["aal1", "aal2"] as const) {
        await signInAs(MODERATOR_EMAIL, aal);
        await refuses(`select public.set_paused(false)`, "Only the board resumes the studio");
        await refuses(`select public.set_paused(p_paused => false)`, "Only the board resumes the studio");
      }
      assertEquals((await state()).paused, true);
      assertEquals(await logged(), []);
    });

    await t.step("the board resumes only at aal2, and the resume names the pause it lifted", async () => {
      await signInAs(BOARD_EMAIL, "aal1");
      await refuses(`select public.set_paused(false)`, "A second factor is required");
      assertEquals((await state()).paused, true);
      await signInAs(BOARD_EMAIL, "aal2");
      await db.query(`select public.set_paused(false)`);
      assertEquals(await state(), { paused: false, pause_reason: null, paused_by: null });
      assertEquals(await logged(), [{ action: "resumed", actor: BOARD_EMAIL, actor_role: "board", pause_reason: "incident" }]);
    });

    await t.step("an outsider and a signed-out caller can neither pause nor resume", async () => {
      for (const email of [OUTSIDER_EMAIL, null]) {
        await signInAs(email, "aal2");
        await refuses(`select public.set_paused(true)`, "Board or moderator membership is required");
        await refuses(`select public.set_paused(false)`, "Board or moderator membership is required");
      }
      await asRole("anon", () => refuses(`select public.set_paused(false)`, "permission denied"));
      assertEquals(await logged(), []);
    });

    await t.step("the moderator cannot lift the dispatcher's money pauses; the dispatcher's own pause and resume are logged as the dispatcher", async () => {
      for (const reason of ["awaiting_credit", "spend_limit"]) {
        // The dispatcher's pause (db.ts pauseStudio): a service-role update naming itself.
        await asService();
        await asRole("service_role", () =>
          db.query(`update public.studio_state set paused = true, paused_by = $1, paused_at = now(), pause_reason = $2 where id = 1 and paused = false`, [DISPATCHER, reason]));
        assertEquals(await logged(), [{ action: "paused", actor: DISPATCHER, actor_role: "dispatcher", pause_reason: reason }]);
        await signInAs(MODERATOR_EMAIL);
        await refuses(`select public.set_paused(false)`, "Only the board resumes the studio");
        assertEquals(await state(), { paused: true, pause_reason: reason, paused_by: DISPATCHER });
        // The credit probe lifts it (dispatcher_resume_studio, decision 66).
        await asService();
        assertEquals((await asRole("service_role", () => row<{ ok: boolean }>(`select public.dispatcher_resume_studio('probe passed', '{}'::jsonb) as ok`))).ok, true);
        assertEquals(await logged(), [{ action: "resumed", actor: "service_role", actor_role: "dispatcher", pause_reason: reason }]);
      }
    });

    await t.step("a pause taken over is logged once, a pause pressed again by its holder and the heartbeat are not", async () => {
      await asService();
      await asRole("service_role", () =>
        db.query(`update public.studio_state set paused = true, paused_by = $1, paused_at = now(), pause_reason = 'awaiting_credit' where id = 1`, [DISPATCHER]));
      await signInAs(MODERATOR_EMAIL);
      await db.query(`select public.set_paused(true)`);
      await db.query(`select public.set_paused(true)`);
      await asService();
      await asRole("service_role", () => db.query(`update public.studio_state set dispatcher_seen_at = now() where id = 1`));
      assertEquals(await logged(), [
        { action: "paused", actor: DISPATCHER, actor_role: "dispatcher", pause_reason: "awaiting_credit" },
        { action: "paused", actor: MODERATOR_EMAIL, actor_role: "moderator", pause_reason: "board" },
      ]);
      // The moderator's takeover is not the dispatcher's to lift, and not the moderator's either.
      assertEquals((await asRole("service_role", () => row<{ ok: boolean }>(`select public.dispatcher_resume_studio('probe passed', '{}'::jsonb) as ok`))).ok, false);
      await signInAs(BOARD_EMAIL, "aal2");
      await db.query(`select public.set_paused(false)`);
      assertEquals(await logged(), [{ action: "resumed", actor: BOARD_EMAIL, actor_role: "board", pause_reason: "board" }]);
    });

    await t.step("BOARD-SETUP's SQL editor pause and a SQL resume are logged as the database", async () => {
      await signInAs(null);
      await db.exec(`update public.studio_state set paused = true, paused_by = 'sql-editor', paused_at = now(), pause_reason = 'board' where id = 1`);
      await db.exec(`update public.studio_state set paused = false, paused_by = null, paused_at = null where id = 1`);
      assertEquals(await logged(), [
        { action: "paused", actor: "sql-editor", actor_role: "database", pause_reason: "board" },
        { action: "resumed", actor: "postgres", actor_role: "database", pause_reason: "board" },
      ]);
      const stamped = await row<{ n: number }>(`select count(*)::int as n from public.studio_pause_log where created_at is null or id is null`);
      assertEquals(stamped.n, 0);
    });

    await t.step("the log is append-only for every role, the owner included", async () => {
      await refuses(`update public.studio_pause_log set actor = 'someone else'`, "studio_pause_log is append-only");
      await refuses(`delete from public.studio_pause_log`, "studio_pause_log is append-only");
      await refuses(`truncate public.studio_pause_log`, "studio_pause_log is append-only");
      for (const role of ["anon", "authenticated", "service_role"]) {
        if (role === "authenticated") await signInAs(BOARD_EMAIL, "aal2");
        else await signInAs(null);
        await asRole(role, async () => {
          await refuses(`insert into public.studio_pause_log (action, actor, actor_role) values ('paused', 'forged', 'board')`, "permission denied");
          await refuses(`update public.studio_pause_log set actor = 'someone else'`, "permission denied");
          await refuses(`delete from public.studio_pause_log`, "permission denied");
        });
      }
      assertEquals((await log()).length, seen);
    });

    await t.step("the board and the moderator read the log; an outsider reads nothing and anon is refused", async () => {
      for (const [email, aal] of [[BOARD_EMAIL, "aal2"], [BOARD_EMAIL, "aal1"], [MODERATOR_EMAIL, "aal1"]] as const) {
        await signInAs(email, aal);
        const read = await asRole("authenticated", () => rows<LogRow>(`select action, actor, actor_role, pause_reason from public.studio_pause_log order by id`));
        assertEquals(read.length, seen, `${email} at ${aal}`);
      }
      await signInAs(OUTSIDER_EMAIL, "aal2");
      assertEquals(await asRole("authenticated", () => rows(`select * from public.studio_pause_log`)), []);
      await signInAs(null);
      await asRole("anon", () => refuses(`select * from public.studio_pause_log`, "permission denied"));
    });
  } finally {
    await db.close();
  }
});
