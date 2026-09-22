-- Public roles and the public pause (docs/specs/launch-db.md).
-- Applies after 20260922000300_backlog.sql and can run twice.
--
-- roles gains a one-line description of what each role does, seeded from the
-- role JSON in platform/agents. public_roles is the site's window onto roles:
-- the columns the Meet the Team page shows, and nothing the dispatcher needs
-- privately. It runs with the view owner's rights, so it keeps working once
-- 20260922000500_roles_revoke.sql closes the roles table to anon. That revoke
-- is its own file because the deployed site reads roles until it switches to
-- this view; this file revokes nothing on roles.
--
-- public_studio gains paused, so the site can say when the agents are paused.
-- It never exposes paused_by, which is a board member's email, or paused_at.
--
-- Both views are simple views over one table, which Postgres would let a
-- caller write through, so every privilege is revoked before select is
-- granted.

set lock_timeout = '5s';

alter table public.roles add column if not exists description text;
alter table public.roles drop constraint if exists roles_description_check;
alter table public.roles add constraint roles_description_check
  check (description is null or (btrim(description) <> '' and char_length(description) <= 200 and strpos(description, E'\n') = 0));

create or replace view public.public_roles with (security_invoker = false) as
  select id, name, title, description, species_note, avatar_url, model, write_access, state, hired_at
  from public.roles;

create or replace view public.public_studio with (security_invoker = false) as
  select launched_at, paused from public.studio_state where id = 1;

revoke all on table public.public_roles, public.public_studio from anon, authenticated;
grant select on public.public_roles to anon, authenticated;
grant select on public.public_studio to anon, authenticated;

notify pgrst, 'reload schema';
