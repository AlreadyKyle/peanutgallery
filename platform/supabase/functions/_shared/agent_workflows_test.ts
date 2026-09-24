// The agent-workflows migration on PGlite (docs/specs/agent-workflows.md): drafts are private and
// reach a card only on approval, approval inserts one seed-1 card whose hash is the graded draft's
// and which takes no money until the tick deals it, a withdrawal writes no card, the card text
// guard admits the board and draft paths only, the ranking writes rank only within its limits, and
// every new function is the service role's. Every migration runs in order behind the same Supabase
// shim as agent_system_test.ts.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20260924400000_agent_workflows.sql";
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const BOARD_EMAIL = "board@peanutgallery.games";
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
type RoleName = "builder" | "designer" | "director" | "studioHead";

const APPLY =
  `select public.apply_contribution(p_stripe_event_id => $1, p_contributor_id => $2, p_display_name => null, p_amount_usd => $3, p_net_usd => $3, p_studio_pct => 0, p_goal_card_id => $4::uuid, p_stripe_session_id => $5, p_payer_key => null, p_session_created_at => null) as r`;

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
  const roles: Record<RoleName, string> = {
    builder: await roleOf("Builder A", "writer"),
    designer: await roleOf("Game Designer", "planner"),
    director: await roleOf("Game Director", "reviewer"),
    studioHead: await roleOf("Studio Head", "planner"),
  };
  // The migration again, now the roles exist: it links each job to its role, as on production.
  await db.exec(migrations.find((m) => m.name === MIGRATION)!.sql);

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
  const draft = async (over: Row = {}, maker?: string) => {
    makers += 1;
    return (await row<{ r: { id: string; content_sha256: string } }>(`select public.record_card_draft(null, $1, $2::jsonb, $3) as r`, [
      roles.designer,
      JSON.stringify(fields(over)),
      maker ?? `designer-session-${makers}`,
    ])).r;
  };
  const approve = async (id: string, grader = `director-session-${id}`) =>
    (await row<{ id: string }>(`select public.approve_card_draft($1, $2, $3, '{"reason_codes":["fits_pillars"]}'::jsonb) as id`, [id, roles.director, grader])).id;
  const draftRow = async (id: string) => await row<Row>(`select * from public.card_drafts where id = $1`, [id]);
  const cardRow = async (id: string) => await row<Row>(`select * from public.cards where id = $1`, [id]);
  const cardCount = async () => (await row<{ n: number }>(`select count(*)::int as n from public.cards`)).n;
  const takes = async (id: string) =>
    (await row<{ t: boolean }>(`select money.card_takes_money(c, false) as t from public.cards c where c.id = $1`, [id])).t;
  const pay = async (key: string, amount: number, goal: string | null = null) => (await row<{ r: Row }>(APPLY, [`evt_${key}`, `contrib_${key}`, amount, goal, `cs_${key}`])).r;
  let made = 0;
  const boardCard = async (title: string, o: { horizon?: string; stage?: string; rank?: number | null; target?: number } = {}) => {
    made += 1;
    return (await row<{ id: string }>(
      `insert into public.cards (bucket, source, shape, lane, folder, title, summary, intent, acceptance_test, funding_target_usd, estimate_usd, stage, horizon, rank, executor_role_id, created_at)
       values ('game', 'board', 'goal', 'config', 'seed-1', $1, 'A summary.', 'An intent.', 'check: config seed-1/config/a.json x == 1', $2, $2, $3, $4, $5, $6,
         timestamptz '2026-09-01T00:00:00Z' + make_interval(secs => $7)) returning id`,
      [title, o.target ?? 10, o.stage ?? "proposed", o.horizon ?? "now", o.rank === undefined ? null : o.rank, roles.builder, made],
    )).id;
  };
  return { db, row, rows, refuses, asRole, signInAs, roles, fields, draft, approve, draftRow, cardRow, cardCount, takes, pay, boardCard, close: () => db.close() };
}

Deno.test("a draft is private and every draft and ranking function is the service role's", OPTS, async (t) => {
  const s = await studio();
  try {
    const d = await s.draft();
    await t.step("anon and authenticated read no draft, a board member included; the service role reads it", async () => {
      for (const role of ["anon", "authenticated"]) {
        await s.signInAs(role === "authenticated" ? BOARD_EMAIL : null, role === "authenticated" ? "aal2" : null);
        await s.asRole(role, () => s.refuses(`select * from public.card_drafts`, "permission denied"));
      }
      await s.signInAs(null);
      assertEquals((await s.asRole("service_role", () => s.rows(`select id from public.card_drafts`))).length, 1);
    });

    await t.step("anon and authenticated may call none of the new functions", async () => {
      const calls = [
        `select public.record_card_draft(null, '${s.roles.designer}', '{}'::jsonb, 'm')`,
        `select public.approve_card_draft('${d.id}', '${s.roles.director}', 'g')`,
        `select public.withdraw_card_draft('${d.id}', array['off_pillar'])`,
        `select public.apply_card_ranking(gen_random_uuid(), array[]::uuid[])`,
        `select public.rankable_cards()`,
        `select public.card_ranking_places(array[]::uuid[])`,
        `select public.card_rank_problem(null::public.cards)`,
        `select public.card_from_draft('{}'::jsonb, null)`,
      ];
      for (const role of ["anon", "authenticated"]) {
        for (const call of calls) await s.asRole(role, () => s.refuses(call, "permission denied"));
      }
      assertEquals((await s.draftRow(d.id)).status, "drafted");
    });
  } finally {
    await s.close();
  }
});

Deno.test("record_card_draft hashes the card approval would insert and refuses a draft that is not one card", OPTS, async (t) => {
  const s = await studio();
  try {
    await t.step("the hash is the would-be card's content hash, the target being the estimate", async () => {
      const d = await s.draft();
      const expected = (await s.row<{ h: string }>(`select public.card_content_hash_of(public.card_from_draft($1::jsonb, $2)) as h`, [JSON.stringify(s.fields()), s.roles.designer])).h;
      assertEquals(d.content_sha256, expected);
      const stored = await s.draftRow(d.id);
      assertEquals([stored.status, stored.maker_ref, stored.card_id, stored.role_id], ["drafted", "designer-session-1", null, s.roles.designer]);
      assertEquals(await s.cardCount(), 0, "a draft writes no card");
    });

    await t.step("each malformed draft is refused with its own message", async () => {
      const record = (f: Row, role = s.roles.designer, maker = "m") => `select public.record_card_draft(null, '${role}', '${JSON.stringify(f).replaceAll("'", "''")}'::jsonb, '${maker}')`;
      await s.refuses(record(s.fields({ funding_target_usd: 3 })), "a key that is not a card field");
      await s.refuses(record(s.fields({ title: "" })), "A draft needs a title");
      await s.refuses(record(s.fields({ summary: "x".repeat(201) })), "public summary of at most 200 characters");
      await s.refuses(record(s.fields({ lane: "art" })), "lane is config or code");
      await s.refuses(record(s.fields({ estimate_usd: "2" })), "one estimate_usd, a number");
      await s.refuses(record(s.fields({ estimate_usd: 0 })), "above zero and at most $10,000");
      await s.refuses(record(s.fields({ executor_role_id: "00000000-0000-4000-8000-000000000000" })), "is not a role");
      await s.refuses(record(s.fields(), s.roles.director), "Only a planner drafts a card");
      await s.refuses(record(s.fields(), s.roles.designer, " "), "A maker ref is required");
    });
  } finally {
    await s.close();
  }
});

Deno.test("approval inserts one seed-1 card from the graded draft, which takes no money until it is dealt", OPTS, async (t) => {
  const s = await studio();
  try {
    const sink = await s.boardCard("The board's open card", { target: 100 });
    const d = await s.draft();
    let card = "";

    await t.step("the card: source agent, horizon next, stage proposed, target equal to the estimate, the Designer as proposer, drafter and check author", async () => {
      card = await s.approve(d.id);
      const c = await s.cardRow(card);
      assertEquals(
        [c.source, c.bucket, c.folder, c.lane, c.shape, c.horizon, c.stage, c.funding_target_usd, c.estimate_usd, c.funded_usd],
        ["agent", "game", "seed-1", "config", "goal", "next", "proposed", "2.5000", "2.5000", "0.0000"],
      );
      assertEquals([c.proposer_role_id, c.drafter_role_id, c.check_author_role_id, c.executor_role_id], [s.roles.designer, s.roles.designer, s.roles.designer, s.roles.builder]);
      assertEquals((await s.row<{ h: string }>(`select public.card_content_hash($1) as h`, [card])).h, d.content_sha256);
      assertEquals(await s.cardCount(), 2);
    });

    await t.step("the approval names the grader's session, not the maker's, and the draft is approved with its card", async () => {
      const a = await s.row<Row>(`select * from public.card_approvals where card_id = $1`, [card]);
      assertEquals([a.kind, a.approver_role_id, a.maker_role_id, a.maker_ref, a.grader_ref, a.content_sha256], ["draft", s.roles.director, s.roles.designer, "designer-session-1", `director-session-${d.id}`, d.content_sha256]);
      assertEquals((a.verdict as Row).verdict, "approved");
      const stored = await s.draftRow(d.id);
      assertEquals([stored.status, stored.card_id, stored.grader_ref], ["approved", card, `director-session-${d.id}`]);
      assertEquals((await s.row<{ a: boolean }>(`select public.card_approved($1) as a`, [card])).a, true);
    });

    await t.step("off now until dealt: a payment naming it credits no bar; the tick deals it and then it takes money", async () => {
      assertEquals(await s.takes(card), false);
      const paid = await s.pay("named_undealt", 3, card);
      assertEquals(paid.allocations, [{ destination: "card", card_id: sink, amount_usd: 3, step: 2 }]);
      assertEquals(Number((await s.cardRow(card)).funded_usd), 0);
      assertEquals((await s.rows<{ id: string }>(`select public.deal_due_cards() as id`)).map((r) => r.id), [card]);
      assertEquals((await s.cardRow(card)).horizon, "now");
      assertEquals(await s.takes(card), true);
    });

    await t.step("opens_at is the approval time plus the cooling window", async () => {
      await s.db.exec(`update public.studio_state set cooling_window_minutes = 60 where id = 1`);
      const later = await s.approve((await s.draft({ title: "Gatherers cost 12" })).id);
      const opens = await s.row<{ minutes: number }>(`select round(extract(epoch from (opens_at - now())) / 60)::int as minutes from public.cards where id = $1`, [later]);
      assertEquals(opens.minutes, 60);
      assertEquals((await s.rows(`select public.deal_due_cards()`)).length, 0);
    });

    await t.step("approval is refused, writing no card, when the grader ref is the maker's, the approver made it, or the card is not ready", async () => {
      const before = await s.cardCount();
      const same = await s.draft({ title: "Same session" }, "one-session");
      await s.refuses(`select public.approve_card_draft($1, $2, 'one-session')`, "The grader ref must differ from the maker ref", [same.id, s.roles.director]);
      await s.refuses(`select public.approve_card_draft($1, $2, 'other-session')`, "The approver cannot be the card's proposer, drafter or executor", [same.id, s.roles.designer]);
      const noExecutor = await s.draft({ title: "No executor", executor_role_id: null });
      await s.refuses(`select public.approve_card_draft($1, $2, 'grader-x')`, "A card on now needs an executor role", [noExecutor.id, s.roles.director]);
      const noCheck = await s.draft({ title: "No check", acceptance_test: "It feels better." });
      await s.refuses(`select public.approve_card_draft($1, $2, 'grader-y')`, "needs a check: line", [noCheck.id, s.roles.director]);
      assertEquals(await s.cardCount(), before);
      assertEquals((await s.draftRow(same.id)).status, "drafted");
      await s.refuses(`select public.approve_card_draft($1, $2, 'grader-z')`, "is already approved", [d.id, s.roles.director]);
    });
  } finally {
    await s.close();
  }
});

Deno.test("a withdrawal writes no card and ends the draft", OPTS, async () => {
  const s = await studio();
  try {
    const d = await s.draft();
    await s.refuses(`select public.withdraw_card_draft($1, array[]::text[])`, "at least one reason code", [d.id]);
    await s.db.query(`select public.withdraw_card_draft($1, array['off_pillar', 'too_big'])`, [d.id]);
    const stored = await s.draftRow(d.id);
    assertEquals([stored.status, stored.reason_codes, stored.card_id], ["withdrawn", ["off_pillar", "too_big"], null]);
    assertEquals(await s.cardCount(), 0);
    await s.refuses(`select public.approve_card_draft($1, $2, 'grader')`, "is already withdrawn", [d.id, s.roles.director]);
    await s.refuses(`select public.withdraw_card_draft($1, array['again'])`, "is already withdrawn", [d.id]);
  } finally {
    await s.close();
  }
});

Deno.test("the card text guard accepts agent text from the board and draft paths only", OPTS, async () => {
  const s = await studio();
  try {
    const card = await s.approve((await s.draft()).id);
    const edit = async (writer: string, title: string) => {
      await s.db.exec(`begin; select set_config('peanutgallery.card_writer', '${writer}', true); update public.cards set title = '${title}' where id = '${card}'; commit;`);
    };
    for (const writer of ["", "agent", "builder", "Draft"]) {
      await assertRejects(() => edit(writer, `Rewritten by ${writer || "nobody"}`), Error, "changes only through a board RPC or the draft path");
      await s.db.exec(`rollback`);
    }
    await edit("draft", "Rewritten on the draft path");
    await edit("board", "Rewritten on the board path");
    assertEquals((await s.cardRow(card)).title, "Rewritten on the board path");
    // The estimate is not hashed, so it changes on no path at all.
    await s.db.query(`update public.cards set estimate_usd = 3 where id = $1`, [card]);
  } finally {
    await s.close();
  }
});

type Moves = { moves: { card_id: string; from: number | null; to: number }[]; unapplied: number };

// A studio_ranking run marked running, the ranking applied from it, and the cards step 2 funds, in
// its order, as "title@rank" ("-" for no rank).
function ranking(s: Awaited<ReturnType<typeof studio>>) {
  const running = async (job = "studio_ranking") =>
    (await s.row<{ id: string }>(`insert into public.job_runs (job_name, idem_key, origin, status) values ($1, gen_random_uuid()::text, 'board', 'running') returning id`, [job])).id;
  const rank = async (order: string[]) => (await s.row<{ r: Moves }>(`select public.apply_card_ranking($1, $2::uuid[]) as r`, [await running(), order])).r;
  const line = async () =>
    (await s.rows<{ t: string }>(`select c.title || '@' || coalesce(c.rank::text, '-') as t from money.funding_order() f join public.cards c on c.id = f.card_id order by f.position`)).map((r) => r.t);
  const sharedRanks = async () => await s.rows(`select rank from public.cards where horizon = 'now' and rank is not null group by rank having count(*) > 1`);
  return { running, rank, line, sharedRanks };
}

Deno.test("apply_card_ranking writes rank only, on open cards on now with no money, at most ten a run", OPTS, async (t) => {
  const s = await studio();
  try {
    const { running, rank, line, sharedRanks } = ranking(s);
    const open: string[] = [];
    for (let i = 0; i < 12; i += 1) open.push(await s.boardCard(`Open ${i}`, { rank: i + 1 }));

    await t.step("each refusal names the card, and a refused ranking writes nothing; rankable_cards lists the cards it accepts", async () => {
      const run = await running();
      const next = await s.boardCard("On next", { horizon: "next" });
      const funded = await s.boardCard("Funded", { stage: "funded" });
      const withMoney = await s.boardCard("Money on its bar", { target: 100 });
      await s.pay("bar", 2, withMoney);
      // No credit left today: the whole payment is held, naming the card, and its bar stays empty.
      await s.db.exec(`update public.studio_state set credit_daily_cap_usd = 0 where id = 1`);
      const withHold = await s.boardCard("Money on hold", { target: 100 });
      const held = await s.pay("hold", 5, withHold);
      assertEquals(held.held_usd, 5);
      assertEquals(Number((await s.cardRow(withHold)).funded_usd), 0, "nothing on its bar, only a hold");
      await s.db.exec(`update public.studio_state set credit_daily_cap_usd = 10000 where id = 1`);
      assertEquals((await s.row<{ ids: string[] }>(`select public.rankable_cards() as ids`)).ids, open, "the open cards on now with no money, in funding order");
      const before = await s.rows(`select id, rank from public.cards order by id`);
      await s.refuses(`select public.apply_card_ranking($1, array['00000000-0000-4000-8000-000000000000']::uuid[])`, "does not exist", [run]);
      await s.refuses(`select public.apply_card_ranking($1, $2::uuid[])`, "is not on now", [run, [open[1], next]]);
      await s.refuses(`select public.apply_card_ranking($1, $2::uuid[])`, "is not open for funding", [run, [funded]]);
      await s.refuses(`select public.apply_card_ranking($1, $2::uuid[])`, "holds money", [run, [withMoney]]);
      await s.refuses(`select public.apply_card_ranking($1, $2::uuid[])`, `Card ${withHold} holds money`, [run, [open[0], withHold]]);
      await s.refuses(`select public.apply_card_ranking($1, $2::uuid[])`, "names a card twice", [run, [open[0], open[0]]]);
      const other = await running("draft_card");
      await s.refuses(`select public.apply_card_ranking($1, $2::uuid[])`, "only from a running studio_ranking run", [other, [open[0]]]);
      await s.db.query(`update public.job_runs set status = 'succeeded' where id = $1`, [run]);
      await s.refuses(`select public.apply_card_ranking($1, $2::uuid[])`, "only from a running studio_ranking run", [run, [open[0]]]);
      assertEquals(await s.rows(`select id, rank from public.cards order by id`), before);
      assertEquals((await s.rows(`select 1 from public.agent_events where payload_json ->> 'step' = 'ranked'`)).length, 0);
    });

    await t.step("the reverse of twelve applies the longest start of the order that fits in ten changes, and leaves no two cards on now one rank", async () => {
      const before = await s.rows<Row>(`select * from public.cards where id = any($1::uuid[]) order by id`, [open]);
      const reversed = [...open].reverse();
      const result = await rank(reversed);
      // All twelve would change twelve ranks. The first eleven trade ranks 2 to 12 among
      // themselves, which changes ten (Open 6 keeps 7); Open 0, past the cut, keeps rank 1.
      assertEquals(result.moves.length, 10);
      assertEquals(result.unapplied, 1);
      assertEquals(result.moves[0], { card_id: reversed[0], from: 12, to: 2 });
      assertEquals(await line(), [
        "Open 0@1", "Open 11@2", "Open 10@3", "Open 9@4", "Open 8@5", "Open 7@6", "Open 6@7", "Open 5@8", "Open 4@9", "Open 3@10", "Open 2@11", "Open 1@12",
        "Funded@-", "Money on its bar@-", "Money on hold@-",
      ]);
      assertEquals(await sharedRanks(), []);
      const after = await s.rows<Row>(`select * from public.cards where id = any($1::uuid[]) order by id`, [open]);
      for (const [i, card] of after.entries()) {
        const { rank: _a, updated_at: _b, ...rest } = card;
        const { rank: _c, updated_at: _d, ...was } = before[i]!;
        assertEquals(rest, was, "only rank changes");
      }
      const events = await s.rows<{ card_id: string | null; role_id: string; payload_json: Row }>(`select card_id, role_id, payload_json from public.agent_events where payload_json ->> 'step' = 'ranked'`);
      assertEquals(events.length, 1);
      assertEquals([events[0]!.card_id, events[0]!.role_id], [null, s.roles.studioHead]);
      assertEquals(Object.keys(events[0]!.payload_json).sort(), ["moves", "step"]);
      assertEquals(events[0]!.payload_json.moves, result.moves);
      for (const move of events[0]!.payload_json.moves as Row[]) assertEquals(Object.keys(move).sort(), ["card_id", "from", "to"]);
    });

    await t.step("an order the cards already stand in is not a change", async () => {
      const result = await rank([...open].reverse().slice(0, 3));
      assertEquals([result.moves.length, result.unapplied], [0, 0]);
      assertEquals((await s.rows(`select 1 from public.agent_events where payload_json ->> 'step' = 'ranked'`)).length, 2, "one event per run");
    });
  } finally {
    await s.close();
  }
});

Deno.test("a ranking trades only the places the named cards hold, so a card holding money keeps its place in line", OPTS, async (t) => {
  await t.step("ranked cards: the unchanged order moves nothing, and a card holding money stays first", async () => {
    const s = await studio();
    try {
      const { rank, line } = ranking(s);
      const m = await s.boardCard("M", { rank: 1, target: 100 });
      await s.pay("m", 2, m);
      const a = await s.boardCard("A", { rank: 2 });
      const b = await s.boardCard("B", { rank: 3 });
      assertEquals(await rank([a, b]), { moves: [], unapplied: 0 });
      assertEquals(await rank([b, a]), { moves: [{ card_id: b, from: 3, to: 2 }, { card_id: a, from: 2, to: 3 }], unapplied: 0 });
      assertEquals(await line(), ["M@1", "B@2", "A@3"]);
    } finally {
      await s.close();
    }
  });

  await t.step("sparse ranks: the named cards keep the ranks they hold, and the card holding money between them keeps its own", async () => {
    const s = await studio();
    try {
      const { rank, line } = ranking(s);
      const x = await s.boardCard("X", { rank: 2, target: 1.5 });
      await s.pay("x", 0.5, x);
      const a = await s.boardCard("A", { rank: 5 });
      const b = await s.boardCard("B", { rank: 6 });
      const c = await s.boardCard("C", { rank: 7 });
      assertEquals((await rank([a, b, c])).moves, []);
      await rank([c, a, b]);
      assertEquals(await line(), ["X@2", "C@5", "A@6", "B@7"]);
    } finally {
      await s.close();
    }
  });

  await t.step("unranked cards: they go after every rank on now, only where they already are, and the next payment still reaches the card holding money", async () => {
    const s = await studio();
    try {
      const { rank, line } = ranking(s);
      const a = await s.boardCard("A");
      const b = await s.boardCard("B");
      const m = await s.boardCard("M", { rank: 1, target: 100 });
      await s.pay("m", 2, m);
      assertEquals(await line(), ["M@1", "A@-", "B@-"]);
      assertEquals(await rank([a, b]), { moves: [], unapplied: 0 }, "already their place: no number needed");
      assertEquals(await rank([b, a]), { moves: [{ card_id: b, from: null, to: 2 }], unapplied: 0 });
      assertEquals(await line(), ["M@1", "B@2", "A@-"]);
      const next = await s.pay("next", 1);
      assertEquals(next.allocations, [{ destination: "card", card_id: m, amount_usd: 1, step: 2 }]);
    } finally {
      await s.close();
    }
  });

  await t.step("an unranked card holding money: no card behind it passes it, and a card ahead of it can still move", async () => {
    const s = await studio();
    try {
      const { rank, line } = ranking(s);
      const r = await s.boardCard("R", { rank: 1 });
      const o = await s.boardCard("O");
      const u = await s.boardCard("U", { target: 100 });
      await s.pay("u", 2, u);
      const a = await s.boardCard("A");
      const b = await s.boardCard("B");
      assertEquals(await line(), ["R@1", "O@-", "U@-", "A@-", "B@-"]);
      assertEquals(await rank([b, a]), { moves: [], unapplied: 2 });
      assertEquals(await rank([b, o]), { moves: [], unapplied: 1 });
      assertEquals(await rank([o, r]), { moves: [{ card_id: o, from: null, to: 1 }, { card_id: r, from: 1, to: 2 }], unapplied: 0 });
      assertEquals(await line(), ["O@1", "R@2", "U@-", "A@-", "B@-"]);
    } finally {
      await s.close();
    }
  });

  await t.step("a rank another card in line shares is not traded, a funded card with room included", async () => {
    const s = await studio();
    try {
      const { rank, line } = ranking(s);
      const l = await s.boardCard("L", { rank: 3 });
      const a = await s.boardCard("A", { rank: 3 });
      const b = await s.boardCard("B", { rank: 4 });
      await s.boardCard("F", { rank: 5, stage: "funded" });
      const c = await s.boardCard("C", { rank: 5 });
      assertEquals(await rank([b, a]), { moves: [], unapplied: 1 });
      assertEquals(await rank([b, a, l]), { moves: [], unapplied: 2 }, "named or not, a shared rank stays");
      assertEquals(await rank([c, b]), { moves: [], unapplied: 1 }, "F is not rankable but step 2 still funds it");
      assertEquals(await line(), ["L@3", "A@3", "B@4", "F@5", "C@5"]);
    } finally {
      await s.close();
    }
  });
});

Deno.test("the two jobs are seeded manual, model-calling and running while the studio is paused, linked to their roles", OPTS, async () => {
  const s = await studio();
  try {
    const jobs = await s.rows<{ name: string; role_id: string; calls_model: boolean; runs_when_paused: boolean }>(
      `select name, role_id, calls_model, runs_when_paused from public.jobs where name in ('draft_card', 'studio_ranking') order by name`,
    );
    assertEquals(jobs, [
      { name: "draft_card", role_id: s.roles.designer, calls_model: true, runs_when_paused: true },
      { name: "studio_ranking", role_id: s.roles.studioHead, calls_model: true, runs_when_paused: true },
    ]);
    await s.signInAs(BOARD_EMAIL, "aal2");
    const run = (await s.row<{ id: string }>(`select public.enqueue_manual_job('draft_card', null, 'Draft a game card', '{}'::jsonb) as id`)).id;
    const queued = await s.row<Row>(`select origin, status, input from public.job_runs where id = $1`, [run]);
    assertEquals(queued, { origin: "board", status: "queued", input: {} });
    await s.signInAs(null);
    // Twice more: the seed keeps the role link and changes nothing else.
    const file = (await readMigrations()).find((m) => m.name === MIGRATION)!;
    await s.db.exec(file.sql);
    assertEquals((await s.row<{ n: number }>(`select count(*)::int as n from public.jobs where role_id is not null and name in ('draft_card', 'studio_ranking')`)).n, 2);
  } finally {
    await s.close();
  }
});
