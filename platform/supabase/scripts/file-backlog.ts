// Files docs/BACKLOG.md as planned cards (docs/specs/launch-db.md, lib/backlog.ts).
// Dry run by default (--dry-run says so explicitly); --apply writes.
//   pnpm --filter @backseat/supabase file-backlog
//   pnpm --filter @backseat/supabase file-backlog -- --apply
//   pnpm --filter @backseat/supabase file-backlog -- --file <path>
// Each entry becomes a board goal card at stage proposed on its horizon (next
// or later) with its rank, and no funding target, executor or acceptance test:
// it is planned, not open for funding. The script matches cards by title, so
// it can run again: an entry already filed is updated where the file changed,
// and one the board has moved to now, or past proposed, is left alone.
// The service role writes the rows, since board_role() is null for it. Run it
// only once the site lists horizon now cards alone, or the planned cards show
// as open for funding.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadRepoEnv, REPO_ROOT, serviceClient } from "../lib/client.js";
import { backlogCounts, type ExistingCard, parseBacklog, planBacklog } from "../lib/backlog.js";

type Result<T> = { data: T; error: null } | { data: null; error: { message: string } };

class UsageError extends Error {}

function check<T>(label: string, result: Result<T>): T {
  if (result.error !== null) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.data;
}

function parseArgs(argv: string[]): { apply: boolean; file: string } {
  let apply = false;
  let dryRun = false;
  let file = resolve(REPO_ROOT, "docs", "BACKLOG.md");
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    // pnpm passes the "--" separator through to the script.
    if (arg === "--") continue;
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--file") {
      const path = argv[i + 1];
      if (!path) throw new UsageError("--file needs a path");
      file = resolve(path);
      i += 1;
    } else {
      throw new UsageError(`Unknown argument ${arg}; the options are --dry-run, --apply and --file <path>`);
    }
  }
  if (apply && dryRun) throw new UsageError("--apply and --dry-run cannot both be given");
  return { apply, file };
}

async function main(): Promise<void> {
  const { apply, file } = parseArgs(process.argv.slice(2));
  const entries = parseBacklog(await readFile(file, "utf8"));
  const counts = backlogCounts(entries);
  const mode = apply ? "apply" : "dry run";
  console.log(
    `${mode}: ${entries.length} backlog entries in ${file}: next ${counts.horizon.next}, later ${counts.horizon.later}; seed-1 ${counts.folder["seed-1"]}, platform ${counts.folder.platform}`,
  );

  const db = serviceClient(loadRepoEnv());
  const existing = check(
    "cards read",
    await db
      .from("cards")
      .select("id, title, stage, horizon, rank, bucket, folder, summary, intent")
      .in("title", entries.map((e) => e.title))
      .order("created_at", { ascending: true })
      .returns<ExistingCard[]>(),
  );
  const plan = planBacklog(entries, existing);

  for (const skip of plan.skipped) console.log(`skip "${skip.title}": ${skip.reason}`);
  for (const title of plan.unchanged) console.log(`unchanged "${title}"`);
  for (const row of plan.insert) {
    console.log(`${apply ? "insert" : "would insert"} "${row.title}" (${row.horizon} ${row.rank}, ${row.folder}, ${row.bucket})`);
  }
  for (const change of plan.update) {
    console.log(`${apply ? "update" : "would update"} "${change.title}" (${change.id}): ${Object.keys(change.patch).join(", ")}`);
  }

  if (apply) {
    if (plan.insert.length > 0) {
      const inserted = check("cards insert", await db.from("cards").insert(plan.insert).select("id"));
      if (inserted.length !== plan.insert.length) {
        throw new Error(`inserted ${inserted.length} of ${plan.insert.length} cards`);
      }
    }
    for (const change of plan.update) {
      check(
        `cards update ${change.id}`,
        await db.from("cards").update(change.patch).eq("id", change.id).eq("stage", "proposed").neq("horizon", "now"),
      );
    }
  }
  const summary = `${plan.insert.length} ${apply ? "inserted" : "would be inserted"}, ${plan.update.length} ${apply ? "updated" : "would be updated"}, ${plan.unchanged.length} unchanged, ${plan.skipped.length} skipped`;
  console.log(apply ? `done: ${summary}` : `dry run: ${summary}; pass --apply to write`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`file-backlog failed: ${message}`);
  process.exit(err instanceof UsageError ? 2 : 1);
});
