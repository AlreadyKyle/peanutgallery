// The supply-refill migration on PGlite (docs/specs/unattended-roles.md, PR4): the card a draft is
// billed to is opened first (the next seed-1 backlog card by horizon, rank and age, skipping board
// work and drafted cards, or a new private seed-1 card); an approved draft fills that card's fields
// and records a draft approval on it, and deal_due_cards deals it; a withdrawn draft rejects a new
// card and leaves a backlog card as it was; enqueue_supply_draft queues one scheduled run while the
// supply is short, within its guards; studio_ranking is retired. Every migration runs in order
// behind the same Supabase shim as agent_workflows_test.ts.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const WORKFLOWS = "20260924400000_agent_workflows.sql";
const MIGRATION = "20261010200000_supply_refill.sql";
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
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

async function readMigrations(): Promise<{ name: string; sql: string }[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  return await Promise.all(names.map(async (name) => ({ name, sql: (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "") })));
}

async function studio() {
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
  // The floor of docs/specs/studio-reports.md: 6 open, 1 of $5 or more, 1 under $2.
  await db.exec(
    `insert into public.studio_state (id, credit_daily_cap_usd, credit_studio_daily_cap_usd, card_max_usd, daily_cap_usd, monthly_cap_usd, reserve_pct, incident_cap_usd)
       values (1, 10000, 10000, 25, 100, 500, 0, 0);
     insert into public.pool (id) values (1); insert into public.stream_state (id) values (1);
     insert into public.board_members (email, role) values ('${BOARD_EMAIL}', 'board');`,
  );
  const roleOf = async (name: string, klass: string) =>
    (await row<{ id: string }>(
      `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, write_access, agent_class)
       values ($1, $1, 'A small creature.', 'model-id', 0.1, 'plain', 'platform/agents/prompts/x.md', $2, $3) returning id`,
      [name, klass === "writer" || klass === "planner", klass],
    )).id;
  const roles = {
    builder: await roleOf("Builder A", "writer"),
    designer: await roleOf("Game Designer", "planner"),
    director: await roleOf("Game Director", "reviewer"),
    studioHead: await roleOf("Studio Head", "planner"),
  };
  // agent-workflows again, now the roles exist, links each job to its role as on production; this
  // migration again after it restores what agent-workflows would replace.
  await db.exec(migrations.find((m) => m.name === WORKFLOWS)!.sql);
  await db.exec(migrations.find((m) => m.name === MIGRATION)!.sql);

  let made = 0;
  const at = () => {
    made += 1;
    return made;
  };
  // A card file-backlog files: a board goal card at proposed on next or later, no target, executor
  // or acceptance test.
  const backlog = async (title: string, o: { horizon?: string; rank?: number | null; folder?: string; boardWork?: boolean } = {}) =>
    (await row<{ id: string }>(
      `insert into public.cards (bucket, source, shape, lane, folder, title, summary, intent, stage, horizon, rank, board_work, created_at)
       values ('game', 'board', 'goal', 'code', $1, $2, 'A backlog summary.', 'It is not built yet.', 'proposed', $3, $4, $5,
         timestamptz '2026-09-01T00:00:00Z' + make_interval(secs => $6)) returning id`,
      [o.folder ?? "seed-1", title, o.horizon ?? "next", o.rank === undefined ? null : o.rank, o.boardWork ?? false, at()],
    )).id;
  // A card open for funding on now, with a target.
  const openCard = async (title: string, target: number) =>
    (await row<{ id: string }>(
      `insert into public.cards (bucket, source, shape, lane, folder, title, summary, intent, acceptance_test, funding_target_usd, estimate_usd, stage, horizon, executor_role_id, created_at)
       values ('game', 'board', 'goal', 'config', 'seed-1', $1, 'A summary.', 'An intent.', 'check: config seed-1/config/a.json x == 1', $2, $2, 'proposed', 'now', $3,
         timestamptz '2026-09-01T00:00:00Z' + make_interval(secs => $4)) returning id`,
      [title, target, roles.builder, at()],
    )).id;
  // A draft_card run, running, as the dispatcher claims it.
  const running = async (card: string | null = null) =>
    (await row<{ id: string }>(
      `insert into public.job_runs (job_name, idem_key, origin, status, card_id, started_at) values ('draft_card', gen_random_uuid()::text, 'schedule', 'running', $1, now()) returning id`,
      [card],
    )).id;
  const open = async (run: string) => (await row<{ r: { card_id: string; kind: string; opened: string } }>(`select public.open_draft_card($1) as r`, [run])).r;
  const fields = (over: Row = {}): Row => ({
    title: "Gatherers cost 11",
    summary: "The gatherer costs one more to build.",
    intent: "Raise the gatherer base cost by one so the first unlock takes a little longer.",
    acceptance_test: "The gatherer costs 11.\ncheck: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11",
    lane: "config",
    executor_role_id: roles.builder,
    estimate_usd: 2.5,
    ...over,
  });
  let makers = 0;
  const draft = async (card: string, run: string | null, over: Row = {}) => {
    makers += 1;
    return (await row<{ r: { id: string; content_sha256: string } }>(`select public.record_card_draft_for($1, $2, $3, $4::jsonb, $5) as r`, [
      card,
      run,
      roles.designer,
      JSON.stringify(fields(over)),
      `designer-session-${makers}`,
    ])).r;
  };
  const approve = async (id: string) =>
    (await row<{ id: string }>(`select public.approve_card_draft($1, $2, $3, '{"result":"approved","reason_codes":["fits_pillars"]}'::jsonb) as id`, [id, roles.director, `director-session-${id}`])).id;
  const cardRow = async (id: string) => await row<Row>(`select * from public.cards where id = $1`, [id]);
  const finish = async (run: string, output: Row) => await db.query(`select public.finish_job_run($1, 'succeeded', null, $2::jsonb)`, [run, JSON.stringify(output)]);
  const enqueue = async () => (await row<{ r: Row }>(`select public.enqueue_supply_draft() as r`)).r;
  const isPublic = async (id: string) => (await row<{ p: boolean }>(`select public.card_is_public($1) as p`, [id])).p;
  const takes = async (id: string) => (await row<{ t: boolean }>(`select money.card_takes_money(c, false) as t from public.cards c where c.id = $1`, [id])).t;
  return { db, row, rows, refuses, asRole, signInAs, roles, backlog, openCard, running, open, fields, draft, approve, cardRow, finish, enqueue, isPublic, takes, close: () => db.close() };
}

Deno.test("next_backlog_card takes the next seed-1 backlog card by horizon, then rank, then age, skipping board work, drafted, vetoed and platform cards", OPTS, async (t) => {
  const s = await studio();
  try {
    const next = async () => (await s.row<{ id: string | null }>(`select public.next_backlog_card() as id`)).id;
    await t.step("with no backlog card there is none", async () => {
      assertEquals(await next(), null);
    });
    const later1 = await s.backlog("Later, rank 1", { horizon: "later", rank: 1 });
    const nextUnranked = await s.backlog("Next, no rank", { horizon: "next" });
    const nextRank2Old = await s.backlog("Next, rank 2, older", { horizon: "next", rank: 2 });
    const nextRank2New = await s.backlog("Next, rank 2, newer", { horizon: "next", rank: 2 });
    const nextRank3 = await s.backlog("Next, rank 3", { horizon: "next", rank: 3 });
    const skipped = {
      boardWork: await s.backlog("Board work, rank 0", { rank: 0, boardWork: true }),
      platform: await s.backlog("Platform, rank 0", { rank: 0, folder: "platform" }),
      drafted: await s.backlog("Drafted, rank 0", { rank: 0 }),
      vetoed: await s.backlog("Vetoed, rank 0", { rank: 0 }),
      onNow: await s.backlog("On now, rank 0", { rank: 0 }),
    };
    await s.db.query(`update public.cards set drafter_role_id = $2 where id = $1`, [skipped.drafted, s.roles.designer]);
    await s.db.query(`update public.cards set board_vetoed = true, board_veto_reason = 'No.' where id = $1`, [skipped.vetoed]);
    await s.db.query(`update public.cards set horizon = 'now' where id = $1`, [skipped.onNow]);

    await t.step("next before later, then rank, then age, and an unranked card after the ranked ones", async () => {
      const order: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        const id = await next();
        if (id === null) break;
        order.push(id);
        // Take it out of the backlog as a draft approval would.
        await s.db.query(`update public.cards set opens_at = now() where id = $1`, [id]);
      }
      assertEquals(order, [nextRank2Old, nextRank2New, nextRank3, nextUnranked, later1]);
      for (const id of Object.values(skipped)) assert(!order.includes(id), `${id} is skipped`);
    });
  } finally {
    await s.close();
  }
});

Deno.test("open_draft_card opens the card first: the next backlog card, or a new private seed-1 card, and a new card an earlier run left unfinished", OPTS, async (t) => {
  const s = await studio();
  let newCard = "";
  try {
    await t.step("with no backlog card: a new seed-1 card, private, proposed on next, the Game Designer as drafter, named on the run", async () => {
      const run = await s.running();
      const opened = await s.open(run);
      assertEquals([opened.kind, opened.opened], ["new", "new"]);
      const c = await s.cardRow(opened.card_id);
      assertEquals(
        [c.source, c.bucket, c.folder, c.shape, c.stage, c.horizon, c.funding_target_usd, c.funded_usd, c.executor_role_id, c.opens_at],
        ["agent", "game", "seed-1", "goal", "proposed", "next", "0.0000", "0.0000", null, null],
      );
      assertEquals([c.proposer_role_id, c.drafter_role_id, c.check_author_role_id], [s.roles.designer, s.roles.designer, s.roles.designer]);
      assertEquals((await s.row<{ card_id: string }>(`select card_id from public.job_runs where id = $1`, [run])).card_id, opened.card_id);
      assertEquals(await s.isPublic(opened.card_id), false, "private until approved");
      assertEquals(await s.takes(opened.card_id), false);
      for (const role of ["anon", "authenticated"]) {
        const seen = await s.asRole(role, () => s.rows(`select id from public.cards where id = $1`, [opened.card_id]));
        assertEquals(seen.length, 0, `${role} reads no private draft card`);
      }
      // A studio row names it, so the draft's spend is billed to it.
      await s.db.query(`select public.record_usage($1, $2, 'model-id', 100, 0, 10, 0.12, 'studio', 'draft-request-1')`, [opened.card_id, s.roles.designer]);
      assertEquals(Number((await s.cardRow(opened.card_id)).actual_usd), 0.12);
      newCard = opened.card_id;
      await s.db.query(`select public.finish_job_run($1, 'failed', 'the Game Designer''s session failed', null)`, [run]);
    });

    await t.step("a later run while that card is unfinished reuses it, before any backlog card", async () => {
      await s.backlog("A backlog card", { rank: 1 });
      const again = await s.open(await s.running());
      assertEquals([again.card_id, again.kind, again.opened], [newCard, "new", "reused"]);
    });

    await t.step("a run that names its card keeps it, and one naming a card a draft may not fill is refused", async () => {
      const card = await s.backlog("Named", { rank: 9 });
      assertEquals(await s.open(await s.running(card)), { card_id: card, kind: "backlog", opened: "named" });
      const work = await s.backlog("Kernel work", { boardWork: true });
      await s.refuses(`select public.open_draft_card($1)`, "is not a card a draft may fill", [await s.running(work)]);
      const queued = (await s.row<{ id: string }>(`insert into public.job_runs (job_name, idem_key, origin) values ('draft_card', 'queued-one', 'schedule') returning id`)).id;
      await s.refuses(`select public.open_draft_card($1)`, "is not running", [queued]);
    });
  } finally {
    await s.close();
  }

  const b = await studio();
  try {
    await t.step("with a backlog card: that card, named on the run, and no new card", async () => {
      const card = await b.backlog("Show the next unlock", { rank: 1 });
      const before = (await b.row<{ n: number }>(`select count(*)::int as n from public.cards`)).n;
      const opened = await b.open(await b.running());
      assertEquals(opened, { card_id: card, kind: "backlog", opened: "backlog" });
      assertEquals((await b.row<{ n: number }>(`select count(*)::int as n from public.cards`)).n, before);
    });
  } finally {
    await b.close();
  }
});

Deno.test("an approved draft fills its card's fields, records a draft approval on it, and deal_due_cards deals it", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("a backlog card keeps the board's title and summary and gains the draft's intent, check lines, executor, lane and estimate", async () => {
      const card = await s.backlog("Show the next unlock", { horizon: "later", rank: 4 });
      const run = await s.running();
      assertEquals((await s.open(run)).card_id, card);
      await s.refuses(`select public.record_card_draft_for($1, $2, $3, $4::jsonb, 'other-title')`, "A backlog card keeps the board's title and summary", [card, run, s.roles.designer, JSON.stringify(s.fields())]);
      const d = await s.draft(card, run, { title: "Show the next unlock", summary: "A backlog summary." });
      const stored = await s.row<Row>(`select target_card_id, status, card_id from public.card_drafts where id = $1`, [d.id]);
      assertEquals([stored.target_card_id, stored.status, stored.card_id], [card, "drafted", null]);
      assertEquals((await s.cardRow(card)).intent, "It is not built yet.", "nothing changes before approval");

      assertEquals(await s.approve(d.id), card);
      const c = await s.cardRow(card);
      assertEquals(
        [c.title, c.summary, c.source, c.lane, c.executor_role_id, c.funding_target_usd, c.estimate_usd, c.stage, c.horizon, c.rank],
        ["Show the next unlock", "A backlog summary.", "board", "config", s.roles.builder, "2.5000", "2.5000", "proposed", "later", 4],
      );
      assertEquals([c.intent, c.drafter_role_id, c.check_author_role_id], [s.fields().intent, s.roles.designer, s.roles.designer]);
      assert(c.opens_at !== null, "opens_at is set");
      const a = await s.row<Row>(`select kind, approver_role_id, maker_role_id, content_sha256, job_run_id from public.card_approvals where card_id = $1`, [card]);
      assertEquals([a.kind, a.approver_role_id, a.maker_role_id, a.content_sha256, a.job_run_id], ["draft", s.roles.director, s.roles.designer, d.content_sha256, run]);
      assertEquals((await s.row<{ h: string }>(`select public.card_content_hash($1) as h`, [card])).h, d.content_sha256);
      assertEquals((await s.row<Row>(`select status, card_id from public.card_drafts where id = $1`, [d.id])), { status: "approved", card_id: card });

      assertEquals(await s.isPublic(card), true);
      assertEquals(await s.takes(card), false, "no money before it is dealt");
      assertEquals((await s.rows<{ id: string }>(`select public.deal_due_cards() as id`)).map((r) => r.id), [card]);
      assertEquals((await s.cardRow(card)).horizon, "now");
      assertEquals(await s.takes(card), true);
      const line = await s.rows<{ card_id: string }>(`select card_id from money.funding_order()`);
      assertEquals(line.map((r) => r.card_id), [card], "the waterfall funds it");
      assertEquals((await s.row<{ id: string | null }>(`select public.next_backlog_card() as id`)).id, null, "a drafted card is not drafted again");
    });

    await t.step("a new card takes the draft's title and summary too, and becomes public on approval", async () => {
      const run = await s.running();
      const opened = await s.open(run);
      assertEquals(opened.kind, "new");
      const d = await s.draft(opened.card_id, run);
      await s.db.exec(`update public.studio_state set cooling_window_minutes = 60 where id = 1`);
      assertEquals(await s.approve(d.id), opened.card_id);
      const c = await s.cardRow(opened.card_id);
      assertEquals([c.title, c.summary, c.source, c.horizon, c.stage, c.funding_target_usd], ["Gatherers cost 11", "The gatherer costs one more to build.", "agent", "next", "proposed", "2.5000"]);
      assertEquals(await s.isPublic(opened.card_id), true);
      assertEquals((await s.rows(`select public.deal_due_cards()`)).length, 0, "the cooling window holds it");
    });

    await t.step("approval is refused when the card is no longer one a draft may fill", async () => {
      const card = await s.backlog("Vetoed meanwhile", { rank: 5 });
      const run = await s.running(card);
      const d = await s.draft(card, run, { title: "Vetoed meanwhile", summary: "A backlog summary." });
      await s.db.query(`update public.cards set board_vetoed = true, board_veto_reason = 'Not now.' where id = $1`, [card]);
      await s.refuses(`select public.approve_card_draft($1, $2, 'grader-v', '{"result":"approved"}'::jsonb)`, "is no longer a card a draft may fill", [d.id, s.roles.director]);
      assertEquals((await s.cardRow(card)).intent, "It is not built yet.");
      const other = await s.backlog("Retitled meanwhile", { rank: 6 });
      const run2 = await s.running(other);
      const d2 = await s.draft(other, run2, { title: "Retitled meanwhile", summary: "A backlog summary." });
      await s.db.query(`update public.cards set summary = 'The board changed it.' where id = $1`, [other]);
      await s.refuses(`select public.approve_card_draft($1, $2, 'grader-w', '{"result":"approved"}'::jsonb)`, "keeps the board's title and summary", [d2.id, s.roles.director]);
      await s.refuses(`select public.record_card_draft_for($1, $2, $3, $4::jsonb, 'm')`, "does not name card", [other, run, s.roles.designer, JSON.stringify(s.fields())]);
    });
  } finally {
    await s.close();
  }
});

Deno.test("a withdrawn draft rejects a new card with draft_withdrawn, its spend kept, and leaves a backlog card as it was", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("a new card: rejected with draft_withdrawn, its ledger row kept, never public", async () => {
      const run = await s.running();
      const card = (await s.open(run)).card_id;
      await s.db.query(`select public.record_usage($1, $2, 'model-id', 100, 0, 10, 0.3, 'studio', 'withdrawn-1')`, [card, s.roles.designer]);
      const d = await s.draft(card, run);
      await s.db.query(`select public.withdraw_card_draft($1, array['off_pillar'])`, [d.id]);
      await s.db.query(`select public.reject_draft_card($1, $2)`, [card, run]);
      const c = await s.cardRow(card);
      assertEquals([c.stage, c.failing_check, c.actual_usd], ["rejected", "draft_withdrawn", "0.3000"]);
      assertEquals((await s.rows(`select id from public.ledger where card_id = $1 and billed_to = 'studio'`, [card])).length, 1);
      assertEquals(await s.isPublic(card), false);
      await s.finish(run, { result: "withdrawn", card_id: card });
      const next = await s.open(await s.running());
      assert(next.card_id !== card && next.opened === "new", "the next run opens another new card");
    });

    await t.step("a backlog card: refused by reject_draft_card, unchanged, and passed over until it changes", async () => {
      const card = await s.backlog("Hard to draft", { rank: 1 });
      const second = await s.backlog("The next one", { rank: 2 });
      await s.db.exec(`update public.cards set stage = 'rejected', failing_check = 'draft_withdrawn' where source = 'agent' and stage = 'proposed'`);
      const run = await s.running();
      assertEquals((await s.open(run)).card_id, card);
      const before = await s.cardRow(card);
      const d = await s.draft(card, run, { title: "Hard to draft", summary: "A backlog summary." });
      await s.db.query(`select public.withdraw_card_draft($1, array['off_pillar'])`, [d.id]);
      await s.refuses(`select public.reject_draft_card($1, $2)`, "a backlog card is left as it was", [card, run]);
      await s.finish(run, { result: "withdrawn", card_id: card });
      assertEquals(await s.cardRow(card), before, "the backlog card is as it was");
      assertEquals((await s.row<{ id: string }>(`select public.next_backlog_card() as id`)).id, second, "passed over after a withdrawn draft");
      await s.db.query(`update public.cards set intent = 'It is not built yet. The board said more.' where id = $1`, [card]);
      assertEquals((await s.row<{ id: string }>(`select public.next_backlog_card() as id`)).id, card, "eligible again once it changes");
    });
  } finally {
    await s.close();
  }
});

Deno.test("enqueue_supply_draft queues one scheduled draft_card run while the supply is short, and never otherwise", OPTS, async (t) => {
  const s = await studio();
  try {
    const runs = async () => await s.rows<Row>(`select id, origin, status, input from public.job_runs where job_name = 'draft_card' order by created_at, id`);
    let first = "";

    await t.step("short with no board action: one run, origin schedule, the floor as its input", async () => {
      const r = await s.enqueue();
      assertEquals([r.queued, r.reason], [true, null]);
      const queued = await runs();
      assertEquals(queued.length, 1);
      first = String(queued[0]!.id);
      assertEquals([queued[0]!.origin, queued[0]!.status], ["schedule", "queued"]);
      assertEquals(queued[0]!.input, { floor: { short_open: 6, short_big: 1, short_small: 1, big_min_usd: 5, small_max_usd: 2 } });
    });

    await t.step("never two at once: queued, then running", async () => {
      assertEquals((await s.enqueue()).reason, "already_queued");
      await s.db.query(`update public.job_runs set status = 'running', started_at = now() where id = $1`, [first]);
      assertEquals((await s.enqueue()).reason, "already_queued");
      assertEquals((await runs()).length, 1);
      await s.finish(first, { result: "approved" });
    });

    await t.step("never while the studio is paused, the job's role or the Game Director is paused", async () => {
      await s.db.exec(`update public.studio_state set paused = true where id = 1`);
      assertEquals((await s.enqueue()).reason, "studio_paused");
      await s.db.exec(`update public.studio_state set paused = false where id = 1`);
      await s.db.query(`update public.roles set paused = true where id = $1`, [s.roles.designer]);
      assertEquals((await s.enqueue()).reason, "role_paused");
      await s.db.query(`update public.roles set paused = false where id = $1`, [s.roles.designer]);
      await s.db.query(`update public.roles set paused = true where id = $1`, [s.roles.director]);
      assertEquals((await s.enqueue()).reason, "grader_paused");
      await s.db.query(`update public.roles set paused = false where id = $1`, [s.roles.director]);
      assertEquals((await runs()).length, 1);
    });

    await t.step("at most draft_runs_per_day runs since New York midnight; a skipped run does not count", async () => {
      await s.db.exec(`update public.studio_state set draft_runs_per_day = 2 where id = 1`);
      await s.db.exec(`insert into public.job_runs (job_name, idem_key, origin, status, reason) values ('draft_card', 'skipped-1', 'schedule', 'skipped', 'role_paused')`);
      const second = await s.enqueue();
      assertEquals(second.queued, true);
      await s.db.query(`update public.job_runs set status = 'failed', reason = 'insufficient_balance', finished_at = now() where id = $1`, [second.run_id]);
      assertEquals(await s.enqueue(), { queued: false, reason: "daily_limit", runs_today: 2 });
      // Yesterday's runs, in New York, do not count.
      await s.db.exec(`update public.job_runs set created_at = (((now() at time zone 'America/New_York')::date)::timestamp at time zone 'America/New_York') - interval '1 minute' where job_name = 'draft_card'`);
      assertEquals((await s.enqueue()).queued, true);
      await s.db.exec(`update public.job_runs set status = 'skipped', reason = 'test' where job_name = 'draft_card' and status = 'queued'`);
      await s.db.exec(`update public.studio_state set draft_runs_per_day = 4 where id = 1`);
    });

    await t.step("not short once the open cards and the approved agent cards waiting to be dealt meet the floor", async () => {
      await s.db.exec(`update public.studio_state set card_floor_open = 2, card_floor_big = 0, card_floor_small = 0 where id = 1`);
      await s.openCard("Open one", 3);
      assertEquals((await s.enqueue()).floor, { short_open: 1, short_big: 0, short_small: 0, big_min_usd: 5, small_max_usd: 2 });
      await s.db.exec(`update public.job_runs set status = 'skipped', reason = 'test' where job_name = 'draft_card' and status = 'queued'`);
      // An approved draft waiting for its cooling window counts as open.
      const run = await s.running();
      const card = (await s.open(run)).card_id;
      await s.db.exec(`update public.studio_state set cooling_window_minutes = 600 where id = 1`);
      await s.approve((await s.draft(card, run)).id);
      await s.finish(run, { result: "approved", card_id: card });
      const r = await s.enqueue();
      assertEquals([r.queued, r.reason, r.waiting], [false, "not_short", 1]);
    });

    await t.step("a big shortfall no draft can fill (its threshold above the card maximum) queues nothing", async () => {
      await s.db.exec(`update public.studio_state set card_floor_big = 1, card_big_min_usd = 30 where id = 1`);
      const r = await s.enqueue();
      assertEquals([r.queued, r.reason], [false, "not_short"]);
      assertEquals((r.floor as Row).short_big, 0);
    });
  } finally {
    await s.close();
  }
});

Deno.test("studio_ranking is retired: no run of it can be queued by the board or a schedule, and no schedule names it", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("the jobs rows: studio_ranking disabled, draft_card enabled and no longer running while the studio is paused", async () => {
      const jobs = await s.rows<Row>(`select name, role_id, calls_model, runs_when_paused, enabled from public.jobs where name in ('draft_card', 'studio_ranking') order by name`);
      assertEquals(jobs, [
        { name: "draft_card", role_id: s.roles.designer, calls_model: true, runs_when_paused: false, enabled: true },
        { name: "studio_ranking", role_id: s.roles.studioHead, calls_model: true, runs_when_paused: true, enabled: false },
      ]);
    });

    await t.step("a schedule, an event and the board's Run now are all refused, and nothing is queued", async () => {
      for (const origin of ["schedule", "event", "operator"]) {
        await s.refuses(`select public.enqueue_job_run('studio_ranking', $1)`, "Job studio_ranking is retired and takes no run", [origin]);
      }
      await s.signInAs(BOARD_EMAIL, "aal2");
      await s.refuses(`select public.enqueue_manual_job('studio_ranking', null, 'Rank now', '{}'::jsonb)`, "is retired");
      const draft = (await s.row<{ id: string }>(`select public.enqueue_manual_job('draft_card', null, 'Draft one', '{}'::jsonb) as id`)).id;
      assert(draft, "draft_card still takes a board run");
      await s.signInAs(null);
      assertEquals((await s.rows(`select id from public.job_runs where job_name = 'studio_ranking'`)).length, 0);
    });

    await t.step("no migration schedules studio_ranking, and this one schedules the supply draft every 20 minutes", async () => {
      for (const m of await readMigrations()) {
        assert(!/cron\.schedule\(\s*'studio_ranking'/.test(m.sql), `${m.name} schedules studio_ranking`);
        assert(!/enqueue_job_run\(\s*'studio_ranking'/.test(m.sql), `${m.name} queues studio_ranking`);
      }
      const sql = (await readMigrations()).find((m) => m.name === MIGRATION)!.sql;
      assert(sql.includes(`cron.schedule('supply-draft', '*/20 * * * *', $c$select public.enqueue_supply_draft()$c$)`));
    });
  } finally {
    await s.close();
  }
});

Deno.test("every new function is the service role's, and the migration runs twice", OPTS, async () => {
  const s = await studio();
  try {
    const calls = [
      `select public.next_backlog_card()`,
      `select public.open_draft_card(gen_random_uuid())`,
      `select public.record_card_draft_for(gen_random_uuid(), null, gen_random_uuid(), '{}'::jsonb, 'm')`,
      `select public.reject_draft_card(gen_random_uuid(), gen_random_uuid())`,
      `select public.enqueue_supply_draft()`,
      `select public.card_from_draft_onto(null::public.cards, '{}'::jsonb, null)`,
      `select public.draft_target_kind(null::public.cards, null)`,
    ];
    for (const role of ["anon", "authenticated"]) {
      for (const call of calls) await s.asRole(role, () => s.refuses(call, "permission denied"));
    }
    const sql = (await readMigrations()).find((m) => m.name === MIGRATION)!.sql;
    await s.db.exec(sql);
    await s.db.exec(sql);
    assertEquals((await s.row<{ n: number }>(`select count(*)::int as n from pg_trigger where tgname = 'job_runs_job_enabled'`)).n, 1);
  } finally {
    await s.close();
  }
});
