// The governance-role-copy migration on PGlite (docs/specs/governance-copy.md): six roles' description,
// status and trigger become exactly what their files in platform/agents say, every other role keeps its
// row, and a second run changes nothing. Every migration runs in order behind the same Supabase shim as
// the other migration tests.

import { PGlite } from "npm:@electric-sql/pglite@0.3.7";
import { assertEquals } from "jsr:@std/assert@1";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const AGENTS_DIR = new URL("../../../agents/", import.meta.url);
const MIGRATION = "20261020110000_governance_role_copy.sql";
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

// The rows as the seed wrote them before this pass (20261018130000_plain_role_descriptions.sql and the
// role files at 8dcf3a6), and one role the pass leaves alone.
const BEFORE: [string, string, string, string | null][] = [
  ["HR", "Keeps each agent's job description true to the work it actually does, and proposes changes to a role for the board to approve.", "starts", "Starts once role scorecards and the replay eval set exist."],
  ["Head of Product", "Looks at the studio the way a newcomer, a supporter and the board see it, and sends each problem it finds to the agent who owns it.", "starts", "Starts with a first review, then runs monthly and after any big change."],
  ["Host", "Narrates the studio's work on a live stream and speaks up for chat.", "planned", "No trigger is set yet; the Host waits on the stream, a backlog entry."],
  ["Curator", "Reads the ideas players pitch and sorts them into clear summaries. It has no tools and changes nothing.", "starts", "Starts when the board turns on suggestion triage."],
  ["Studio Head", "Keeps the studio's roadmap and numbers.", "planned", "Starts when its backlog entries are built: drafting cards from the roadmap and triaging board notes."],
  ["Head of Finance", "Explains the ledger and each purchase of model credit in plain words, and flags money problems. It can read the books but not change them.", "starts", "Starts once the first Stripe payout has bought the agents' model credit."],
  ["Builder A", "Builds funded game cards.", "running", null],
];
const FILES: Record<string, string> = {
  "HR": "hr.json",
  "Head of Product": "head-of-product.json",
  "Host": "host.json",
  "Curator": "curator.json",
  "Studio Head": "studio-head.json",
  "Head of Finance": "head-of-finance.json",
};

type Row = { name: string; description: string; status: string | null; trigger: string | null };

Deno.test("six roles' words become their role files', every other role keeps its row, and a second run changes nothing", OPTS, async () => {
  const db = new PGlite();
  try {
    await db.exec(SHIM);
    const names: string[] = [];
    for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
      if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
    }
    names.sort();
    const sqlOf = async (name: string) => (await Deno.readTextFile(new URL(name, MIGRATIONS_DIR))).replaceAll(PGCRYPTO_LINE, "");
    // Every migration before this one, then the rows as they were, then this one.
    for (const name of names.filter((n) => n < MIGRATION)) await db.exec(await sqlOf(name));
    for (const [name, description, status, trigger] of BEFORE) {
      await db.query(
        `insert into public.roles (name, title, description, species_note, model, budget_share, voice, prompt_path, status, trigger)
         values ($1, $1, $2, 'A small creature.', 'model-id', 0, 'plain', 'platform/agents/prompts/x.md', $3, $4)`,
        [name, description, status, trigger],
      );
    }
    const roles = async () =>
      (await db.query<Row>(`select name, description, status, trigger from public.roles order by name`)).rows;
    // The migration's update is its last statement; its row count is the rows it changed.
    const updated = async () => (await db.exec(await sqlOf(MIGRATION))).at(-1)?.affectedRows ?? 0;
    assertEquals(await updated(), 6);

    const expected: Row[] = [];
    for (const [name, description, status, trigger] of BEFORE) {
      const file = FILES[name];
      if (file === undefined) {
        expected.push({ name, description, status, trigger });
        continue;
      }
      const spec = JSON.parse(await Deno.readTextFile(new URL(file, AGENTS_DIR)));
      expected.push({ name, description: spec.description, status: spec.status, trigger: spec.trigger ?? null });
    }
    expected.sort((a, b) => (a.name < b.name ? -1 : 1));
    assertEquals(await roles(), expected);
    // The Curator runs, with no trigger, and no row says board any more.
    assertEquals(expected.find((r) => r.name === "Curator"), {
      name: "Curator",
      description: "Reads the ideas players pitch and sorts them into clear summaries. It has no tools and changes nothing.",
      status: "running",
      trigger: null,
    });
    for (const row of await roles()) assertEquals(/board/i.test(`${row.description} ${row.trigger ?? ""}`), false, row.name);

    assertEquals(await updated(), 0);
    // The migrations after it run on top, as production applies them.
    for (const name of names.filter((n) => n > MIGRATION)) await db.exec(await sqlOf(name));
  } finally {
    await db.close();
  }
});
