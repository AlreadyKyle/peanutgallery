import { existsSync, readdirSync, readFileSync } from "node:fs";
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

// The launch migrations (docs/specs/launch-db.md). Stamps are fixed so the new
// enum value is committed before any file uses it, and the roles revoke waits
// in its own file until the site reads public_roles.

const LAUNCH_FILES = {
  overhead: "20260922000000_ledger_overhead.sql",
  money: "20260922000100_money_fixes.sql",
  lease: "20260922000200_dispatcher_lease.sql",
  backlog: "20260922000300_backlog.sql",
  roles: "20260922000400_public_roles.sql",
  revoke: "20260922000500_roles_revoke.sql",
} as const;

function launchFile(name: string): string {
  const path = resolve(MIGRATIONS_DIR, name);
  expect(existsSync(path), name).toBe(true);
  return readFileSync(path, "utf8");
}

const overheadSql = launchFile(LAUNCH_FILES.overhead);
const moneySql = launchFile(LAUNCH_FILES.money);
const leaseSql = launchFile(LAUNCH_FILES.lease);
const backlogSql = launchFile(LAUNCH_FILES.backlog);
const rolesSql = launchFile(LAUNCH_FILES.roles);
const revokeSql = launchFile(LAUNCH_FILES.revoke);

/** The board-RPC preamble every launch board RPC opens with: membership first, then the second factor. */
const BOARD_PREAMBLE = `  if public.board_role() is distinct from 'board'::public.board_role then\n    raise exception 'Board membership is required';\n  end if;\n${AAL2_CHECK}`;

/** A function block with each [after, before] pair swapped back; each after must appear exactly once. */
function undo(block: string, pairs: [string, string][]): string {
  let body = block;
  for (const [after, before] of pairs) {
    expect(body.split(after), after).toHaveLength(2);
    body = body.replace(after, before);
  }
  return body;
}

const APPLY_V9_TYPES = "text, text, text, numeric, numeric, integer, uuid, text, text";
const FILE_CARD_V12_TYPES = `${NEW_FILE_CARD_TYPES}, public.card_horizon`;
const NY_MIDNIGHT = "(date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York')";
const CLOSED_LANE = "The platform code lane is closed until the board has its own site";

describe("launch migrations: order", () => {
  it("carry 14-digit stamps in the fixed order, after every earlier file", () => {
    const names: string[] = Object.values(LAUNCH_FILES);
    for (const name of names) expect(name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect([...names].sort()).toEqual(names);
    expect(names[0]! > LEDGER_REQUEST_ID_FILE).toBe(true);
  });

  it("add the overhead label alone, so no file uses it in the transaction that adds it", () => {
    expect(withoutComments(overheadSql)).toBe("alter type public.ledger_billing add value if not exists 'overhead';");
    for (const text of [founderBilling, ledgerRequestId]) expect(text).not.toContain("'overhead'");
  });
});

describe("money-fixes migration", () => {
  it("sets a lock timeout first and drops founder_credit", () => {
    expect(withoutComments(moneySql).split("\n")[0]).toBe(LOCK_TIMEOUT);
    expect(moneySql).toContain("drop function if exists public.founder_credit(numeric, public.contribution_kind, text);");
    expect(moneySql).not.toContain("create or replace function public.founder_credit(");
  });

  it("keeps the request-id record_usage except that an overhead row names no card and leaves the pool alone", () => {
    const block = functionBlockIn(moneySql, "record_usage");
    expect(
      undo(block, [
        [
          "  if p_billed_to = 'overhead'::public.ledger_billing and p_card_id is not null then\n    raise exception 'An overhead row names no card';\n  end if;\n",
          "",
        ],
        [
          "  if p_billed_to in ('founder'::public.ledger_billing, 'overhead'::public.ledger_billing) then\n",
          "  if p_billed_to = 'founder'::public.ledger_billing then\n",
        ],
      ]),
    ).toBe(functionBlockIn(ledgerRequestId, "record_usage"));
    const skip = block.indexOf("if p_billed_to in ('founder'::public.ledger_billing, 'overhead'::public.ledger_billing) then");
    expect(block.slice(skip, block.indexOf("else", skip))).not.toContain("update public.pool");
  });

  it("shows anon studio and overhead rows and never founder rows, with overhead in its own total", () => {
    expect(moneySql).toContain("drop policy if exists ledger_public_read on public.ledger;");
    expect(moneySql).toContain(
      "create policy ledger_public_read on public.ledger for select to anon, authenticated using (billed_to in ('studio', 'overhead'));",
    );
    for (const column of ["usd_total", "row_count"]) {
      expect(moneySql).toMatch(new RegExp(`filter \\(where billed_to = 'studio'\\)[^\\n]* as ${column}`));
    }
    expect(moneySql).toContain("coalesce(sum(usd) filter (where billed_to = 'overhead'), 0)::numeric(12,4) as overhead_usd");
    expect(moneySql).toContain("  from public.ledger\n  where billed_to in ('studio', 'overhead');");
    expect(moneySql).toContain("revoke all on table public.public_ledger_totals from anon, authenticated;");
    expect(moneySql).toContain("grant select on public.public_ledger_totals to anon, authenticated;");
  });

  it("adds the payer key, backfills payments with their email key, then requires one on every payment", () => {
    const column = moneySql.indexOf("alter table public.contributions add column if not exists payer_key text;");
    const backfill = moneySql.indexOf(
      "update public.contributions set payer_key = 'email:' || contributor_id where entry = 'payment' and payer_key is null;",
    );
    const check = moneySql.indexOf("add constraint contributions_payer_key_check");
    expect(column).toBeGreaterThan(0);
    expect(backfill).toBeGreaterThan(column);
    expect(check).toBeGreaterThan(backfill);
    expect(moneySql).toContain("check (entry <> 'payment' or (payer_key is not null and payer_key ~ '^(card|email):.+$'));");
    expect(moneySql).toContain("alter table public.contributions drop constraint if exists contributions_payer_key_check;");
    expect(moneySql).toContain(
      "create index if not exists contributions_payer_day_idx on public.contributions (payer_key, created_at) where entry = 'payment';",
    );
  });

  it("adds the studio-wide daily room and the monthly cap, both defaulting to $500", () => {
    expect(moneySql).toContain(
      "alter table public.studio_state add column if not exists credit_studio_daily_cap_usd numeric(12,4) not null default 500;",
    );
    expect(moneySql).toContain("alter table public.studio_state add column if not exists monthly_cap_usd numeric(12,4) not null default 500;");
  });

  it("creates board_actions and credit_purchases with row level security and nothing for anon or authenticated", () => {
    for (const table of ["board_actions", "credit_purchases"]) {
      expect(moneySql).toContain(`create table if not exists public.${table} (`);
      expect(moneySql).toContain(`alter table public.${table} enable row level security;`);
      expect(moneySql).toContain(`revoke all on table public.${table} from anon, authenticated;`);
      expect(moneySql).toContain(`grant all on table public.${table} to service_role;`);
      expect(moneySql).not.toMatch(new RegExp(`create policy \\w+ on public\\.${table} `));
    }
  });

  it("opens set_caps and record_credit_purchase with the board preamble, records each action and grants them to authenticated only", () => {
    for (const [name, types] of [
      ["set_caps", "numeric, numeric, numeric, text, numeric, numeric"],
      ["record_credit_purchase", "numeric, text, text"],
    ] as const) {
      const block = functionBlockIn(moneySql, name);
      expect(block, name).toContain(`begin\n${BOARD_PREAMBLE}`);
      expect(block, name).not.toContain("board_role() is null");
      expect(block, name).toContain("security definer");
      expect(block, name).toContain("set search_path = public");
      expect(block, name).toContain(`insert into public.board_actions (action, card_id, actor_email, reason, details)\n  values ('${name}',`);
      expect(block, name).toContain("raise exception 'A reason is required';");
      expect(moneySql).toContain(`revoke all on function public.${name}(${types}) from public, anon;`);
      expect(moneySql).toContain(`grant execute on function public.${name}(${types}) to authenticated, service_role;`);
    }
    const caps = functionBlockIn(moneySql, "set_caps");
    for (const message of [
      "Name at least one cap to change",
      "A cap must be zero or more",
      "The hourly rate must be above zero",
      "A cap must be at most $10,000",
      "The per-card maximum must not exceed the daily cap",
      "The daily cap must not exceed the monthly cap",
    ]) {
      expect(caps, message).toContain(`raise exception '${message}'`);
    }
  });

  it("gives board_studio_state every cap and the credit bought and spent", () => {
    const block = functionBlockIn(moneySql, "board_studio_state");
    expect(block).toContain("if not public.is_board_member() then");
    for (const key of ["agent_hourly_rate_usd", "monthly_cap_usd", "credit_daily_cap_usd", "credit_studio_daily_cap_usd", "daily_cap_usd", "card_max_usd"]) {
      expect(block, key).toContain(`'${key}', ${key}`);
    }
    expect(block).toContain("'credit_bought_usd', (select coalesce(sum(amount_usd), 0) from public.credit_purchases)");
    expect(block).toContain("'credit_spent_usd', (select coalesce(sum(usd), 0) from public.ledger where billed_to in ('studio', 'overhead'))");
  });

  it("drops the eight-argument apply_contribution and changes only the payer key and the studio-wide room", () => {
    const drop = moneySql.indexOf("drop function if exists public.apply_contribution(text, text, text, numeric, numeric, integer, uuid, text);");
    expect(drop).toBeGreaterThan(0);
    expect(moneySql.indexOf("create or replace function public.apply_contribution(")).toBeGreaterThan(drop);
    const block = functionBlockIn(moneySql, "apply_contribution");
    expect(
      undo(block, [
        ["  p_stripe_session_id text default null,\n  p_payer_key text default null\n) returns jsonb", "  p_stripe_session_id text default null\n) returns jsonb"],
        ["  v_daily_cap numeric(12,4);\n  v_studio_cap numeric(12,4);\n", "  v_daily_cap numeric(12,4);\n"],
        ["  v_used numeric(12,4);\n  v_studio_used numeric(12,4);\n  v_payer text;\n", "  v_used numeric(12,4);\n"],
        [
          "  v_payer := coalesce(nullif(btrim(p_payer_key), ''), 'email:' || p_contributor_id);\n  if v_payer !~ '^(card|email):.+$' then\n    raise exception 'p_payer_key must start with card: or email:';\n  end if;\n",
          "",
        ],
        [
          "credit_hold_days, credit_studio_daily_cap_usd\n  into v_reserve_pct, v_incident_pct, v_incident_cap, v_daily_cap, v_hold_days, v_studio_cap\n",
          "credit_hold_days\n  into v_reserve_pct, v_incident_pct, v_incident_cap, v_daily_cap, v_hold_days\n",
        ],
        [
          "  -- Read after the pool lock, so two payments from one payer take turns and\n  -- the second sees the first. A payer is the card behind the payment or the\n  -- email: the day's window counts every payment that shares either one, so a\n  -- second email on the same card and a second card on the same email share\n  -- one $50. The studio-wide room counts every payment today. Refunds do not\n  -- free room.\n",
          "  -- Read after the pool lock, so two payments from one contributor take turns\n  -- and the second sees the first. Refunds do not free room.\n",
        ],
        ["  where (payer_key = v_payer or contributor_id = p_contributor_id)\n", "  where contributor_id = p_contributor_id\n"],
        [
          `  select coalesce(sum(agents_usd - incident_usd - held_usd), 0) into v_studio_used\n  from public.contributions\n  where entry = 'payment'\n    and created_at >= ${NY_MIDNIGHT};\n  v_held := greatest(0, v_credit - least(greatest(0, v_daily_cap - v_used), greatest(0, v_studio_cap - v_studio_used)));\n`,
          "  v_held := greatest(0, v_credit - greatest(0, v_daily_cap - v_used));\n",
        ],
        ["held_usd, hold_until, payer_key\n", "held_usd, hold_until\n"],
        ["v_held, v_hold_until, v_payer\n", "v_held, v_hold_until\n"],
      ]),
    ).toBe(functionBlockIn(openFunding, "apply_contribution"));
    expect(moneySql).toContain(`revoke all on function public.apply_contribution(${APPLY_V9_TYPES}) from public, anon, authenticated;`);
    expect(moneySql).toContain(`grant execute on function public.apply_contribution(${APPLY_V9_TYPES}) to service_role;`);
  });

  it("keeps reverse_contribution's arithmetic and adds the earmarked money and the shortfall to its result", () => {
    const block = functionBlockIn(moneySql, "reverse_contribution");
    const report = block.slice(block.indexOf("\n  -- Money on the bars of cards waiting"), block.indexOf("\n\n  return jsonb_build_object(") + 1);
    expect(report).toContain("where c.stage in ('funded', 'voted', 'paused');");
    expect(report).toContain("v_shortfall := greatest(v_earmarked - (v_balance - coalesce(v_studio_reserve, 0)), 0);");
    expect(
      undo(block, [
        ["  v_incident_after numeric(12,4);\n  v_studio_reserve numeric(12,4);\n  v_earmarked numeric(12,4);\n  v_shortfall numeric(12,4);\n", "  v_incident_after numeric(12,4);\n"],
        [report, ""],
        ["    'goal_target_usd', v_goal_target,\n    'earmarked_usd', v_earmarked,\n    'shortfall_usd', v_shortfall\n", "    'goal_target_usd', v_goal_target\n"],
      ]),
    ).toBe(functionBlockIn(openFunding, "reverse_contribution"));
  });
});

describe("dispatcher-lease migration", () => {
  it("keeps the lease in one private row that only the service role's functions change", () => {
    expect(withoutComments(leaseSql).split("\n")[0]).toBe(LOCK_TIMEOUT);
    expect(leaseSql).toContain("create table if not exists public.dispatcher_lease (\n  id integer primary key check (id = 1),");
    expect(leaseSql).toContain("insert into public.dispatcher_lease (id) values (1) on conflict (id) do nothing;");
    for (const table of ["dispatcher_lease", "card_patches"]) {
      expect(leaseSql).toContain(`alter table public.${table} enable row level security;`);
      expect(leaseSql).toContain(`revoke all on table public.${table} from anon, authenticated;`);
      expect(leaseSql).not.toMatch(new RegExp(`create policy \\w+ on public\\.${table} `));
    }
    for (const [name, types] of [["claim_dispatcher_lease", "text, integer"], ["release_dispatcher_lease", "text"]] as const) {
      const block = functionBlockIn(leaseSql, name);
      expect(block, name).toContain("returns boolean");
      expect(block, name).toContain("security definer");
      expect(leaseSql).toContain(`revoke all on function public.${name}(${types}) from public, anon, authenticated;`);
      expect(leaseSql).toContain(`grant execute on function public.${name}(${types}) to service_role;`);
    }
  });

  it("claims in one conditional update, so two claimants never both win", () => {
    const block = functionBlockIn(leaseSql, "claim_dispatcher_lease");
    expect(block).toContain("    and (holder is null or holder = p_holder or expires_at <= now());");
    expect(block.match(/update public\.dispatcher_lease/g)).toHaveLength(1);
  });

  it("stores a patch only with its true digest and length", () => {
    expect(leaseSql).toContain("sha256 = encode(sha256(convert_to(patch, 'UTF8')), 'hex')");
    expect(leaseSql).toContain("bytes = octet_length(convert_to(patch, 'UTF8'))");
  });
});

describe("backlog migration", () => {
  it("adds the horizon enum and column, defaulting to now, and a rank", () => {
    expect(withoutComments(backlogSql).split("\n")[0]).toBe(LOCK_TIMEOUT);
    expect(backlogSql).toContain("create type public.card_horizon as enum ('now', 'next', 'later');");
    expect(backlogSql).toContain("when duplicate_object then null;");
    expect(backlogSql).toContain("alter table public.cards add column if not exists horizon public.card_horizon not null default 'now';");
    expect(backlogSql).toContain("alter table public.cards add column if not exists rank integer;");
  });

  it("re-grants the public card columns with horizon and rank, and nothing withheld", () => {
    const start = backlogSql.indexOf("grant select (");
    const grant = backlogSql.slice(start, backlogSql.indexOf(GRANT_END, start) + GRANT_END.length);
    const columns = grant.slice("grant select (".length, -GRANT_END.length).split(",").map((c) => c.trim());
    expect(columns).toEqual([...grantedCardColumns(), "horizon", "rank"]);
    for (const column of WITHHELD_CARD_COLUMNS) expect(columns).not.toContain(column);
    expect(backlogSql.indexOf("revoke all on public.cards from anon, authenticated;")).toBeLessThan(start);
  });

  it("drops the eleven-argument file_card and adds p_horizon last, uncapped by the per-card maximum", () => {
    const drop = backlogSql.indexOf(`drop function if exists public.file_card(${NEW_FILE_CARD_TYPES});`);
    expect(drop).toBeGreaterThan(0);
    expect(backlogSql.indexOf("create or replace function public.file_card(")).toBeGreaterThan(drop);
    const block = functionBlockIn(backlogSql, "file_card");
    expect(block).toContain(`begin\n${BOARD_PREAMBLE}`);
    expect(block).not.toContain("card_max_usd");
    expect(
      undo(block, [
        ["  p_board_reason text,\n  p_horizon public.card_horizon default 'now'\n) returns uuid", "  p_board_reason text\n) returns uuid"],
        ["declare\n  v_id uuid;\n", "declare\n  v_card_max numeric(12,4);\n  v_id uuid;\n"],
        [
          "  if p_horizon is null then\n    raise exception 'A horizon is required';\n  end if;\n",
          "  select card_max_usd into v_card_max from public.studio_state where id = 1;\n  if not found then\n    raise exception 'studio_state row 1 is missing';\n  end if;\n",
        ],
        [
          "  if p_funding_target_usd > 10000 then\n    raise exception 'The funding target must be at most $10,000';\n  end if;\n",
          "  if p_funding_target_usd > v_card_max then\n    raise exception 'The funding target must not exceed the per-card maximum of %', v_card_max;\n  end if;\n",
        ],
        [`  if p_horizon = 'now' and p_folder = 'platform' and p_lane = 'code' then\n    raise exception '${CLOSED_LANE}';\n  end if;\n`, ""],
        ["    confidence, proposer_role_id, stage, horizon\n", "    confidence, proposer_role_id, stage\n"],
        ["    'low', null, p_stage, p_horizon\n", "    'low', null, p_stage\n"],
        [
          "  insert into public.board_actions (action, card_id, actor_email, reason, details)\n  values ('file_card', v_id, auth.email(), coalesce(nullif(btrim(p_board_reason), ''), 'No reason given'), jsonb_build_object(\n    'horizon', p_horizon,\n    'stage', p_stage,\n    'funding_target_usd', round(p_funding_target_usd, 4)\n  ));\n",
          "",
        ],
      ]),
    ).toBe(functionBlockIn(boardTwoFactor, "file_card"));
    expect(backlogSql).toContain(`revoke all on function public.file_card(${FILE_CARD_V12_TYPES}) from public, anon;`);
    expect(backlogSql).toContain(`grant execute on function public.file_card(${FILE_CARD_V12_TYPES}) to authenticated, service_role;`);
  });

  it("credits a card only on now, and a release moves only a card on now to funded", () => {
    expect(
      undo(functionBlockIn(backlogSql, "apply_contribution"), [
        ["and stage in ('proposed', 'designing', 'voted') and horizon = 'now' for update;", "and stage in ('proposed', 'designing', 'voted') for update;"],
      ]),
    ).toBe(functionBlockIn(moneySql, "apply_contribution"));
    expect(
      undo(functionBlockIn(backlogSql, "credit_held_contributions"), [
        ["        and stage in ('proposed', 'voted')\n        and horizon = 'now'\n", "        and stage in ('proposed', 'voted')\n"],
      ]),
    ).toBe(functionBlockIn(refunds, "credit_held_contributions"));
  });

  it("opens set_card_horizon, cancel_card and resume_card with the board preamble, records each and grants them to authenticated only", () => {
    for (const [name, types] of [
      ["set_card_horizon", "uuid, public.card_horizon, integer, text, numeric, text, uuid, public.card_lane, text"],
      ["cancel_card", "uuid, text"],
      ["resume_card", "uuid, numeric, text"],
    ] as const) {
      const block = functionBlockIn(backlogSql, name);
      expect(block, name).toContain(`begin\n${BOARD_PREAMBLE}`);
      expect(block, name).not.toContain("board_role() is null");
      expect(block, name).toContain("security definer");
      expect(block, name).toContain(`values ('${name}', p_card, auth.email(), btrim(p_reason),`);
      expect(block, name).toContain("from public.cards where id = p_card for update;");
      expect(backlogSql).toContain(`revoke all on function public.${name}(${types}) from public, anon;`);
      expect(backlogSql).toContain(`grant execute on function public.${name}(${types}) to authenticated, service_role;`);
    }
    expect(functionBlockIn(backlogSql, "set_card_horizon")).toContain(CLOSED_LANE);
    expect(functionBlockIn(backlogSql, "resume_card")).toContain(CLOSED_LANE);
    expect(functionBlockIn(backlogSql, "cancel_card")).toContain("if v_card.stage not in ('proposed', 'designing', 'voted', 'funded', 'paused') then");
  });
});

describe("public-roles migration", () => {
  it("adds a one-line roles.description and public_roles with the site's columns", () => {
    expect(rolesSql).toContain("alter table public.roles add column if not exists description text;");
    expect(rolesSql).toContain(
      "create or replace view public.public_roles with (security_invoker = false) as\n  select id, name, title, description, species_note, avatar_url, model, write_access, state, hired_at\n  from public.roles;",
    );
  });

  it("adds paused to public_studio, last, and never paused_by or paused_at", () => {
    expect(rolesSql).toContain(
      "create or replace view public.public_studio with (security_invoker = false) as\n  select launched_at, paused from public.studio_state where id = 1;",
    );
    expect(withoutComments(rolesSql)).not.toMatch(/paused_(by|at)/);
  });

  it("revokes everything on both views before granting select, and revokes nothing on roles", () => {
    expect(rolesSql).toContain("revoke all on table public.public_roles, public.public_studio from anon, authenticated;");
    expect(rolesSql).toContain("grant select on public.public_roles to anon, authenticated;");
    expect(rolesSql).toContain("grant select on public.public_studio to anon, authenticated;");
    expect(withoutComments(rolesSql)).not.toMatch(/(revoke|grant)[^;]* on (table )?public\.roles[ ;]/);
  });
});

describe("roles-revoke migration", () => {
  it("revokes anon and authenticated on roles and does nothing else", () => {
    expect(withoutComments(revokeSql)).toBe(
      [LOCK_TIMEOUT, "revoke all on table public.roles from anon, authenticated;", "notify pgrst, 'reload schema';"].join("\n"),
    );
  });
});

// docs/specs/money-safety.md: the backup login, the ledger identity in SQL, the Controller's tables and
// the append-only money tables.
const MONEY_SAFETY_FILES = {
  entries: "20260923000000_contribution_entries.sql",
  backup: "20260923000010_backup_role.sql",
  appendOnly: "20260923000020_append_only.sql",
} as const;
const entriesSql = launchFile(MONEY_SAFETY_FILES.entries);
const backupSql = launchFile(MONEY_SAFETY_FILES.backup);
const appendOnlySql = launchFile(MONEY_SAFETY_FILES.appendOnly);
const APPEND_ONLY_TABLES = ["ledger", "contributions", "credit_purchases", "board_actions", "controller_runs"];

describe("money-safety migrations: order", () => {
  it("carry 14-digit stamps in order, after every launch file", () => {
    const names: string[] = Object.values(MONEY_SAFETY_FILES);
    for (const name of names) expect(name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect([...names].sort()).toEqual(names);
    expect(names[0]! > LAUNCH_FILES.revoke).toBe(true);
  });

  it("add the two entry labels alone, so no file uses them in the transaction that adds them", () => {
    expect(withoutComments(entriesSql)).toBe(
      [
        "alter type public.contribution_entry add value if not exists 'reinstated';",
        "alter type public.contribution_entry add value if not exists 'adjustment';",
      ].join("\n"),
    );
    for (const name of Object.values(LAUNCH_FILES)) expect(launchFile(name)).not.toMatch(/'(reinstated|adjustment)'/);
  });
});

describe("backup-role migration", () => {
  it("creates the backup login with no password, and a second run never touches one", () => {
    expect(withoutComments(backupSql).split("\n")[0]).toBe(LOCK_TIMEOUT);
    expect(withoutComments(backupSql)).not.toMatch(/password\s+(null|'|")|encrypted\s+password/i);
    expect(backupSql).toContain(
      "  create role peanutgallery_backup with login nosuperuser nocreatedb nocreaterole noreplication inherit connection limit 4;\nexception\n  when duplicate_object then null;",
    );
    expect(backupSql).toContain("alter role peanutgallery_backup set default_transaction_read_only = on;");
  });

  it("never names SUPERUSER or REPLICATION in an alter role, which the project owner may not do, and checks them instead", () => {
    // Production refused the first version: only a superuser may alter those two attributes.
    expect(withoutComments(backupSql)).not.toMatch(/alter role peanutgallery_backup with[^;]*(superuser|replication)/);
    expect(backupSql).toContain("alter role peanutgallery_backup with login nocreatedb nocreaterole inherit connection limit 4;");
    expect(backupSql).toContain("(rolsuper or rolreplication)) then\n    raise exception");
  });

  it("grants reads only: select on every table and sequence, never a write", () => {
    const grants = withoutComments(backupSql)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^(grant|alter default privileges)/.test(line) && line.includes("peanutgallery_backup"));
    expect(grants).toEqual([
      "grant pg_read_all_data to peanutgallery_backup;",
      "grant usage on schema public to peanutgallery_backup;",
      "grant select on all tables in schema public to peanutgallery_backup;",
      "grant select on all sequences in schema public to peanutgallery_backup;",
      "alter default privileges in schema public grant select on tables to peanutgallery_backup;",
      "alter default privileges in schema public grant select on sequences to peanutgallery_backup;",
      "grant usage on schema auth to peanutgallery_backup;",
      "grant select on all tables in schema auth to peanutgallery_backup;",
      "grant usage on schema supabase_migrations to peanutgallery_backup;",
      "grant select on all tables in schema supabase_migrations to peanutgallery_backup;",
      "grant execute on function public.ledger_identity() to service_role, peanutgallery_backup;",
    ]);
    expect(withoutComments(backupSql)).not.toMatch(/pg_write_all_data|grant (all|insert|update|delete)[^;]*peanutgallery_backup/);
  });

  it("computes the three identity lines the ledger-identity script checks, in one function", () => {
    const block = functionBlockIn(backupSql, "ledger_identity");
    expect(block).toContain("v_i1 := v_pool.reserve_usd - v_reserve;");
    expect(block).toContain("v_i2 := (v_pool.balance_usd + v_pool.incident_reserve_usd + v_pool.held_usd) - (v_agents - v_studio);");
    expect(block).toContain("v_i3 := v_pool.held_usd - v_held;");
    expect(block).toContain("coalesce(sum(usd) filter (where billed_to = 'studio'), 0),");
    expect(block).toContain("stable\nsecurity definer\nset search_path = public");
  });

  it("keeps controller_runs private to the service role, which may insert and read but not change a row", () => {
    expect(backupSql).toContain("alter table public.controller_runs enable row level security;");
    expect(backupSql).toContain("revoke all on table public.controller_runs from anon, authenticated;");
    expect(backupSql).toContain("grant select, insert on table public.controller_runs to service_role;");
    expect(backupSql).toContain("check (job in ('reconcile', 'quota'))");
  });

  it("measures remaining ceilings the way the throttle does, and gives the two job functions to the service role only", () => {
    const figures = functionBlockIn(backupSql, "controller_figures");
    expect(figures).toContain("least(round(1.5 * c.estimate_usd, 4), v_state.card_max_usd) - coalesce(s.usd, 0)");
    expect(figures).toContain("where c.stage in ('funded', 'building');");
    expect(figures).toContain("(p.agents_usd - p.incident_usd - p.held_usd) + coalesce(sum(c.agents_usd - c.incident_usd - c.held_usd), 0) as agent_money_usd");
    for (const name of ["controller_figures", "ops_database_size"]) {
      expect(backupSql).toContain(`revoke all on function public.${name}() from public, anon, authenticated;\ngrant execute on function public.${name}() to service_role;`);
    }
  });
});

describe("append-only migration", () => {
  it("guards exactly the five money tables against update, delete and truncate", () => {
    expect(appendOnlySql).toContain(`foreach v_table in array array[${APPEND_ONLY_TABLES.map((t) => `'${t}'`).join(", ")}] loop`);
    expect(appendOnlySql).toContain("before update or delete on public.%I for each row execute function public.refuse_money_change()");
    expect(appendOnlySql).toContain("before truncate on public.%I for each statement execute function public.refuse_money_change()");
    expect(appendOnlySql).toContain("contribution_allocations and card_approvals do not exist yet");
  });

  it("lets through only the plan's two exceptions: decision_id set once and display_name nulled inside the privacy RPC", () => {
    const guard = functionBlockIn(appendOnlySql, "refuse_money_change");
    expect(guard).not.toContain("security definer");
    expect(guard.match(/return new;/g)).toHaveLength(3);
    expect(guard).toContain("if old.decision_id is null and new.decision_id is not null\n      and v_new - 'decision_id' = v_old - 'decision_id' then");
    expect(guard).toContain(
      "if old.display_name is not null and new.display_name is null\n      and v_new - 'display_name' = v_old - 'display_name'\n      and current_setting('peanutgallery.redact_name', true) = 'on' then",
    );
    expect(guard).not.toContain("card_id");
    // A card a board action names cannot be deleted, so no foreign key ever rewrites an action.
    expect(appendOnlySql).toContain(
      "alter table public.board_actions drop constraint if exists board_actions_card_id_fkey;\nalter table public.board_actions add constraint board_actions_card_id_fkey\n  foreign key (card_id) references public.cards (id) on delete restrict;",
    );
    const redact = functionBlockIn(appendOnlySql, "redact_contribution_name");
    expect(redact).toContain(
      "perform set_config('peanutgallery.redact_name', 'on', true);\n  update public.contributions set display_name = null\n  where id = p_contribution_id and display_name is not null;\n  v_nulled := found;\n  perform set_config('peanutgallery.redact_name', 'off', true);",
    );
  });

  it("keeps reverse_contribution's money-fixes body except that reinstated rows count as given back", () => {
    const block = functionBlockIn(appendOnlySql, "reverse_contribution");
    expect(
      undo(block, [
        [
          "    -coalesce(sum(amount_usd) filter (where entry in ('refund', 'dispute', 'reinstated')), 0),",
          "    -coalesce(sum(amount_usd) filter (where entry in ('refund', 'dispute')), 0),",
        ],
      ]),
    ).toBe(functionBlockIn(moneySql, "reverse_contribution"));
  });

  it("opens record_adjustment and redact_contribution_name with the board preamble, records each, and grants them to authenticated", () => {
    for (const name of ["record_adjustment", "redact_contribution_name"]) {
      const block = functionBlockIn(appendOnlySql, name);
      expect(block.slice(block.indexOf("\nbegin\n") + "\nbegin\n".length)).toMatch(new RegExp(`^${escape(BOARD_PREAMBLE)}`));
      expect(block).toContain("insert into public.board_actions (action, card_id, actor_email, reason, details)");
    }
    expect(appendOnlySql).toContain("grant execute on function public.record_adjustment(uuid, numeric, numeric, numeric, numeric, text) to authenticated, service_role;");
    expect(appendOnlySql).toContain("grant execute on function public.redact_contribution_name(uuid, text) to authenticated, service_role;");
    expect(appendOnlySql).toContain(
      "check (action in ('set_caps', 'record_credit_purchase', 'file_card', 'set_card_horizon', 'cancel_card', 'resume_card', 'record_adjustment', 'redact_display_name'));",
    );
  });

  it("writes a reinstated row that negates the disputes, keyed on the dispute, for the service role only", () => {
    const block = functionBlockIn(appendOnlySql, "record_dispute_reinstated");
    expect(block).toContain("v_ref := p_dispute_id || ':reinstated';");
    expect(block).toContain("where parent_id = v_payment.id and entry in ('dispute', 'reinstated');");
    expect(block).toContain(
      "'reinstated', v_payment.id, v_payment.rail, v_payment.contributor_id, -v_amount, -v_net,\n    -v_reserve, -v_agents, -v_studio, -v_incident, v_payment.studio_pct_chosen, v_payment.kind,\n    v_payment.public, v_payment.goal_card_id, v_ref, 0, now()",
    );
    expect(block).toContain("balance_usd = balance_usd - (v_agents - v_incident)");
    // The card's bar gets back what the pool balance does, so a later refund never takes it below zero.
    expect(block).toContain("set funded_usd = funded_usd - (v_agents - v_incident)\n    where id = v_payment.goal_card_id;");
    expect(block.indexOf("from public.cards where id = v_payment.goal_card_id for update")).toBeLessThan(block.indexOf("from public.pool where id = 1 for update"));
    expect(appendOnlySql).toContain(
      "revoke all on function public.record_dispute_reinstated(text, text, numeric) from public, anon, authenticated;\ngrant execute on function public.record_dispute_reinstated(text, text, numeric) to service_role;",
    );
  });
});

// The production proof after the money-safety files are applied is anon-negative-test.ts, so it must
// probe every private object they add: each new table as a private table, and each new function as an
// RPC anon is refused with 42501.
describe("anon-negative-test covers the money-safety objects", () => {
  const script = readFileSync(resolve(MIGRATIONS_DIR, "..", "scripts", "anon-negative-test.ts"), "utf8");
  const block = (name: string) => {
    const start = script.indexOf(`const ${name}`);
    return script.slice(start, script.indexOf("];", start));
  };
  const moneySafety = [backupSql, appendOnlySql].map(withoutComments).join("\n");

  it("lists every table the files create as private", () => {
    const tables = [...moneySafety.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]!);
    expect(tables).toEqual(["controller_runs"]);
    for (const table of tables) expect(block("PRIVATE_TABLES")).toContain(`"${table}"`);
  });

  it("probes every function the files revoke from anon", () => {
    const functions = [...new Set([...moneySafety.matchAll(/revoke all on function public\.(\w+)\([^)]*\) from public, anon/g)].map((m) => m[1]!))].sort();
    expect(functions).toEqual([
      "controller_figures",
      "ledger_identity",
      "ops_database_size",
      "record_adjustment",
      "record_dispute_reinstated",
      "redact_contribution_name",
      "refuse_money_change",
      "reverse_contribution",
    ]);
    // The trigger function is not an RPC PostgREST serves, and reverse_contribution's grant predates
    // these files and is unchanged by them.
    for (const name of functions.filter((f) => f !== "refuse_money_change" && f !== "reverse_contribution")) {
      expect(block("RPC_PROBES")).toContain(`["${name}", {`);
    }
  });
});

// The scale migration (docs/specs/scale-launch.md): the dispatcher's spend totals in SQL and the
// usage tier cap.

const SPEND_TOTALS_FILE = "20260923000100_spend_totals.sql";
const spendTotalsSql = launchFile(SPEND_TOTALS_FILE);

describe("spend-totals migration", () => {
  it("comes after every launch file and sets a lock timeout first", () => {
    expect(Object.values(LAUNCH_FILES).every((name) => name < SPEND_TOTALS_FILE)).toBe(true);
    expect(withoutComments(spendTotalsSql).split("\n")[0]).toBe(LOCK_TIMEOUT);
  });

  it("can run twice: every statement is guarded or replaces what it creates", () => {
    const statements = withoutComments(spendTotalsSql)
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => /^(create|alter|drop)\b/.test(statement) && !statement.startsWith("create or replace function"));
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement, statement).toMatch(/if (not )?exists|^alter table public\.studio_state add constraint/);
    }
    // The constraint is dropped first, so adding it again does not fail.
    expect(spendTotalsSql.indexOf("drop constraint if exists studio_state_anthropic_tier_cap_check")).toBeLessThan(
      spendTotalsSql.indexOf("add constraint studio_state_anthropic_tier_cap_check"),
    );
  });

  it("adds an optional, positive tier cap to studio_state and nothing to the public views", () => {
    expect(spendTotalsSql).toContain("alter table public.studio_state add column if not exists anthropic_tier_cap_usd numeric(12,4);");
    expect(spendTotalsSql).toContain("check (anthropic_tier_cap_usd is null or anthropic_tier_cap_usd > 0)");
    expect(withoutComments(spendTotalsSql)).not.toMatch(/create or replace view|grant select/);
  });

  it("indexes the ledger by billing and time, carrying usd", () => {
    expect(spendTotalsSql).toContain("create index if not exists ledger_billed_created_idx on public.ledger (billed_to, created_at) include (usd);");
  });

  it("sums studio and overhead rows only, from the month and tier starts, and every credit purchase", () => {
    const block = functionBlockIn(spendTotalsSql, "studio_spend_totals");
    expect(block).toContain("where l.billed_to in ('studio', 'overhead');");
    expect(block).toContain("'month_usd', coalesce(sum(l.usd) filter (where l.created_at >= p_month_start), 0)");
    expect(block).toContain("'tier_usd', coalesce(sum(l.usd) filter (where l.created_at >= p_tier_start), 0)");
    expect(block).toContain("(select coalesce(sum(p.amount_usd), 0) from public.credit_purchases p)");
    expect(functionBlockIn(spendTotalsSql, "card_ledger_usd")).toContain("from public.ledger l where l.card_id = p_card_id;");
  });

  it("gives both functions to the service role only, read-only, strict and with a fixed search path", () => {
    for (const [name, types] of [["studio_spend_totals", "timestamptz, timestamptz"], ["card_ledger_usd", "uuid"]] as const) {
      const block = functionBlockIn(spendTotalsSql, name);
      expect(block, name).toContain("\nstable\nstrict\nsecurity definer\nset search_path = public\n");
      expect(block, name).not.toMatch(/\b(insert|update|delete)\b/);
      expect(spendTotalsSql).toContain(`revoke all on function public.${name}(${types}) from public, anon, authenticated;`);
      expect(spendTotalsSql).toContain(`grant execute on function public.${name}(${types}) to service_role;`);
    }
  });
});

// The Biz Dev rename and the roster columns (docs/specs/carry-over.md).
const RENAME_BIZ_DEV_FILE = "20260923000200_rename_biz_dev.sql";
const renameSql = launchFile(RENAME_BIZ_DEV_FILE);

describe("rename-biz-dev migration", () => {
  it("comes after the launch files and sets a lock timeout first", () => {
    expect(RENAME_BIZ_DEV_FILE > LAUNCH_FILES.revoke).toBe(true);
    expect(withoutComments(renameSql).startsWith(LOCK_TIMEOUT)).toBe(true);
  });

  it("renames the Scout's row in place, only while no Biz Dev row exists, so the seed's upsert on name finds it", () => {
    expect(renameSql).toContain(
      "update public.roles\nset name = 'Biz Dev', title = 'Biz Dev', prompt_path = 'platform/agents/prompts/biz-dev.md'\nwhere name = 'Scout'\n  and not exists (select 1 from public.roles where name = 'Biz Dev');",
    );
    // A Scout row left beside a Biz Dev row is retired, never deleted.
    expect(renameSql).toContain("set state = 'retired', retired_at = coalesce(retired_at, now())");
    expect(withoutComments(renameSql)).not.toMatch(/\bdelete\b|\binsert\b|\bdrop table\b/i);
  });

  it("retitles the Scout's planned roadmap card to the new backlog title, so file-backlog finds it", () => {
    expect(renameSql).toContain(
      "update public.cards\nset title = 'Biz Dev agent for outside tools and trends'\nwhere title = 'Scout agent for outside tools and trends'\n  and stage = 'proposed'\n  and horizon in ('next', 'later')\n  and not exists (select 1 from public.cards where title = 'Biz Dev agent for outside tools and trends');",
    );
    const backlog = readFileSync(resolve(MIGRATIONS_DIR, "..", "..", "..", "docs", "BACKLOG.md"), "utf8");
    expect(backlog).toContain("### Biz Dev agent for outside tools and trends\n");
    expect(backlog).not.toMatch(/scout/i);
  });

  it("adds nullable status and trigger, each checked, and runs twice", () => {
    expect(renameSql).toContain("alter table public.roles add column if not exists status text;");
    expect(renameSql).toContain("alter table public.roles add column if not exists trigger text;");
    expect(renameSql).toContain("check (status is null or status in ('running', 'starts', 'planned'));");
    expect(renameSql).toContain("check (trigger is null or (btrim(trigger) <> '' and char_length(trigger) <= 200 and strpos(trigger, E'\\n') = 0));");
    for (const name of ["roles_status_check", "roles_trigger_check"]) {
      expect(renameSql).toContain(`alter table public.roles drop constraint if exists ${name};`);
    }
  });

  it("re-creates public_roles with status and trigger at its end, then revokes everything before granting select", () => {
    expect(renameSql).toContain(
      "create or replace view public.public_roles with (security_invoker = false) as\n  select id, name, title, description, species_note, avatar_url, model, write_access, state, hired_at, status, trigger\n  from public.roles;",
    );
    const body = withoutComments(renameSql);
    expect(body.indexOf("revoke all on table public.public_roles from anon, authenticated;")).toBeGreaterThan(body.indexOf("create or replace view public.public_roles"));
    expect(body.indexOf("grant select on public.public_roles to anon, authenticated;")).toBeGreaterThan(body.indexOf("revoke all on table public.public_roles"));
    expect(body).not.toMatch(/(revoke|grant)[^;]* on (table )?public\.roles[ ;]/);
  });
});

// The board's own site (docs/specs/board-site.md): the platform code lane behind a studio flag, the
// usage tier cap in set_caps, and the board's Needs you RPC.
const BOARD_SITE_FILE = "20260924000000_board_site.sql";
const TERMS_VERSIONS_FILE = "20260924100000_terms_versions.sql";
const boardSiteSql = launchFile(BOARD_SITE_FILE);
const LANE_OPEN = "coalesce((select s.platform_lane_open from public.studio_state s where s.id = 1), false)";
const NEW_CAPS_TYPES = "numeric, numeric, numeric, text, numeric, numeric, numeric, boolean";

describe("board-site migration", () => {
  it("comes after every earlier file and sets a lock timeout first", () => {
    const others = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql") && name !== BOARD_SITE_FILE);
    // Only the files of later specs come after it (docs/specs/legal-copy.md onwards).
    expect(others.filter((name) => name > BOARD_SITE_FILE).every((name) => name >= TERMS_VERSIONS_FILE)).toBe(true);
    expect(others.filter((name) => name < BOARD_SITE_FILE).length).toBeGreaterThan(20);
    expect(BOARD_SITE_FILE > RENAME_BIZ_DEV_FILE).toBe(true);
    expect(withoutComments(boardSiteSql).split("\n")[0]).toBe(LOCK_TIMEOUT);
  });

  it("can run twice: every statement is guarded or replaces what it creates", () => {
    const statements = withoutComments(boardSiteSql)
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => /^(create|alter|drop)\b/.test(statement) && !/^create or replace (function|view)/.test(statement));
    expect(statements).toEqual([
      "alter table public.studio_state add column if not exists platform_lane_open boolean not null default false",
      "drop function if exists public.set_caps(numeric, numeric, numeric, text, numeric, numeric)",
    ]);
  });

  it("opens the platform code lane in file_card, set_card_horizon and resume_card only while studio_state says so", () => {
    for (const [name, before, after] of [
      [
        "file_card",
        `  if p_horizon = 'now' and p_folder = 'platform' and p_lane = 'code' then\n`,
        `  if p_horizon = 'now' and p_folder = 'platform' and p_lane = 'code' and not ${LANE_OPEN} then\n`,
      ],
      [
        "set_card_horizon",
        `    if v_after.folder = 'platform' and v_after.lane = 'code' then\n`,
        `    if v_after.folder = 'platform' and v_after.lane = 'code' and not ${LANE_OPEN} then\n`,
      ],
      [
        "resume_card",
        `  if v_card.folder = 'platform' and v_card.lane = 'code' then\n`,
        `  if v_card.folder = 'platform' and v_card.lane = 'code' and not ${LANE_OPEN} then\n`,
      ],
    ] as const) {
      const block = functionBlockIn(boardSiteSql, name);
      expect(block, name).toContain(CLOSED_LANE);
      expect(undo(block, [[after, before]]), name).toBe(functionBlockIn(backlogSql, name));
    }
    expect(boardSiteSql).toContain(`revoke all on function public.file_card(${FILE_CARD_V12_TYPES}) from public, anon;`);
    expect(boardSiteSql).toContain(`grant execute on function public.file_card(${FILE_CARD_V12_TYPES}) to authenticated, service_role;`);
  });

  it("adds the lane flag at the end of public_studio, closed by default, and revokes before it grants select", () => {
    expect(boardSiteSql).toContain(
      "create or replace view public.public_studio with (security_invoker = false) as\n  select launched_at, paused, platform_lane_open from public.studio_state where id = 1;",
    );
    const body = withoutComments(boardSiteSql);
    expect(body.indexOf("revoke all on table public.public_studio from anon, authenticated;")).toBeGreaterThan(body.indexOf("create or replace view public.public_studio"));
    expect(body.indexOf("grant select on public.public_studio to anon, authenticated;")).toBeGreaterThan(body.indexOf("revoke all on table public.public_studio"));
    const view = body.slice(body.indexOf("create or replace view public.public_studio"), body.indexOf(";", body.indexOf("create or replace view public.public_studio")));
    expect(view).not.toMatch(/paused_by|paused_at|\*/);
  });

  it("gives set_caps the usage tier cap, changed only when asked, and nothing else", () => {
    const drop = boardSiteSql.indexOf("drop function if exists public.set_caps(numeric, numeric, numeric, text, numeric, numeric);");
    expect(drop).toBeGreaterThan(0);
    expect(boardSiteSql.indexOf("create or replace function public.set_caps(")).toBeGreaterThan(drop);
    expect(
      undo(functionBlockIn(boardSiteSql, "set_caps"), [
        [
          "  p_credit_studio_daily_cap_usd numeric default null,\n  p_anthropic_tier_cap_usd numeric default null,\n  p_set_anthropic_tier_cap boolean default false\n) returns jsonb",
          "  p_credit_studio_daily_cap_usd numeric default null\n) returns jsonb",
        ],
        [
          "  if p_anthropic_tier_cap_usd is not null and not coalesce(p_set_anthropic_tier_cap, false) then\n    raise exception 'Pass p_set_anthropic_tier_cap to change the usage tier cap';\n  end if;\n",
          "",
        ],
        [
          "    and p_monthly_cap_usd is null and p_credit_studio_daily_cap_usd is null\n    and not coalesce(p_set_anthropic_tier_cap, false) then\n",
          "    and p_monthly_cap_usd is null and p_credit_studio_daily_cap_usd is null then\n",
        ],
        [
          "  if p_anthropic_tier_cap_usd <= 0 or p_anthropic_tier_cap_usd > 1000000 then\n    raise exception 'The usage tier cap must be above zero and at most $1,000,000, or null for none';\n  end if;\n",
          "",
        ],
        [
          "      credit_studio_daily_cap_usd = coalesce(round(p_credit_studio_daily_cap_usd, 4), credit_studio_daily_cap_usd),\n      anthropic_tier_cap_usd = case when coalesce(p_set_anthropic_tier_cap, false) then round(p_anthropic_tier_cap_usd, 4) else anthropic_tier_cap_usd end\n",
          "      credit_studio_daily_cap_usd = coalesce(round(p_credit_studio_daily_cap_usd, 4), credit_studio_daily_cap_usd)\n",
        ],
        [
          "      'credit_studio_daily_cap_usd', v_before.credit_studio_daily_cap_usd,\n      'anthropic_tier_cap_usd', v_before.anthropic_tier_cap_usd\n",
          "      'credit_studio_daily_cap_usd', v_before.credit_studio_daily_cap_usd\n",
        ],
        [
          "      'credit_studio_daily_cap_usd', v_after.credit_studio_daily_cap_usd,\n      'anthropic_tier_cap_usd', v_after.anthropic_tier_cap_usd\n    )\n",
          "      'credit_studio_daily_cap_usd', v_after.credit_studio_daily_cap_usd\n    )\n",
        ],
        [
          "    'credit_studio_daily_cap_usd', v_after.credit_studio_daily_cap_usd,\n    'anthropic_tier_cap_usd', v_after.anthropic_tier_cap_usd\n  );",
          "    'credit_studio_daily_cap_usd', v_after.credit_studio_daily_cap_usd\n  );",
        ],
      ]),
    ).toBe(functionBlockIn(moneySql, "set_caps"));
    expect(boardSiteSql).toContain(`revoke all on function public.set_caps(${NEW_CAPS_TYPES}) from public, anon;`);
    expect(boardSiteSql).toContain(`grant execute on function public.set_caps(${NEW_CAPS_TYPES}) to authenticated, service_role;`);
  });

  it("returns the tier cap and the lane flag from board_studio_state, and nothing else new", () => {
    expect(
      undo(functionBlockIn(boardSiteSql, "board_studio_state"), [
        ["    'anthropic_tier_cap_usd', anthropic_tier_cap_usd,\n    'platform_lane_open', platform_lane_open,\n", ""],
      ]),
    ).toBe(functionBlockIn(moneySql, "board_studio_state"));
  });

  it("lets board members only read the Needs you figures, and writes nothing", () => {
    const block = functionBlockIn(boardSiteSql, "board_needs_you");
    expect(block).toContain("\nstable\nsecurity definer\nset search_path = public\n");
    expect(block).toContain("  if public.board_role() is distinct from 'board'::public.board_role then\n    raise exception 'Board membership is required';\n  end if;\n");
    expect(block).not.toMatch(/\b(insert|update|delete)\b/);
    expect(block).toContain("where job = 'reconcile'\n  order by created_at desc, id desc\n  limit 1;");
    expect(block).toContain("where c.severity = 's1' and c.stage in ('funded', 'building', 'gated', 'paused');");
    // The Controller's figures are passed through by name; nothing else of the run is.
    expect([...block.matchAll(/v_run\.figures (?:->|#>) '([^']+)'/g)].map((m) => m[1])).toEqual([
      "credit_purchase_usd",
      "minimum_balance_usd",
      "{minimum_balance,settlement_amount}",
      "{minimum_balance,settlement_currency}",
      "disputes_to_answer",
      "latest_payout",
    ]);
    expect(boardSiteSql).toContain("revoke all on function public.board_needs_you() from public, anon;");
    expect(boardSiteSql).toContain("grant execute on function public.board_needs_you() to authenticated, service_role;");
  });

  it("is probed by anon-negative-test: the new RPC refused to anon, the flag readable on public_studio", () => {
    const script = readFileSync(resolve(MIGRATIONS_DIR, "..", "scripts", "anon-negative-test.ts"), "utf8");
    expect(script).toContain('["board_needs_you", {}]');
    // money-logic.md adds pause_reason after the lane flag.
    expect(script).toMatch(/const STUDIO_COLUMNS_READABLE = "launched_at,paused,platform_lane_open[,"]/);
  });
});

// docs/specs/legal-copy.md: numbered Terms versions, append-only, read by the public through one view.
const TERMS_VERSION_2_FILE = "20260924100100_terms_version_2.sql";
// Version 3: version 2's words with the studio's new name (docs/specs/rename.md).
const TERMS_VERSION_3_FILE = "20260925000000_terms_version_3.sql";
const termsVersionsSql = launchFile(TERMS_VERSIONS_FILE);
const termsVersion2Sql = launchFile(TERMS_VERSION_2_FILE);
const termsVersion3Sql = launchFile(TERMS_VERSION_3_FILE);

describe("terms-versions migrations", () => {
  it("come after the board-site file, in order, and the first sets a lock timeout first", () => {
    const names = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
    const at = names.indexOf(TERMS_VERSIONS_FILE);
    expect(names[at - 1]).toBe(BOARD_SITE_FILE);
    expect(names[at + 1]).toBe(TERMS_VERSION_2_FILE);
    expect(withoutComments(termsVersionsSql).split("\n")[0]).toBe(LOCK_TIMEOUT);
  });

  it("can run twice: every statement is guarded or replaces what it creates", () => {
    const statements = withoutComments(termsVersionsSql)
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => /^(create|alter|drop|insert)\b/.test(statement) && !/^create or replace (function|view)/.test(statement));
    expect(statements).toEqual([
      "create table if not exists public.terms_versions (\n  version integer primary key check (version between 1 and 9999),\n  posted_at timestamptz not null default now()\n)",
      "alter table public.terms_versions enable row level security",
      "drop trigger if exists terms_versions_append_only on public.terms_versions",
      "create trigger terms_versions_append_only before update or delete on public.terms_versions\n  for each row execute function public.refuse_money_change()",
      "drop trigger if exists terms_versions_no_truncate on public.terms_versions",
      "create trigger terms_versions_no_truncate before truncate on public.terms_versions\n  for each statement execute function public.refuse_money_change()",
      "insert into public.terms_versions (version, posted_at) values (1, '2026-09-23 01:32:51+00')\n  on conflict (version) do nothing",
    ]);
    expect(withoutComments(termsVersion2Sql)).toBe("insert into public.terms_versions (version) values (2) on conflict (version) do nothing;");
    expect(withoutComments(termsVersion3Sql)).toBe("insert into public.terms_versions (version) values (3) on conflict (version) do nothing;");
    const names = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
    expect(names.indexOf(TERMS_VERSION_3_FILE)).toBeGreaterThan(names.indexOf(MONEY_LOGIC_FILE));
  });

  it("keeps the table behind row level security, readable by the service role only, and revokes before it grants", () => {
    const body = withoutComments(termsVersionsSql);
    const revoke = body.indexOf("revoke all on public.terms_versions from anon, authenticated, service_role;");
    const grant = body.indexOf("grant select on public.terms_versions to service_role;");
    expect(body).toContain("alter table public.terms_versions enable row level security;");
    expect(revoke).toBeGreaterThan(0);
    expect(grant).toBeGreaterThan(revoke);
    expect(body.match(/grant [^;]* on public\.terms_versions to [^;]*;/g)).toEqual(["grant select on public.terms_versions to service_role;"]);
  });

  it("gives terms_version_at to the service role only: the newest version posted at or before the time", () => {
    expect(functionBlockIn(termsVersionsSql, "terms_version_at")).toBe(
      "create or replace function public.terms_version_at(p_at timestamptz) returns integer\nlanguage sql\nstable\nset search_path = public\nas $$\n  select max(version) from public.terms_versions where posted_at <= p_at",
    );
    const body = withoutComments(termsVersionsSql);
    const revoke = body.indexOf("revoke all on function public.terms_version_at(timestamptz) from public, anon, authenticated;");
    expect(revoke).toBeGreaterThan(0);
    expect(body.indexOf("grant execute on function public.terms_version_at(timestamptz) to service_role;")).toBeGreaterThan(revoke);
  });

  it("shows only version and posted_at through public_terms_versions, select only, as the owner", () => {
    const body = withoutComments(termsVersionsSql);
    expect(body).toContain(
      "create or replace view public.public_terms_versions with (security_invoker = false) as\n  select version, posted_at from public.terms_versions;",
    );
    const revoke = body.indexOf("revoke all on public.public_terms_versions from anon, authenticated, service_role;");
    expect(revoke).toBeGreaterThan(body.indexOf("create or replace view public.public_terms_versions"));
    expect(body.indexOf("grant select on public.public_terms_versions to anon, authenticated, service_role;")).toBeGreaterThan(revoke);
    expect(body.split("\n").at(-1)).toBe("notify pgrst, 'reload schema';");
  });

  it("is probed by anon-negative-test: the table refused, the view readable and closed to writes, the function refused", () => {
    const script = readFileSync(resolve(MIGRATIONS_DIR, "..", "scripts", "anon-negative-test.ts"), "utf8");
    const block = (name: string) => {
      const start = script.indexOf(`const ${name}`);
      return script.slice(start, script.indexOf("];", start));
    };
    expect(block("PRIVATE_TABLES")).toContain('"terms_versions"');
    expect(block("PUBLIC_RELATIONS")).toContain('"public_terms_versions"');
    expect(block("RPC_PROBES")).toContain('["terms_version_at", { p_at: "2000-01-01T00:00:00Z" }]');
    expect(script).toContain('relation: "public_terms_versions(insert)"');
    expect(script).toContain('relation: "public_terms_versions(update)"');
  });
});

// docs/specs/money-logic.md: one waterfall, allocations, supporter numbers, the terms stamp and the
// fees Stripe keeps.
const MONEY_LOGIC_FILE = "20260924200000_money_logic.sql";
const moneyLogicSql = launchFile(MONEY_LOGIC_FILE);
const MONEY_LOGIC_TABLES = ["contribution_allocations", "supporters", "board_test_payments"];
// The public functions that place money through the waterfall.
const PLACES_MONEY = [
  "apply_contribution",
  "credit_held_contributions",
  "reverse_contribution",
  "record_dispute_reinstated",
  "record_adjustment",
  "cancel_card",
  "waterfall_sweep",
];

describe("money-logic migration", () => {
  it("comes straight after the terms-versions files and sets a lock timeout first", () => {
    const names = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
    const at = names.indexOf(MONEY_LOGIC_FILE);
    expect(at).toBeGreaterThan(0);
    expect(names[at - 1]).toBe(TERMS_VERSION_2_FILE);
    expect(withoutComments(moneyLogicSql).split("\n")[0]).toBe(LOCK_TIMEOUT);
  });

  it("drops the nine-argument apply_contribution and the one-argument set_paused before creating their successors", () => {
    const body = withoutComments(moneyLogicSql);
    const dropApply = body.indexOf(`drop function if exists public.apply_contribution(${APPLY_V9_TYPES});`);
    expect(dropApply).toBeGreaterThan(0);
    expect(body.indexOf("create or replace function public.apply_contribution(")).toBeGreaterThan(dropApply);
    expect(functionBlockIn(moneyLogicSql, "apply_contribution")).toContain("  p_payer_key text default null,\n  p_session_created_at timestamptz default null\n) returns jsonb");
    const dropPause = body.indexOf("drop function if exists public.set_paused(boolean);");
    expect(dropPause).toBeGreaterThan(0);
    expect(body.indexOf("create or replace function public.set_paused(p_paused boolean, p_reason text default null) returns void")).toBeGreaterThan(dropPause);
    expect(body).toContain(`grant execute on function public.apply_contribution(${APPLY_V9_TYPES}, timestamptz) to service_role;`);
    expect(body).toContain("grant execute on function public.set_paused(boolean, text) to authenticated, service_role;");
  });

  it("keeps the three new tables behind row level security, select-only for the service role and nothing for anyone else", () => {
    const body = withoutComments(moneyLogicSql);
    const tables = [...MONEY_LOGIC_TABLES].sort().map((t) => `public.${t}`).join(", ");
    for (const table of MONEY_LOGIC_TABLES) expect(body).toContain(`alter table public.${table} enable row level security;`);
    const revoke = body.indexOf(`revoke all on ${tables} from anon, authenticated, service_role;`);
    expect(revoke).toBeGreaterThan(0);
    expect(body.indexOf(`grant select on ${tables} to service_role;`)).toBeGreaterThan(revoke);
    for (const table of MONEY_LOGIC_TABLES) {
      expect(body.match(new RegExp(`grant (insert|update|delete|all)[^;]*public\\.${table}`, "g")), table).toBeNull();
    }
  });

  it("takes the money lock before any row lock, and locks cards before the pool, in every public function that places money", () => {
    for (const name of PLACES_MONEY) {
      const block = functionBlockIn(moneyLogicSql, name);
      const lock = block.indexOf("perform money.money_lock();");
      expect(lock, name).toBeGreaterThan(0);
      const firstRowLock = block.search(/for update|money\.lock_money_cards\(/);
      expect(firstRowLock, name).toBeGreaterThan(lock);
      const cards = block.indexOf("perform money.lock_money_cards(");
      const pool = block.search(/from public\.pool where id = 1 for update/);
      expect(cards, name).toBeGreaterThan(lock);
      expect(pool, name).toBeGreaterThan(cards);
      expect(block, name).not.toMatch(/from public\.cards[^;]*for update/);
    }
    expect(moneyLogicSql).toContain("perform pg_advisory_xact_lock(7240926200000);");
  });

  it("schedules waterfall_sweep every five minutes with pg_cron, only where pg_cron ships", () => {
    expect(moneyLogicSql).toContain(
      "do $$\nbegin\n  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then\n    raise notice 'pg_cron is not available; waterfall_sweep is not scheduled';\n    return;\n  end if;\n  create extension if not exists pg_cron with schema pg_catalog;\n  perform cron.schedule('waterfall-sweep', '*/5 * * * *', 'select public.waterfall_sweep()');\nend $$;",
    );
    expect(withoutComments(moneyLogicSql)).toContain("grant execute on function public.waterfall_sweep() to service_role;");
  });

  it("runs the append-only loop over the three new tables only, and never drops terms_versions' triggers", () => {
    expect(moneyLogicSql).toContain("foreach v_table in array array['contribution_allocations', 'supporters', 'board_test_payments'] loop");
    expect(moneyLogicSql).not.toMatch(/drop trigger if exists terms_versions_/);
  });

  it("keeps its helpers in the money schema, which no API role may use, with only the views' four readers executable", () => {
    const body = withoutComments(moneyLogicSql);
    expect(body).toContain("create schema if not exists money;");
    expect(body).toContain("revoke all on schema money from public, anon, authenticated, service_role;");
    expect(body).not.toMatch(/grant usage on schema money to (anon|authenticated|service_role)/);
    expect(body).toContain("revoke all on all functions in schema money from public, anon, authenticated, service_role;");
    expect(body.match(/grant execute on function money\.[^;]*;/g)).toEqual([
      "grant execute on function money.payment_counts(uuid), money.not_on_card_usd(), money.board_test_usd(), money.funding_order()\n  to anon, authenticated, service_role;",
    ]);
  });

  it("mirrors the dispatcher's runnable() in money.card_takes_money, the one predicate", () => {
    const select = readFileSync(resolve(MIGRATIONS_DIR, "..", "..", "dispatcher", "src", "select.ts"), "utf8");
    expect(select).toContain("export const SESSION_SOURCES: readonly string[] = ['board', 'agent', 'decision'];");
    expect(moneyLogicSql).toContain("    and c.source in ('board', 'agent', 'decision')\n");
    expect(moneyLogicSql).toContain("    and c.director_stance <> 'vetoed'\n    and c.source in ('board', 'agent', 'decision')\n    and c.executor_role_id is not null\n    and not (c.folder = 'platform' and c.lane = 'code' and not coalesce(p_lane_open, false))\n");
    expect(select).toContain("money.card_takes_money in platform/supabase/migrations/20260924200000_money_logic.sql mirrors");
  });

  it("ends by checking the ledger identity, rolling back if it does not hold, then reloads the schema", () => {
    const body = withoutComments(moneyLogicSql);
    const check = body.indexOf("raise exception 'money_logic: the ledger identity does not hold after the migration: %', v_identity;");
    expect(check).toBeGreaterThan(body.indexOf("foreach v_table in array array['contribution_allocations'"));
    expect(body.split("\n").at(-1)).toBe("notify pgrst, 'reload schema';");
  });

  it("is probed by anon-negative-test: the tables refused, the views readable, the functions and the schema refused", () => {
    const script = readFileSync(resolve(MIGRATIONS_DIR, "..", "scripts", "anon-negative-test.ts"), "utf8");
    const block = (name: string) => {
      const start = script.indexOf(`const ${name}`);
      return script.slice(start, script.indexOf("];", start));
    };
    for (const table of MONEY_LOGIC_TABLES) expect(block("PRIVATE_TABLES")).toContain(`"${table}"`);
    for (const view of ["public_money", "public_stopped_cards", "public_card_funding"]) expect(block("PUBLIC_RELATIONS")).toContain(`"${view}"`);
    expect(script).toContain('const STUDIO_COLUMNS_READABLE = "launched_at,paused,platform_lane_open,pause_reason";');
    expect(block("RPC_PROBES")).toContain('["record_stripe_fee", { p_ref: "anon-negative-test", p_stripe_session_id: "", p_fee_usd: 0 }]');
    expect(block("RPC_PROBES")).toContain('["set_paused", { p_paused: false, p_reason: "anon-negative-test" }]');
    expect(block("RPC_PROBES")).toContain('["waterfall_sweep", {}]');
    expect(script).toContain('const MONEY_SCHEMA = "money";');
    expect(script).toContain("await db.schema(MONEY_SCHEMA).rpc(");
  });
});

// docs/specs/agent-system-core.md: approvals, dealing after the cooling window, the board's and the
// roles' controls, the job queue and resume by rule.
const AGENT_SYSTEM_CORE_FILE = "20260924300000_agent_system_core.sql";
const agentSystemCoreSql = launchFile(AGENT_SYSTEM_CORE_FILE);
// Every table, view and function the migration adds that anon must not reach.
const AGENT_SYSTEM_CORE_PRIVATE = ["card_approvals", "jobs", "job_runs", "dispatcher_cards"];
const AGENT_SYSTEM_CORE_FUNCTIONS = [
  "record_card_approval",
  "card_content_hash",
  "card_content_hash_of",
  "card_needs_approval",
  "card_approved",
  "card_money_held",
  "card_ready_problem",
  "card_ceiling_resumed",
  "deal_due_cards",
  "resume_card_by_rule",
  "resume_due_by_rule",
  "enqueue_job_run",
  "claim_job_run",
  "finish_job_run",
  "fail_running_job_runs",
  "set_cooling_window",
  "set_role_pause",
  "set_card_veto",
  "enqueue_manual_job",
  "board_jobs",
  "board_roles",
];

describe("agent-system-core migration", () => {
  it("comes straight after money-logic and sets a lock timeout first", () => {
    const names = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
    const at = names.indexOf(AGENT_SYSTEM_CORE_FILE);
    expect(at).toBeGreaterThan(0);
    expect(names[at - 1]).toBe(MONEY_LOGIC_FILE);
    expect(withoutComments(agentSystemCoreSql).split("\n")[0]).toBe(LOCK_TIMEOUT);
    expect(withoutComments(agentSystemCoreSql).split("\n").at(-1)).toBe("notify pgrst, 'reload schema';");
  });

  it("keeps card_approvals private and append-only: select for the service role, nothing for anon or authenticated, the money tables' guard", () => {
    const body = withoutComments(agentSystemCoreSql);
    expect(body).toContain("alter table public.card_approvals enable row level security;");
    expect(body).toContain("revoke all on public.card_approvals from anon, authenticated, service_role;\ngrant select on public.card_approvals to service_role;");
    expect(body).toContain("create trigger card_approvals_append_only before update or delete on public.card_approvals\n  for each row execute function public.refuse_money_change();");
    expect(body).toContain("create trigger card_approvals_no_truncate before truncate on public.card_approvals\n  for each statement execute function public.refuse_money_change();");
    expect(body).not.toMatch(/grant (insert|update|delete|all)[^;]*public\.card_approvals/);
    expect(body).toContain("revoke all on public.jobs, public.job_runs from anon, authenticated;");
    expect(body).toContain("revoke all on table public.dispatcher_cards from anon, authenticated, service_role;\ngrant select on public.dispatcher_cards to service_role;");
  });

  it("grants card_is_public to anon, which the cards policy calls as the caller, and every other new function to the service role or the board", () => {
    const body = withoutComments(agentSystemCoreSql);
    expect(body).toContain("grant execute on function public.card_is_public(uuid) to anon, authenticated, service_role;");
    expect(body).toContain("create policy cards_public_read on public.cards for select to anon, authenticated using (public.card_is_public(id));");
    expect(body).toContain("create policy cards_board_read on public.cards for select to authenticated using (public.is_board_member());");
    for (const name of AGENT_SYSTEM_CORE_FUNCTIONS) {
      expect(body, name).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon`));
    }
    expect(body).toContain("revoke all on function money.top_up_card(uuid, numeric) from public, anon, authenticated, service_role;");
    expect(body).not.toMatch(/grant execute on function money\./);
  });

  it("adds two conditions to money-logic's predicate and keeps its body otherwise", () => {
    const predicate = (sql: string) => {
      const start = sql.indexOf("create or replace function money.card_takes_money(");
      return sql.slice(start, sql.indexOf("\n$$;", start));
    };
    const before = predicate(moneyLogicSql);
    const after = predicate(agentSystemCoreSql);
    expect(after).toBe(before.replace("not coalesce(p_lane_open, false))", "not coalesce(p_lane_open, false))\n    and not c.board_vetoed\n    and public.card_is_public(c.id)"));
    const select = readFileSync(resolve(MIGRATIONS_DIR, "..", "..", "dispatcher", "src", "select.ts"), "utf8");
    expect(select).toContain("20260924300000_agent_system_core.sql");
    expect(select).toContain("if (card.needs_approval && !card.approved) return false;");
    expect(select).toContain("if (card.board_vetoed) return false;");
  });

  it("keeps record_usage at nine arguments and refuses a studio row with no card", () => {
    const body = functionBlockIn(agentSystemCoreSql, "record_usage");
    expect(body).toContain("  p_billed_to public.ledger_billing default 'studio',\n  p_request_id text default null\n) returns jsonb");
    expect(body).toContain("if p_billed_to = 'studio'::public.ledger_billing and p_card_id is null then\n    raise exception 'A studio row names a card';");
    expect(withoutComments(agentSystemCoreSql)).toContain(`grant execute on function public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing, text) to service_role;`);
  });

  it("is probed by anon-negative-test: the new tables and views refused, every new function refused but card_is_public, which is callable", () => {
    const script = readFileSync(resolve(MIGRATIONS_DIR, "..", "scripts", "anon-negative-test.ts"), "utf8");
    const block = (name: string) => {
      const start = script.indexOf(`const ${name}`);
      return script.slice(start, script.indexOf("];", start));
    };
    for (const relation of AGENT_SYSTEM_CORE_PRIVATE) expect(block("PRIVATE_TABLES")).toContain(`"${relation}"`);
    for (const name of AGENT_SYSTEM_CORE_FUNCTIONS) expect(block("RPC_PROBES")).toContain(`["${name}",`);
    expect(block("RPC_PROBES")).not.toContain('"card_is_public"');
    expect(script).toContain('const CALLABLE_RPCS: Array<[string, Record<string, unknown>]> = [["card_is_public", { p_card: NO_CARD }]];');
    expect(script).toContain('const PUBLIC_ROLE_CLASS_COLUMNS = "agent_class,paused,paused_reason";');
    expect(script).toContain('relation: "cards(agent-written without an approval)"');
  });
});
