-- agent-upkeep (docs/specs/agent-upkeep.md): the Janitor as code. Its daily
-- check records drift as findings for the board; nothing here calls a model.
--
-- findings is one row per check and subject, keyed by fingerprint. The board
-- reads the open ones in Needs you (board members only, through RLS); only the
-- service role writes, through record_finding and close_finding.
-- record_finding opens a finding, or reopens a closed one, and returns true
-- then, so the dispatcher sends one ntfy message; seen again while open it
-- only moves last_seen_at and detail and returns false.
-- schema_fingerprint() is one md5 per object in the app's schemas (public and
-- money): tables with their ordered columns and types, RLS flag and grants to
-- anon and authenticated (the table's and each column's); views with their
-- definition, options and grants; functions with their result, security,
-- settings, body and execute grants; triggers; and policies. Runs of
-- whitespace are collapsed before hashing. The dispatcher compares
-- production's with PGlite's after every migration in its own checkout.
-- producer_signals() is what a Producer would watch, as policy constants.
-- Two jobs, both the Janitor's and both code only, and both run while the
-- studio is paused: janitor daily and upkeep_merge hourly (which merges nothing
-- while the studio is paused, and still settles a merge it left pending),
-- queued by pg_cron through enqueue_job_run.
--
-- Re-runnable: the table and index are created if missing, the policy is
-- dropped and created again, the functions are replaced, the job rows upsert,
-- and cron.schedule with a job name replaces the existing job.

set lock_timeout = '5s';

-- a. findings --------------------------------------------------------------------

create table if not exists public.findings (
  fingerprint text primary key check (btrim(fingerprint) <> '' and length(fingerprint) <= 500),
  kind text not null check (kind in ('schema', 'model', 'cli', 'scan', 'producer')),
  subject text not null check (btrim(subject) <> '' and length(subject) <= 500),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  opened_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists findings_open_idx on public.findings (opened_at) where closed_at is null;

alter table public.findings enable row level security;
revoke all on public.findings from anon, authenticated, service_role;
grant select on public.findings to authenticated, service_role;
drop policy if exists findings_board_read on public.findings;
create policy findings_board_read on public.findings for select to authenticated using (public.is_board_member());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'peanutgallery_backup') then
    grant select on public.findings to peanutgallery_backup;
  end if;
end
$$;

-- b. record_finding, close_finding -----------------------------------------------

create or replace function public.record_finding(p_fingerprint text, p_kind text, p_subject text, p_detail jsonb default '{}'::jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
  v_closed timestamptz;
begin
  if p_fingerprint is null or btrim(p_fingerprint) = '' then
    raise exception 'A finding needs a fingerprint';
  end if;
  if p_kind is null or p_kind not in ('schema', 'model', 'cli', 'scan', 'producer') then
    raise exception 'The kind must be schema, model, cli, scan or producer';
  end if;
  if p_subject is null or btrim(p_subject) = '' then
    raise exception 'A finding needs a subject';
  end if;
  if jsonb_typeof(v_detail) <> 'object' then
    raise exception 'The detail must be a JSON object';
  end if;
  insert into public.findings (fingerprint, kind, subject, detail)
  values (p_fingerprint, p_kind, p_subject, v_detail)
  on conflict (fingerprint) do nothing;
  if found then
    return true;
  end if;
  select closed_at into v_closed from public.findings where fingerprint = p_fingerprint for update;
  if v_closed is not null then
    update public.findings
      set kind = p_kind, subject = p_subject, detail = v_detail, opened_at = now(), last_seen_at = now(), closed_at = null
      where fingerprint = p_fingerprint;
    return true;
  end if;
  update public.findings set detail = v_detail, last_seen_at = now() where fingerprint = p_fingerprint;
  return false;
end;
$$;

-- True when an open finding was closed.
create or replace function public.close_finding(p_fingerprint text) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.findings set closed_at = now() where fingerprint = p_fingerprint and closed_at is null;
  return found;
end;
$$;

-- c. schema_fingerprint ------------------------------------------------------------
-- Security invoker: it reads only the catalogs, which every role may read. Only
-- grants to anon, authenticated and PUBLIC are fingerprinted, so the owner and
-- the backup role, which differ between PGlite and production, do not count.
-- A null ACL is read as its default. Objects an extension owns are left out, and so are event
-- trigger functions: no migration makes one, and Supabase's own "ensure_rls" event trigger puts
-- public.rls_auto_enable() in production, database-wide plumbing rather than part of the app.

create or replace function public.schema_fingerprint() returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog
as $fp$
  with
  app_ns as (
    select oid, nspname from pg_namespace where nspname in ('public', 'money')
  ),
  extension_objects as (
    select objid from pg_depend where deptype = 'e'
  ),
  rels as (
    select c.oid, c.relkind, n.nspname || '.' || c.relname as name, c.relrowsecurity, c.reloptions,
      coalesce(c.relacl, acldefault('r', c.relowner)) as acl
    from pg_class c
    join app_ns n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm')
      and c.oid not in (select objid from extension_objects)
  ),
  rel_grants as (
    select r.oid,
      coalesce((
        select string_agg(entry, ',' order by entry)
        from (
          select coalesce(a.attname::text, '*') || ':' || case when x.grantee = 0 then 'public' else pg_get_userbyid(x.grantee)::text end || ':' || x.privilege_type as entry
          from (
            select null::name as attname, r.acl
            union all
            select at.attname, at.attacl from pg_attribute at
            where at.attrelid = r.oid and at.attnum > 0 and not at.attisdropped and at.attacl is not null
          ) a
          cross join lateral aclexplode(a.acl) x
          where x.grantee = 0 or pg_get_userbyid(x.grantee) in ('anon', 'authenticated')
        ) g
      ), '') as grants
    from rels r
  ),
  objects as (
    select 'table:' || r.name as key,
      'rls=' || r.relrowsecurity::text
        || ';columns=' || coalesce((
          select string_agg(quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
          from pg_attribute a where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
        ), '')
        || ';grants=' || g.grants as body
    from rels r join rel_grants g on g.oid = r.oid
    where r.relkind in ('r', 'p')
    union all
    select 'view:' || r.name,
      'def=' || pg_get_viewdef(r.oid)
        || ';options=' || coalesce(array_to_string(r.reloptions, ','), '')
        || ';grants=' || g.grants
    from rels r join rel_grants g on g.oid = r.oid
    where r.relkind in ('v', 'm')
    union all
    select 'function:' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
      'secdef=' || p.prosecdef::text
        || ';returns=' || coalesce(pg_get_function_result(p.oid), '')
        || ';config=' || coalesce(array_to_string(p.proconfig, ','), '')
        || ';src=' || p.prosrc
        || ';grants=' || coalesce((
          select string_agg(entry, ',' order by entry)
          from (
            select case when x.grantee = 0 then 'public' else pg_get_userbyid(x.grantee)::text end || ':' || x.privilege_type as entry
            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
            where x.grantee = 0 or pg_get_userbyid(x.grantee) in ('anon', 'authenticated')
          ) g
        ), '')
    from pg_proc p
    join app_ns n on n.oid = p.pronamespace
    where p.prokind in ('f', 'p')
      and p.prorettype <> 'pg_catalog.event_trigger'::pg_catalog.regtype
      and p.oid not in (select objid from extension_objects)
    union all
    select 'trigger:' || n.nspname || '.' || c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join app_ns n on n.oid = c.relnamespace
    where not t.tgisinternal
    union all
    select 'policy:' || n.nspname || '.' || c.relname || '.' || p.polname,
      'cmd=' || p.polcmd::text
        || ';permissive=' || p.polpermissive::text
        || ';roles=' || coalesce((
          select string_agg(role_name, ',' order by role_name)
          from (select case when r = 0 then 'public' else pg_get_userbyid(r)::text end as role_name from unnest(p.polroles) as r) s
        ), '')
        || ';using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
        || ';check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join app_ns n on n.oid = c.relnamespace
  )
  select coalesce(jsonb_object_agg(key, md5(regexp_replace(btrim(body), '\s+', ' ', 'g'))), '{}'::jsonb)
  from objects
$fp$;

-- d. producer_signals ---------------------------------------------------------------
-- The thresholds are policy constants (docs/specs/agent-upkeep.md, Decisions):
-- - unclaimed: a funded card on now, unchanged for 24 hours, while the studio
--   runs (studio_state says it is not paused now);
-- - overrun: a card paused at its ceiling that changed in the last seven days,
--   with its executor;
-- - throughput: fewer cards live in the last seven days than half the seven
--   days before, while a funded card waits.

create or replace function public.producer_signals()
returns table (kind text, card_id uuid, executor text, figures jsonb)
language sql
stable
security invoker
set search_path = public
as $$
  select 'unclaimed'::text, c.id, r.name,
    jsonb_build_object('funded_usd', c.funded_usd, 'since', c.updated_at, 'hours', floor(extract(epoch from now() - c.updated_at) / 3600))
  from public.cards c
  left join public.roles r on r.id = c.executor_role_id
  where c.stage = 'funded'
    and c.horizon = 'now'
    and c.updated_at <= now() - interval '24 hours'
    and not coalesce((select s.paused from public.studio_state s where s.id = 1), true)
  union all
  select 'overrun'::text, c.id, r.name,
    jsonb_build_object('actual_usd', c.actual_usd, 'estimate_usd', c.estimate_usd, 'paused_at', c.updated_at)
  from public.cards c
  left join public.roles r on r.id = c.executor_role_id
  where c.stage = 'paused'
    and c.failing_check = 'ceiling'
    and c.updated_at > now() - interval '7 days'
  union all
  select 'throughput'::text, null::uuid, null::text,
    jsonb_build_object('week', to_char(now() at time zone 'UTC', 'IYYY-"W"IW'), 'last_7_days', t.last_week, 'previous_7_days', t.previous_week, 'funded_waiting', t.waiting)
  from (
    select
      count(*) filter (where c.live_at > now() - interval '7 days') as last_week,
      count(*) filter (where c.live_at > now() - interval '14 days' and c.live_at <= now() - interval '7 days') as previous_week,
      (select count(*) from public.cards f where f.stage = 'funded') as waiting
    from public.cards c
    where c.live_at is not null
  ) t
  where t.last_week * 2 < t.previous_week
    and t.waiting > 0
$$;

-- e. Privileges -------------------------------------------------------------------------

revoke all on function public.record_finding(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.close_finding(text) from public, anon, authenticated;
revoke all on function public.schema_fingerprint() from public, anon, authenticated;
revoke all on function public.producer_signals() from public, anon, authenticated;
grant execute on function public.record_finding(text, text, text, jsonb) to service_role;
grant execute on function public.close_finding(text) to service_role;
grant execute on function public.schema_fingerprint() to service_role;
grant execute on function public.producer_signals() to service_role;

-- f. The two jobs, and their schedules --------------------------------------------------
-- Both the Janitor's and both code only, and both run while the studio is
-- paused: janitor only reads and records findings; upkeep_merge merges nothing
-- while the studio is paused, but a merge it made is verified, or rolled back,
-- through a pause, as a card's is. A database that does not ship pg_cron
-- (PGlite in the tests) skips the schedules.

insert into public.jobs (name, role_id, calls_model, runs_when_paused, description)
values
  ('janitor', (select id from public.roles where name = 'Janitor'), false, true,
    'The daily drift check: schema, models, the Claude Code pin, the weekly scan and the producer signals, each difference a finding for the board.'),
  ('upkeep_merge', (select id from public.roles where name = 'Janitor'), false, true,
    'Merges a Dependabot patch update that passes every condition of the merge policy, at its head sha on a green gate, then deploys and smoke-tests it. It merges nothing while the studio is paused.')
on conflict (name) do update
set role_id = coalesce(excluded.role_id, public.jobs.role_id),
    calls_model = excluded.calls_model,
    runs_when_paused = excluded.runs_when_paused,
    description = excluded.description;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; janitor and upkeep_merge are not scheduled';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('janitor', '0 8 * * *', $c$select public.enqueue_job_run('janitor', 'schedule')$c$);
  perform cron.schedule('upkeep_merge', '15 * * * *', $c$select public.enqueue_job_run('upkeep_merge', 'schedule')$c$);
end $$;

notify pgrst, 'reload schema';
