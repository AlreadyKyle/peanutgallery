-- Biz Dev replaces the Scout, and roles gains status and trigger (docs/specs/carry-over.md).
-- Applies after 20260922000500_roles_revoke.sql and can run twice.
--
-- The seed upserts roles on name, so a renamed spec file would add a second row beside the
-- Scout's. The Scout's row is renamed in place instead: its id, hired date and every ledger row or
-- card that names it stay with it, and the next seed updates it. If a Biz Dev row already exists (the
-- seed ran first), that row is the role, and the Scout's row is retired rather than deleted, since
-- rows elsewhere may name it.
--
-- The roadmap card docs/BACKLOG.md filed for the Scout is retitled the same way, so file-backlog,
-- which matches cards by title, updates it instead of filing a second card beside it. Only a planned
-- card is touched: stage proposed, on horizon next or later.
--
-- status is the role's place in the launch roster: running, starts (on the named trigger) or
-- planned. trigger is the one line saying when a role that does not run yet starts. Both are seeded
-- from the role JSON in platform/agents and are null until the seed runs. public_roles gains both at
-- its end, which create or replace allows; the grants are set again as 20260922000400 set them.

set lock_timeout = '5s';

update public.roles
set name = 'Biz Dev', title = 'Biz Dev', prompt_path = 'platform/agents/prompts/biz-dev.md'
where name = 'Scout'
  and not exists (select 1 from public.roles where name = 'Biz Dev');

update public.roles
set state = 'retired', retired_at = coalesce(retired_at, now())
where name = 'Scout'
  and state = 'active'
  and exists (select 1 from public.roles where name = 'Biz Dev');

update public.cards
set title = 'Biz Dev agent for outside tools and trends'
where title = 'Scout agent for outside tools and trends'
  and stage = 'proposed'
  and horizon in ('next', 'later')
  and not exists (select 1 from public.cards where title = 'Biz Dev agent for outside tools and trends');

alter table public.roles add column if not exists status text;
alter table public.roles add column if not exists trigger text;
alter table public.roles drop constraint if exists roles_status_check;
alter table public.roles add constraint roles_status_check
  check (status is null or status in ('running', 'starts', 'planned'));
alter table public.roles drop constraint if exists roles_trigger_check;
alter table public.roles add constraint roles_trigger_check
  check (trigger is null or (btrim(trigger) <> '' and char_length(trigger) <= 200 and strpos(trigger, E'\n') = 0));

create or replace view public.public_roles with (security_invoker = false) as
  select id, name, title, description, species_note, avatar_url, model, write_access, state, hired_at, status, trigger
  from public.roles;

revoke all on table public.public_roles from anon, authenticated;
grant select on public.public_roles to anon, authenticated;

notify pgrst, 'reload schema';
