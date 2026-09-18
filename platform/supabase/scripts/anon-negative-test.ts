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
  "ledger",
  "deploys",
  "roles",
  "last_green",
  "public_agent_events",
  "public_ledger_totals",
  "public_studio",
  "public_card_funding",
  "public_card_spend",
];

// cards is granted column by column (docs/specs/card-columns-and-open-funding.md).
// The site's columns are readable. actual_usd, severity and priority are
// withheld, and so is select=*, which names them; each must be refused with
// Postgres's permission error, 42501, not some other failure.
const CARD_COLUMNS_READABLE = "id,title,stage,funded_usd,live_at";
const CARD_COLUMNS_WITHHELD = ["actual_usd", "severity", "priority", "*"];
const PERMISSION_DENIED = "42501";

interface Outcome {
  relation: string;
  expected: "refused" | "readable";
  actual: "refused" | "readable" | "error";
  detail: string;
}

async function probe(
  db: SupabaseClient,
  relation: string,
  columns = "*",
  refusalCode?: string,
): Promise<{ actual: Outcome["actual"]; detail: string }> {
  const { data, error } = await db.from(relation).select(columns).limit(1);
  if (error) {
    const refused = refusalCode === undefined || error.code === refusalCode;
    return { actual: refused ? "refused" : "error", detail: `${error.code ?? "error"} ${error.message}` };
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

  const failures = outcomes.filter((o) => o.expected !== o.actual);
  console.log(failures.length === 0 ? "PASS: anon access matches the RLS contract" : `FAIL: ${failures.length} relation(s) differ from the RLS contract`);
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
