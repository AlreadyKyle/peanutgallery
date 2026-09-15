// Seed: roles, studio_state, pool, stream_state and board_members. Idempotent;
// service role; reads .env at the repo root. Next cards are filed separately
// by scripts/file-next-cards.ts.
//   pnpm --filter @backseat/supabase seed
//   pnpm --filter @backseat/supabase seed -- --week1-test [--run 1|2|3]

import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRepoEnv, REPO_ROOT, serviceClient } from "./lib/client.js";
import { parseBoardMembers, requireEnv, requireUsd, todayInNewYork, type Env } from "./lib/env.js";
import { readRoleSpecs } from "./lib/role-files.js";
import { resolveModel } from "./lib/roles.js";
import { parseSeedArgs, UsageError } from "./lib/seed-args.js";
import { week1Card, WEEK1_EXECUTOR_ROLE, type Week1Run } from "./lib/week1.js";

const AGENTS_DIR = resolve(REPO_ROOT, "platform", "agents");
/** A week-1 card in one of these stages is still in flight or shipped; a rejected or paused one is superseded by a fresh insert. */
const ACTIVE_STAGES = ["funded", "building", "gated", "live"];

type Result<T> = { data: T; error: null } | { data: null; error: { message: string } };

function check<T>(label: string, result: Result<T>): T {
  if (result.error !== null) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.data;
}

async function seedRoles(db: SupabaseClient, env: Env): Promise<void> {
  const specs = await readRoleSpecs(AGENTS_DIR);
  const rows = specs.map((s) => ({
    name: s.name,
    title: s.title,
    species_note: s.species_note,
    model: resolveModel(s, env),
    budget_share: s.budget_share,
    voice: s.voice,
    prompt_path: s.prompt_path,
    tools_json: s.tools,
    metrics_json: s.metrics,
    write_access: s.write_access,
  }));
  check("roles upsert", await db.from("roles").upsert(rows, { onConflict: "name" }));
  console.log(`roles: ${rows.length} upserted`);
}

async function seedStudioState(db: SupabaseClient, env: Env): Promise<void> {
  const row = {
    id: 1,
    daily_cap_usd: requireUsd(env, "POOL_DAILY_CAP_USD"),
    card_max_usd: requireUsd(env, "CARD_MAX_USD"),
    agent_hourly_rate_usd: requireUsd(env, "AGENT_HOURLY_RATE_USD"),
    agent_mode: requireEnv(env, "AGENT_MODE"),
  };
  check("studio_state upsert", await db.from("studio_state").upsert(row, { onConflict: "id" }));
  console.log(`studio_state: daily cap ${row.daily_cap_usd}, card max ${row.card_max_usd}, rate ${row.agent_hourly_rate_usd}, mode ${row.agent_mode}`);
}

async function seedPool(db: SupabaseClient): Promise<void> {
  const row = { id: 1, balance_usd: 0, reserve_usd: 0, incident_reserve_usd: 0, daily_spent_usd: 0, day: todayInNewYork(new Date()) };
  check("pool insert", await db.from("pool").upsert(row, { onConflict: "id", ignoreDuplicates: true }));
  const pool = check("pool read", await db.from("pool").select("balance_usd, day").eq("id", 1).single<{ balance_usd: string; day: string }>());
  console.log(`pool: balance ${pool.balance_usd}, day ${pool.day}`);
}

async function seedStreamState(db: SupabaseClient): Promise<void> {
  check("stream_state insert", await db.from("stream_state").upsert({ id: 1 }, { onConflict: "id", ignoreDuplicates: true }));
  console.log("stream_state: row 1 present");
}

async function seedBoardMembers(db: SupabaseClient, env: Env): Promise<void> {
  const members = parseBoardMembers(env.BOARD_EMAILS, env.MODERATOR_EMAIL);
  check("board_members upsert", await db.from("board_members").upsert(members, { onConflict: "email" }));
  console.log(`board_members: ${members.map((m) => `${m.email} (${m.role})`).join(", ")}`);
}

async function insertWeek1Card(db: SupabaseClient, run: Week1Run): Promise<void> {
  const role = check(
    "roles read",
    await db.from("roles").select("id").eq("name", WEEK1_EXECUTOR_ROLE).single<{ id: string }>(),
  );
  const card = week1Card(run);
  const existing = check(
    "cards read",
    await db.from("cards").select("id, stage").eq("title", card.title).order("created_at", { ascending: false }).limit(1).returns<{ id: string; stage: string }[]>(),
  );
  const found = existing[0];
  if (found && ACTIVE_STAGES.includes(found.stage)) {
    console.log(`week-1 card: "${card.title}" already present (${found.id}, stage ${found.stage})`);
    return;
  }
  if (found) {
    console.log(`week-1 card: newest "${card.title}" is ${found.id} at stage ${found.stage}; inserting a fresh card`);
  }
  const inserted = check(
    "cards insert",
    await db
      .from("cards")
      .insert({ ...card, executor_role_id: role.id, proposer_role_id: role.id })
      .select("id")
      .single<{ id: string }>(),
  );
  console.log(`week-1 card: run ${run.run} inserted ${inserted.id} ("${card.title}")`);
}

async function main(): Promise<void> {
  const options = parseSeedArgs(process.argv.slice(2));
  const env = loadRepoEnv();
  const db = serviceClient(env);

  await seedRoles(db, env);
  await seedStudioState(db, env);
  await seedPool(db);
  await seedStreamState(db);
  await seedBoardMembers(db, env);

  // The week-1 card runs attended, billed to the founder's subscription, so the pool is not
  // topped up: it holds customer money only (docs/specs/launch-hardening.md).
  if (options.week1Test) {
    await insertWeek1Card(db, options.run);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`seed failed: ${message}`);
  process.exit(err instanceof UsageError ? 2 : 1);
});
