import { readFileSync } from "node:fs";
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
