// The agent-system-core migration on PGlite (docs/specs/agent-system-core.md): one test per clause
// of criteria 1 to 6 and 8, the SQL half of 7, and the foreign keys file-backlog relies on (9).
// Every migration runs in order behind the same Supabase shim as migration_test.ts, money-logic's
// included, with the append-only triggers on. The studio has no reserve and no incident carve-out,
// so a payment's credit is its net and the arithmetic reads plainly.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert@1";
import {
  type AllocationRow,
  type CardBar,
  checkAllocations,
  checkIdentity,
  type ContributionCredit,
  type ContributionSums,
  type LedgerRow,
  type PoolRow,
} from "../../lib/ledger-identity.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const BOARD_EMAIL = "board@peanutgallery.games";
const MODERATOR_EMAIL = "mod@peanutgallery.games";
const OUTSIDER_EMAIL = "someone@peanutgallery.games";
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
type RoleName = "builder" | "designer" | "director" | "qa" | "janitor" | "studioHead";

const APPLY =
  `select public.apply_contribution(p_stripe_event_id => $1, p_contributor_id => $2, p_display_name => null, p_amount_usd => $3, p_net_usd => $3, p_studio_pct => 0, p_goal_card_id => $4::uuid, p_stripe_session_id => $5, p_payer_key => null, p_session_created_at => null) as r`;

interface CardOpts {
  source?: "board" | "agent";
  horizon?: "now" | "next" | "later";
  stage?: string;
  target?: number;
  estimate?: number;
  drafter?: boolean;
  checkLine?: boolean;
  stance?: string;
  opensAt?: string | null;
  checkAuthor?: RoleName | null;
  folder?: "seed-1" | "platform";
  lane?: "config" | "code";
}

async function readMigrations(): Promise<{ name: string; sql: string }[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  return await Promise.all(names.map(async (name) => ({ name, sql: (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "") })));
}

/** A studio with every migration, or those up to and including `through`. */
async function studio(opts: { through?: string } = {}) {
  const db = new PGlite();
  const row = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T> => {
    const result = await db.query<T>(sql, params);
    assert(result.rows.length > 0, `no row for: ${sql}`);
    return result.rows[0]!;
  };
  const rows = async <T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
  const refuses = async (sql: string, message: string, params: unknown[] = []) => {
    await assertRejects(() => db.query(sql, params), Error, message, `expected "${message}" from: ${sql}`);
  };
  const signInAs = async (email: string | null, aal: "aal1" | "aal2" | null = null) => {
    await db.query(`select set_config('request.jwt.claim.email', $1, false)`, [email ?? ""]);
    const claims = email === null ? "" : JSON.stringify(aal === null ? { email } : { email, aal });
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  };
  const asRole = async <T>(role: string, run: () => Promise<T>): Promise<T> => {
    await db.exec(`set role ${role}`);
    try {
      return await run();
    } finally {
      await db.exec(`reset role`);
    }
  };

  await db.exec(SHIM);
  for (const m of await readMigrations()) if (opts.through === undefined || m.name <= opts.through) await db.exec(m.sql);
  await db.exec(
    `insert into public.studio_state (id, credit_daily_cap_usd, credit_studio_daily_cap_usd, card_max_usd, daily_cap_usd, monthly_cap_usd, reserve_pct, incident_cap_usd)
       values (1, 10000, 10000, 5, 100, 500, 0, 0);
     insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);
     insert into public.board_members (email, role) values ('${BOARD_EMAIL}', 'board'), ('${MODERATOR_EMAIL}', 'moderator');`,
  );
  const roleOf = async (name: string, klass: string) =>
    (await row<{ id: string }>(
      `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, write_access, agent_class)
       values ($1, $1, 'A small creature.', 'model-id', 0.1, 'plain', 'platform/agents/prompts/x.md', $2, $3) returning id`,
      [name, klass === "writer" || klass === "planner", klass],
    )).id;
  const roles: Record<RoleName, string> = {
    builder: await roleOf("Builder A", "writer"),
    designer: await roleOf("Game Designer", "planner"),
    director: await roleOf("Game Director", "reviewer"),
    qa: await roleOf("QA", "writer"),
    janitor: await roleOf("Janitor", "read_only"),
    studioHead: await roleOf("Studio Head", "planner"),
  };

  let made = 0;
  const card = async (title: string, o: CardOpts = {}) => {
    made += 1;
    const source = o.source ?? "agent";
    const agent = source === "agent";
    return (await row<{ id: string }>(
      `insert into public.cards (bucket, source, shape, lane, folder, title, summary, intent, acceptance_test, funding_target_usd, estimate_usd,
         stage, horizon, director_stance, executor_role_id, proposer_role_id, drafter_role_id, check_author_role_id, opens_at, created_at)
       values ('game', $1, 'goal', $15, $14, $2, 'A short public summary.', 'Change one number.', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz,
         timestamptz '2026-09-01T00:00:00Z' + make_interval(secs => $16)) returning id`,
      [
        source,
        title,
        o.checkLine === false ? "No check line here." : "check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11",
        o.target ?? 5,
        o.estimate ?? o.target ?? 5,
        o.stage ?? "proposed",
        o.horizon ?? (agent ? "next" : "now"),
        o.stance ?? "neutral",
        roles.builder,
        agent ? roles.designer : null,
        agent && o.drafter !== false ? roles.designer : null,
        o.checkAuthor ? roles[o.checkAuthor] : null,
        o.opensAt === undefined ? null : o.opensAt,
        o.folder ?? "seed-1",
        o.lane ?? "config",
        made,
      ],
    )).id;
  };
  const hash = async (id: string) => (await row<{ h: string }>(`select public.card_content_hash($1) as h`, [id])).h;
  let refs = 0;
  const approve = async (id: string, extra: { kind?: string; approver?: RoleName; grader?: string; maker?: string | null; verdict?: Row; sha?: string } = {}) => {
    refs += 1;
    return (await row<{ id: string }>(
      `select public.record_card_approval($1, $2, $3::jsonb, $4, $5, $6, $7, $8) as id`,
      [
        id,
        extra.kind ?? "draft",
        JSON.stringify(extra.verdict ?? { verdict: "approved" }),
        roles[extra.approver ?? "director"],
        roles.designer,
        extra.maker === undefined ? `maker-session-${refs}` : extra.maker,
        extra.grader ?? `grader-session-${refs}`,
        extra.sha ?? (await hash(id)),
      ],
    )).id;
  };
  // A raw SQL edit that goes around the guard, as a superuser can: it voids the approval.
  const rawEdit = async (id: string, set: string) => {
    await db.exec(`begin; select set_config('peanutgallery.card_writer', 'board', true); update public.cards set ${set} where id = '${id}'; commit;`);
  };
  const pay = async (key: string, amount: number, goal: string | null = null) => (await row<{ r: Row }>(APPLY, [`evt_${key}`, `contrib_${key}`, amount, goal, `cs_${key}`])).r;
  const spend = async (id: string, usd: number) => {
    await db.query(`select public.record_usage($1, $2, 'model-id', 1, 0, 1, $3)`, [id, roles.builder, usd]);
  };
  const cardRow = async (id: string) => await row<Row>(`select * from public.cards where id = $1`, [id]);
  const approved = async (id: string) => (await row<{ a: boolean }>(`select public.card_approved($1) as a`, [id])).a;
  const isPublic = async (id: string) => (await row<{ p: boolean }>(`select public.card_is_public($1) as p`, [id])).p;
  const takes = async (id: string) =>
    (await row<{ t: boolean }>(`select money.card_takes_money(c, false) as t from public.cards c where c.id = $1`, [id])).t;
  const deal = async () => (await rows<{ id: string }>(`select public.deal_due_cards() as id`)).map((r) => r.id);
  const identity = async () => {
    const r = (await row<{ r: { holds: boolean; lines: { name: string; holds: boolean }[] } }>(`select public.ledger_identity() as r`)).r;
    assert(r.holds, `the ledger identity drifts: ${JSON.stringify(r.lines.filter((l) => !l.holds))}`);
    return r;
  };
  return { db, row, rows, refuses, signInAs, asRole, roles, card, hash, approve, rawEdit, pay, spend, cardRow, approved, isPublic, takes, deal, identity, close: () => db.close() };
}

type Studio = Awaited<ReturnType<typeof studio>>;

// ---------------------------------------------------------------------------------------------

Deno.test("criterion 1: card_approvals is append-only and private, and record_card_approval enforces separation of duties", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("record_card_approval runs for service_role only and changes no card field, director_stance and board_vetoed included", async () => {
      const id = await s.card("Approve me", { stance: "endorsed" });
      const before = await s.cardRow(id);
      const sha = await s.hash(id);
      for (const role of ["anon", "authenticated"]) {
        await s.asRole(role, () =>
          s.refuses(`select public.record_card_approval($1, 'draft', '{"verdict":"approved"}', $2, $3, 'm', 'g-${role}', $4)`, "permission denied", [id, s.roles.director, s.roles.designer, sha])
        );
      }
      const approval = await s.asRole("service_role", () => s.approve(id));
      assert(approval);
      assertEquals(await s.cardRow(id), before);
      assertEquals([before.director_stance, before.board_vetoed], ["endorsed", false]);
      assertEquals(await s.approved(id), true);
    });

    await t.step("card_approvals refuses UPDATE, DELETE and TRUNCATE, whoever asks, and anon and authenticated read nothing", async () => {
      await s.refuses(`update public.card_approvals set verdict = '{}'`, "card_approvals is append-only");
      await s.refuses(`delete from public.card_approvals`, "card_approvals is append-only");
      await s.refuses(`truncate public.card_approvals`, "card_approvals is append-only");
      for (const role of ["anon", "authenticated"]) {
        await s.asRole(role, () => s.refuses(`select * from public.card_approvals`, "permission denied"));
      }
      await s.asRole("service_role", () => s.refuses(`insert into public.card_approvals (card_id, kind, verdict, approver_role_id, grader_ref, content_sha256) select id, 'draft', '{}', proposer_role_id, 'x', repeat('a', 64) from public.cards limit 1`, "permission denied"));
    });

    await t.step("each refusal has its own message", async () => {
      const id = await s.card("Separation of duties");
      await s.refuses(`select public.record_card_approval($1, 'draft', '{"verdict":"approved"}', $2, null, 'm1', 'g1', $3)`, "The approver cannot be the card's proposer, drafter or executor", [id, s.roles.designer, await s.hash(id)]);
      await s.refuses(`select public.record_card_approval($1, 'draft', '{"verdict":"approved"}', $2, null, 'm1', 'g1', $3)`, "The approver cannot be the card's proposer, drafter or executor", [id, s.roles.builder, await s.hash(id)]);
      const undrafted = await s.card("Proposed by the Studio Head, drafted by the Designer", { drafter: true });
      await s.db.query(`update public.cards set proposer_role_id = $2 where id = $1`, [undrafted, s.roles.studioHead]);
      await s.refuses(`select public.record_card_approval($1, 'draft', '{"verdict":"approved"}', $2, null, 'm1', 'g1', $3)`, "The approver cannot be the card's proposer, drafter or executor", [undrafted, s.roles.studioHead, await s.hash(undrafted)]);
      await s.refuses(`select public.record_card_approval($1, 'draft', '{"verdict":"approved"}', $2, null, 'm1', 'g1', $3)`, "The approver cannot be the card's proposer, drafter or executor", [undrafted, s.roles.designer, await s.hash(undrafted)]);

      const selfChecked = await s.card("Its executor wrote its check lines", { checkAuthor: "builder" });
      await s.refuses(`select public.record_card_approval($1, 'draft', '{"verdict":"approved"}', $2, null, 'm1', 'g1', $3)`, "The author of the card's check lines cannot be its executor", [selfChecked, s.roles.director, await s.hash(selfChecked)]);

      await s.refuses(`select public.record_card_approval($1, 'qa_verify', '{"verdict":"pass"}', $2, $2, 'build-1', 'qa-1', $3)`, "A qa_verify approval cannot come from the executor or name the build session", [id, s.roles.builder, await s.hash(id)]);
      await s.db.query(`insert into public.agent_events (card_id, role_id, type, payload_json) values ($1, $2, 'start', '{"session_id":"build-session-7"}')`, [id, s.roles.builder]);
      await s.refuses(`select public.record_card_approval($1, 'qa_verify', '{"verdict":"pass"}', $2, $3, 'maker-x', 'build-session-7', $4)`, "A qa_verify approval cannot come from the executor or name the build session", [id, s.roles.qa, s.roles.builder, await s.hash(id)]);

      await s.refuses(`select public.record_card_approval($1, 'draft', '{"verdict":"approved"}', $2, $3, 'm1', '  ', $4)`, "A grader ref is required", [id, s.roles.director, s.roles.designer, await s.hash(id)]);
      await s.refuses(`select public.record_card_approval($1, 'draft', '{"verdict":"approved"}', $2, $3, 'same', 'same', $4)`, "The grader ref must differ from the maker ref", [id, s.roles.director, s.roles.designer, await s.hash(id)]);
      await s.approve(id, { grader: "used-once" });
      await s.refuses(`select public.record_card_approval($1, 'draft', '{"verdict":"approved"}', $2, $3, 'm2', 'used-once', $4)`, "The grader ref used-once is already used", [id, s.roles.director, s.roles.designer, await s.hash(id)]);
      await s.refuses(`select public.record_card_approval($1, 'draft', '{"verdict":"approved"}', $2, $3, 'm2', 'g-hash', $4)`, "The content hash is not the card's current content hash", [id, s.roles.director, s.roles.designer, "0".repeat(64)]);

      await s.db.query(`update public.roles set paused = true, paused_reason = 'test' where id = $1`, [s.roles.director]);
      await s.refuses(`select public.record_card_approval($1, 'draft', '{"verdict":"approved"}', $2, $3, 'm3', 'g-paused', $4)`, "The approver role is paused", [id, s.roles.director, s.roles.designer, await s.hash(id)]);
      await s.db.query(`update public.roles set paused = false, paused_reason = null, state = 'retired' where id = $1`, [s.roles.director]);
      await s.refuses(`select public.record_card_approval($1, 'draft', '{"verdict":"approved"}', $2, $3, 'm3', 'g-retired', $4)`, "The approver role is retired", [id, s.roles.director, s.roles.designer, await s.hash(id)]);
      await s.db.query(`update public.roles set state = 'active' where id = $1`, [s.roles.director]);
      await s.refuses(`select public.record_card_approval($1, 'draft', '{"verdict":"approved"}', $2, $3, 'm4', 'g-janitor', $4)`, "The approver role's class may not approve a draft card", [id, s.roles.janitor, s.roles.designer, await s.hash(id)]);
      await s.refuses(`select public.record_card_approval($1, 'draft', '{"verdict":"approved"}', $2, $3, 'm4', 'g-writer', $4)`, "The approver role's class may not approve a draft card", [id, s.roles.qa, s.roles.designer, await s.hash(id)]);
      await s.refuses(`select public.record_card_approval($1, 'draft', '{"verdict":"revise"}', $2, $3, 'm5', 'g-revise', $4)`, "A draft approval needs the verdict approved", [id, s.roles.director, s.roles.designer, await s.hash(id)]);
      // A writer may approve a qa_verify, from its own session.
      assert(await s.approve(id, { kind: "qa_verify", approver: "qa", verdict: { verdict: "pass" } }));
      await s.refuses(`select public.record_card_approval($1, 'board', '{"verdict":"approved"}', $2, $3, 'm6', 'g-board', $4)`, "a board approval is written by a board RPC", [id, s.roles.director, s.roles.designer, await s.hash(id)]);
    });
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------------------------

Deno.test("criterion 2: a hashed field changes only through a board RPC, which records a board approval", OPTS, async (t) => {
  const s = await studio();
  try {
    const id = await s.card("Guarded text", { target: 2 });
    await s.approve(id);

    await t.step("an update to any hashed field of a card needing an approval is refused outside a board RPC; the estimate is not hashed", async () => {
      for (const set of ["title = 'New'", "summary = 'New'", "intent = 'New'", "acceptance_test = 'check: x'", "design_spec_url = 'https://x'", "funding_target_usd = 9", "lane = 'code'", "folder = 'platform'", "bucket = 'studio'", `executor_role_id = '${s.roles.qa}'`]) {
        await s.refuses(`update public.cards set ${set} where id = $1`, "An agent-written card's content changes only through a board RPC", [id]);
        await s.asRole("service_role", () => s.refuses(`update public.cards set ${set} where id = $1`, "An agent-written card's content changes only through a board RPC", [id]));
      }
      await s.refuses(`update public.cards set source = 'board', drafter_role_id = null where id = $1`, "An agent-written card stays agent-written", [id]);
      await s.db.query(`update public.cards set estimate_usd = 3 where id = $1`, [id]);
      assertEquals(await s.approved(id), true);
      // A board-filed card needs no approval, so the guard leaves it alone.
      const board = await s.card("A board card", { source: "board" });
      await s.db.query(`update public.cards set title = 'Retitled' where id = $1`, [board]);
    });

    await t.step("the same change through set_card_horizon leaves the card approved with a board approval of the new content", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      await s.db.query(`select public.set_card_horizon($1, 'now', 1, 'Board sets a new target', 4)`, [id]);
      const after = await s.cardRow(id);
      assertEquals([Number(after.funding_target_usd), after.horizon], [4, "now"]);
      assertEquals(await s.approved(id), true);
      assertEquals(await s.isPublic(id), true);
      const board = await s.row(`select kind, approver_email, approver_role_id, grader_ref like 'board:%' as board_ref, content_sha256 from public.card_approvals where card_id = $1 order by seq desc limit 1`, [id]);
      assertEquals(board, { kind: "board", approver_email: BOARD_EMAIL, approver_role_id: null, board_ref: true, content_sha256: await s.hash(id) });
      const action = await s.row<{ id: string }>(`select id from public.board_actions where action = 'set_card_horizon' and card_id = $1`, [id]);
      assertEquals((await s.row<{ g: string }>(`select grader_ref as g from public.card_approvals where card_id = $1 order by seq desc limit 1`, [id])).g, `board:${action.id}`);
      // The setting is only for the board RPC's own update.
      await s.refuses(`update public.cards set title = 'After' where id = $1`, "changes only through a board RPC", [id]);
    });

    await t.step("resume_card and the resume rule change the estimate and leave the card approved, runnable and public", async () => {
      await s.db.query(`update public.cards set stage = 'paused', failing_check = 'ceiling', actual_usd = 1 where id = $1`, [id]);
      await s.db.query(`select public.resume_card($1, 6, 'More room')`, [id]);
      const view = await s.row(`select stage::text as stage, estimate_usd, needs_approval, approved, executor_paused, board_vetoed from public.dispatcher_cards where id = $1`, [id]);
      assertEquals(view, { stage: "funded", estimate_usd: "6.0000", needs_approval: true, approved: true, executor_paused: false, board_vetoed: false });
      assertEquals(await s.isPublic(id), true);
      // The rule's half is criterion 8, which checks the approval after a top-up.
    });

    await t.step("dispatcher_cards reads a card at every stage, so a tick sees the hold stages and startup recovery sees building and gated cards", async () => {
      await s.signInAs(null);
      const staged = await s.card("Every stage", { source: "board" });
      const stages = (await s.rows<{ stage: string }>(`select unnest(enum_range(null::public.card_stage))::text as stage`)).map((r) => r.stage);
      assert(stages.includes("gated") && stages.includes("building"), JSON.stringify(stages));
      for (const stage of stages) {
        await s.db.query(`update public.cards set stage = $2::public.card_stage where id = $1`, [staged, stage]);
        const seen = await s.rows<{ stage: string }>(`select stage::text as stage from public.dispatcher_cards where id = $1`, [staged]);
        assertEquals(seen, [{ stage }], `dispatcher_cards at ${stage}`);
      }
      // Recovery's own read: building and gated, each with the approval columns.
      await s.db.query(`update public.cards set stage = 'gated' where id = $1`, [staged]);
      const recovery = await s.rows(`select stage::text as stage, needs_approval, approved from public.dispatcher_cards where id = $1 and stage in ('building', 'gated')`, [staged]);
      assertEquals(recovery, [{ stage: "gated", needs_approval: false, approved: false }]);
    });
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------------------------

Deno.test("criterion 3: an approved agent card is dealt to now at opens_at, and only then", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("with the window at 0 the next tick deals it, writing a dealt line", async () => {
      const id = await s.card("Window 0", { opensAt: "now" });
      await s.approve(id);
      assertEquals(await s.deal(), [id]);
      assertEquals((await s.cardRow(id)).horizon, "now");
      assertEquals((await s.row(`select payload_json ->> 'step' as step from public.agent_events where card_id = $1`, [id])).step, "dealt");
      assertEquals(await s.deal(), []);
    });

    await t.step("with the window at 60 it is not dealt before 60 minutes after approval, and is at the first tick after", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      await s.db.query(`select public.set_cooling_window(60, 'Give the board an hour')`);
      const id = await s.card("Window 60");
      await s.approve(id);
      // The approval path (agent-workflows) stamps opens_at as the approval time plus the window.
      await s.db.query(`update public.cards set opens_at = (select created_at from public.card_approvals where card_id = $1) + interval '60 minutes' where id = $1`, [id]);
      assertEquals(await s.deal(), []);
      await s.db.query(`update public.cards set opens_at = now() - interval '59 minutes 59 seconds' + interval '60 minutes' where id = $1`, [id]);
      assertEquals(await s.deal(), []);
      // An opens_at written earlier than the approval plus the window deals nothing: Postgres applies
      // the window from the newest draft approval, whatever opens_at says.
      await s.db.query(`update public.cards set opens_at = now() - interval '1 second' where id = $1`, [id]);
      assertEquals(await s.deal(), []);
      // An hour passes: the approval is back-dated around its append-only guard, as only a test may.
      await s.db.exec(`alter table public.card_approvals disable trigger card_approvals_append_only`);
      await s.db.query(`update public.card_approvals set created_at = created_at - interval '60 minutes' where card_id = $1`, [id]);
      await s.db.exec(`alter table public.card_approvals enable trigger card_approvals_append_only`);
      assertEquals(await s.deal(), [id]);
      await s.db.query(`select public.set_cooling_window(0, 'Back to none')`);
      await s.signInAs(null);
    });

    await t.step("nothing is dealt while the studio is paused, and the card is dealt on the first tick after", async () => {
      const id = await s.card("Dealt after the pause", { opensAt: "2026-09-01T00:00:00Z" });
      await s.approve(id);
      await s.db.query(`update public.studio_state set paused = true where id = 1`);
      assertEquals(await s.deal(), []);
      assertEquals((await s.cardRow(id)).horizon, "next");
      await s.db.query(`update public.studio_state set paused = false where id = 1`);
      assertEquals(await s.deal(), [id]);
    });

    await t.step("a board- or Director-vetoed card, one whose approval is not current, a paused executor's and an unready one are not dealt", async () => {
      const board = await s.card("Board vetoed", { opensAt: "2026-09-01T00:00:00Z" });
      const director = await s.card("Director vetoed", { opensAt: "2026-09-01T00:00:00Z", stance: "vetoed" });
      const voided = await s.card("Approval voided", { opensAt: "2026-09-01T00:00:00Z" });
      const neverApproved = await s.card("Never approved", { opensAt: "2026-09-01T00:00:00Z" });
      const unready = await s.card("No check line", { opensAt: "2026-09-01T00:00:00Z", checkLine: false });
      for (const id of [board, director, voided, unready]) await s.approve(id);
      await s.db.query(`update public.cards set board_vetoed = true where id = $1`, [board]);
      await s.rawEdit(voided, "title = 'Changed by raw SQL'");
      assertEquals(await s.approved(voided), false);
      assertEquals(await s.deal(), []);
      const paused = await s.card("Executor paused", { opensAt: "2026-09-01T00:00:00Z" });
      await s.approve(paused);
      await s.db.query(`update public.roles set paused = true, paused_reason = 'test' where id = $1`, [s.roles.builder]);
      assertEquals(await s.deal(), []);
      await s.db.query(`update public.roles set paused = false, paused_reason = null where id = $1`, [s.roles.builder]);
      assertEquals(await s.deal(), [paused]);
      for (const id of [board, director, voided, neverApproved, unready]) assertEquals((await s.cardRow(id)).horizon, "next");
      // What the dispatcher reads for the same three refusals (runnable() in select.ts).
      const flags = await s.rows(
        `select title, approved, board_vetoed, director_stance::text as stance, executor_paused from public.dispatcher_cards where id = any($1::uuid[]) order by title`,
        [[board, director, voided]],
      );
      assertEquals(flags, [
        { title: "Board vetoed", approved: true, board_vetoed: true, stance: "neutral", executor_paused: false },
        { title: "Changed by raw SQL", approved: false, board_vetoed: false, stance: "neutral", executor_paused: false },
        { title: "Director vetoed", approved: true, board_vetoed: false, stance: "vetoed", executor_paused: false },
      ]);
    });
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------------------------

Deno.test("criterion 4: no money reaches an undealt, board-vetoed or unapproved card", OPTS, async (t) => {
  const s = await studio();
  try {
    const sink = await s.card("The board's open card", { source: "board", target: 100 });
    const shapes = async () => ({
      undealt: await (async () => {
        const id = await s.card("Approved, not dealt", { opensAt: "2099-01-01T00:00:00Z" });
        await s.approve(id);
        return id;
      })(),
      vetoed: await (async () => {
        const id = await s.card("Board vetoed on now", { horizon: "now" });
        await s.approve(id);
        await s.db.query(`update public.cards set board_vetoed = true where id = $1`, [id]);
        return id;
      })(),
      void: await (async () => {
        const id = await s.card("Approval not current", { horizon: "now" });
        await s.approve(id);
        await s.rawEdit(id, "summary = 'Rewritten outside a board RPC'");
        return id;
      })(),
    });

    await t.step("the new predicate cases: undealt, board-vetoed and void take no money; an approved dealt agent card does", async () => {
      const cards = await shapes();
      for (const [why, id] of Object.entries(cards)) assertEquals(await s.takes(id), false, why);
      const dealt = await s.card("Approved and dealt", { horizon: "now" });
      assertEquals(await s.takes(dealt), false, "not approved yet");
      await s.approve(dealt);
      assertEquals(await s.takes(dealt), true, "approved and on now");
      assertEquals(await s.takes(sink), true, "a board card");
      // Paused executors do not stop a dealt card taking money.
      await s.db.query(`update public.roles set paused = true, paused_reason = 'test' where id = $1`, [s.roles.builder]);
      assertEquals(await s.takes(dealt), true, "executor paused");
      await s.db.query(`update public.roles set paused = false, paused_reason = null where id = $1`, [s.roles.builder]);
      await s.db.query(`update public.cards set board_vetoed = true where id = $1`, [dealt]);
    });

    await t.step("a payment naming each credits no bar, and step 2 skips them", async () => {
      const cards = await shapes();
      for (const [key, id] of Object.entries(cards)) {
        const paid = await s.pay(`named_${key}`, 3, id);
        assertEquals([paid.goal_card_id, paid.requested_card_id], [null, id], key);
        assertEquals(paid.allocations, [{ destination: "card", card_id: sink, amount_usd: 3, step: 2 }], key);
        assertEquals(Number((await s.cardRow(id)).funded_usd), 0, key);
      }
      const plain = await s.pay("plain", 2);
      assertEquals(plain.allocations, [{ destination: "card", card_id: sink, amount_usd: 2, step: 2 }]);
      await s.identity();
    });

    await t.step("a released hold skips each, and the waterfall's drain skips each", async () => {
      await s.db.exec(`update public.studio_state set credit_daily_cap_usd = 1 where id = 1`);
      const held: Record<string, { card: string; payment: string }> = {};
      for (const key of ["undealt", "vetoed", "void"]) {
        // Each takes money when paid (approved, on now), then stops taking it.
        const id = await s.card(`Held for ${key}`, { horizon: "now", target: 20 });
        await s.approve(id);
        const paid = await s.pay(`held_${key}`, 5, id);
        assertEquals([paid.goal_card_id, paid.held_usd], [id, 4]);
        held[key] = { card: id, payment: String(paid.contribution_id) };
      }
      await s.db.exec(`update public.studio_state set credit_daily_cap_usd = 10000 where id = 1`);
      await s.db.query(`update public.cards set horizon = 'next' where id = $1`, [held.undealt!.card]);
      await s.db.query(`update public.cards set board_vetoed = true where id = $1`, [held.vetoed!.card]);
      await s.rawEdit(held.void!.card, "intent = 'Rewritten outside a board RPC'");
      await s.db.exec(`alter table public.contributions disable trigger contributions_append_only;
        update public.contributions set hold_until = now() - interval '1 minute' where held_usd > 0;
        alter table public.contributions enable trigger contributions_append_only;`);
      assertEquals((await s.row<{ r: Row }>(`select public.credit_held_contributions() as r`)).r, { released: 3, released_usd: 12 });
      for (const [key, { card, payment }] of Object.entries(held)) {
        const release = await s.rows<{ card_id: string; step: number }>(
          `select a.card_id, a.step from public.contribution_allocations a join public.contributions r on r.id = a.entry_id where r.entry = 'release' and a.payment_id = $1`,
          [payment],
        );
        assertEquals(release, [{ card_id: sink, step: 2 }], key);
        assertEquals(Number((await s.cardRow(card)).funded_usd), 1, key);
      }
      // The drain: Not on a card yet goes to the cards that take money, and none of these.
      await s.db.query(`update public.cards set director_stance = 'vetoed' where id = $1`, [sink]);
      await s.pay("unassigned", 4);
      await s.db.query(`update public.cards set director_stance = 'neutral' where id = $1`, [sink]);
      const before = await s.rows(`select id, funded_usd from public.cards where id <> $1 order by id`, [sink]);
      const swept = (await s.row<{ r: Row }>(`select public.waterfall_sweep() as r`)).r;
      assertEquals(swept.drained_usd, 4);
      assertEquals(await s.rows(`select id, funded_usd from public.cards where id <> $1 order by id`, [sink]), before);
      await s.identity();
    });

    await t.step("record_usage refuses a studio row with no card, and still writes founder and overhead rows with none", async () => {
      await s.refuses(`select public.record_usage(null, null, 'model-id', 1, 0, 1, 0.01)`, "A studio row names a card");
      await s.refuses(`select public.record_usage(null, null, 'model-id', 1, 0, 1, 0.01, 'studio', 'req-1')`, "A studio row names a card");
      await s.db.query(`select public.record_usage(null, null, 'model-id', 1, 0, 1, 0.01, 'founder')`);
      await s.db.query(`select public.record_usage(null, null, 'model-id', 1, 0, 1, 0.01, 'overhead')`);
      await s.identity();
    });
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------------------------

Deno.test("criterion 5: outside the board an agent-written card is readable only while its approval is current", OPTS, async (t) => {
  const s = await studio();
  try {
    const board = await s.card("Board filed", { source: "board" });
    const approvedCard = await s.card("Agent, approved", { horizon: "now", target: 10 });
    await s.approve(approvedCard);
    const hidden = await s.card("Agent, never approved");
    const voided = await s.card("Agent, voided", { horizon: "now", target: 10 });
    await s.approve(voided);
    // While public: money reached it, it spent, it logged, and it stopped.
    await s.pay("v1", 4, voided);
    await s.db.query(`update public.cards set stage = 'building' where id = $1`, [voided]);
    await s.spend(voided, 1);
    await s.db.query(`insert into public.agent_events (card_id, role_id, type) values ($1, $2, 'start'), (null, $2, 'message')`, [voided, s.roles.builder]);
    await s.db.query(`update public.cards set stage = 'paused', failing_check = 'ceiling' where id = $1`, [voided]);
    // The card that takes the voided card's released money, in the step that cancels it.
    let taker = "";

    const readAll = async () => ({
      cards: (await s.rows<{ id: string }>(`select id from public.cards order by created_at`)).map((r) => r.id),
      funding: (await s.rows<{ card_id: string }>(`select card_id from public.public_card_funding`)).map((r) => r.card_id),
      spend: (await s.rows<{ card_id: string }>(`select card_id from public.public_card_spend`)).map((r) => r.card_id),
      stopped: (await s.rows<{ card_id: string }>(`select card_id from public.public_stopped_cards`)).map((r) => r.card_id),
      events: (await s.rows<{ card_id: string | null }>(`select card_id from public.public_agent_events order by created_at, card_id nulls first`)).map((r) => r.card_id),
      ledger: (await s.rows<{ card_id: string }>(`select distinct card_id from public.ledger where card_id is not null`)).map((r) => r.card_id),
    });

    await t.step("before the approval is voided, the public reads it everywhere", async () => {
      const seen = await s.asRole("anon", readAll);
      assertEquals(seen.cards, [board, approvedCard, voided]);
      assert(seen.funding.includes(voided) && seen.spend.includes(voided) && seen.stopped.includes(voided) && seen.events.includes(voided));
      assert(seen.ledger.includes(voided));
    });

    await t.step("anon and a signed-in non-member read no agent card without a current approval, through cards or any public view, and every board card", async () => {
      await s.rawEdit(voided, "title = 'Rewritten outside a board RPC'");
      for (const [who, email] of [["anon", null], ["authenticated", OUTSIDER_EMAIL]] as const) {
        await s.signInAs(email, email ? "aal2" : null);
        const seen = await s.asRole(who, readAll);
        assertEquals(seen.cards, [board, approvedCard], who);
        for (const view of ["funding", "spend", "stopped", "ledger"] as const) assertEquals(seen[view].includes(voided), false, `${who} ${view}`);
        assertEquals(seen.events, [null], `${who}: the card-less event stays`);
      }
      await s.signInAs(null);
      // The dispatcher's throttle still reads the hidden card's spend, so its hold is not overstated.
      const spent = await s.asRole("service_role", () => s.rows<{ card_id: string; spent_usd: string }>(`select card_id, spent_usd from public.dispatcher_card_spend`));
      assertEquals(spent.map((r) => [r.card_id, Number(r.spent_usd)]), [[voided, 1]]);
      await s.asRole("anon", () => s.refuses(`select * from public.dispatcher_card_spend`, "permission denied"));
      const ledgerPolicy = await s.row<{ qual: string }>(`select qual from pg_policies where tablename = 'ledger' and policyname = 'ledger_public_read'`);
      assert(ledgerPolicy.qual.includes("card_is_public(card_id)"), ledgerPolicy.qual);
    });

    await t.step("a board member reads every card, undealt and hidden included", async () => {
      await s.signInAs(BOARD_EMAIL, "aal1");
      const seen = await s.asRole("authenticated", readAll);
      assertEquals(seen.cards, [board, approvedCard, hidden, voided]);
      await s.signInAs(MODERATOR_EMAIL, "aal1");
      assertEquals((await s.asRole("authenticated", readAll)).cards.length, 4);
    });

    await t.step("card_is_public is callable by anon; realtime publishes cards under the same policy", async () => {
      await s.signInAs(null);
      assertEquals(await s.asRole("anon", () => s.isPublic(hidden)), false);
      assertEquals(await s.asRole("anon", () => s.isPublic(board)), true);
      const published = await s.rows(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'cards'`);
      assertEquals(published.length, 1);
      const policies = await s.rows(`select policyname, roles::text as roles, qual from pg_policies where tablename = 'cards' order by 1`);
      assertEquals(policies, [
        { policyname: "cards_board_read", roles: "{authenticated}", qual: "is_board_member()" },
        { policyname: "cards_public_read", roles: "{anon,authenticated}", qual: "card_is_public(id)" },
      ]);
      // Needs you lists a card holding money whose approval is not current.
      await s.signInAs(BOARD_EMAIL, "aal1");
      const needs = (await s.row<{ n: { approval_void: { id: string; money_usd: number }[] } }>(`select public.board_needs_you() as n`)).n;
      // $4 paid, $1 spent: the $3 left on its bar is what cancelling it moves.
      assertEquals(needs.approval_void.map((c) => [c.id, Number(c.money_usd)]), [[voided, 3]]);
    });

    await t.step("a stopped card's money moved to a card whose approval is not current shows no title for it", async () => {
      // The voided card's money moves on when the board cancels it; then the card that took it is voided too.
      taker = await s.card("Agent, takes the release", { horizon: "now", target: 10 });
      await s.approve(taker);
      await s.signInAs(BOARD_EMAIL, "aal2");
      await s.db.query(`update public.cards set stage = 'paused' where id = $1`, [voided]);
      await s.db.query(`select public.cancel_card($1, 'Voided')`, [voided]);
      await s.rawEdit(voided, "summary = 'Still voided'");
      const board = await s.card("Board, stopped", { source: "board", target: 10 });
      await s.pay("v2", 3, board);
      // Only the taker takes money when the board's card releases its bar.
      await s.db.query(`update public.cards c set director_stance = 'vetoed' where c.id <> $1 and money.card_takes_money(c, true)`, [taker]);
      await s.db.query(`select public.cancel_card($1, 'Stopped')`, [board]);
      const before = (await s.asRole("anon", () => s.row<{ moved: { to_card_id: string; to_title: string | null }[] }>(`select moved from public.public_stopped_cards where card_id = $1`, [board]))).moved;
      assertEquals(before.map((m) => [m.to_card_id, m.to_title]), [[taker, "Agent, takes the release"]]);
      await s.rawEdit(taker, "title = 'Rewritten outside a board RPC'");
      const after = (await s.asRole("anon", () => s.row<{ moved: { to_card_id: string; to_title: string | null }[] }>(`select moved from public.public_stopped_cards where card_id = $1`, [board]))).moved;
      assertEquals(after.map((m) => [m.to_card_id, m.to_title]), [[taker, null]]);
    });

    await t.step("a void card leaves Needs you once the board cancels it, though its spent money stays on its bar, and a live one is left to the sweep", async () => {
      const voidCards = async () =>
        (await s.row<{ n: { approval_void: { id: string; stage: string }[] } }>(`select public.board_needs_you() as n`)).n.approval_void.map((c) => [c.id, c.stage]);
      await s.signInAs(BOARD_EMAIL, "aal2");
      // The cancelled void card is rejected with its $1 of spend still on its bar, and is not listed.
      const cancelled = await s.cardRow(voided);
      assertEquals([cancelled.stage, Number(cancelled.funded_usd)], ["rejected", 1]);
      // The taker, voided while it holds the released money, is listed until the board cancels it too.
      assertEquals(await voidCards(), [[taker, "proposed"]]);
      await s.db.query(`select public.cancel_card($1, 'Voided')`, [taker]);
      assertEquals(await voidCards(), []);
      await s.refuses(`select public.cancel_card($1, 'Again')`, "cannot be cancelled", [taker]);
      // A shipped card whose approval is voided is not the board's to cancel: the sweep moves its unspent money.
      const shipped = await s.card("Agent, shipped", { horizon: "now", target: 10 });
      await s.approve(shipped);
      await s.pay("v3", 2, shipped);
      await s.db.query(`update public.cards set stage = 'live' where id = $1`, [shipped]);
      await s.rawEdit(shipped, "title = 'Rewritten after it shipped'");
      assertEquals(await voidCards(), []);
      await s.identity();
    });
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------------------------

Deno.test("criterion 6: the board's veto, the cooling window and role pauses", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("each RPC needs the board, the second factor and a reason; the moderator pauses a role at aal1 but cannot resume one", async () => {
      const id = await s.card("Veto target", { source: "board" });
      await s.db.exec(`insert into public.jobs (name, role_id, calls_model) values ('tidy_up', null, false)`);
      const calls: [string, unknown[]][] = [
        [`select public.set_card_veto($1::uuid, true, $2)`, [id]],
        [`select public.set_cooling_window(30, $1)`, []],
        [`select public.set_role_pause($1::uuid, false, $2)`, [s.roles.qa]],
        [`select public.enqueue_manual_job('tidy_up', null, $1)`, []],
      ];
      const call = (sql: string, params: unknown[], reason: string | null) => {
        const n = params.length + 1;
        return { sql: sql.replace(`$${n}`, `$${n}`), params: [...params, reason] };
      };
      for (const [sql, params] of calls) {
        await s.signInAs(null);
        const c = call(sql, params, "why");
        await s.asRole("anon", () => s.refuses(c.sql, "permission denied", c.params));
        await s.signInAs(OUTSIDER_EMAIL, "aal2");
        await s.refuses(c.sql, "membership is required", c.params);
        await s.signInAs(MODERATOR_EMAIL, "aal2");
        await s.refuses(c.sql, sql.includes("set_role_pause") ? "Only the board resumes a role" : "Board membership is required", c.params);
        await s.signInAs(BOARD_EMAIL, "aal1");
        await s.refuses(c.sql, "A second factor is required", c.params);
        await s.signInAs(BOARD_EMAIL, "aal2");
        const blank = call(sql, params, "  ");
        await s.refuses(blank.sql, "A reason is required", blank.params);
      }
      await s.signInAs(MODERATOR_EMAIL, "aal1");
      await s.db.query(`select public.set_role_pause($1, true, 'Moderator stops QA')`, [s.roles.qa]);
      assertEquals(await s.row(`select paused, paused_reason from public.roles where id = $1`, [s.roles.qa]), { paused: true, paused_reason: "Moderator stops QA" });
      await s.refuses(`select public.set_role_pause($1, false, 'Try to resume')`, "Only the board resumes a role", [s.roles.qa]);
      await s.signInAs(BOARD_EMAIL, "aal2");
      await s.db.query(`select public.set_role_pause($1, false, 'Board resumes QA')`, [s.roles.qa]);
      assertEquals(await s.row(`select paused, paused_reason, paused_at from public.roles where id = $1`, [s.roles.qa]), { paused: false, paused_reason: null, paused_at: null });
      assertEquals(
        (await s.rows<{ action: string }>(`select action from public.board_actions where action = 'set_role_pause' order by created_at`)).map((a) => a.action).length,
        2,
      );
      // public_roles shows the class and the pause.
      const pub = await s.asRole("anon", () => s.row(`select agent_class, paused, paused_reason from public.public_roles where id = $1`, [s.roles.director]));
      assertEquals(pub, { agent_class: "reviewer", paused: false, paused_reason: null });
    });

    await t.step("set_cooling_window takes 0 to 10,080 minutes only", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      for (const bad of [-1, 10081]) await s.refuses(`select public.set_cooling_window($1, 'bad')`, "between 0 and 10,080 minutes", [bad]);
      for (const ok of [10080, 0]) {
        await s.db.query(`select public.set_cooling_window($1, 'ok')`, [ok]);
        assertEquals((await s.row<{ m: number }>(`select cooling_window_minutes as m from public.studio_state`)).m, ok);
      }
      assertEquals((await s.row<{ s: Row }>(`select public.board_studio_state() as s`)).s.cooling_window_minutes, 0);
    });

    await t.step("a veto moves a card on now with no money to next and never changes director_stance; money on its bar or on hold refuses it", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      const empty = await s.card("Empty on now", { source: "board", stance: "endorsed" });
      await s.db.query(`update public.cards set opens_at = now() where id = $1`, [empty]);
      await s.db.query(`select public.set_card_veto($1, true, 'Not this one')`, [empty]);
      assertEquals(await s.row(`select horizon::text as horizon, opens_at, board_vetoed, board_veto_reason, director_stance::text as stance from public.cards where id = $1`, [empty]), {
        horizon: "next",
        opens_at: null,
        board_vetoed: true,
        board_veto_reason: "Not this one",
        stance: "endorsed",
      });
      await s.db.query(`select public.set_card_veto($1, false, 'Back on')`, [empty]);
      assertEquals(await s.row(`select board_vetoed, director_stance::text as stance, horizon::text as horizon from public.cards where id = $1`, [empty]), { board_vetoed: false, stance: "endorsed", horizon: "next" });

      const funded = await s.card("Money on its bar", { source: "board", target: 10 });
      await s.pay("bar", 2, funded);
      await s.refuses(`select public.set_card_veto($1, true, 'No')`, "A card holding money cannot be vetoed; cancel it with a reason instead", [funded]);
      await s.db.exec(`update public.studio_state set credit_daily_cap_usd = 0 where id = 1`);
      const onHold = await s.card("Money on hold", { source: "board", target: 10 });
      const held = await s.pay("hold", 2, onHold);
      assertEquals([Number((await s.cardRow(onHold)).funded_usd), held.held_usd], [0, 2]);
      await s.refuses(`select public.set_card_veto($1, true, 'No')`, "A card holding money cannot be vetoed; cancel it with a reason instead", [onHold]);
      await s.db.exec(`update public.studio_state set credit_daily_cap_usd = 10000 where id = 1`);
      const building = await s.card("Building", { source: "board", stage: "building" });
      await s.refuses(`select public.set_card_veto($1, true, 'No')`, "Only a proposed, designing or voted card can be vetoed or unvetoed", [building]);
    });

    await t.step("unvetoing an approved agent card sets opens_at to now plus the window", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      await s.db.query(`select public.set_cooling_window(90, 'An hour and a half')`);
      const id = await s.card("Agent, approved, vetoed", { opensAt: "2026-09-01T00:00:00Z" });
      await s.approve(id);
      await s.db.query(`select public.set_card_veto($1, true, 'Hold it')`, [id]);
      assertEquals(await s.deal(), []);
      await s.db.query(`select public.set_card_veto($1, false, 'Go ahead')`, [id]);
      const opens = await s.row<{ minutes: number }>(`select round(extract(epoch from (opens_at - now())) / 60)::int as minutes from public.cards where id = $1`, [id]);
      assertEquals(opens.minutes, 90);
      assertEquals(await s.deal(), []);
      const actions = await s.rows(`select action, reason from public.board_actions where card_id = $1 order by created_at`, [id]);
      assertEquals(actions, [{ action: "set_card_veto", reason: "Hold it" }, { action: "set_card_veto", reason: "Go ahead" }]);
    });
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------------------------

Deno.test("criterion 7, SQL half: the job queue", OPTS, async (t) => {
  const s = await studio();
  try {
    // agent-workflows (20260924400000) seeds studio_ranking and draft_card before any role exists.
    await s.db.exec(`insert into public.jobs (name, role_id, calls_model, runs_when_paused) values ('studio_ranking', '${s.roles.studioHead}', true, true), ('tidy_up', null, false, false)
      on conflict (name) do update set role_id = excluded.role_id`);
    const enqueue = async (job: string, origin: string, key: string | null = null, parent: string | null = null) =>
      (await s.row<{ r: { id: string; created: boolean } }>(`select public.enqueue_job_run($1, $2, $3, null, '{}'::jsonb, $4) as r`, [job, origin, key, parent])).r;

    await t.step("enqueue_job_run with the same job and key twice creates one run", async () => {
      const first = await enqueue("tidy_up", "event", "tidy_up:event:one");
      const again = await enqueue("tidy_up", "event", "tidy_up:event:one");
      assertEquals([first.created, again.created, again.id], [true, false, first.id]);
      assertEquals((await s.row<{ n: number }>(`select count(*)::int as n from public.job_runs where idem_key = 'tidy_up:event:one'`)).n, 1);
      const defaults = await enqueue("tidy_up", "operator");
      assert((await s.row<{ k: string }>(`select idem_key as k from public.job_runs where id = $1`, [defaults.id])).k.startsWith("tidy_up:operator:"));
    });

    await t.step("a job never holds two queued scheduled runs, and the default scheduled key is the UTC minute", async () => {
      const first = await enqueue("tidy_up", "schedule");
      const key = (await s.row<{ k: string }>(`select idem_key as k from public.job_runs where id = $1`, [first.id])).k;
      assert(/^tidy_up:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(key), key);
      const later = await enqueue("tidy_up", "schedule", "tidy_up:2099-01-01T00:00Z");
      assertEquals([later.created, later.id], [false, first.id]);
      await s.refuses(`insert into public.job_runs (job_name, idem_key, origin) values ('tidy_up', 'another-slot', 'schedule')`, "job_runs_one_queued_schedule");
      // Once the queued one has run, the next slot queues.
      await s.db.query(`update public.job_runs set status = 'skipped', reason = 'test' where id = $1`, [first.id]);
      assertEquals((await enqueue("tidy_up", "schedule", "tidy_up:2099-01-01T00:00Z")).created, true);
    });

    await t.step("a run queued by a board-origin run is board origin", async () => {
      await s.signInAs(BOARD_EMAIL, "aal2");
      const board = (await s.row<{ id: string }>(`select public.enqueue_manual_job('studio_ranking', null, 'Rank now', '{"floor":3}') as id`)).id;
      const run = await s.row(`select origin, idem_key like 'studio_ranking:manual:%' as manual_key, input from public.job_runs where id = $1`, [board]);
      assertEquals(run, { origin: "board", manual_key: true, input: { floor: 3 } });
      const child = await enqueue("tidy_up", "event", null, board);
      assertEquals((await s.row<{ o: string }>(`select origin as o from public.job_runs where id = $1`, [child.id])).o, "board");
      const scheduled = await enqueue("tidy_up", "event", null, child.id);
      assertEquals((await s.row<{ o: string }>(`select origin as o from public.job_runs where id = $1`, [scheduled.id])).o, "board");
      await s.refuses(`select public.enqueue_manual_job('studio_ranking', null, 'Too big', $1::jsonb)`, "The input must be at most 4 KB", [JSON.stringify({ x: "y".repeat(5000) })]);
      await s.refuses(`select public.enqueue_manual_job('studio_ranking', null, 'Not an object', '[1]'::jsonb)`, "The input must be a JSON object");
      await s.refuses(`select public.enqueue_manual_job('no_such_job', null, 'Missing')`, "Job no_such_job does not exist");
      assertEquals((await s.row<{ n: number }>(`select count(*)::int as n from public.board_actions where action = 'enqueue_manual_job'`)).n, 1);
    });

    await t.step("only the board labels a run as its own: a service-role call for a board-origin run with no board-origin parent is refused", async () => {
      await s.signInAs(null);
      await s.refuses(`select public.enqueue_job_run('studio_ranking', 'board', null, null, '{}'::jsonb, null)`, "Only the board queues a board-origin run");
      const scheduled = await enqueue("studio_ranking", "event");
      await s.refuses(`select public.enqueue_job_run('studio_ranking', 'board', null, null, '{}'::jsonb, $1)`, "Only the board queues a board-origin run", [scheduled.id]);
      // At the first factor the board cannot either; Run now needs the second.
      await s.signInAs(BOARD_EMAIL, "aal1");
      await s.refuses(`select public.enqueue_job_run('studio_ranking', 'board', null, null, '{}'::jsonb, null)`, "Only the board queues a board-origin run");
      await s.signInAs(null);
      const board = (await s.row<{ id: string }>(`select id from public.job_runs where origin = 'board' and parent_run_id is null limit 1`)).id;
      assertEquals((await enqueue("studio_ranking", "board", null, board)).created, true);
    });

    await t.step("a claim is refused without the lease; fail_running_job_runs is the lease holder's alone", async () => {
      const run = (await enqueue("tidy_up", "operator")).id;
      assertEquals((await s.row<{ ok: boolean }>(`select public.claim_job_run($1, 'mac') as ok`, [run])).ok, false);
      assertEquals((await s.row<{ ok: boolean }>(`select public.claim_dispatcher_lease('mac', 60) as ok`)).ok, true);
      assertEquals((await s.row<{ ok: boolean }>(`select public.claim_job_run($1, 'vps') as ok`, [run])).ok, false);
      assertEquals((await s.row<{ ok: boolean }>(`select public.claim_job_run($1, 'mac') as ok`, [run])).ok, true);
      assertEquals((await s.row<{ ok: boolean }>(`select public.claim_job_run($1, 'mac') as ok`, [run])).ok, false);
      await s.refuses(`select public.fail_running_job_runs('vps', 'dispatcher_restart')`, "Only the dispatcher lease holder fails running job runs");
      assertEquals((await s.row<{ n: number }>(`select public.fail_running_job_runs('mac', 'dispatcher_restart') as n`)).n, 1);
      assertEquals(await s.row(`select status, reason, finished_at is not null as finished from public.job_runs where id = $1`, [run]), { status: "failed", reason: "dispatcher_restart", finished: true });
      assertEquals((await s.row<{ n: number }>(`select public.fail_running_job_runs('mac', 'dispatcher_restart') as n`)).n, 0);
    });

    await t.step("finish_job_run finishes a running run, skips a queued one with a reason, and board_jobs lists each job's last runs", async () => {
      const run = (await enqueue("tidy_up", "operator")).id;
      await s.refuses(`select public.finish_job_run($1, 'succeeded', null, null)`, "is not running", [run]);
      await s.refuses(`select public.finish_job_run($1, 'skipped', null, null)`, "A failed or skipped run needs a reason", [run]);
      await s.db.query(`select public.finish_job_run($1, 'skipped', 'studio_paused', null)`, [run]);
      const done = (await enqueue("tidy_up", "operator")).id;
      assertEquals((await s.row<{ ok: boolean }>(`select public.claim_job_run($1, 'mac') as ok`, [done])).ok, true);
      await s.db.query(`select public.finish_job_run($1, 'succeeded', null, '{"tidied":2}')`, [done]);
      // Older runs than the last ten are left out.
      await s.db.exec(`insert into public.job_runs (job_name, idem_key, origin, status, reason, created_at)
        select 'tidy_up', 'old-' || g, 'operator', 'skipped', 'old', now() - interval '1 day' from generate_series(1, 5) g`);
      await s.signInAs(BOARD_EMAIL, "aal1");
      const jobs = (await s.row<{ j: { name: string; runs: { id: string; status: string }[] }[] }>(`select public.board_jobs() as j`)).j;
      // The migrations register draft_card and studio_ranking (agent-workflows), janitor and upkeep_merge (agent-upkeep).
      assertEquals(jobs.map((j) => j.name), ["draft_card", "janitor", "studio_ranking", "tidy_up", "upkeep_merge"]);
      const tidy = jobs.find((j) => j.name === "tidy_up")!;
      assertEquals(tidy.runs.length, 10);
      // Nine runs from this test, then the newest of the five old ones.
      assertEquals(tidy.runs.filter((r) => (r as { reason?: string }).reason === "old").length, 1);
      assertEquals(tidy.runs[0]!, { ...tidy.runs[0]!, id: done, status: "succeeded" });
      const roles = (await s.row<{ r: { name: string; agent_class: string }[] }>(`select public.board_roles() as r`)).r;
      assertEquals(roles.find((r) => r.name === "Game Director")?.agent_class, "reviewer");
      for (const table of ["jobs", "job_runs", "dispatcher_cards"]) {
        for (const role of ["anon", "authenticated"]) await s.asRole(role, () => s.refuses(`select * from public.${table}`, "permission denied"));
      }
      await s.signInAs(null);
      for (const fn of ["board_jobs()", "board_roles()"]) await s.asRole("anon", () => s.refuses(`select public.${fn}`, "permission denied"));
    });
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------------------------

async function tsIdentity(s: Studio) {
  const pool = (await s.row(`select balance_usd, reserve_usd, incident_reserve_usd, held_usd from public.pool where id = 1`)) as unknown as PoolRow;
  const contributions = (await s.rows(`select id, parent_id, reserve_usd, agents_usd, incident_usd, held_usd from public.contributions`)) as unknown as (ContributionSums & ContributionCredit)[];
  const ledger = (await s.rows(`select usd, billed_to::text as billed_to from public.ledger`)) as unknown as LedgerRow[];
  const allocations = (await s.rows(`select payment_id, destination::text as destination, card_id, amount_usd from public.contribution_allocations`)) as unknown as AllocationRow[];
  const cards = (await s.rows(`select id, funded_usd from public.cards`)) as unknown as CardBar[];
  return [...checkIdentity(pool, contributions, ledger), ...checkAllocations(contributions, allocations, cards)];
}

Deno.test("criterion 8: resume by rule, once per card, topping the bar up from money not on a card yet", OPTS, async (t) => {
  const s = await studio();
  try {
    // Target and estimate $1.00, paid in full, paused at its ceiling with $1.50 of studio spend; the card maximum is $5.
    const id = await s.card("Ceiling card", { horizon: "now", target: 1 });
    await s.approve(id);
    await s.pay("full", 1, id);
    await s.db.query(`update public.cards set stage = 'building' where id = $1`, [id]);
    await s.spend(id, 1.5);
    await s.db.query(`update public.cards set stage = 'paused', failing_check = 'ceiling' where id = $1`, [id]);
    const before = await s.cardRow(id);
    assertEquals([Number(before.funding_target_usd), Number(before.estimate_usd), Number(before.funded_usd), Number(before.actual_usd)], [1, 1, 1, 1.5]);

    await t.step("with less than $1.25 that may leave Not on a card yet it waits and changes nothing", async () => {
      await s.pay("some", 1.5);
      const allocations = (await s.row<{ n: number }>(`select count(*)::int as n from public.contribution_allocations`)).n;
      const r = (await s.row<{ r: Row }>(`select public.resume_card_by_rule($1) as r`, [id])).r;
      assertEquals([r.waiting, r.need_usd], [true, 1.25]);
      assertEquals(await s.cardRow(id), before);
      assertEquals((await s.row<{ n: number }>(`select count(*)::int as n from public.contribution_allocations`)).n, allocations);
      assertEquals((await s.rows(`select 1 from public.agent_events where card_id = $1`, [id])).length, 0);
    });

    await t.step("with at least $1.25 it tops the bar up by $1.25, sets the estimate to $1.50 and resumes under a $2.25 ceiling; the identity holds", async () => {
      await s.pay("more", 1);
      const r = (await s.row<{ r: { resumed: number } }>(`select public.resume_due_by_rule() as r`)).r;
      assertEquals(r.resumed, 1);
      const after = await s.cardRow(id);
      assertEquals(
        [after.stage, after.failing_check, Number(after.estimate_usd), Number(after.funded_usd), Number(after.funding_target_usd)],
        ["funded", null, 1.5, 2.25, 1],
      );
      const moved = await s.rows(`select destination::text as destination, amount_usd, reason from public.contribution_allocations where reason = 'ceiling_top_up' order by seq`);
      assertEquals(moved, [
        { destination: "unassigned", amount_usd: "-1.2500", reason: "ceiling_top_up" },
        { destination: "card", amount_usd: "1.2500", reason: "ceiling_top_up" },
      ]);
      const events = await s.rows<{ p: Row }>(`select payload_json as p from public.agent_events where card_id = $1 order by created_at, (payload_json ->> 'step') = 'resume_rule'`, [id]);
      assertEquals(events.map((e) => e.p), [
        { step: "ceiling_top_up", usd: 1.25 },
        { step: "resume_rule", estimate_usd: 1.5, ceiling_usd: 2.25, actual_usd: 1.5, top_up_usd: 1.25 },
      ]);
      // The public list says what happened, with the amount, and reads nothing else of the payload.
      const seen = await s.asRole("anon", () => s.rows<{ step: string; usd: string | null }>(`select step, usd from public.public_agent_events where card_id = $1 order by created_at, step = 'resume_rule'`, [id]));
      assertEquals(seen.map((e) => [e.step, e.usd === null ? null : Number(e.usd)]), [["ceiling_top_up", 1.25], ["resume_rule", null]]);
      // The funding target never changes, so the approval stands: approved, runnable and public.
      assertEquals([await s.approved(id), await s.isPublic(id)], [true, true]);
      assertEquals((await s.row<{ a: boolean }>(`select approved as a from public.dispatcher_cards where id = $1`, [id])).a, true);
      await s.identity();
      const lines = await tsIdentity(s);
      assert(lines.every((l) => l.holds), JSON.stringify(lines));
      const sql = (await s.row<{ r: { lines: { name: string; drift: number }[] } }>(`select public.ledger_identity() as r`)).r.lines;
      assertEquals(lines.map((l) => [l.name, Number(l.drift)]), sql.map((l) => [l.name, Number(l.drift)]));
    });

    await t.step("paused at its ceiling a second time, or at the card maximum, it is never resumed by the rule and is listed in Needs you", async () => {
      await s.db.query(`update public.cards set stage = 'building' where id = $1`, [id]);
      await s.spend(id, 0.75);
      await s.db.query(`update public.cards set stage = 'paused', failing_check = 'ceiling' where id = $1`, [id]);
      await s.pay("plenty", 20);
      assertEquals((await s.row<{ r: { resumed: number } }>(`select public.resume_due_by_rule() as r`)).r.resumed, 0);
      assertEquals((await s.row<{ r: Row }>(`select public.resume_card_by_rule($1) as r`, [id])).r.blocked, "resumed_before");
      assertEquals((await s.cardRow(id)).stage, "paused");

      const maxed = await s.card("At the card maximum", { source: "board", horizon: "now", target: 5 });
      await s.pay("maxed", 5, maxed);
      await s.db.query(`update public.cards set stage = 'building' where id = $1`, [maxed]);
      await s.spend(maxed, 5);
      await s.db.query(`update public.cards set stage = 'paused', failing_check = 'ceiling' where id = $1`, [maxed]);
      assertEquals((await s.row<{ r: Row }>(`select public.resume_card_by_rule($1) as r`, [maxed])).r.blocked, "card_max");
      assertEquals((await s.cardRow(maxed)).stage, "paused");

      await s.signInAs(BOARD_EMAIL, "aal1");
      const needs = (await s.row<{ n: { rule_blocked: { id: string; why: string }[] } }>(`select public.board_needs_you() as n`)).n;
      assertEquals(needs.rule_blocked.map((c) => [c.id, c.why]), [[id, "resumed_before"], [maxed, "card_max"]]);
      await s.identity();
    });

    await t.step("a card the board resumed from its ceiling pause, paused at its ceiling again, is never resumed by the rule and is listed in Needs you", async () => {
      await s.signInAs(null);
      const card = await s.card("Board resumed it", { source: "board", horizon: "now", target: 1 });
      await s.pay("board-resumed", 1, card);
      await s.db.query(`update public.cards set stage = 'building' where id = $1`, [card]);
      await s.spend(card, 1.5);
      await s.db.query(`update public.cards set stage = 'paused', failing_check = 'ceiling' where id = $1`, [card]);
      // The board resumes the first ceiling pause itself, before the rule does.
      await s.signInAs(BOARD_EMAIL, "aal2");
      await s.db.query(`select public.resume_card($1, 2, 'More room')`, [card]);
      await s.signInAs(null);
      const action = await s.row<{ d: Row }>(`select details as d from public.board_actions where action = 'resume_card' and card_id = $1`, [card]);
      assertEquals(action.d.failing_check, "ceiling");
      await s.db.query(`update public.cards set stage = 'building' where id = $1`, [card]);
      await s.spend(card, 1.5);
      await s.db.query(`update public.cards set stage = 'paused', failing_check = 'ceiling' where id = $1`, [card]);
      const before = await s.cardRow(card);
      const allocations = (await s.row<{ n: number }>(`select count(*)::int as n from public.contribution_allocations`)).n;
      // There is money not on a card yet, and $4.50 is under the $5 maximum, so only the earlier resume blocks it.
      const due = (await s.row<{ r: { resumed: number; results: Row[] } }>(`select public.resume_due_by_rule() as r`)).r;
      assertEquals(due.resumed, 0);
      assertEquals(due.results.filter((r) => r.card_id === card), []);
      assertEquals((await s.row<{ r: Row }>(`select public.resume_card_by_rule($1) as r`, [card])).r.blocked, "resumed_before");
      assertEquals(await s.cardRow(card), before);
      assertEquals((await s.row<{ n: number }>(`select count(*)::int as n from public.contribution_allocations`)).n, allocations);
      assertEquals((await s.rows(`select 1 from public.agent_events where card_id = $1 and payload_json ->> 'step' in ('resume_rule', 'ceiling_top_up')`, [card])).length, 0);

      await s.signInAs(BOARD_EMAIL, "aal1");
      const needs = (await s.row<{ n: { rule_blocked: { id: string; why: string }[] } }>(`select public.board_needs_you() as n`)).n;
      assertEquals(needs.rule_blocked.filter((c) => c.id === card).map((c) => c.why), ["resumed_before"]);
      await s.signInAs(null);
      await s.identity();
    });

    await t.step("a vetoed or closed-lane card is never resumed by the rule and is listed in Needs you; while the studio is paused nothing resumes", async () => {
      await s.signInAs(null);
      const pausedAtCeiling = async (key: string, card: string) => {
        await s.pay(key, 1, card);
        await s.db.query(`update public.cards set stage = 'building' where id = $1`, [card]);
        await s.spend(card, 1.5);
        await s.db.query(`update public.cards set stage = 'paused', failing_check = 'ceiling' where id = $1`, [card]);
      };
      const vetoed = await s.card("Director vetoed at its ceiling", { source: "board", horizon: "now", target: 1 });
      await pausedAtCeiling("vetoed", vetoed);
      await s.db.query(`update public.cards set director_stance = 'vetoed' where id = $1`, [vetoed]);
      await s.db.query(`update public.studio_state set platform_lane_open = true where id = 1`);
      const closed = await s.card("Closed lane at its ceiling", { source: "board", horizon: "now", target: 1, folder: "platform", lane: "code" });
      await pausedAtCeiling("closed", closed);
      await s.db.query(`update public.studio_state set platform_lane_open = false where id = 1`);
      const allocations = (await s.row<{ n: number }>(`select count(*)::int as n from public.contribution_allocations`)).n;
      assertEquals((await s.row<{ r: Row }>(`select public.resume_card_by_rule($1) as r`, [vetoed])).r.blocked, "vetoed");
      assertEquals((await s.row<{ r: Row }>(`select public.resume_card_by_rule($1) as r`, [closed])).r.blocked, "closed_lane");
      assertEquals([(await s.cardRow(vetoed)).stage, (await s.cardRow(closed)).stage], ["paused", "paused"]);
      assertEquals((await s.row<{ n: number }>(`select count(*)::int as n from public.contribution_allocations`)).n, allocations);
      await s.signInAs(BOARD_EMAIL, "aal1");
      const needs = (await s.row<{ n: { rule_blocked: { id: string; why: string }[] } }>(`select public.board_needs_you() as n`)).n;
      assertEquals(needs.rule_blocked.filter((c) => c.id === vetoed || c.id === closed).map((c) => [c.id, c.why]), [[vetoed, "vetoed"], [closed, "closed_lane"]]);
      await s.signInAs(null);

      const later = await s.card("Resumed after the pause", { source: "board", horizon: "now", target: 1 });
      await pausedAtCeiling("later", later);
      await s.db.query(`update public.studio_state set paused = true where id = 1`);
      assertEquals((await s.row<{ r: { resumed: number } }>(`select public.resume_due_by_rule() as r`)).r.resumed, 0);
      assertEquals((await s.cardRow(later)).stage, "paused");
      await s.db.query(`update public.studio_state set paused = false where id = 1`);
      const due = (await s.row<{ r: { resumed: number; results: Row[] } }>(`select public.resume_due_by_rule() as r`)).r;
      assertEquals(due.results.filter((r) => r.card_id === later).map((r) => r.resumed), [true]);
      assertEquals((await s.cardRow(later)).stage, "funded");
      await s.identity();
    });

    await t.step("money.top_up_card is all or nothing and no API role can call it", async () => {
      const other = await s.card("Top-up target", { source: "board", horizon: "now", target: 1, stage: "paused" });
      await s.refuses(`select money.top_up_card($1, 100000)`, "may leave Not on a card yet", [other]);
      for (const role of ["anon", "authenticated", "service_role"]) {
        await s.asRole(role, () => s.refuses(`select money.top_up_card($1, 1)`, "permission denied", [other]));
      }
      await s.identity();
    });
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------------------------

Deno.test("criterion 9's foreign keys: one delete of planned cards removes none when any is referenced", OPTS, async () => {
  const s = await studio();
  try {
    const free = await s.card("Planned, never referenced", { source: "board", horizon: "next" });
    const referenced = await s.card("Planned, named by a board action", { source: "board", horizon: "later" });
    await s.db.query(`insert into public.board_actions (action, card_id, actor_email, reason) values ('file_card', $1, $2, 'filed')`, [referenced, BOARD_EMAIL]);
    await s.refuses(`delete from public.cards where id = any($1::uuid[])`, "violates foreign key constraint", [[free, referenced]]);
    assertEquals((await s.rows(`select id from public.cards where id = any($1::uuid[])`, [[free, referenced]])).length, 2);
    await s.db.query(`delete from public.cards where id = any($1::uuid[])`, [[free]]);
    assertEquals((await s.rows(`select id from public.cards where id = $1`, [free])).length, 0);
  } finally {
    await s.close();
  }
});

// The migration runs twice, as a retried apply would (straight after itself, before any later file
// recreates its views), and the reason check keeps money-logic's reasons.
Deno.test("the migration applies twice and keeps money-logic's allocation reasons", OPTS, async () => {
  const s = await studio({ through: "20260924300000_agent_system_core.sql" });
  try {
    const file = (await readMigrations()).find((m) => m.name === "20260924300000_agent_system_core.sql");
    assert(file, "the agent-system-core migration");
    await s.db.exec(file.sql);
    const check = (await s.row<{ d: string }>(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'contribution_allocations_reason_check'`)).d;
    for (const reason of ["credit", "drain", "card_release", "unwind", "backfill", "ceiling_top_up"]) assert(check.includes(`'${reason}'`), reason);
    assertNotEquals((await s.row<{ n: number }>(`select count(*)::int as n from pg_trigger where tgname = 'cards_agent_text_guard'`)).n, 0);
  } finally {
    await s.close();
  }
});
