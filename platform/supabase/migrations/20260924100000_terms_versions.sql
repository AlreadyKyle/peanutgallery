-- Numbered Terms versions (docs/specs/legal-copy.md).
-- Applies after 20260924000000_board_site.sql and can run twice.
--
-- The Terms and the Refunds page are one document with a whole-number
-- version. terms_versions holds one row per posted version: its number and
-- the time it took effect. A version is posted by inserting its row, through
-- its own migration, applied only after the site that carries its words is
-- live (platform/site/src/lib/terms-versions.ts). Rows are append-only: the
-- existing guard refuse_money_change refuses an update, delete or truncate.
-- Only the table's owner inserts; service_role reads, and anon and
-- authenticated read only the view public_terms_versions.
--
-- terms_version_at(t) is the newest version posted at or before t, or null.
-- money-logic stamps each contribution with it, from the Checkout Session's
-- created time, never a value the client sends. A later migration that re-runs
-- the append-only loop must not drop terms_versions_append_only or
-- terms_versions_no_truncate.

set lock_timeout = '5s';

create table if not exists public.terms_versions (
  version integer primary key check (version between 1 and 9999),
  posted_at timestamptz not null default now()
);

alter table public.terms_versions enable row level security;

-- Production's default privileges grant anon, authenticated and service_role
-- every right on a new table, so each is taken away before select is given.
revoke all on public.terms_versions from anon, authenticated, service_role;
grant select on public.terms_versions to service_role;

drop trigger if exists terms_versions_append_only on public.terms_versions;
create trigger terms_versions_append_only before update or delete on public.terms_versions
  for each row execute function public.refuse_money_change();
drop trigger if exists terms_versions_no_truncate on public.terms_versions;
create trigger terms_versions_no_truncate before truncate on public.terms_versions
  for each statement execute function public.refuse_money_change();

-- Version 1 is the text live since #47, merged 2026-09-23 01:32:51 UTC.
insert into public.terms_versions (version, posted_at) values (1, '2026-09-23 01:32:51+00')
  on conflict (version) do nothing;

create or replace function public.terms_version_at(p_at timestamptz) returns integer
language sql
stable
set search_path = public
as $$
  select max(version) from public.terms_versions where posted_at <= p_at
$$;

revoke all on function public.terms_version_at(timestamptz) from public, anon, authenticated;
grant execute on function public.terms_version_at(timestamptz) to service_role;

create or replace view public.public_terms_versions with (security_invoker = false) as
  select version, posted_at from public.terms_versions;

revoke all on public.public_terms_versions from anon, authenticated, service_role;
grant select on public.public_terms_versions to anon, authenticated, service_role;

notify pgrst, 'reload schema';
