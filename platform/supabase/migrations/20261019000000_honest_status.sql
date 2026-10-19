-- honest-status (docs/specs/honest-status.md, docs/PLAN.md §10 decisions 62 and 77): the public
-- drafting status says only what is happening, and says when the agents are offline.
--
-- public_supply()'s drafting was true while any draft_card run was queued or running, however old.
-- Production's dispatcher last checked in on 15 October 2026, and a draft run queued after that kept
-- home's Next up lane and the studio room saying the Game Designer was drafting while nothing ran.
-- Now drafting is true only while a draft_card run is running and the dispatcher checked in
-- (studio_state.dispatcher_seen_at) less than 15 minutes ago. A queued run is not drafting: nothing
-- has picked it up yet.
--
-- It gains one key, offline: true while the dispatcher has never checked in, or not for 24 hours.
-- The site then says "The agents are offline." where it says what the studio is doing (decision 77,
-- which amends decision 62 for this one state; a pause still shows nothing). offline is a flag
-- worked out from a time, never the time itself, and like every other key it carries no card text
-- or free text (docs/PLAN.md §4 Kernel: the read/write separation). The other five keys, the
-- signature, security definer, the search_path and the grants are as
-- 20261011200000_supply_every_minute.sql left them; site_live() carries it as studio.supply.
--
-- Applies after 20261018130000_plain_role_descriptions.sql and can run twice.

set lock_timeout = '5s';

create or replace function public.public_supply() returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'drafting', coalesce(s.dispatcher_seen_at > now() - interval '15 minutes', false) and exists (
      select 1 from public.job_runs r
      where r.job_name = 'draft_card' and r.status = 'running'
    ),
    'offline', s.dispatcher_seen_at is null or s.dispatcher_seen_at < now() - interval '24 hours',
    'short', (c.v ->> 'short')::boolean,
    'reason', c.v ->> 'reason',
    'runs_today', (c.v ->> 'runs_today')::integer,
    'run_limit', s.draft_runs_per_day,
    'next_check_at', date_trunc('minute', now()) + interval '1 min'
  )
  from public.studio_state s
  cross join lateral (select public.supply_draft_check() as v) c
  where s.id = 1
$$;

revoke all on function public.public_supply() from public;
grant execute on function public.public_supply() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
