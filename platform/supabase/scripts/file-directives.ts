// Files the first board directives (docs/specs/week1-runs.md, lib/directives.ts)
// into the cards table. Dry run by default; --apply inserts.
//   pnpm --filter @backseat/supabase file-directives
//   pnpm --filter @backseat/supabase file-directives --apply
// board_role() is null under the service role, so the script cannot call
// file_directive. It inserts the same field set (source board, shape oneoff,
// priority 0, stage funded) plus the public summary, in D1, D2, D3 order so the
// dispatcher builds them in that order. A title already filed at priority 0 in
// any stage other than rejected or paused is skipped, so the script can run
// more than once. Each directive's check: lines run first against the
// repository's seed-1 files with the dispatcher's pre-check; a directive the
// dispatcher would reject is never inserted. Filing D2 deletes the open Next
// card it replaces, only while that card has no money and no contribution
// names it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRepoEnv, REPO_ROOT, serviceClient } from "../lib/client.js";
import { type Directive, DIRECTIVES, REPLACED_NEXT_CARD_TITLE } from "../lib/directives.js";
import { preCheckRejection } from "../lib/pre-check.js";

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
    if (arg === "--") continue;
    if (arg === "--apply") {
      apply = true;
    } else {
      throw new UsageError(`Unknown argument ${arg}; the only option is --apply`);
    }
  }
  return { apply };
}

/** The refusals a directive must pass before it is filed; null when it passes. */
function refusal(d: Directive, cardMax: number): string | null {
  if (d.title.trim() === "") return "A title is required";
  if (d.summary.trim() === "" || d.summary.length > 200) return "The public summary must be 1 to 200 characters";
  if (d.board_reason.trim() === "") return "A directive needs its one-line reason";
  if (!(d.estimate_usd > 0)) return "The estimate must be above zero";
  if (d.estimate_usd > cardMax) return `The estimate must not exceed the per-card maximum of ${cardMax.toFixed(4)}`;
  return null;
}

async function executorIds(db: SupabaseClient): Promise<Map<string, string>> {
  const names = [...new Set(DIRECTIVES.map((d) => d.executor_role_name))];
  const roles = check(
    "roles read",
    await db.from("roles").select("id, name, state, write_access").in("name", names)
      .returns<{ id: string; name: string; state: string; write_access: boolean }[]>(),
  );
  const ids = new Map<string, string>();
  for (const name of names) {
    const role = roles.find((r) => r.name === name);
    if (!role) throw new Error(`role "${name}" is not in roles; run the seed first`);
    if (role.state !== "active" || !role.write_access) throw new Error(`role "${name}" must be active with write access`);
    ids.set(name, role.id);
  }
  return ids;
}

async function filed(db: SupabaseClient, title: string): Promise<{ id: string; stage: string } | null> {
  const rows = check(
    "cards read",
    await db.from("cards").select("id, stage").eq("priority", 0).eq("title", title)
      .not("stage", "in", SUPERSEDED_STAGES).order("created_at", { ascending: false }).limit(1)
      .returns<{ id: string; stage: string }[]>(),
  );
  return rows[0] ?? null;
}

/** Deletes the Next card D2 replaces, only while it holds no money and no contribution names it. */
async function retireReplacedCard(db: SupabaseClient, apply: boolean): Promise<void> {
  const cards = check(
    "replaced card read",
    await db.from("cards").select("id, stage, funded_usd").eq("shape", "goal").eq("title", REPLACED_NEXT_CARD_TITLE)
      .returns<{ id: string; stage: string; funded_usd: string | number }[]>(),
  );
  if (cards.length === 0) {
    console.log(`replaced Next card "${REPLACED_NEXT_CARD_TITLE}": already gone`);
    return;
  }
  for (const card of cards) {
    const { count, error } = await db.from("contributions").select("id", { count: "exact", head: true }).eq("goal_card_id", card.id);
    if (error) throw new Error(`contributions read: ${error.message}`);
    if (card.stage !== "proposed" || Number(card.funded_usd) !== 0 || (count ?? 0) > 0) {
      console.log(`keep ${card.id}: stage ${card.stage}, funded ${card.funded_usd}, ${count ?? 0} contribution(s); retire it by hand`);
      continue;
    }
    if (!apply) {
      console.log(`would delete Next card ${card.id} "${REPLACED_NEXT_CARD_TITLE}"`);
      continue;
    }
    const deleted = check(
      "replaced card delete",
      await db.from("cards").delete().eq("id", card.id).eq("stage", "proposed").eq("funded_usd", 0).select("id")
        .returns<{ id: string }[]>(),
    );
    console.log(`deleted Next card ${deleted.map((d) => d.id).join(", ")} "${REPLACED_NEXT_CARD_TITLE}"`);
  }
}

async function main(): Promise<void> {
  const { apply } = parseArgs(process.argv.slice(2));
  const db = serviceClient(loadRepoEnv());
  const ids = await executorIds(db);
  const state = check(
    "studio_state read",
    await db.from("studio_state").select("card_max_usd").eq("id", 1).single<{ card_max_usd: string | number }>(),
  );
  const cardMax = Number(state.card_max_usd);
  console.log(`${apply ? "apply" : "dry run"}: ${DIRECTIVES.length} directives, per-card maximum ${cardMax.toFixed(4)}`);

  for (const d of DIRECTIVES) {
    const why = refusal(d, cardMax) ?? (await preCheckRejection(d.acceptance_test, REPO_ROOT))?.failingCheck ?? null;
    if (why) throw new Error(`${d.key} "${d.title}" would be refused: ${why}; nothing inserted`);
    console.log(`${d.key} passes the refusals and the pre-check`);
  }

  for (const d of DIRECTIVES) {
    const present = await filed(db, d.title);
    if (present) {
      console.log(`skip ${d.key}: ${present.id} is at stage ${present.stage}`);
    } else if (!apply) {
      console.log(`would insert ${d.key} "${d.title}" (${d.executor_role_name}, estimate ${d.estimate_usd.toFixed(2)})`);
    } else {
      const row = check(
        "cards insert",
        await db.from("cards").insert({
          bucket: d.bucket,
          source: d.source,
          shape: d.shape,
          lane: d.lane,
          priority: d.priority,
          board_reason: d.board_reason,
          folder: d.folder,
          executor_role_id: ids.get(d.executor_role_name),
          title: d.title,
          summary: d.summary,
          intent: d.intent,
          acceptance_test: d.acceptance_test,
          estimate_usd: d.estimate_usd,
          confidence: d.confidence,
          stage: d.stage,
        }).select("id, created_at").single<{ id: string; created_at: string }>(),
      );
      console.log(`inserted ${d.key} ${row.id} at ${row.created_at} "${d.title}"`);
    }
    if (d.key === "D2") await retireReplacedCard(db, apply);
  }
}

main().catch((err: unknown) => {
  console.error(`file-directives failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(err instanceof UsageError ? 2 : 1);
});
