// Files the first Next cards (docs/specs/next-cards.md, lib/next-cards.ts)
// into the cards table. Dry run by default; --apply inserts.
//   pnpm --filter @backseat/supabase file-next-cards
//   pnpm --filter @backseat/supabase file-next-cards -- --apply
// board_role() is null under the service role, so the script cannot call
// file_card. It applies the same refusals and inserts the same field set. A
// title that already exists as a goal card in any stage other than rejected or
// paused is skipped, so the script can run more than once. Before anything is
// inserted, each card's check: lines run against the repository's seed-1 files
// with the dispatcher's pre-check; a card the dispatcher would reject is
// reported and never inserted, and the other cards proceed.

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRepoEnv, REPO_ROOT, serviceClient } from "../lib/client.js";
import { NEXT_CARDS, type NextCard } from "../lib/next-cards.js";
import { preCheckRejection, type PreCheckRejection } from "../lib/pre-check.js";

/** The line rule file_card applies to a config-lane acceptance test. */
const CHECK_LINE = /(^|\n)\s*check:\s/;
/** A goal card in one of these stages is superseded; any other stage counts as present. */
const SUPERSEDED_STAGES = "(rejected,paused)";

type Result<T> = { data: T; error: null } | { data: null; error: { message: string } };

class UsageError extends Error {}

function check<T>(label: string, result: Result<T>): T {
  if (result.error !== null) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.data;
}

function parseArgs(argv: string[]): { apply: boolean } {
  let apply = false;
  for (const arg of argv) {
    // pnpm passes the "--" separator through to the script.
    if (arg === "--") continue;
    if (arg === "--apply") {
      apply = true;
    } else {
      throw new UsageError(`Unknown argument ${arg}; the only option is --apply`);
    }
  }
  return { apply };
}

interface RoleRow {
  id: string;
  name: string;
  state: string;
}

/** roles.name to roles.id for every executor the cards name; each must exist and be active. */
async function readExecutors(db: SupabaseClient): Promise<Map<string, string>> {
  const names = [...new Set(NEXT_CARDS.map((c) => c.executor_role_name))];
  const roles = check("roles read", await db.from("roles").select("id, name, state").in("name", names).returns<RoleRow[]>());
  const ids = new Map<string, string>();
  for (const name of names) {
    const role = roles.find((r) => r.name === name);
    if (!role) {
      throw new Error(`role "${name}" is not in roles; run the seed first`);
    }
    if (role.state !== "active") {
      throw new Error(`role "${name}" is ${role.state}; the executor must be an active role`);
    }
    ids.set(name, role.id);
  }
  return ids;
}

async function readCardMax(db: SupabaseClient): Promise<number> {
  const state = check(
    "studio_state read",
    await db.from("studio_state").select("card_max_usd").eq("id", 1).single<{ card_max_usd: string | number }>(),
  );
  return Number(state.card_max_usd);
}

/** The refusals of file_card, in its order, so a dry run reports them before anything is inserted. */
function refusal(card: NextCard, cardMax: number): string | null {
  if (card.title.trim() === "") return "A title is required";
  if (card.stage !== "proposed" && card.stage !== "voted") return "A Next card starts at proposed or voted";
  if (!(card.funding_target_usd > 0)) return "The funding target must be above zero";
  if (card.funding_target_usd > cardMax) return `The funding target must not exceed the per-card maximum of ${cardMax.toFixed(4)}`;
  if (card.lane === "config" && card.folder !== "seed-1") return "The config lane exists only for seed-1";
  if (card.lane === "config" && !CHECK_LINE.test(card.acceptance_test)) return "A config-lane card needs a check: line in its acceptance test";
  return null;
}

/** The row file_card inserts, with the executor resolved. */
function cardRow(card: NextCard, executorRoleId: string) {
  return {
    bucket: card.bucket,
    source: card.source,
    shape: card.shape,
    lane: card.lane,
    priority: card.priority,
    board_reason: null,
    folder: card.folder,
    executor_role_id: executorRoleId,
    title: card.title.trim(),
    intent: card.intent,
    acceptance_test: card.acceptance_test,
    funding_target_usd: card.funding_target_usd,
    funded_usd: 0,
    estimate_usd: card.funding_target_usd,
    confidence: card.confidence,
    proposer_role_id: null,
    stage: card.stage,
  };
}

async function presentCard(db: SupabaseClient, title: string): Promise<{ id: string; stage: string } | null> {
  const found = check(
    "cards read",
    await db
      .from("cards")
      .select("id, stage")
      .eq("shape", "goal")
      .eq("title", title)
      .not("stage", "in", SUPERSEDED_STAGES)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<{ id: string; stage: string }[]>(),
  );
  return found[0] ?? null;
}

function describe(card: NextCard): string {
  return `${card.stage}, ${card.lane}, target ${card.funding_target_usd.toFixed(2)}, executor ${card.executor_role_name}`;
}

async function main(): Promise<void> {
  const { apply } = parseArgs(process.argv.slice(2));
  const env = loadRepoEnv();
  const db = serviceClient(env);
  const mode = apply ? "apply" : "dry run";

  const executors = await readExecutors(db);
  const cardMax = await readCardMax(db);
  console.log(`${mode}: ${NEXT_CARDS.length} Next cards, per-card maximum ${cardMax.toFixed(4)}`);

  const refused = NEXT_CARDS.map((card) => ({ card, why: refusal(card, cardMax) })).filter((r) => r.why !== null);
  for (const r of refused) {
    console.log(`refused "${r.card.title}": ${r.why}`);
  }
  if (refused.length > 0) {
    throw new Error(`${refused.length} card(s) would be refused by file_card; nothing inserted`);
  }

  const rejected = new Map<string, PreCheckRejection>();
  for (const card of NEXT_CARDS) {
    const rejection = await preCheckRejection(card.acceptance_test, REPO_ROOT);
    if (rejection) {
      rejected.set(card.title, rejection);
      console.log(`pre-check rejects "${card.title}": ${rejection.failingCheck} (${rejection.detail}); not filed`);
    } else {
      console.log(`pre-check passes "${card.title}"`);
    }
  }

  let inserted = 0;
  let wouldInsert = 0;
  let skipped = 0;
  for (const card of NEXT_CARDS) {
    if (rejected.has(card.title)) {
      continue;
    }
    const present = await presentCard(db, card.title);
    if (present) {
      console.log(`skip "${card.title}": ${present.id} is at stage ${present.stage}`);
      skipped += 1;
      continue;
    }
    const executorRoleId = executors.get(card.executor_role_name);
    if (!executorRoleId) {
      throw new Error(`no role id for "${card.executor_role_name}"`);
    }
    const row = cardRow(card, executorRoleId);
    if (!apply) {
      console.log(`would insert "${row.title}" (${describe(card)})`);
      wouldInsert += 1;
      continue;
    }
    const result = check("cards insert", await db.from("cards").insert(row).select("id").single<{ id: string }>());
    console.log(`inserted ${result.id} "${row.title}" (${describe(card)})`);
    inserted += 1;
  }

  if (apply) {
    console.log(`done: ${inserted} inserted, ${skipped} skipped, ${rejected.size} rejected by the pre-check`);
  } else {
    console.log(
      `dry run: ${wouldInsert} would be inserted, ${skipped} skipped, ${rejected.size} rejected by the pre-check; pass --apply to insert`,
    );
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`file-next-cards failed: ${message}`);
  process.exit(err instanceof UsageError ? 2 : 1);
});
