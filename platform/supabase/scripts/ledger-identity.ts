// Checks the ledger identity on the live project with the service key.
//   pnpm --filter @backseat/supabase exec tsx scripts/ledger-identity.ts
// First output line is PASS: or FAIL:; exit 0 on pass, 1 on fail.

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRepoEnv, serviceClient } from "../lib/client.js";
import { checkIdentity, type ContributionSums, debitsPool, ledgerTotals, type LedgerRow, type PoolRow } from "../lib/ledger-identity.js";

const PAGE = 1000;

async function all<T>(client: SupabaseClient, table: string, columns: string, filter?: [string, string[]]): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = client.from(table).select(columns).order("id").range(from, from + PAGE - 1);
    if (filter) query = query.in(filter[0], filter[1]);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

async function main(): Promise<void> {
  const client = serviceClient(loadRepoEnv());
  const { data: pool, error } = await client
    .from("pool")
    .select("balance_usd, reserve_usd, incident_reserve_usd, held_usd")
    .eq("id", 1)
    .single();
  if (error || !pool) throw new Error(`pool: ${error?.message ?? "row 1 is missing"}`);
  const contributions = await all<ContributionSums>(client, "contributions", "id, reserve_usd, agents_usd, held_usd");
  // Overhead rows are read so the totals can be shown; only studio rows enter the identity.
  const ledger = await all<LedgerRow>(client, "ledger", "id, usd, billed_to", ["billed_to", ["studio", "overhead"]]);
  const studioRows = ledger.filter(debitsPool).length;
  const lines = checkIdentity(pool as PoolRow, contributions, ledger);
  const holds = lines.every((l) => l.holds);
  console.log(
    holds
      ? `PASS: ledger identity holds over ${contributions.length} contribution rows and ${studioRows} studio ledger rows`
      : `FAIL: ledger identity drifts (${lines.filter((l) => !l.holds).map((l) => `${l.name} ${l.drift}`).join(", ")})`,
  );
  for (const l of lines) console.log(`${l.name}: pool ${l.left} rows ${l.right} drift ${l.drift}`);
  const totals = ledgerTotals(ledger);
  console.log(`studio spend ${totals.studio} (from the pool); overhead ${totals.overhead} over ${ledger.length - studioRows} rows (studio share, not from the pool)`);
  process.exit(holds ? 0 : 1);
}

main().catch((err: unknown) => {
  console.log(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
