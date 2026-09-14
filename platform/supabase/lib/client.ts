// Repo-root .env loading and Supabase clients for seed.ts and the scripts.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnv, type Env } from "./env.js";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Loads <repo root>/.env into process.env without printing and returns the environment. */
export function loadRepoEnv(): Env {
  loadDotenv({ path: resolve(REPO_ROOT, ".env"), quiet: true });
  return process.env;
}

export function serviceClient(env: Env): SupabaseClient {
  return createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient(env: Env): SupabaseClient {
  return createClient(requireEnv(env, "SUPABASE_URL"), requireEnv(env, "SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function functionUrl(env: Env, name: string): string {
  return `${requireEnv(env, "SUPABASE_URL").replace(/\/$/, "")}/functions/v1/${name}`;
}
