// Checks the anon key's view of the schema against the RLS contract.
//   pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts
//   pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts --before-roles-revoke
// First output line is PASS: or FAIL:; exit 0 on pass, 1 on fail.
//
// roles closes to anon with 20260922000500_roles_revoke.sql, which production
// applies only after the site reads public_roles. Between 20260922000400 and
// that file, run with --before-roles-revoke: roles is then expected readable.
// Without the flag roles is expected refused.
//
// Nothing here writes. The RPC probes call board and service functions with
// arguments each function itself refuses, so even a wrong grant changes
// nothing; the expected answer is Postgres's permission error, 42501.

import type { SupabaseClient } from "@supabase/supabase-js";
import { anonClient, loadRepoEnv } from "../lib/client.js";

const PRIVATE_TABLES = [
  "contributions",
  "board_notes",
  "agent_events",
  "studio_state",
  "votes",
  "scores",
  "images",
  "decisions",
  "standing_costs",
  "stream_state",
  "board_members",
  "board_actions",
  "credit_purchases",
  "dispatcher_lease",
  "card_patches",
  "controller_runs",
  "terms_versions",
  "contribution_allocations",
  "supporters",
  "board_test_payments",
];

const PUBLIC_RELATIONS = [
  "pool",
  "ledger",
  "deploys",
  "last_green",
  "public_agent_events",
  "public_ledger_totals",
  "public_studio",
  "public_card_funding",
  "public_card_spend",
  "public_roles",
  "public_terms_versions",
  "public_money",
  "public_stopped_cards",
];

// cards is granted column by column (docs/specs/card-columns-and-open-funding.md).
// The site's columns, horizon and rank included, are readable. actual_usd,
// severity and priority are withheld, and so is select=*, which names them;
// each must be refused with Postgres's permission error, 42501, not some other
// failure.
const CARD_COLUMNS_READABLE = "id,title,stage,funded_usd,live_at,horizon,rank";
const CARD_COLUMNS_WITHHELD = ["actual_usd", "severity", "priority", "*"];
const PERMISSION_DENIED = "42501";

// public_studio shows whether the studio is paused, why (docs/specs/money-logic.md)
// and whether the platform code lane is open (docs/specs/board-site.md), and never
// who paused it or when; those columns are not in the view at all (42703).
const STUDIO_COLUMNS_READABLE = "launched_at,paused,platform_lane_open,pause_reason";
const STUDIO_COLUMNS_ABSENT = ["paused_by", "paused_at"];
const UNDEFINED_COLUMN = "42703";

const PUBLIC_ROLE_COLUMNS = "id,name,title,description,species_note,avatar_url,model,write_access,state,hired_at";

// Each call is refused by the function itself if the grant is wrong: a holder
// that holds nothing, a ttl of 0, no reason, a card id that does not exist, a
// dispute id that is not one. terms_version_at only reads, and a time before
// every version answers null. The three money-safety readers take no argument
// and write nothing (docs/specs/money-safety.md); a wrong grant would only let
// the call run, which this reports without printing what it returned. The
// money-logic calls (docs/specs/money-logic.md): record_stripe_fee with a
// reference that is not a balance transaction; set_paused's two-argument form
// from a caller who is no board member; waterfall_sweep, which takes no
// argument and would only do what pg_cron does every five minutes.
const NO_CARD = "00000000-0000-4000-8000-000000000000";
const RPC_PROBES: Array<[string, Record<string, unknown>]> = [
  ["claim_dispatcher_lease", { p_holder: "anon-negative-test", p_ttl_seconds: 0 }],
  ["release_dispatcher_lease", { p_holder: "anon-negative-test" }],
  ["set_caps", {}],
  ["board_needs_you", {}],
  ["record_credit_purchase", { p_amount_usd: 0 }],
  ["set_card_horizon", { p_card: NO_CARD, p_horizon: "later", p_rank: null, p_reason: null }],
  ["cancel_card", { p_card: NO_CARD, p_reason: null }],
  ["resume_card", { p_card: NO_CARD, p_estimate_usd: 0, p_reason: null }],
  ["ledger_identity", {}],
  ["controller_figures", {}],
  ["ops_database_size", {}],
  ["record_dispute_reinstated", { p_dispute_id: "anon-negative-test", p_stripe_session_id: "", p_amount_usd: 0 }],
  ["record_adjustment", { p_parent_id: NO_CARD, p_net_usd: 0, p_studio_usd: 0, p_agents_usd: 0, p_reserve_usd: 0, p_reason: null }],
  ["redact_contribution_name", { p_contribution_id: NO_CARD, p_reason: null }],
  ["terms_version_at", { p_at: "2000-01-01T00:00:00Z" }],
  ["record_stripe_fee", { p_ref: "anon-negative-test", p_stripe_session_id: "", p_fee_usd: 0 }],
  ["set_paused", { p_paused: false, p_reason: "anon-negative-test" }],
  ["waterfall_sweep", {}],
];

// The money schema holds the waterfall's helpers and is not exposed: PostgREST refuses any request
// that names it (PGRST106) before a function is looked up.
const MONEY_SCHEMA = "money";
const SCHEMA_NOT_EXPOSED = "PGRST106";

type Actual = "refused" | "readable" | "empty" | "error";

interface Outcome {
  relation: string;
  expected: "refused" | "readable" | "empty";
  actual: Actual;
  detail: string;
}

async function probe(
  db: SupabaseClient,
  relation: string,
  columns = "*",
  refusalCode?: string,
): Promise<{ actual: Actual; detail: string }> {
  const { data, error } = await db.from(relation).select(columns).limit(1);
  if (error) {
    const refused = refusalCode === undefined || error.code === refusalCode;
    return { actual: refused ? "refused" : "error", detail: `${error.code ?? "error"} ${error.message}` };
  }
  return { actual: "readable", detail: `${data.length} row(s) returned` };
}

/** An RPC anon must not run: refused only with 42501. */
async function probeRpc(db: SupabaseClient, name: string, args: Record<string, unknown>): Promise<{ actual: Actual; detail: string }> {
  const { error } = await db.rpc(name, args);
  if (!error) return { actual: "readable", detail: "the call ran" };
  return { actual: error.code === PERMISSION_DENIED ? "refused" : "error", detail: `${error.code ?? "error"} ${error.message}` };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const unknown = args.filter((arg) => arg !== "--before-roles-revoke");
  if (unknown.length > 0) {
    console.log(`FAIL: unknown argument ${unknown.join(" ")}; the only option is --before-roles-revoke`);
    process.exit(2);
  }
  const rolesOpen = args.includes("--before-roles-revoke");
  const env = loadRepoEnv();
  const db = anonClient(env);
  const outcomes: Outcome[] = [];

  for (const relation of rolesOpen ? PRIVATE_TABLES : [...PRIVATE_TABLES, "roles"]) {
    outcomes.push({ relation, expected: "refused", ...(await probe(db, relation)) });
  }
  for (const relation of rolesOpen ? [...PUBLIC_RELATIONS, "roles"] : PUBLIC_RELATIONS) {
    outcomes.push({ relation, expected: "readable", ...(await probe(db, relation)) });
  }
  outcomes.push({
    relation: `cards(${CARD_COLUMNS_READABLE})`,
    expected: "readable",
    ...(await probe(db, "cards", CARD_COLUMNS_READABLE)),
  });
  for (const column of CARD_COLUMNS_WITHHELD) {
    outcomes.push({
      relation: `cards(${column})`,
      expected: "refused",
      ...(await probe(db, "cards", column, PERMISSION_DENIED)),
    });
  }
  outcomes.push({
    relation: `public_studio(${STUDIO_COLUMNS_READABLE})`,
    expected: "readable",
    ...(await probe(db, "public_studio", STUDIO_COLUMNS_READABLE)),
  });
  for (const column of STUDIO_COLUMNS_ABSENT) {
    outcomes.push({
      relation: `public_studio(${column})`,
      expected: "refused",
      ...(await probe(db, "public_studio", column, UNDEFINED_COLUMN)),
    });
  }
  outcomes.push({
    relation: "public_roles(site columns)",
    expected: "readable",
    ...(await probe(db, "public_roles", PUBLIC_ROLE_COLUMNS)),
  });
  outcomes.push({
    relation: "public_ledger_totals(overhead_usd)",
    expected: "readable",
    ...(await probe(db, "public_ledger_totals", "usd_total,overhead_usd")),
  });

  // Founder-billed rows stay private: the ledger shows anon studio and overhead rows only.
  {
    const { data, error } = await db.from("ledger").select("id").eq("billed_to", "founder").limit(1);
    outcomes.push({
      relation: "ledger(billed_to=founder)",
      expected: "empty",
      actual: error ? "error" : data.length === 0 ? "empty" : "readable",
      detail: error ? `${error.code ?? "error"} ${error.message}` : `${data.length} row(s) returned`,
    });
  }

  // public_roles is a simple view; a write through it must be refused. The filter matches no row.
  {
    const { error } = await db.from("public_roles").update({ model: "anon-negative-test" }).eq("id", NO_CARD);
    outcomes.push({
      relation: "public_roles(update)",
      expected: "refused",
      actual: error ? (error.code === PERMISSION_DENIED ? "refused" : "error") : "readable",
      detail: error ? `${error.code ?? "error"} ${error.message}` : "the update ran",
    });
  }

  // public_terms_versions is a simple view over terms_versions, whose rows are the posted Terms
  // versions (docs/specs/legal-copy.md); a write through it must be refused. The insert names
  // version 0 and the update matches no row, so even a wrong grant posts and changes nothing: the
  // table's check refuses version 0, and that answer is not 42501, so it would show as a failure.
  {
    const { error } = await db.from("public_terms_versions").insert({ version: 0 });
    outcomes.push({
      relation: "public_terms_versions(insert)",
      expected: "refused",
      actual: error ? (error.code === PERMISSION_DENIED ? "refused" : "error") : "readable",
      detail: error ? `${error.code ?? "error"} ${error.message}` : "the insert ran",
    });
  }
  {
    const { error } = await db.from("public_terms_versions").update({ posted_at: "2000-01-01T00:00:00Z" }).eq("version", 0);
    outcomes.push({
      relation: "public_terms_versions(update)",
      expected: "refused",
      actual: error ? (error.code === PERMISSION_DENIED ? "refused" : "error") : "readable",
      detail: error ? `${error.code ?? "error"} ${error.message}` : "the update ran",
    });
  }

  for (const [name, rpcArgs] of RPC_PROBES) {
    outcomes.push({ relation: `rpc ${name}`, expected: "refused", ...(await probeRpc(db, name, rpcArgs)) });
  }

  // Content-Profile: money. board_test_usd only reads, so even an exposed schema would change nothing.
  {
    const { error } = await db.schema(MONEY_SCHEMA).rpc("board_test_usd", {});
    outcomes.push({
      relation: `schema ${MONEY_SCHEMA}`,
      expected: "refused",
      actual: error ? (error.code === SCHEMA_NOT_EXPOSED || error.code === PERMISSION_DENIED ? "refused" : "error") : "readable",
      detail: error ? `${error.code ?? "error"} ${error.message}` : "the call ran",
    });
  }

  const failures = outcomes.filter((o) => o.expected !== o.actual);
  console.log(failures.length === 0 ? "PASS: anon access matches the RLS contract" : `FAIL: ${failures.length} relation(s) differ from the RLS contract`);
  console.log(`roles expected ${rolesOpen ? "readable (before 20260922000500)" : "refused (20260922000500 applied)"}`);
  const width = Math.max(22, ...outcomes.map((o) => o.relation.length));
  for (const o of outcomes) {
    const mark = o.expected === o.actual ? "ok  " : "FAIL";
    console.log(`${mark} ${o.relation.padEnd(width)} expected ${o.expected.padEnd(8)} actual ${o.actual.padEnd(8)} ${o.detail}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.log(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
