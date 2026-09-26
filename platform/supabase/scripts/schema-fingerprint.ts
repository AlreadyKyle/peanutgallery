// The schema fingerprint the Janitor's daily check compares (docs/specs/agent-upkeep.md).
//   pnpm --filter @backseat/supabase exec tsx scripts/schema-fingerprint.ts --pglite
//     applies every migration in this checkout on PGlite, in process and with no network, behind the
//     same Supabase shim as the Deno migration tests, and prints schema_fingerprint();
//   pnpm --filter @backseat/supabase exec tsx scripts/schema-fingerprint.ts
//     prints production's, through the RPC with the service role key from the repository's .env.
// stdout is the fingerprint as one JSON object, key to md5, and nothing else; the object count goes
// to stderr. Exit 1 on any error.

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { loadRepoEnv, REPO_ROOT, serviceClient } from "../lib/client.js";
import { forPglite, migrationOrder, SHIM } from "../lib/pglite-migrations.js";

export const MIGRATIONS_DIR = resolve(REPO_ROOT, "platform", "supabase", "migrations");

export type Fingerprint = Record<string, string>;

/** Every migration in the folder applied on a fresh PGlite, then schema_fingerprint(). */
export async function pgliteFingerprint(dir: string = MIGRATIONS_DIR): Promise<Fingerprint> {
  const db = new PGlite();
  try {
    await db.exec(SHIM);
    for (const name of migrationOrder(await readdir(dir))) {
      await db.exec(forPglite(await readFile(join(dir, name), "utf8")));
    }
    const result = await db.query<{ fp: Fingerprint }>("select public.schema_fingerprint() as fp");
    return result.rows[0]!.fp;
  } finally {
    await db.close();
  }
}

export async function productionFingerprint(): Promise<Fingerprint> {
  const { data, error } = await serviceClient(loadRepoEnv()).rpc("schema_fingerprint");
  if (error) throw new Error(`schema_fingerprint: ${error.message}`);
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("schema_fingerprint returned no object");
  return data as Fingerprint;
}

async function main(): Promise<void> {
  const pglite = process.argv.includes("--pglite");
  const fingerprint = pglite ? await pgliteFingerprint() : await productionFingerprint();
  process.stdout.write(`${JSON.stringify(fingerprint)}\n`);
  process.stderr.write(`schema_fingerprint: ${Object.keys(fingerprint).length} objects (${pglite ? "pglite" : "production"})\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    process.stderr.write(`schema_fingerprint: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
