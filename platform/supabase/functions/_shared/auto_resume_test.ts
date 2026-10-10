// The auto-resume migrations on PGlite (docs/specs/unattended-roles.md, PR3): auto_resume_due's
// list, its refusals, its bounds and backoff, its event and its public line; and
// dispatcher_resume_studio, which lifts only a pause the dispatcher set for money it could not
// spend. Every migration runs in order behind the same Supabase shim as migration_test.ts.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const AUTO_RESUME = "20261010000000_auto_resume.sql";
const STUDIO_AUTO_RESUME = "20261010100000_studio_auto_resume.sql";
const BOARD_EMAIL = "board@mobmachine.games";
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
type Due = { resumed: number; results: Row[] };

async function readMigrations(): Promise<{ name: string; sql: string }[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  return await Promise.all(names.map(async (name) => ({ name, sql: (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "") })));
}

interface CardOpts {
  source?: "board" | "agent";
  check?: string;
  horizon?: "now" | "next" | "later";
  estimate?: number;
  actual?: number;
  folder?: "seed-1" | "platform";
  lane?: "config" | "code";
}

async function studio() {
  const db = new PGlite();
  const row = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T> => {
    const result = await db.query<T>(sql, params);
    assert(result.rows.length > 0, `no row for: ${sql}`);
    return result.rows[0]!;
  };
  const rows = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
  const asRole = async <T>(role: string, run: () => Promise<T>): Promise<T> => {
    await db.exec(`set role ${role}`);
    try {
      return await run();
    } finally {
      await db.exec(`reset role`);
    }
  };
  const signInAs = async (email: string | null, aal: "aal1" | "aal2" | null = null) => {
    await db.query(`select set_config('request.jwt.claim.email', $1, false)`, [email ?? ""]);
    const claims = email === null ? "" : JSON.stringify(aal === null ? { email } : { email, aal });
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  };

  await db.exec(SHIM);
  const migrations = await readMigrations();
  for (const m of migrations) await db.exec(m.sql);
  await db.exec(
    `insert into public.studio_state (id, credit_daily_cap_usd, credit_studio_daily_cap_usd, card_max_usd, daily_cap_usd, monthly_cap_usd, reserve_pct, incident_cap_usd)
       values (1, 10000, 10000, 5, 100, 500, 0, 0);
     insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);
     insert into public.board_members (email, role) values ('${BOARD_EMAIL}', 'board');`,
  );
  const roleOf = async (name: string, klass: string) =>
    (await row<{ id: string }>(
      `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, write_access, agent_class)
       values ($1, $1, 'A small creature.', 'model-id', 0.1, 'plain', 'platform/agents/prompts/x.md', $2, $3) returning id`,
      [name, klass === "writer" || klass === "planner", klass],
    )).id;
  const builder = await roleOf("Builder A", "writer");
  const designer = await roleOf("Game Designer", "planner");
  const director = await roleOf("Game Director", "reviewer");

  let made = 0;
  /** A card paused with the check given, on now, with room under its ceiling unless actual says otherwise. */
  const paused = async (title: string, o: CardOpts = {}) => {
    made += 1;
    const agent = o.source === "agent";
    const id = (await row<{ id: string }>(
      `insert into public.cards (bucket, source, shape, lane, folder, title, summary, intent, acceptance_test, funding_target_usd, estimate_usd,
         stage, horizon, executor_role_id, proposer_role_id, drafter_role_id, created_at)
       values ('game', $1, 'goal', $2, $3, $4, 'A short public summary.', 'Change one number.',
         'check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11', 1, $5, 'proposed', $6, $7, $8, $8,
         timestamptz '2026-09-01T00:00:00Z' + make_interval(secs => $9)) returning id`,
      [agent ? "agent" : "board", o.lane ?? "config", o.folder ?? "seed-1", title, o.estimate ?? 1, o.horizon ?? "now", builder, agent ? designer : null, made],
    )).id;
    await db.query(`update public.cards set stage = 'paused', failing_check = $2, actual_usd = $3 where id = $1`, [id, o.check ?? "dispatcher_restart", o.actual ?? 0.5]);
    return id;
  };
  let refs = 0;
  const approve = async (id: string) => {
    refs += 1;
    const sha = (await row<{ h: string }>(`select public.card_content_hash($1) as h`, [id])).h;
    await db.query(`select public.record_card_approval($1, 'draft', '{"verdict":"approved"}'::jsonb, $2, $3, $4, $5, $6)`, [id, director, designer, `maker-${refs}`, `grader-${refs}`, sha]);
  };
  const due = async () => (await row<{ r: Due }>(`select public.auto_resume_due() as r`)).r;
  const cardRow = async (id: string) => await row<{ stage: string; failing_check: string | null }>(`select stage::text as stage, failing_check from public.cards where id = $1`, [id]);
  const events = async (id: string) =>
    (await rows<{ p: Row }>(`select payload_json as p from public.agent_events where card_id = $1 and payload_json ->> 'step' = 'auto_resume' order by created_at`, [id])).map((r) => r.p);
  /** Earlier auto_resume rows for a card, minutes ago, of the kind given. */
  const history = async (id: string, minutesAgo: number[], kind = "free") => {
    for (const m of minutesAgo) {
      await db.query(
        `insert into public.agent_events (card_id, role_id, type, payload_json, created_at)
         values ($1, null, 'message', jsonb_build_object('step', 'auto_resume', 'from_check', 'dispatcher_restart', 'kind', $2::text, 'n', 0), now() - make_interval(mins => $3))`,
        [id, kind, m],
      );
    }
  };
  /** Moves a card back to paused with the check given, as a later stop would. */
  const pauseAgain = async (id: string, check = "dispatcher_restart") => {
    await db.query(`update public.cards set stage = 'paused', failing_check = $2 where id = $1`, [id, check]);
  };
  const skipped = (r: Due, id: string) => r.results.filter((x) => x.card_id === id).map((x) => x.skipped ?? (x.resumed ? "resumed" : null));
  return { db, row, rows, asRole, signInAs, builder, migrations, paused, approve, due, cardRow, events, history, pauseAgain, skipped, close: () => db.close() };
}

Deno.test("auto_resume_checks: seeded by kind, read by the service role only", OPTS, async () => {
  const s = await studio();
  try {
    const seeded = await s.rows<{ failing_check: string; kind: string }>(`select failing_check, kind from public.auto_resume_checks order by kind, failing_check`);
    const byKind = (kind: string) => seeded.filter((r) => r.kind === kind).map((r) => r.failing_check);
    assertEquals(byKind("session"), ["budget", "patch_conflict", "turn_cap", "visual_review", "wall_clock"]);
    assert(byKind("free").includes("dispatcher_restart") && byKind("free").includes("console_credit"));
    assert(byKind("infra").includes("gate_infrastructure") && byKind("infra").includes("main_red"));
    for (const manual of ["ceiling", "horizon", "vetoed", "read_token", "unknown_model"]) {
      assert(!seeded.some((r) => r.failing_check === manual), `${manual} is never seeded`);
    }
    for (const role of ["anon", "authenticated"]) {
      await s.asRole(role, () => assertRejects(() => s.db.query(`select * from public.auto_resume_checks`), Error, "permission denied"));
      await s.asRole(role, () => assertRejects(() => s.db.query(`select public.auto_resume_due()`), Error, "permission denied"));
      await s.asRole(role, () => assertRejects(() => s.db.query(`select public.dispatcher_resume_studio('probe', '{}')`), Error, "permission denied"));
    }
    await s.asRole("service_role", () => assertRejects(() => s.db.query(`insert into public.auto_resume_checks values ('ceiling', 'free')`), Error, "permission denied"));
    assertEquals((await s.asRole("service_role", () => s.rows(`select 1 from public.auto_resume_checks`))).length, seeded.length);
    assertEquals((await s.asRole("service_role", () => s.due())).resumed, 0);
  } finally {
    await s.close();
  }
});

Deno.test("auto_resume_due: a seeded check resumes to funded with its event and public line; a manual one waits", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("a card paused at a restart goes back to funded, its check cleared, with an auto_resume event", async () => {
      const id = await s.paused("Paused at a restart");
      const r = await s.due();
      assertEquals(r.resumed, 1);
      assertEquals(r.results, [{ card_id: id, from_check: "dispatcher_restart", kind: "free", n: 1, resumed: true }]);
      assertEquals(await s.cardRow(id), { stage: "funded", failing_check: null });
      assertEquals(await s.events(id), [{ step: "auto_resume", from_check: "dispatcher_restart", kind: "free", n: 1 }]);
      const seen = await s.asRole("anon", () => s.rows<{ step: string | null; line_key: string; role_id: string | null }>(`select step, line_key, role_id from public.public_agent_events where card_id = $1`, [id]));
      assertEquals(seen, [{ step: "auto_resume", line_key: "auto_resumed", role_id: null }]);
    });

    await t.step("every kind resumes: an infrastructure stop and a session bound", async () => {
      const infra = await s.paused("Gate never started", { check: "gate_missing" });
      const session = await s.paused("Wall clock", { check: "wall_clock" });
      const r = await s.due();
      assertEquals(r.results.filter((x) => x.resumed).map((x) => [x.card_id, x.kind]), [[infra, "infra"], [session, "session"]].sort((a, b) => a[0]! < b[0]! ? -1 : 1));
    });

    await t.step("the ceiling, a horizon move, a veto stop, a read token, an unpriced model and an unknown check all wait", async () => {
      const ids: string[] = [];
      for (const check of ["ceiling", "horizon", "vetoed", "read_token", "unknown_model", "something_new"]) ids.push(await s.paused(`Manual ${check}`, { check }));
      const r = await s.due();
      assertEquals(r.resumed, 0);
      // A manual check is never even considered, so it is not in the results.
      assertEquals(r.results.filter((x) => ids.includes(x.card_id as string)), []);
      for (const id of ids) assertEquals((await s.cardRow(id)).stage, "paused");
    });

    await t.step("a card off now is left alone", async () => {
      const next = await s.paused("On next", { horizon: "next" });
      const r = await s.due();
      assertEquals(r.results.filter((x) => x.card_id === next), []);
      assertEquals((await s.cardRow(next)).stage, "paused");
    });
  } finally {
    await s.close();
  }
});

Deno.test("auto_resume_due: refusals", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("nothing resumes while the studio is paused, and the card resumes on the first call after", async () => {
      const id = await s.paused("Studio paused");
      await s.db.query(`update public.studio_state set paused = true, paused_by = 'board@mobmachine.games' where id = 1`);
      assertEquals(await s.due(), { resumed: 0, results: [] });
      assertEquals((await s.cardRow(id)).stage, "paused");
      assertEquals(await s.events(id), []);
      await s.db.query(`update public.studio_state set paused = false where id = 1`);
      assertEquals(s.skipped(await s.due(), id), ["resumed"]);
    });

    await t.step("vetoed by the board or the Director", async () => {
      const board = await s.paused("Board vetoed");
      await s.db.query(`update public.cards set board_vetoed = true, board_veto_reason = 'no' where id = $1`, [board]);
      const director = await s.paused("Director vetoed");
      await s.db.query(`update public.cards set director_stance = 'vetoed' where id = $1`, [director]);
      const r = await s.due();
      assertEquals([s.skipped(r, board), s.skipped(r, director)], [["vetoed"], ["vetoed"]]);
      assertEquals([(await s.cardRow(board)).stage, (await s.cardRow(director)).stage], ["paused", "paused"]);
      assertEquals([...(await s.events(board)), ...(await s.events(director))], []);
    });

    await t.step("the closed platform code lane", async () => {
      const id = await s.paused("Platform code", { folder: "platform", lane: "code" });
      assertEquals(s.skipped(await s.due(), id), ["closed_lane"]);
      await s.db.query(`update public.studio_state set platform_lane_open = true where id = 1`);
      assertEquals(s.skipped(await s.due(), id), ["resumed"]);
      await s.db.query(`update public.studio_state set platform_lane_open = false where id = 1`);
    });

    await t.step("an agent card whose approval is not current, until it is approved", async () => {
      const id = await s.paused("Agent card", { source: "agent" });
      assertEquals(s.skipped(await s.due(), id), ["approval_not_current"]);
      await s.approve(id);
      assertEquals(s.skipped(await s.due(), id), ["resumed"]);
    });

    await t.step("a paused executor role", async () => {
      const id = await s.paused("Executor paused");
      await s.db.query(`update public.roles set paused = true, paused_reason = 'test' where id = $1`, [s.builder]);
      assertEquals(s.skipped(await s.due(), id), ["executor_paused"]);
      await s.db.query(`update public.roles set paused = false, paused_reason = null where id = $1`, [s.builder]);
      assertEquals(s.skipped(await s.due(), id), ["resumed"]);
    });

    await t.step("no room under its ceiling: at 1.5 times the estimate, or at the card maximum", async () => {
      const ceiling = await s.paused("At 1.5 times", { estimate: 1, actual: 1.5 });
      const max = await s.paused("At the maximum", { estimate: 10, actual: 5 });
      const r = await s.due();
      assertEquals([s.skipped(r, ceiling), s.skipped(r, max)], [["no_room"], ["no_room"]]);
    });
  } finally {
    await s.close();
  }
});

Deno.test("auto_resume_due: bounds and backoff", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("backoff: 15 minutes times 2 to the power of the day's count", async () => {
      const id = await s.paused("Backoff");
      assertEquals(s.skipped(await s.due(), id), ["resumed"]);
      await s.pauseAgain(id);
      assertEquals(s.skipped(await s.due(), id), ["backoff"]);
      assertEquals((await s.cardRow(id)).stage, "paused");
      // The first resume 16 minutes ago: 15 x 2^1 = 30 minutes are needed with one in the day.
      await s.db.query(`update public.agent_events set created_at = now() - interval '16 minutes' where card_id = $1`, [id]);
      assertEquals(s.skipped(await s.due(), id), ["backoff"]);
      await s.db.query(`update public.agent_events set created_at = now() - interval '31 minutes' where card_id = $1`, [id]);
      assertEquals(s.skipped(await s.due(), id), ["resumed"]);
      assertEquals((await s.events(id)).map((e) => e.n), [1, 2]);
    });

    await t.step("at most three in the last 24 hours", async () => {
      const id = await s.paused("Three today");
      await s.history(id, [600, 500, 400]);
      assertEquals(s.skipped(await s.due(), id), ["limit_day"]);
      const older = await s.paused("Three, one of them yesterday");
      await s.history(older, [2000, 500, 400]);
      assertEquals(s.skipped(await s.due(), older), ["resumed"]);
      assertEquals((await s.events(older)).at(-1)!.n, 4);
    });

    await t.step("at most eight in all", async () => {
      const id = await s.paused("Eight in all");
      await s.history(id, [9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000]);
      assertEquals(s.skipped(await s.due(), id), ["limit_ever"]);
      const seven = await s.paused("Seven in all");
      await s.history(seven, [9000, 8000, 7000, 6000, 5000, 4000, 3000]);
      assertEquals(s.skipped(await s.due(), seven), ["resumed"]);
      assertEquals((await s.events(seven)).at(-1)!.n, 8);
    });

    await t.step("at most two in all of kind session; a free stop after them still resumes", async () => {
      const id = await s.paused("Two session resumes", { check: "budget" });
      await s.history(id, [5000, 4000], "session");
      assertEquals(s.skipped(await s.due(), id), ["limit_session"]);
      await s.pauseAgain(id, "dispatcher_restart");
      assertEquals(s.skipped(await s.due(), id), ["resumed"]);
      const one = await s.paused("One session resume", { check: "turn_cap" });
      await s.history(one, [5000], "session");
      const r = await s.due();
      assertEquals(s.skipped(r, one), ["resumed"]);
      assertEquals((await s.events(one)).at(-1), { step: "auto_resume", from_check: "turn_cap", kind: "session", n: 2 });
    });
  } finally {
    await s.close();
  }
});

Deno.test("dispatcher_resume_studio lifts only the dispatcher's own credit and spend-limit pauses", OPTS, async (t) => {
  const s = await studio();
  const resume = () => s.asRole("service_role", async () => (await s.row<{ r: boolean }>(`select public.dispatcher_resume_studio('credit probe ok', '{"model":"m"}'::jsonb) as r`)).r);
  const state = () => s.row<{ paused: boolean; paused_by: string | null; paused_at: string | null; pause_reason: string | null }>(`select paused, paused_by, paused_at, pause_reason from public.studio_state where id = 1`);
  const pause = (by: string, reason: string) => s.db.query(`update public.studio_state set paused = true, paused_by = $1, paused_at = now(), pause_reason = $2 where id = 1`, [by, reason]);
  const studioEvents = () => s.rows<{ p: Row }>(`select payload_json as p from public.agent_events where card_id is null and payload_json ->> 'step' = 'studio_resumed'`);
  try {
    await t.step("a studio that is not paused is left alone", async () => {
      assertEquals(await resume(), false);
      assertEquals((await studioEvents()).length, 0);
    });

    await t.step("an incident pause, a board pause and a moderator pause stay paused", async () => {
      await pause("dispatcher: the revert of card 1234abcd failed", "incident");
      assertEquals(await resume(), false);
      await pause(BOARD_EMAIL, "awaiting_credit");
      assertEquals(await resume(), false);
      await pause(BOARD_EMAIL, "board");
      assertEquals(await resume(), false);
      await pause("mod@mobmachine.games", "spend_limit");
      assertEquals(await resume(), false);
      assertEquals((await state()).paused, true);
      assertEquals((await studioEvents()).length, 0);
    });

    await t.step("the board pausing again takes a dispatcher's pause over", async () => {
      await s.db.query(`update public.studio_state set paused = false where id = 1`);
      await pause("dispatcher: Console credit needed (card 1234abcd)", "awaiting_credit");
      await s.signInAs(BOARD_EMAIL, "aal2");
      await s.db.query(`select public.set_paused(true)`);
      await s.signInAs(null);
      assertEquals([(await state()).paused_by, (await state()).pause_reason], [BOARD_EMAIL, "board"]);
      assertEquals(await resume(), false);
    });

    await t.step("a fired kill switch keeps it paused", async () => {
      await s.db.query(`update public.studio_state set paused = false where id = 1`);
      await pause("dispatcher: Console credit needed (card 1234abcd)", "awaiting_credit");
      await s.db.query(`update public.studio_state set kill_switch_fired_at = now() where id = 1`);
      assertEquals(await resume(), false);
      await s.db.query(`update public.studio_state set kill_switch_fired_at = null where id = 1`);
    });

    await t.step("a dispatcher's awaiting_credit pause is lifted, with a studio_resumed event that reaches no public page", async () => {
      assertEquals(await resume(), true);
      assertEquals(await state(), { paused: false, paused_by: null, paused_at: null, pause_reason: null });
      const events = await studioEvents();
      assertEquals(events.length, 1);
      assertEquals([events[0]!.p.reason, events[0]!.p.from_reason, events[0]!.p.paused_by, events[0]!.p.detail], ["credit probe ok", "awaiting_credit", "dispatcher: Console credit needed (card 1234abcd)", { model: "m" }]);
      const seen = await s.asRole("anon", () => s.rows<{ step: string | null; line_key: string }>(`select step, line_key from public.public_agent_events where card_id is null and type = 'message'`));
      assertEquals(seen, [{ step: null, line_key: "none" }]);
      assertEquals(await resume(), false);
    });

    await t.step("a dispatcher's spend_limit pause is lifted", async () => {
      await pause("dispatcher: usage tier cap reached (card 1234abcd)", "spend_limit");
      assertEquals(await resume(), true);
      assertEquals((await state()).paused, false);
    });

    await t.step("a reason is required", async () => {
      await assertRejects(() => s.db.query(`select public.dispatcher_resume_studio('  ', null)`), Error, "A reason is required");
    });
  } finally {
    await s.close();
  }
});

Deno.test("both auto-resume migrations apply twice", OPTS, async () => {
  const s = await studio();
  try {
    for (const name of [AUTO_RESUME, STUDIO_AUTO_RESUME]) {
      const file = s.migrations.find((m) => m.name === name);
      assert(file, name);
      await s.db.exec(file.sql);
    }
    assertEquals((await s.row<{ n: number }>(`select count(*)::int as n from public.auto_resume_checks`)).n, 31);
  } finally {
    await s.close();
  }
});
