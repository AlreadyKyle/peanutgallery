import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const WEEK1_FILE = "20260914000000_week1_schema.sql";
const LIVE_CUT_FILE = "20260915000000_live_cut.sql";
const sql = readFileSync(resolve(MIGRATIONS_DIR, WEEK1_FILE), "utf8");
const liveCut = readFileSync(resolve(MIGRATIONS_DIR, LIVE_CUT_FILE), "utf8");

const TABLES = [
  "cards",
  "ledger",
  "pool",
  "contributions",
  "standing_costs",
  "agent_events",
  "roles",
  "scores",
  "votes",
  "stream_state",
  "board_notes",
  "studio_state",
  "images",
  "decisions",
  "deploys",
  "board_members",
];

const ENUMS: Record<string, string[]> = {
  card_bucket: ["game", "platform", "qa", "studio", "budget", "agents"],
  card_source: ["board", "community", "agent", "decision"],
  card_shape: ["oneoff", "goal", "standing"],
  card_lane: ["config", "code"],
  card_folder: ["seed-1", "platform"],
  card_confidence: ["low", "med", "high"],
  director_stance: ["neutral", "endorsed", "vetoed"],
  card_stage: ["proposed", "designing", "voted", "funded", "building", "gated", "live", "rejected", "paused"],
  card_severity: ["s1", "s2", "s3", "s4"],
  contribution_rail: ["stripe", "twitch", "founder"],
  contribution_kind: ["cash", "hours", "tokens"],
  agent_event_type: ["start", "tool_call", "tool_result", "message", "gate_pass", "gate_fail", "ship", "revert", "error"],
  role_state: ["active", "retired"],
  scene: ["devcam", "director", "replay", "idle"],
  note_state: ["new", "triaged"],
  note_outcome: ["card", "scheduled", "discarded"],
  decision_size: ["small", "medium", "large"],
  decision_state: ["open", "assigned", "executed", "expired"],
  board_role: ["board", "moderator"],
};

const RPCS: Record<string, string> = {
  is_board_member: "()",
  board_role: "()",
  board_heartbeat: "()",
  set_paused: "(p_paused boolean)",
  file_directive:
    "(\n  p_bucket public.card_bucket,\n  p_lane public.card_lane,\n  p_folder public.card_folder,\n  p_title text,\n  p_intent text,\n  p_acceptance_test text,\n  p_estimate_usd numeric,\n  p_board_reason text,\n  p_executor_role_id uuid\n)",
  file_note: "(p_text text)",
  apply_contribution:
    "(\n  p_stripe_event_id text,\n  p_contributor_id text,\n  p_display_name text,\n  p_amount_usd numeric,\n  p_net_usd numeric,\n  p_studio_pct integer,\n  p_goal_card_id uuid\n)",
  founder_credit: "(\n  p_amount_usd numeric,\n  p_kind public.contribution_kind,\n  p_display_name text\n)",
  record_usage:
    "(\n  p_card_id uuid,\n  p_role_id uuid,\n  p_model text,\n  p_input_tokens integer,\n  p_cached_tokens integer,\n  p_output_tokens integer,\n  p_usd numeric\n)",
};

const VIEWS = ["last_green", "public_agent_events", "public_ledger_totals"];

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The body of one `create or replace function public.<name>` block in a migration. */
function functionBlockIn(text: string, name: string): string {
  const start = text.indexOf(`create or replace function public.${name}(`);
  expect(start, `function ${name}`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n$$;", start);
  expect(end, `end of function ${name}`).toBeGreaterThan(start);
  return text.slice(start, end);
}

function functionBlock(name: string): string {
  return functionBlockIn(sql, name);
}

describe("week-1 migration", () => {
  it("creates pgcrypto and every enum with the contract values", () => {
    expect(sql).toContain("create extension if not exists pgcrypto;");
    for (const [name, values] of Object.entries(ENUMS)) {
      const line = `create type public.${name} as enum (${values.map((v) => `'${v}'`).join(", ")});`;
      expect(sql, name).toContain(line);
    }
    expect(sql.match(/^create type public\.\w+ as enum/gm)).toHaveLength(Object.keys(ENUMS).length);
  });

  it("creates the fifteen tables plus board_members, each with row level security", () => {
    for (const table of TABLES) {
      expect(sql, table).toMatch(new RegExp(`^create table public\\.${table} \\($`, "m"));
      expect(sql, `rls ${table}`).toContain(`alter table public.${table} enable row level security;`);
    }
    expect(sql.match(/^create table public\.\w+ \(/gm)).toHaveLength(TABLES.length);
    expect(sql.match(/enable row level security;/g)).toHaveLength(TABLES.length);
  });

  it("pins the single-row tables to id 1 and uses numeric(12,4) money", () => {
    for (const table of ["pool", "studio_state", "stream_state"]) {
      const block = sql.slice(sql.indexOf(`create table public.${table} (`));
      expect(block.slice(0, block.indexOf(");")), table).toContain("id integer primary key check (id = 1)");
    }
    expect(sql).toContain("balance_usd numeric(12,4) not null default 0");
    expect(sql).toContain("studio_pct_chosen integer not null default 20");
    expect(sql).toContain("reserve_pct integer not null default 10");
    expect(sql).toContain("incident_pct integer not null default 5");
    expect(sql).toContain("incident_cap_usd numeric(12,4) not null default 500");
    expect(sql).toContain("studio_reserve_usd numeric(12,4) not null default 0");
    expect(sql).toContain("priority integer not null default 100");
    expect(sql).toContain("paused boolean not null default false");
    expect(sql).toContain("stripe_event_id text unique");
    expect(sql).toContain("name text not null unique");
    expect(sql).toContain("unique (card_id, voter_id)");
    expect(sql).toContain("create unique index decisions_open_config_key_idx on public.decisions (config_key) where state = 'open';");
  });

  it("keeps the updated_at trigger on cards", () => {
    expect(sql).toContain("create or replace function public.set_updated_at() returns trigger");
    expect(sql).toMatch(/create trigger cards_set_updated_at\s+before update on public\.cards\s+for each row execute function public\.set_updated_at\(\);/);
  });

  it("defines the three views and grants only select on them to anon and authenticated", () => {
    for (const view of VIEWS) {
      expect(sql, view).toMatch(new RegExp(`^create view public\\.${view} with \\(security_invoker = (true|false)\\) as$`, "m"));
      expect(sql, `grant ${view}`).toContain(`grant select on public.${view} to anon, authenticated;`);
    }
    expect(sql).toContain(`revoke all on table ${VIEWS.map((v) => `public.${v}`).join(", ")} from anon, authenticated;`);
    expect(sql).toContain("select id, card_id, role_id, type, created_at\n  from public.agent_events");
    expect(sql).toContain("as usd_total");
    expect(sql).toContain("as row_count");
  });

  it("restricts auth.users inserts to board accounts", () => {
    expect(sql).toContain("raise exception 'Sign-in is limited to board accounts';");
    expect(sql).toMatch(/create trigger restrict_auth_users_to_board\s+before insert on auth\.users\s+for each row execute function public\.restrict_auth_users_to_board\(\);/);
  });

  it("defines every RPC with the contract signature as security definer plpgsql with search_path public", () => {
    for (const [name, signature] of Object.entries(RPCS)) {
      const block = functionBlock(name);
      expect(block, `${name} signature`).toContain(`public.${name}${signature} returns`);
      expect(block, `${name} language`).toContain("language plpgsql");
      expect(block, `${name} definer`).toContain("security definer");
      expect(block, `${name} search_path`).toContain("set search_path = public");
    }
  });

  it("implements the contribution arithmetic with four-decimal rounding", () => {
    const block = functionBlock("apply_contribution");
    expect(block).toContain("v_reserve := round(v_net * v_reserve_pct / 100.0, 4);");
    expect(block).toContain("v_remainder := v_net - v_reserve;");
    expect(block).toContain("v_studio := round(v_remainder * p_studio_pct / 100.0, 4);");
    expect(block).toContain("v_agents := v_remainder - v_studio;");
    expect(block).toContain("v_room := greatest(0, v_incident_cap - v_incident_held);");
    expect(block).toContain("v_incident := least(round(v_agents * v_incident_pct / 100.0, 4), v_room);");
    expect(block).toContain("on conflict (stripe_event_id) do nothing");
    expect(block).toContain("set balance_usd = balance_usd + (v_agents - v_incident)");
    expect(block).toContain("incident_reserve_usd = incident_reserve_usd + v_incident");
    expect(block).toContain("reserve_usd = reserve_usd + v_reserve");
    expect(block).toContain("update public.cards set funded_usd = funded_usd + v_amount where id = v_goal;");
    expect(block).toContain("when v_amount < 5 then 'small'");
    expect(block).toContain("when v_amount < 50 then 'medium'");
    expect(block).toContain("set state = 'assigned'");
  });

  it("requires an active executor role on every directive", () => {
    const block = functionBlock("file_directive");
    expect(block).toContain("raise exception 'An executor role is required';");
    expect(block).toContain("raise exception 'The executor must be an active role';");
    expect(block).toContain("stage\n  ) values (\n    p_bucket, 'board', 'oneoff', p_lane, 0,");
  });

  it("meters usage against the pool, the day and the card", () => {
    const block = functionBlock("record_usage");
    expect(block).toContain("(now() at time zone 'America/New_York')::date");
    expect(block).toContain("update public.pool set daily_spent_usd = 0, day = v_today where id = 1;");
    expect(block).toContain("if v_severity = 's1'::public.card_severity then");
    expect(block).toContain("balance_usd = balance_usd - (v_usd - v_draw)");
    expect(block).toContain("update public.cards set actual_usd = actual_usd + v_usd where id = p_card_id");
  });

  it("opens the five public tables to anon and closes the rest", () => {
    for (const table of ["pool", "cards", "ledger", "deploys", "roles"]) {
      expect(sql, table).toContain(`create policy ${table}_public_read on public.${table} for select to anon, authenticated using (true);`);
    }
    for (const table of TABLES.filter((t) => !["pool", "cards", "ledger", "deploys", "roles"].includes(t))) {
      expect(sql, table).toContain(`revoke all on table public.${table} from anon, authenticated;`);
      expect(sql, `policy ${table}`).not.toMatch(new RegExp(`create policy \\w+ on public\\.${table} `));
    }
  });

  it("keeps the board RPCs away from anon and the service RPCs away from anon and authenticated", () => {
    for (const name of ["is_board_member", "board_role", "board_heartbeat", "set_paused", "file_directive", "file_note"]) {
      expect(sql, name).toMatch(new RegExp(`revoke all on function public\\.${escape(name)}\\([^)]*\\) from public, anon;`));
      expect(sql, name).toMatch(new RegExp(`grant execute on function public\\.${escape(name)}\\([^)]*\\) to authenticated, service_role;`));
    }
    for (const name of ["apply_contribution", "founder_credit", "record_usage"]) {
      expect(sql, name).toMatch(new RegExp(`revoke all on function public\\.${escape(name)}\\([^)]*\\) from public, anon, authenticated;`));
      expect(sql, name).toMatch(new RegExp(`grant execute on function public\\.${escape(name)}\\([^)]*\\) to service_role;`));
    }
  });

  it("adds pool, cards and deploys to the realtime publication", () => {
    expect(sql).toContain("alter publication supabase_realtime add table public.pool, public.cards, public.deploys;");
  });
});

const FILE_CARD_SIGNATURE =
  "(\n  p_bucket public.card_bucket,\n  p_lane public.card_lane,\n  p_folder public.card_folder,\n  p_title text,\n  p_intent text,\n  p_acceptance_test text,\n  p_funding_target_usd numeric,\n  p_stage public.card_stage,\n  p_executor_role_id uuid,\n  p_board_reason text\n)";

const FILE_CARD_RAISES = [
  "Board membership is required",
  "A title is required",
  "A Next card starts at proposed or voted",
  "The funding target must be above zero",
  "The funding target must not exceed the per-card maximum of %",
  "The config lane exists only for seed-1",
  "A config-lane card needs a check: line in its acceptance test",
  "An executor role is required",
  "The executor must be an active role",
];

const LIVE_CUT_RPCS: Record<string, string> = {
  file_card: FILE_CARD_SIGNATURE,
  set_launched: "()",
  set_agent_mode: "(p_mode text)",
  board_studio_state: "()",
};

const LIVE_CUT_VIEWS = ["public_studio", "public_card_funding"];

describe("live-cut migration", () => {
  it("carries a 14-digit stamp that sorts after the week-1 file", () => {
    expect(LIVE_CUT_FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(LIVE_CUT_FILE > WEEK1_FILE).toBe(true);
  });

  it("keeps the apply_contribution signature and locks the goal card before the pool", () => {
    const block = functionBlockIn(liveCut, "apply_contribution");
    expect(block).toContain(`public.apply_contribution${RPCS.apply_contribution} returns jsonb`);
    expect(block).toContain("language plpgsql");
    expect(block).toContain("security definer");
    expect(block).toContain("set search_path = public");
    const goalLock = block.indexOf("select id into v_goal from public.cards where id = p_goal_card_id and shape = 'goal' for update;");
    const poolLock = block.indexOf("from public.pool where id = 1 for update");
    expect(goalLock).toBeGreaterThanOrEqual(0);
    expect(poolLock).toBeGreaterThan(goalLock);
  });

  it("credits the bar with the net amount, seeds the estimate and moves proposed or voted to funded", () => {
    const block = functionBlockIn(liveCut, "apply_contribution");
    expect(block).toContain("funded_usd + (v_agents - v_incident)");
    expect(block).toContain("when estimate_usd = 0 then funding_target_usd");
    expect(block).toContain("stage in ('proposed', 'voted')");
    expect(block).toContain("funded_usd >= funding_target_usd");
    expect(block).not.toContain("funded_usd + v_amount");
    expect(block).toContain("select stage, funded_usd into v_goal_stage, v_goal_funded from public.cards where id = v_goal;");
    expect(block.match(/'goal_card_id', v_goal,\n\s+'goal_stage', v_goal_stage,\n\s+'goal_funded_usd', v_goal_funded/g)).toHaveLength(2);
    // The week-1 arithmetic and the decision assignment are unchanged.
    expect(block).toContain("v_incident := least(round(v_agents * v_incident_pct / 100.0, 4), v_room);");
    expect(block).toContain("set balance_usd = balance_usd + (v_agents - v_incident)");
    expect(block).toContain("for update skip locked;");
    expect(block).toContain("set state = 'assigned'");
  });

  it("defines file_card with the contract signature, every refusal and the goal-card insert", () => {
    const block = functionBlockIn(liveCut, "file_card");
    expect(block).toContain(`public.file_card${FILE_CARD_SIGNATURE} returns uuid`);
    for (const message of FILE_CARD_RAISES) {
      expect(block, message).toContain(`raise exception '${message}'`);
    }
    expect(block).toContain("select card_max_usd into v_card_max from public.studio_state where id = 1;");
    expect(block).toContain(String.raw`coalesce(p_acceptance_test, '') !~ '(^|\n)\s*check:\s'`);
    expect(block).toContain("p_bucket, 'board', 'goal', p_lane, 100, nullif(btrim(p_board_reason), ''), p_folder, p_executor_role_id,");
    expect(block).toContain("btrim(p_title), p_intent, p_acceptance_test, round(p_funding_target_usd, 4), 0, round(p_funding_target_usd, 4),");
    expect(block).toContain("'low', null, p_stage");
  });

  it("adds launched_at and dispatcher_seen_at to studio_state", () => {
    expect(liveCut).toContain("alter table public.studio_state add column if not exists launched_at timestamptz;");
    expect(liveCut).toContain("alter table public.studio_state add column if not exists dispatcher_seen_at timestamptz;");
  });

  it("defines the four board RPCs as security definer plpgsql granted to authenticated and service_role, not anon", () => {
    for (const [name, signature] of Object.entries(LIVE_CUT_RPCS)) {
      const block = functionBlockIn(liveCut, name);
      expect(block, `${name} signature`).toContain(`public.${name}${signature} returns`);
      expect(block, `${name} language`).toContain("language plpgsql");
      expect(block, `${name} definer`).toContain("security definer");
      expect(block, `${name} search_path`).toContain("set search_path = public");
      expect(liveCut, name).toMatch(new RegExp(`revoke all on function public\\.${escape(name)}\\([^)]*\\) from public, anon;`));
      expect(liveCut, name).toMatch(new RegExp(`grant execute on function public\\.${escape(name)}\\([^)]*\\) to authenticated, service_role;`));
    }
    expect(functionBlockIn(liveCut, "set_launched")).toContain("where id = 1 and launched_at is null;");
    expect(functionBlockIn(liveCut, "set_agent_mode")).toContain("raise exception 'agent_mode must be attended or unattended';");
    expect(functionBlockIn(liveCut, "set_agent_mode")).toContain("update public.studio_state set agent_mode = p_mode where id = 1;");
    expect(functionBlockIn(liveCut, "board_studio_state")).toContain("if not public.is_board_member() then");
    for (const key of ["paused", "paused_by", "paused_at", "agent_mode", "launched_at", "dispatcher_seen_at", "daily_cap_usd", "card_max_usd"]) {
      expect(functionBlockIn(liveCut, "board_studio_state"), key).toContain(`'${key}', ${key}`);
    }
  });

  it("defines the two public views with owner rights and grants only select on them", () => {
    for (const view of LIVE_CUT_VIEWS) {
      expect(liveCut, view).toMatch(new RegExp(`^create or replace view public\\.${view} with \\(security_invoker = false\\) as$`, "m"));
      expect(liveCut, `grant ${view}`).toContain(`grant select on public.${view} to anon, authenticated;`);
    }
    expect(liveCut).toContain(`revoke all on table ${LIVE_CUT_VIEWS.map((v) => `public.${v}`).join(", ")} from anon, authenticated;`);
    expect(liveCut).toContain("select launched_at from public.studio_state where id = 1;");
    expect(liveCut).toContain("goal_card_id as card_id,");
    expect(liveCut).toContain("count(distinct contributor_id)::integer as contributors,");
    expect(liveCut).toContain("sum(agents_usd - incident_usd)::numeric(12,4) as credited_usd");
    expect(liveCut).toContain("where goal_card_id is not null");
  });

  it("creates no table, type or policy, leaves the publication alone and uses only repeatable statements", () => {
    expect(liveCut).not.toMatch(/create table/i);
    expect(liveCut).not.toMatch(/create type/i);
    expect(liveCut).not.toMatch(/create policy/i);
    expect(liveCut).not.toMatch(/alter publication/i);
    expect(liveCut).not.toMatch(/^create (?!or replace )/m);
    expect(liveCut).not.toMatch(/^alter table (?!public\.studio_state add column if not exists )/m);
    expect(liveCut).not.toMatch(/^drop /m);
  });
});

const CARD_SUMMARY_FILE = "20260916000000_card_summary.sql";
const cardSummary = readFileSync(resolve(MIGRATIONS_DIR, CARD_SUMMARY_FILE), "utf8");

const FILE_CARD_SUMMARY_SIGNATURE =
  "(\n  p_bucket public.card_bucket,\n  p_lane public.card_lane,\n  p_folder public.card_folder,\n  p_title text,\n  p_summary text,\n  p_intent text,\n  p_acceptance_test text,\n  p_funding_target_usd numeric,\n  p_stage public.card_stage,\n  p_executor_role_id uuid,\n  p_board_reason text\n)";

const OLD_FILE_CARD_TYPES =
  "public.card_bucket, public.card_lane, public.card_folder, text, text, text, numeric, public.card_stage, uuid, text";
const NEW_FILE_CARD_TYPES =
  "public.card_bucket, public.card_lane, public.card_folder, text, text, text, text, numeric, public.card_stage, uuid, text";

describe("card-summary migration", () => {
  it("carries a 14-digit stamp that sorts after the live-cut file", () => {
    expect(CARD_SUMMARY_FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(CARD_SUMMARY_FILE > LIVE_CUT_FILE).toBe(true);
  });

  it("adds the summary column with its 200-character check", () => {
    expect(cardSummary).toContain(
      "alter table public.cards add column if not exists summary text check (summary is null or char_length(summary) <= 200);",
    );
  });

  it("drops the exact ten-argument file_card before creating the new one", () => {
    const drop = cardSummary.indexOf(`drop function if exists public.file_card(${OLD_FILE_CARD_TYPES});`);
    const create = cardSummary.indexOf("create or replace function public.file_card(");
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(drop);
  });

  it("defines file_card with p_summary after p_title, every refusal in order and a trimmed summary insert", () => {
    const block = functionBlockIn(cardSummary, "file_card");
    expect(block).toContain(`public.file_card${FILE_CARD_SUMMARY_SIGNATURE} returns uuid`);
    expect(block).toContain("language plpgsql");
    expect(block).toContain("security definer");
    expect(block).toContain("set search_path = public");
    const raises = [
      FILE_CARD_RAISES[0]!,
      FILE_CARD_RAISES[1]!,
      "A public summary is required",
      "The public summary must be 200 characters or fewer",
      ...FILE_CARD_RAISES.slice(2),
    ];
    let last = -1;
    for (const message of raises) {
      const at = block.indexOf(`raise exception '${message}'`);
      expect(at, message).toBeGreaterThan(last);
      last = at;
    }
    expect(block).toContain("if p_summary is null or btrim(p_summary) = '' then");
    expect(block).toContain("btrim(p_title), btrim(p_summary), p_intent, p_acceptance_test,");
    expect(block).toContain("title, summary, intent, acceptance_test,");
  });

  it("revokes file_card from public and anon and grants it to authenticated and service_role", () => {
    expect(cardSummary).toContain(`revoke all on function public.file_card(${NEW_FILE_CARD_TYPES}) from public, anon;`);
    expect(cardSummary).toContain(`grant execute on function public.file_card(${NEW_FILE_CARD_TYPES}) to authenticated, service_role;`);
    expect(cardSummary.match(/^grant /gm)).toHaveLength(1);
    expect(cardSummary.match(/^revoke /gm)).toHaveLength(1);
  });

  it("creates no table, type or policy and changes nothing else", () => {
    expect(cardSummary).not.toMatch(/create table/i);
    expect(cardSummary).not.toMatch(/create type/i);
    expect(cardSummary).not.toMatch(/create policy/i);
    expect(cardSummary).not.toMatch(/alter publication/i);
    expect(cardSummary).not.toMatch(/create (or replace )?view/i);
    expect(cardSummary.match(/^create /gm)).toHaveLength(1);
    expect(cardSummary.match(/^alter /gm)).toHaveLength(1);
    expect(cardSummary.match(/^drop /gm)).toHaveLength(1);
  });

  it("relies on the week-1 table-level select on cards and the whole-table publication", () => {
    expect(sql).toContain("grant select on table public.pool, public.cards, public.ledger, public.deploys, public.roles to anon, authenticated;");
    expect(sql).toContain("alter publication supabase_realtime add table public.pool, public.cards, public.deploys;");
  });
});

const CONTRIBUTION_SESSION_FILE = "20260917000000_contribution_session.sql";
const contributionSession = readFileSync(resolve(MIGRATIONS_DIR, CONTRIBUTION_SESSION_FILE), "utf8");

const OLD_APPLY_TYPES = "text, text, text, numeric, numeric, integer, uuid";
const NEW_APPLY_TYPES = "text, text, text, numeric, numeric, integer, uuid, text";

describe("contribution-session migration", () => {
  it("carries a 14-digit stamp that sorts after the card-summary file", () => {
    expect(CONTRIBUTION_SESSION_FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(CONTRIBUTION_SESSION_FILE > CARD_SUMMARY_FILE).toBe(true);
  });

  it("adds a unique stripe_session_id column", () => {
    expect(contributionSession).toContain(
      "alter table public.contributions add column if not exists stripe_session_id text unique;",
    );
  });

  it("drops the seven-argument apply_contribution before creating the eight-argument one", () => {
    const drop = contributionSession.indexOf(`drop function if exists public.apply_contribution(${OLD_APPLY_TYPES});`);
    const create = contributionSession.indexOf("create or replace function public.apply_contribution(");
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(drop);
  });

  it("keys the insert on either unique column and keeps the live-cut arithmetic", () => {
    const block = functionBlockIn(contributionSession, "apply_contribution");
    expect(block).toContain("  p_goal_card_id uuid,\n  p_stripe_session_id text default null\n) returns jsonb");
    expect(block).toContain("security definer");
    expect(block).toContain("set search_path = public");
    expect(block).toContain("stripe_event_id, stripe_session_id, credited_at");
    expect(block).toContain("on conflict do nothing");
    expect(block).not.toContain("on conflict (stripe_event_id)");
    expect(block).toContain("stripe_session_id = p_stripe_session_id");
    expect(block).toContain("v_incident := least(round(v_agents * v_incident_pct / 100.0, 4), v_room);");
    expect(block).toContain("set balance_usd = balance_usd + (v_agents - v_incident)");
    expect(block).toContain("funded_usd + (v_agents - v_incident)");
  });

  it("grants the new apply_contribution to service_role only", () => {
    expect(contributionSession).toContain(
      `revoke all on function public.apply_contribution(${NEW_APPLY_TYPES}) from public, anon, authenticated;`,
    );
    expect(contributionSession).toContain(`grant execute on function public.apply_contribution(${NEW_APPLY_TYPES}) to service_role;`);
    expect(contributionSession.match(/^grant /gm)).toHaveLength(1);
    expect(contributionSession.match(/^revoke /gm)).toHaveLength(1);
  });
});

const FOUNDER_BILLING_FILE = "20260918000000_founder_billing.sql";
const founderBilling = readFileSync(resolve(MIGRATIONS_DIR, FOUNDER_BILLING_FILE), "utf8");

const OLD_USAGE_TYPES = "uuid, uuid, text, integer, integer, integer, numeric";
const NEW_USAGE_TYPES = "uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing";

describe("founder-billing migration", () => {
  it("carries a 14-digit stamp that sorts after the contribution-session file", () => {
    expect(FOUNDER_BILLING_FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(FOUNDER_BILLING_FILE > CONTRIBUTION_SESSION_FILE).toBe(true);
  });

  it("adds the billing enum and a studio-default ledger column, both safe to run twice", () => {
    expect(founderBilling).toContain("create type public.ledger_billing as enum ('studio', 'founder');");
    expect(founderBilling).toContain("when duplicate_object then null;");
    expect(founderBilling).toContain(
      "alter table public.ledger add column if not exists billed_to public.ledger_billing not null default 'studio';",
    );
  });

  it("drops the seven-argument record_usage before creating the eight-argument one", () => {
    const drop = founderBilling.indexOf(`drop function if exists public.record_usage(${OLD_USAGE_TYPES});`);
    const create = founderBilling.indexOf("create or replace function public.record_usage(");
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(drop);
  });

  it("leaves the pool alone for founder rows and keeps the studio arithmetic", () => {
    const block = functionBlockIn(founderBilling, "record_usage");
    expect(block).toContain("  p_usd numeric,\n  p_billed_to public.ledger_billing default 'studio'\n) returns jsonb");
    expect(block).toContain("security definer");
    expect(block).toContain("set search_path = public");
    expect(block).toContain("raise exception 'p_billed_to is required';");
    const founder = block.indexOf("if p_billed_to = 'founder'::public.ledger_billing then");
    const studio = block.indexOf("else", founder);
    expect(founder).toBeGreaterThan(0);
    expect(block.slice(founder, studio)).not.toContain("update public.pool");
    expect(block.slice(studio)).toContain("balance_usd = balance_usd - (v_usd - v_draw)");
    expect(block).toContain("update public.cards set actual_usd = actual_usd + v_usd where id = p_card_id");
  });

  it("shows anon studio rows only, in the table and in the totals", () => {
    expect(founderBilling).toContain(
      "create policy ledger_public_read on public.ledger for select to anon, authenticated using (billed_to = 'studio');",
    );
    expect(founderBilling).toContain("drop policy if exists ledger_public_read on public.ledger;");
    expect(founderBilling).toMatch(/create or replace view public\.public_ledger_totals[\s\S]*from public\.ledger\n  where billed_to = 'studio';/);
  });

  it("grants the new record_usage to service_role only", () => {
    expect(founderBilling).toContain(`revoke all on function public.record_usage(${NEW_USAGE_TYPES}) from public, anon, authenticated;`);
    expect(founderBilling).toContain(`grant execute on function public.record_usage(${NEW_USAGE_TYPES}) to service_role;`);
    expect(founderBilling.match(/^grant /gm)).toHaveLength(1);
    expect(founderBilling.match(/^revoke /gm)).toHaveLength(1);
  });
});

const BOARD_TWO_FACTOR_FILE = "20260919000000_board_two_factor.sql";
const boardTwoFactor = readFileSync(resolve(MIGRATIONS_DIR, BOARD_TWO_FACTOR_FILE), "utf8");

const AAL2_CHECK = "  if not public.board_aal2() then\n    raise exception 'A second factor is required';\n  end if;\n";
const BOARD_PAUSE_AAL2_CHECK =
  "  if public.board_role() = 'board'::public.board_role and not public.board_aal2() then\n    raise exception 'A second factor is required';\n  end if;\n";

// Each state-changing board RPC, the migration that last defined it, and its argument types.
const TWO_FACTOR_RPCS: Record<string, { previous: string; types: string }> = {
  file_directive: {
    previous: sql,
    types: "public.card_bucket, public.card_lane, public.card_folder, text, text, text, numeric, text, uuid",
  },
  file_note: { previous: sql, types: "text" },
  file_card: { previous: cardSummary, types: NEW_FILE_CARD_TYPES },
  set_launched: { previous: liveCut, types: "" },
  set_agent_mode: { previous: liveCut, types: "text" },
};

describe("board-two-factor migration", () => {
  it("carries a 14-digit stamp that sorts after the founder-billing file", () => {
    expect(BOARD_TWO_FACTOR_FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(BOARD_TWO_FACTOR_FILE > FOUNDER_BILLING_FILE).toBe(true);
  });

  it("defines board_aal2 from the JWT's aal claim and grants it like is_board_member", () => {
    const block = functionBlockIn(boardTwoFactor, "board_aal2");
    expect(block).toContain("public.board_aal2() returns boolean");
    expect(block).toContain("language plpgsql");
    expect(block).toContain("security definer");
    expect(block).toContain("set search_path = public");
    expect(block).toContain("return coalesce(auth.jwt()->>'aal', '') = 'aal2';");
    expect(boardTwoFactor).toContain("revoke all on function public.board_aal2() from public, anon;");
    expect(boardTwoFactor).toContain("grant execute on function public.board_aal2() to authenticated, service_role;");
  });

  it("adds the second-factor refusal right after the membership check and changes nothing else in the five RPCs", () => {
    const membership = "    raise exception 'Board membership is required';\n  end if;\n";
    for (const [name, { previous }] of Object.entries(TWO_FACTOR_RPCS)) {
      const block = functionBlockIn(boardTwoFactor, name);
      expect(block, name).toContain(`${membership}${AAL2_CHECK}`);
      expect(block.split(AAL2_CHECK), name).toHaveLength(2);
      // Removing the check gives back the previous definition, character for character.
      expect(block.replace(AAL2_CHECK, ""), name).toBe(functionBlockIn(previous, name));
    }
  });

  it("lets a moderator pause at aal1 and requires aal2 of a board member", () => {
    const block = functionBlockIn(boardTwoFactor, "set_paused");
    const membership = "    raise exception 'Board or moderator membership is required';\n  end if;\n";
    expect(block).toContain(`${membership}${BOARD_PAUSE_AAL2_CHECK}`);
    expect(block).not.toContain(AAL2_CHECK);
    expect(block.replace(BOARD_PAUSE_AAL2_CHECK, "")).toBe(functionBlock("set_paused"));
  });

  it("keeps the heartbeat, board_role, is_board_member and board_studio_state at aal1", () => {
    for (const name of ["board_heartbeat", "board_role", "is_board_member", "board_studio_state"]) {
      expect(boardTwoFactor, name).not.toContain(`function public.${name}(`);
    }
  });

  it("repeats the earlier grants for every redefined function", () => {
    const redefined: [string, string][] = [
      ...Object.entries(TWO_FACTOR_RPCS).map(([name, { types }]): [string, string] => [name, types]),
      ["set_paused", "boolean"],
    ];
    for (const [name, types] of redefined) {
      expect(boardTwoFactor, name).toContain(`revoke all on function public.${name}(${types}) from public, anon;`);
      expect(boardTwoFactor, name).toContain(`grant execute on function public.${name}(${types}) to authenticated, service_role;`);
    }
    expect(boardTwoFactor.match(/^grant /gm)).toHaveLength(7);
    expect(boardTwoFactor.match(/^revoke /gm)).toHaveLength(7);
  });

  it("creates no table, type, view or policy and uses only repeatable statements", () => {
    expect(boardTwoFactor).not.toMatch(/create table/i);
    expect(boardTwoFactor).not.toMatch(/create type/i);
    expect(boardTwoFactor).not.toMatch(/create policy/i);
    expect(boardTwoFactor).not.toMatch(/create (or replace )?view/i);
    expect(boardTwoFactor).not.toMatch(/alter publication/i);
    expect(boardTwoFactor).not.toMatch(/^create (?!or replace function )/m);
    expect(boardTwoFactor).not.toMatch(/^(alter|drop) /m);
    expect(boardTwoFactor.match(/^create or replace function /gm)).toHaveLength(7);
  });
});

const CARD_SPEND_FILE = "20260919000100_card_spend.sql";
const cardSpend = readFileSync(resolve(MIGRATIONS_DIR, CARD_SPEND_FILE), "utf8");

describe("card-spend migration", () => {
  it("carries a 14-digit stamp that sorts after the board-two-factor file", () => {
    expect(CARD_SPEND_FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(CARD_SPEND_FILE > BOARD_TWO_FACTOR_FILE).toBe(true);
  });

  it("sums studio-billed ledger rows per card only, so founder-billed turns stay private", () => {
    expect(cardSpend).toContain("create or replace view public.public_card_spend with (security_invoker = false) as");
    expect(cardSpend).toContain("where billed_to = 'studio' and card_id is not null");
    expect(cardSpend).not.toContain("actual_usd\n");
    expect(cardSpend).toContain("revoke all on table public.public_card_spend from anon, authenticated;");
    expect(cardSpend).toContain("grant select on public.public_card_spend to anon, authenticated;");
  });
});

const REFUNDS_FILE = "20260920000000_refunds_and_holds.sql";
const refunds = readFileSync(resolve(MIGRATIONS_DIR, REFUNDS_FILE), "utf8");

describe("refunds-and-holds migration", () => {
  it("carries a 14-digit stamp that sorts after the founder-billing file", () => {
    expect(REFUNDS_FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(REFUNDS_FILE > FOUNDER_BILLING_FILE).toBe(true);
  });

  it("adds the entry enum, the child-row columns and the held totals, all safe to run twice", () => {
    expect(refunds).toContain("create type public.contribution_entry as enum ('payment', 'release', 'refund', 'dispute');");
    expect(refunds).toContain("when duplicate_object then null;");
    for (const column of ["entry", "parent_id", "held_usd", "hold_until"]) {
      expect(refunds).toContain(`alter table public.contributions add column if not exists ${column} `);
    }
    expect(refunds).toContain("alter table public.pool add column if not exists held_usd numeric(12,4) not null default 0;");
    expect(refunds).toContain("credit_daily_cap_usd numeric(12,4) not null default 50;");
    expect(refunds).toContain("credit_hold_days integer not null default 14;");
    for (const constraint of refunds.matchAll(/add constraint (\w+)/g)) {
      expect(refunds).toContain(`drop constraint if exists ${constraint[1]};`);
    }
    expect(refunds).toContain(
      "create unique index if not exists contributions_one_release on public.contributions (parent_id) where entry = 'release';",
    );
  });

  it("never changes a money column on a contribution row or deletes one", () => {
    // The only update is the decision assignment on the row apply_contribution just inserted.
    const updates = [...refunds.matchAll(/update public\.contributions[^;]*;/g)].map((m) => m[0]);
    expect(updates).toEqual(["update public.contributions set decision_id = v_decision where id = v_id;"]);
    expect(refunds).not.toMatch(/delete from public\.contributions/);
  });

  it("keeps the eight-argument apply_contribution, holds credit above the day's cap and locks the card before the pool", () => {
    const block = functionBlockIn(refunds, "apply_contribution");
    expect(block).toContain("  p_stripe_session_id text default null\n) returns jsonb");
    expect(refunds).not.toContain("drop function if exists public.apply_contribution");
    const card = block.indexOf("from public.cards where id = p_goal_card_id and shape = 'goal' for update");
    const pool = block.indexOf("from public.pool where id = 1 for update");
    const used = block.indexOf("into v_used");
    expect(card).toBeGreaterThan(0);
    expect(pool).toBeGreaterThan(card);
    expect(used).toBeGreaterThan(pool);
    expect(block).toContain("v_held := greatest(0, v_credit - greatest(0, v_daily_cap - v_used));");
    expect(block).toContain("at time zone 'America/New_York'");
    expect(block).toContain("set balance_usd = balance_usd + (v_credit - v_held),");
    expect(block).toContain("held_usd = held_usd + v_held,");
  });

  it("releases each hold once, cards in id order before the pool", () => {
    const block = functionBlockIn(refunds, "credit_held_contributions");
    const cards = block.indexOf("perform 1 from public.cards where id = any(v_cards) order by id for update;");
    const pool = block.indexOf("perform 1 from public.pool where id = 1 for update;");
    expect(cards).toBeGreaterThan(0);
    expect(pool).toBeGreaterThan(cards);
    expect(block).toContain("on conflict do nothing");
    expect(block).toContain("if v_release is null or v_amount = 0 then");
  });

  it("reverses by the kind's cumulative total, cancels holds first and covers disputes from the reserve", () => {
    const block = functionBlockIn(refunds, "reverse_contribution");
    expect(block).toContain(
      "v_delta := least(round(p_kind_total_usd, 4) - v_before_kind, v_payment.amount_usd - v_before_all);",
    );
    expect(block).toContain("v_held := least(v_credit, v_held_left);");
    expect(block).toContain("if p_kind = 'dispute' then");
    expect(block).toContain("v_cover := least(v_agents - v_held, greatest(v_pool_reserve - v_reserve, 0));");
    expect(block).not.toContain("set stage");
  });

  it("counts only credited money and contributors not fully reversed in public_card_funding", () => {
    expect(refunds).toContain("where goal_card_id is not null and credited_at is not null");
    expect(refunds).toContain("(count(*) filter (where paid_usd > 0))::integer as contributors,");
    expect(refunds).toContain("sum(agents_usd - incident_usd - held_usd) as credit_usd");
  });

  it("grants the three money functions to service_role only", () => {
    for (const signature of [
      "apply_contribution(text, text, text, numeric, numeric, integer, uuid, text)",
      "credit_held_contributions()",
      "reverse_contribution(text, text, public.contribution_entry, numeric)",
    ]) {
      expect(refunds).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(refunds).toContain(`grant execute on function public.${signature} to service_role;`);
    }
  });

  it("schedules the hourly release only where pg_cron ships", () => {
    const guard = refunds.indexOf("if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then");
    const schedule = refunds.indexOf(
      "perform cron.schedule('credit-held-contributions', '17 * * * *', 'select public.credit_held_contributions()');",
    );
    expect(guard).toBeGreaterThan(0);
    expect(schedule).toBeGreaterThan(guard);
  });
});

const OPEN_FUNDING_FILE = "20260921000000_open_goal_funding.sql";
const openFunding = readFileSync(resolve(MIGRATIONS_DIR, OPEN_FUNDING_FILE), "utf8");

const LOCK_TIMEOUT = "set lock_timeout = '5s';";

/** The text with one occurrence of part removed; fails when part is not there exactly once. */
function removeOnce(text: string, part: string): string {
  expect(text.split(part), part).toHaveLength(2);
  return text.replace(part, "");
}

/** The text with every SQL line comment and blank line removed. */
function withoutComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("--"))
    .join("\n");
}

const APPLY_SIGNATURE = "apply_contribution(text, text, text, numeric, numeric, integer, uuid, text)";
const REVERSE_SIGNATURE = "reverse_contribution(text, text, public.contribution_entry, numeric)";

describe("open-goal-funding migration", () => {
  it("carries a 14-digit stamp that sorts after the refunds-and-holds file", () => {
    expect(OPEN_FUNDING_FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(OPEN_FUNDING_FILE > REFUNDS_FILE).toBe(true);
  });

  it("changes only the goal lookup and the replay's goal in apply_contribution, so the split and the hold are unchanged", () => {
    const changes: [string, string][] = [
      [
        "    select id into v_goal from public.cards where id = p_goal_card_id and shape = 'goal' and stage in ('proposed', 'designing', 'voted') for update;\n",
        "    select id into v_goal from public.cards where id = p_goal_card_id and shape = 'goal' for update;\n",
      ],
      [
        "    select id, held_usd, hold_until, goal_card_id into v_id, v_held, v_hold_until, v_goal from public.contributions\n",
        "    select id, held_usd, hold_until into v_id, v_held, v_hold_until from public.contributions\n",
      ],
    ];
    let block = functionBlockIn(openFunding, "apply_contribution");
    for (const [after, before] of changes) {
      expect(block.split(after), after).toHaveLength(2);
      block = block.replace(after, before);
    }
    expect(block).toBe(functionBlockIn(refunds, "apply_contribution"));
  });

  it("changes reverse_contribution only to return the pool's reserves and the kind's totals, so the reversal is unchanged", () => {
    const changes: [string, string][] = [
      [
        "  v_balance numeric(12,4);\n  v_reserve_after numeric(12,4);\n  v_incident_after numeric(12,4);\n",
        "  v_balance numeric(12,4);\n",
      ],
      [
        "      'reversed_total_usd', v_before_all,\n      'kind_reversed_usd', v_before_kind,\n      'kind_total_usd', round(p_kind_total_usd, 4),\n",
        "      'reversed_total_usd', v_before_all,\n",
      ],
      [
        "    'reversed_total_usd', v_before_all + v_delta,\n    'kind_reversed_usd', v_before_kind,\n    'kind_total_usd', round(p_kind_total_usd, 4),\n",
        "    'reversed_total_usd', v_before_all + v_delta,\n",
      ],
      [
        "  returning balance_usd, reserve_usd, incident_reserve_usd into v_balance, v_reserve_after, v_incident_after;\n",
        "  returning balance_usd into v_balance;\n",
      ],
      [
        "    'pool_balance_usd', v_balance,\n    'pool_reserve_usd', v_reserve_after,\n    'pool_incident_reserve_usd', v_incident_after,\n",
        "    'pool_balance_usd', v_balance,\n",
      ],
    ];
    let block = functionBlockIn(openFunding, "reverse_contribution");
    for (const [after, before] of changes) {
      expect(block.split(after), after).toHaveLength(2);
      block = block.replace(after, before);
    }
    expect(block).toBe(functionBlockIn(refunds, "reverse_contribution"));
  });

  it("leaves the release job alone, so money held for an open card still reaches its bar", () => {
    expect(openFunding).not.toContain("function public.credit_held_contributions(");
  });

  it("repeats the service_role grants and changes nothing else", () => {
    for (const signature of [APPLY_SIGNATURE, REVERSE_SIGNATURE]) {
      expect(openFunding).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(openFunding).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    expect(openFunding.match(/^grant /gm)).toHaveLength(2);
    expect(openFunding.match(/^revoke /gm)).toHaveLength(2);
    expect(openFunding.match(/^create or replace function /gm)).toHaveLength(2);
    let rest = openFunding;
    for (const name of ["apply_contribution", "reverse_contribution"]) {
      rest = removeOnce(rest, `${functionBlockIn(openFunding, name)}\n$$;`);
    }
    for (const signature of [APPLY_SIGNATURE, REVERSE_SIGNATURE]) {
      rest = removeOnce(rest, `revoke all on function public.${signature} from public, anon, authenticated;`);
      rest = removeOnce(rest, `grant execute on function public.${signature} to service_role;`);
    }
    rest = removeOnce(rest, LOCK_TIMEOUT);
    expect(withoutComments(rest)).toBe("");
  });
});

const CARD_COLUMNS_FILE = "20260921000100_public_card_columns.sql";
const cardColumns = readFileSync(resolve(MIGRATIONS_DIR, CARD_COLUMNS_FILE), "utf8");

const WITHHELD_CARD_COLUMNS = ["actual_usd", "severity", "priority"];

const LIVE_AT_BACKFILL = `do $$
begin
  alter table public.cards disable trigger cards_set_updated_at;
  update public.cards c
  set live_at = coalesce(
    (select max(e.created_at) from public.agent_events e where e.card_id = c.id and e.type = 'ship'),
    c.updated_at
  )
  where c.stage = 'live' and c.live_at is null;
  alter table public.cards enable trigger cards_set_updated_at;
end $$;`;

const LIVE_AT_TRIGGER = `drop trigger if exists cards_set_live_at on public.cards;
create trigger cards_set_live_at
  before insert or update of stage on public.cards
  for each row execute function public.set_live_at();`;

const GRANT_END = ") on public.cards to anon, authenticated;";

/** The one column grant on cards, from grant to semicolon. */
function grantStatement(): string {
  const grant = cardColumns.indexOf("grant select (");
  const end = cardColumns.indexOf(GRANT_END, grant);
  expect(grant).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(grant);
  return cardColumns.slice(grant, end + GRANT_END.length);
}

/** The column list of the one column grant on cards. */
function grantedCardColumns(): string[] {
  return grantStatement().slice("grant select (".length, -GRANT_END.length).split(",").map((c) => c.trim());
}

describe("public-card-columns migration", () => {
  it("carries a 14-digit stamp that sorts after the open-goal-funding file", () => {
    expect(CARD_COLUMNS_FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(CARD_COLUMNS_FILE > OPEN_FUNDING_FILE).toBe(true);
    expect(CARD_COLUMNS_FILE > REFUNDS_FILE).toBe(true);
  });

  it("sets a lock timeout first in both new files", () => {
    for (const file of [openFunding, cardColumns]) {
      expect(withoutComments(file).split("\n")[0]).toBe(LOCK_TIMEOUT);
    }
  });

  it("adds live_at, backfills live cards with updated_at held still, and stamps it on the move to live", () => {
    expect(cardColumns).toContain("alter table public.cards add column if not exists live_at timestamptz;");
    expect(cardColumns).toContain(LIVE_AT_BACKFILL);
    const block = functionBlockIn(cardColumns, "set_live_at");
    expect(block).toContain("public.set_live_at() returns trigger");
    expect(block).not.toContain("security definer");
    expect(block).toContain("set search_path = ''");
    expect(block).toContain("new.live_at := coalesce(new.live_at, now());");
    expect(block).toContain("elsif new.stage = 'live' and old.stage is distinct from 'live' then\n    new.live_at := now();");
    expect(cardColumns).toContain(LIVE_AT_TRIGGER);
    expect(cardColumns).toContain("revoke all on function public.set_live_at() from public, anon, authenticated;");
  });

  it("revokes everything on cards, then grants select on every column but actual_usd, severity and priority", () => {
    const revoke = cardColumns.indexOf("revoke all on public.cards from anon, authenticated;");
    const grant = cardColumns.indexOf("grant select (");
    expect(revoke).toBeGreaterThan(0);
    expect(grant).toBeGreaterThan(revoke);
    const granted = grantedCardColumns();
    for (const column of WITHHELD_CARD_COLUMNS) {
      expect(granted, column).not.toContain(column);
    }
    expect(granted).toContain("id");
    expect(granted).toContain("live_at");
    expect(new Set(granted).size).toBe(granted.length);
    expect(cardColumns.match(/^grant /gm)).toHaveLength(1);
  });

  it("holds only the column, backfill, trigger and grant statements, and leaves the publication alone", () => {
    expect(cardColumns).not.toMatch(/alter publication/i);
    expect(cardColumns).not.toMatch(/supabase_realtime/);
    let rest = cardColumns;
    rest = removeOnce(rest, LOCK_TIMEOUT);
    rest = removeOnce(rest, "alter table public.cards add column if not exists live_at timestamptz;");
    rest = removeOnce(rest, LIVE_AT_BACKFILL);
    rest = removeOnce(rest, `${functionBlockIn(cardColumns, "set_live_at")}\n$$;`);
    rest = removeOnce(rest, LIVE_AT_TRIGGER);
    rest = removeOnce(rest, "revoke all on function public.set_live_at() from public, anon, authenticated;");
    rest = removeOnce(rest, "revoke all on public.cards from anon, authenticated;");
    rest = removeOnce(rest, grantStatement());
    expect(withoutComments(rest)).toBe("");
  });
});

const LEDGER_REQUEST_ID_FILE = "20260921000200_ledger_request_id.sql";
const ledgerRequestIdPath = resolve(MIGRATIONS_DIR, LEDGER_REQUEST_ID_FILE);
const ledgerRequestId = existsSync(ledgerRequestIdPath) ? readFileSync(ledgerRequestIdPath, "utf8") : "";
// The open-goal-funding and public-card-columns migrations (pull request 32); this one sorts after them.
const OPEN_GOAL_FUNDING_FILE = "20260921000000_open_goal_funding.sql";
const PUBLIC_CARD_COLUMNS_FILE = "20260921000100_public_card_columns.sql";
const REQUEST_ID_USAGE_TYPES = `${NEW_USAGE_TYPES}, text`;

// The only changes allowed to the founder-billing record_usage: the trailing argument, one variable,
// the retry check before the insert, and the request id on the inserted row.
const REQUEST_ID_CHECK = `  -- A repeated request id is a retry of a write that already landed: return
  -- that row's result and change nothing. The same id with other values is a
  -- fault in the caller and is refused. The card lock above, or the pool lock
  -- when there is no card, makes a concurrent retry wait for the first.
  if p_request_id is not null then
    if p_card_id is null then
      perform 1 from public.pool where id = 1 for update;
    end if;
    select * into v_existing from public.ledger where request_id = p_request_id;
    if found then
      if v_existing.card_id is distinct from p_card_id
        or v_existing.model is distinct from p_model
        or v_existing.usd is distinct from v_usd
        or v_existing.billed_to is distinct from p_billed_to then
        raise exception 'request id % was written with different values', p_request_id;
      end if;
      select balance_usd, daily_spent_usd into v_balance, v_daily from public.pool where id = 1;
      if p_card_id is not null then
        select actual_usd into v_actual from public.cards where id = p_card_id;
      end if;
      return jsonb_build_object(
        'ledger_id', v_existing.id,
        'balance_usd', v_balance,
        'daily_spent_usd', v_daily,
        'actual_usd', v_actual
      );
    end if;
  end if;

`;

// A migration's statements with its comments, blank lines and the named function's body taken out,
// the function standing as one placeholder line.
function statementsOutside(text: string, name: string): string {
  const block = functionBlockIn(text, name);
  return text
    .replace(`${block}\n$$;`, `<function ${name}>`)
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("--"))
    .join("\n");
}

function expectedRequestIdBody(previous: string): string {
  const swaps: Array<[string, string]> = [
    [
      "  p_billed_to public.ledger_billing default 'studio'\n) returns jsonb",
      "  p_billed_to public.ledger_billing default 'studio',\n  p_request_id text default null\n) returns jsonb",
    ],
    ["  v_actual numeric(12,4);\n", "  v_actual numeric(12,4);\n  v_existing public.ledger%rowtype;\n"],
    ["  insert into public.ledger (", `${REQUEST_ID_CHECK}  insert into public.ledger (`],
    ["usd, billed_to)\n", "usd, billed_to, request_id)\n"],
    ["v_usd, p_billed_to)\n", "v_usd, p_billed_to, p_request_id)\n"],
  ];
  let body = previous;
  for (const [from, to] of swaps) {
    expect(body.split(from), from).toHaveLength(2);
    body = body.replace(from, to);
  }
  return body;
}

describe("ledger-request-id migration", () => {
  it("carries a 14-digit stamp that sorts after the founder-billing, refunds and card-columns files", () => {
    expect(ledgerRequestId, LEDGER_REQUEST_ID_FILE).not.toBe("");
    expect(LEDGER_REQUEST_ID_FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    for (const earlier of [FOUNDER_BILLING_FILE, REFUNDS_FILE, OPEN_GOAL_FUNDING_FILE, PUBLIC_CARD_COLUMNS_FILE]) {
      expect(LEDGER_REQUEST_ID_FILE > earlier, earlier).toBe(true);
    }
  });

  it("adds a nullable request_id with a partial unique index, both safe to run twice", () => {
    expect(ledgerRequestId).toContain("alter table public.ledger add column if not exists request_id text;");
    expect(ledgerRequestId).toContain(
      "create unique index if not exists ledger_request_id_key on public.ledger (request_id) where request_id is not null;",
    );
  });

  it("drops the eight-argument record_usage before creating the nine-argument one", () => {
    const drop = ledgerRequestId.indexOf(`drop function if exists public.record_usage(${NEW_USAGE_TYPES});`);
    const create = ledgerRequestId.indexOf("create or replace function public.record_usage(");
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(drop);
  });

  it("keeps the founder-billing body except for the request id", () => {
    expect(functionBlockIn(ledgerRequestId, "record_usage")).toBe(expectedRequestIdBody(functionBlockIn(founderBilling, "record_usage")));
  });

  it("checks for the request id after the card lock and before the insert and the pool update", () => {
    const block = functionBlockIn(ledgerRequestId, "record_usage");
    const cardLock = block.indexOf("from public.cards where id = p_card_id for update;");
    const check = block.indexOf("select * into v_existing from public.ledger where request_id = p_request_id;");
    const insert = block.indexOf("insert into public.ledger (");
    const debit = block.indexOf("update public.pool");
    expect(cardLock).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(cardLock);
    expect(insert).toBeGreaterThan(check);
    expect(debit).toBeGreaterThan(insert);
  });

  it("grants the new record_usage to service_role only, with the exact lines", () => {
    expect(ledgerRequestId).toContain(`revoke all on function public.record_usage(${REQUEST_ID_USAGE_TYPES}) from public, anon, authenticated;`);
    expect(ledgerRequestId).toContain(`grant execute on function public.record_usage(${REQUEST_ID_USAGE_TYPES}) to service_role;`);
    expect(ledgerRequestId.match(/^grant /gm)).toHaveLength(1);
    expect(ledgerRequestId.match(/^revoke /gm)).toHaveLength(1);
  });

  it("holds nothing beyond its intended statements", () => {
    expect(statementsOutside(ledgerRequestId, "record_usage")).toBe(
      [
        "set lock_timeout = '5s';",
        "alter table public.ledger add column if not exists request_id text;",
        "create unique index if not exists ledger_request_id_key on public.ledger (request_id) where request_id is not null;",
        `drop function if exists public.record_usage(${NEW_USAGE_TYPES});`,
        "<function record_usage>",
        `revoke all on function public.record_usage(${REQUEST_ID_USAGE_TYPES}) from public, anon, authenticated;`,
        `grant execute on function public.record_usage(${REQUEST_ID_USAGE_TYPES}) to service_role;`,
        "notify pgrst, 'reload schema';",
      ].join("\n"),
    );
  });
});

const LEDGER_REQUEST_ID_ROLLBACK_FILE = "20260921000200_ledger_request_id_rollback.sql";
const rollbackPath = resolve(MIGRATIONS_DIR, "..", "rollbacks", LEDGER_REQUEST_ID_ROLLBACK_FILE);
const rollback = existsSync(rollbackPath) ? readFileSync(rollbackPath, "utf8") : "";

describe("ledger-request-id rollback", () => {
  it("lives outside migrations/, so it never applies on its own", () => {
    expect(rollback, rollbackPath).not.toBe("");
    expect(existsSync(resolve(MIGRATIONS_DIR, LEDGER_REQUEST_ID_ROLLBACK_FILE))).toBe(false);
  });

  it("restores the founder-billing record_usage exactly", () => {
    expect(functionBlockIn(rollback, "record_usage")).toBe(functionBlockIn(founderBilling, "record_usage"));
  });

  it("holds nothing beyond its intended statements", () => {
    expect(statementsOutside(rollback, "record_usage")).toBe(
      [
        "set lock_timeout = '5s';",
        `drop function if exists public.record_usage(${REQUEST_ID_USAGE_TYPES});`,
        "<function record_usage>",
        `revoke all on function public.record_usage(${NEW_USAGE_TYPES}) from public, anon, authenticated;`,
        `grant execute on function public.record_usage(${NEW_USAGE_TYPES}) to service_role;`,
        "drop index if exists public.ledger_request_id_key;",
        "alter table public.ledger drop column if exists request_id;",
        "notify pgrst, 'reload schema';",
      ].join("\n"),
    );
  });
});
