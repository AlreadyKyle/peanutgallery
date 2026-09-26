// What every run of the migrations on PGlite shares: the Deno migration tests
// (functions/_shared/migration_test.ts, agent_upkeep_test.ts) and the Node script
// scripts/schema-fingerprint.ts, which the Janitor's daily check runs
// (docs/specs/agent-upkeep.md). Plain strings and file ordering only: each side
// reads the files and runs PGlite itself, so this file imports nothing.

/** The one line of the first migration PGlite cannot run: it ships no pgcrypto build, and gen_random_uuid() is core Postgres. */
export const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";

/**
 * The Supabase-only objects the migrations expect, reproduced on PGlite: the
 * roles, the project's default privileges (every new relation and function
 * granted to anon, authenticated and service_role, so each revoke block is
 * exercised the way production exercises it), auth.users with the two claim
 * readers, and the realtime publication.
 */
export const SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.email() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.email', true), '')
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create publication supabase_realtime;
`;

/** The migration files among a folder's names, in the order they apply: by name, since the 14-digit stamp orders them. */
export function migrationOrder(names: readonly string[]): string[] {
  return names.filter((name) => name.endsWith(".sql")).sort();
}

/** A migration's SQL as PGlite runs it. */
export function forPglite(sql: string): string {
  return sql.replaceAll(PGCRYPTO_LINE, "");
}
