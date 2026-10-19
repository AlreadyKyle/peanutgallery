// The designer-model migration on PGlite (docs/PLAN.md §10 decision 77, docs/specs/unattended-roles.md):
// the Game Designer's roles.model, which /team shows, becomes its default and every other role keeps
// its model; it changes nothing on a second run. Every migration runs in order behind the same Supabase
// shim as the other migration tests.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assertEquals } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MIGRATION = "20261019040000_designer_model.sql";
const PGCRYPTO_LINE = "create extension if not exists pgcrypto;";
const OPTS = { sanitizeOps: false, sanitizeResources: false };

const SHIM = `
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

Deno.test("the Game Designer's roles.model becomes claude-sonnet-5-5, every other role keeps its model, and a second run changes nothing", OPTS, async () => {
  const db = new PGlite();
  try {
    await db.exec(SHIM);
    const names: string[] = [];
    for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
      if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
    }
    names.sort();
    const sqlOf = async (name: string) => (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "");
    for (const name of names) await db.exec(await sqlOf(name));
    // The roles as the seed wrote them before: every role that runs on the Directors' model.
    for (const [name, klass] of [["Game Designer", "planner"], ["Game Director", "reviewer"], ["Builder A", "writer"], ["Studio Head", "planner"]]) {
      await db.query(
        `insert into public.roles (name, title, species_note, model, budget_share, voice, prompt_path, write_access, agent_class)
         values ($1, $1, 'A small creature.', 'claude-opus-5-5', 0.1, 'plain', 'platform/agents/prompts/x.md', $2, $3)`,
        [name, klass !== "reviewer", klass],
      );
    }
    const models = async () => (await db.query<{ name: string; model: string }>(`select name, model from public.roles order by name`)).rows;
    // The migration's update is its last statement; its row count is the rows it changed.
    const updated = async () => (await db.exec(await sqlOf(MIGRATION))).at(-1)?.affectedRows ?? 0;
    assertEquals(await updated(), 1);
    assertEquals(await models(), [
      { name: "Builder A", model: "claude-opus-5-5" },
      { name: "Game Designer", model: "claude-sonnet-5-5" },
      { name: "Game Director", model: "claude-opus-5-5" },
      { name: "Studio Head", model: "claude-opus-5-5" },
    ]);
    assertEquals(await updated(), 0);
  } finally {
    await db.close();
  }
});
