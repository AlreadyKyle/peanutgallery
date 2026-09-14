import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MIGRATION = resolve(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "20260914000000_week1_schema.sql");
const sql = readFileSync(MIGRATION, "utf8");

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

/** The body of one `create or replace function public.<name>` block. */
function functionBlock(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `function ${name}`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("\n$$;", start);
  expect(end, `end of function ${name}`).toBeGreaterThan(start);
  return sql.slice(start, end);
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
