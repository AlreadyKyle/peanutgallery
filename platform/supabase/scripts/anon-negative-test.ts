// Checks the anon key's view of the schema against the RLS contract.
//   pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts
// First output line is PASS: or FAIL:; exit 0 on pass, 1 on fail.

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
];

const PUBLIC_RELATIONS = [
  "pool",
  "cards",
  "ledger",
  "deploys",
  "roles",
  "last_green",
  "public_agent_events",
  "public_ledger_totals",
  "public_studio",
  "public_card_funding",
];

interface Outcome {
  relation: string;
  expected: "refused" | "readable";
  actual: "refused" | "readable";
  detail: string;
}

async function probe(db: SupabaseClient, relation: string): Promise<{ actual: "refused" | "readable"; detail: string }> {
  const { data, error } = await db.from(relation).select("*").limit(1);
  if (error) {
    return { actual: "refused", detail: `${error.code ?? "error"} ${error.message}` };
  }
  return { actual: "readable", detail: `${data.length} row(s) returned` };
}

async function main(): Promise<void> {
  const env = loadRepoEnv();
  const db = anonClient(env);
  const outcomes: Outcome[] = [];

  for (const relation of PRIVATE_TABLES) {
    outcomes.push({ relation, expected: "refused", ...(await probe(db, relation)) });
  }
  for (const relation of PUBLIC_RELATIONS) {
    outcomes.push({ relation, expected: "readable", ...(await probe(db, relation)) });
  }

  const failures = outcomes.filter((o) => o.expected !== o.actual);
  console.log(failures.length === 0 ? "PASS: anon access matches the RLS contract" : `FAIL: ${failures.length} relation(s) differ from the RLS contract`);
  for (const o of outcomes) {
    const mark = o.expected === o.actual ? "ok  " : "FAIL";
    console.log(`${mark} ${o.relation.padEnd(22)} expected ${o.expected.padEnd(8)} actual ${o.actual.padEnd(8)} ${o.detail}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.log(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
