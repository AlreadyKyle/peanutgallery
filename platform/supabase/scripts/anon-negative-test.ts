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
  "card_approvals",
  "jobs",
  "job_runs",
  "dispatcher_cards",
  "dispatcher_card_spend",
  "card_drafts",
  // studio-reports (docs/specs/studio-reports.md): the weekly reports, read only through
  // site_reports(), and the dispatcher's Discord outbox.
  "studio_reports",
  "outbound_posts",
  // agent-upkeep (docs/specs/agent-upkeep.md): the Janitor's findings, read only by a board member.
  "findings",
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
  // supporter-pages (docs/specs/supporter-pages.md): each card's supporter numbers and each role's
  // studio-billed spend and ships.
  "public_card_supporters",
  "public_role_stats",
];

// cards is granted column by column (docs/specs/card-columns-and-open-funding.md).
// The site's columns, horizon and rank included, are readable. actual_usd,
// severity, priority and design-review's review_rounds are withheld, and so is
// select=*, which names them;
// each must be refused with Postgres's permission error, 42501, not some other
// failure.
const CARD_COLUMNS_READABLE = "id,title,stage,funded_usd,live_at,horizon,rank,opens_at,board_vetoed,drafter_role_id";
const CARD_COLUMNS_WITHHELD = ["actual_usd", "severity", "priority", "review_rounds", "*"];
const PERMISSION_DENIED = "42501";

// public_studio shows whether the studio is paused, why (docs/specs/money-logic.md)
// and whether the platform code lane is open (docs/specs/board-site.md), and never
// who paused it or when; those columns are not in the view at all (42703).
const STUDIO_COLUMNS_READABLE = "launched_at,paused,platform_lane_open,pause_reason";
const STUDIO_COLUMNS_ABSENT = ["paused_by", "paused_at"];
const UNDEFINED_COLUMN = "42703";

const PUBLIC_ROLE_COLUMNS = "id,name,title,description,species_note,avatar_url,model,write_access,state,hired_at";
// Each role's trust class and pause (docs/specs/agent-system-core.md).
const PUBLIC_ROLE_CLASS_COLUMNS = "agent_class,paused,paused_reason";

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
  // agent-system-core (docs/specs/agent-system-core.md): approvals, dealing, resume by rule, the
  // board's controls and the job queue. Each is refused before it reads its arguments; the
  // arguments name nothing (no card, no role, no job, a holder that holds nothing, no reason).
  ["record_card_approval", { p_card: NO_CARD, p_kind: "draft", p_verdict: {}, p_approver_role: NO_CARD, p_maker_role: null, p_maker_ref: null, p_grader_ref: "", p_content_sha256: "", p_job_run: null }],
  ["card_content_hash", { p_card: NO_CARD }],
  ["card_content_hash_of", { c: {} }],
  ["card_needs_approval", { p_source: "board", p_drafter: null }],
  ["card_approved", { p_card: NO_CARD }],
  ["card_money_held", { p_card: NO_CARD }],
  ["card_ready_problem", { c: {} }],
  ["card_ceiling_resumed", { p_card: NO_CARD }],
  ["deal_due_cards", {}],
  ["resume_card_by_rule", { p_card: NO_CARD }],
  ["resume_due_by_rule", {}],
  ["enqueue_job_run", { p_job: "anon_negative_test", p_origin: "operator" }],
  ["claim_job_run", { p_run: NO_CARD, p_holder: "anon-negative-test" }],
  ["finish_job_run", { p_run: NO_CARD, p_status: "skipped", p_reason: "anon-negative-test", p_output: null }],
  ["fail_running_job_runs", { p_holder: "anon-negative-test", p_reason: "anon-negative-test" }],
  ["set_cooling_window", { p_minutes: -1, p_reason: null }],
  ["set_role_pause", { p_role: NO_CARD, p_paused: true, p_reason: null }],
  ["set_card_veto", { p_card: NO_CARD, p_vetoed: true, p_reason: null }],
  ["enqueue_manual_job", { p_job: "anon_negative_test", p_card: null, p_reason: null, p_input: {} }],
  ["board_jobs", {}],
  ["board_roles", {}],
  // agent-workflows (docs/specs/agent-workflows.md): drafts and the ranking, the service role's
  // alone. Each names no draft, no role and no run, and records nothing.
  ["card_from_draft", { p_fields: {}, p_role: null }],
  ["record_card_draft", { p_run: null, p_role: null, p_fields: {}, p_maker_ref: "" }],
  ["approve_card_draft", { p_draft: NO_CARD, p_approver_role: NO_CARD, p_grader_ref: "", p_verdict: {} }],
  ["withdraw_card_draft", { p_draft: NO_CARD, p_reason_codes: [] }],
  ["card_rank_problem", { c: {} }],
  ["rankable_cards", {}],
  ["card_ranking_places", { p_order: [] }],
  ["apply_card_ranking", { p_run: NO_CARD, p_order: [] }],
  // studio-reports: the hourly publish, pg_cron's alone, with a Tuesday it refuses before it reads
  // anything; and the board's supply count, which only reads.
  ["publish_weekly_report", { p_week_start: "2000-01-04" }],
  ["card_supply", {}],
  // design-review (docs/specs/design-review.md): the visual review's round count, the service
  // role's alone; the card named does not exist, so even a wrong grant counts nothing.
  ["record_review_round", { p_card: NO_CARD }],
  // agent-upkeep (docs/specs/agent-upkeep.md): the Janitor's four functions, the service role's
  // alone. record_finding refuses the kind named and close_finding names no finding, so even a wrong
  // grant writes nothing; the other two only read.
  ["record_finding", { p_fingerprint: "anon-probe", p_kind: "not-a-kind", p_subject: "anon-probe", p_detail: {} }],
  ["close_finding", { p_fingerprint: "anon-probe:no-such-finding" }],
  ["schema_fingerprint", {}],
  ["producer_signals", {}],
];

// The one function anon runs on purpose: the cards policy calls it as the caller
// (docs/specs/agent-system-core.md). It only reads and answers false for no card.
const CALLABLE_RPCS: Array<[string, Record<string, unknown>]> = [["card_is_public", { p_card: NO_CARD }]];

// The public site's two documents (docs/specs/site-snapshot.md): security invoker functions anon
// calls on purpose, each answering one JSON object with these top-level keys. They only read, as
// anon, so they return nothing anon could not already read.
const SNAPSHOT_RPCS: Array<[string, string[]]> = [
  ["site_live", ["built_at", "cards", "deploys", "events", "money", "pool", "role_stats", "stopped", "studio", "totals"]],
  ["site_cards", ["cards", "roles", "terms"]],
  // studio-reports: /reports' document, published weekly reports only (docs/specs/studio-reports.md).
  ["site_reports", ["reports"]],
];

// supporter-pages (docs/specs/supporter-pages.md): a card's own document, null for a card that does
// not exist, and the /thanks answer, which for a session that is not a real one is exactly
// {"status":"pending"}. Both only read; thanks_for_session is the one security definer function
// anon calls, and its answer for a made-up session names nothing.
const CARD_DOCUMENT_KEYS = ["card", "funding", "line_count", "lines", "milestones", "roles", "spent_usd", "stopped", "supporter_count", "supporters"];
const SUPPORTER_COLUMNS = "card_id,supporter_number,founding";
const ROLE_STATS_COLUMNS = "role_id,spent_usd,spent_7d_usd,shipped_cards";
const FAKE_SESSION = "cs_test_anonnegativetest0000";

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
    relation: `public_roles(${PUBLIC_ROLE_CLASS_COLUMNS})`,
    expected: "readable",
    ...(await probe(db, "public_roles", PUBLIC_ROLE_CLASS_COLUMNS)),
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

  for (const [name, rpcArgs] of CALLABLE_RPCS) {
    const { data, error } = await db.rpc(name, rpcArgs);
    outcomes.push({
      relation: `rpc ${name} (intentionally callable)`,
      expected: "readable",
      actual: error ? "error" : data === false ? "readable" : "error",
      detail: error ? `${error.code ?? "error"} ${error.message}` : `answered ${JSON.stringify(data)}`,
    });
  }

  for (const [name, keys] of SNAPSHOT_RPCS) {
    const { data, error } = await db.rpc(name, {});
    const present = typeof data === "object" && data !== null && !Array.isArray(data) ? Object.keys(data as object) : [];
    const lacking = keys.filter((key) => !present.includes(key));
    outcomes.push({
      relation: `rpc ${name} (the site's document)`,
      expected: "readable",
      actual: error ? "error" : lacking.length === 0 ? "readable" : "error",
      detail: error ? `${error.code ?? "error"} ${error.message}` : lacking.length === 0 ? `keys ${keys.join(",")}` : `missing ${lacking.join(",")}`,
    });
  }

  // supporter-pages: the two new views' columns, site_card for no card and for a public live card,
  // and thanks_for_session for a made-up and a malformed session.
  outcomes.push({ relation: `public_card_supporters(${SUPPORTER_COLUMNS})`, expected: "readable", ...(await probe(db, "public_card_supporters", SUPPORTER_COLUMNS)) });
  outcomes.push({ relation: `public_role_stats(${ROLE_STATS_COLUMNS})`, expected: "readable", ...(await probe(db, "public_role_stats", ROLE_STATS_COLUMNS)) });
  {
    const { data, error } = await db.rpc("site_card", { p_id: NO_CARD });
    outcomes.push({
      relation: "rpc site_card (no card)",
      expected: "readable",
      actual: error ? "error" : data === null ? "readable" : "error",
      detail: error ? `${error.code ?? "error"} ${error.message}` : `answered ${JSON.stringify(data)}`,
    });
  }
  {
    const live = await db.from("cards").select("id").eq("stage", "live").order("live_at", { ascending: false }).limit(1);
    const id = (live.data?.[0] as { id?: string } | undefined)?.id;
    if (live.error || id === undefined) {
      outcomes.push({ relation: "rpc site_card (a live card)", expected: "readable", actual: "error", detail: live.error ? `${live.error.code ?? "error"} ${live.error.message}` : "no live card to read" });
    } else {
      const { data, error } = await db.rpc("site_card", { p_id: id });
      const keys = typeof data === "object" && data !== null ? Object.keys(data as object).sort() : [];
      const same = JSON.stringify(keys) === JSON.stringify(CARD_DOCUMENT_KEYS);
      outcomes.push({
        relation: "rpc site_card (a live card)",
        expected: "readable",
        actual: error ? "error" : same ? "readable" : "error",
        detail: error ? `${error.code ?? "error"} ${error.message}` : same ? `keys ${keys.join(",")}` : `keys ${keys.join(",")}`,
      });
    }
  }
  for (const session of [FAKE_SESSION, "not-a-session"]) {
    const { data, error } = await db.rpc("thanks_for_session", { p_session: session });
    const exact = JSON.stringify(data) === '{"status":"pending"}';
    outcomes.push({
      relation: `rpc thanks_for_session (${session === FAKE_SESSION ? "unknown" : "malformed"})`,
      expected: "readable",
      actual: error ? "error" : exact ? "readable" : "error",
      detail: error ? `${error.code ?? "error"} ${error.message}` : `answered ${JSON.stringify(data)}`,
    });
  }

  // No card anon can read lacks an approval it needs: every agent-written card it sees is public.
  {
    const { data, error } = await db.from("cards").select("id").or("source.eq.agent,drafter_role_id.not.is.null");
    let lacking = 0;
    let detail = error ? `${error.code ?? "error"} ${error.message}` : `${data.length} agent-written card(s) readable`;
    if (!error) {
      for (const card of data as { id: string }[]) {
        const answer = await db.rpc("card_is_public", { p_card: card.id });
        if (answer.error || answer.data !== true) lacking += 1;
      }
      if (lacking > 0) detail = `${lacking} readable agent-written card(s) lack a current approval`;
    }
    outcomes.push({
      relation: "cards(agent-written without an approval)",
      expected: "empty",
      actual: error ? "error" : lacking === 0 ? "empty" : "readable",
      detail,
    });
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
