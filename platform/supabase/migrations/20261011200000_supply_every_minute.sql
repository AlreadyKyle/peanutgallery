-- supply-every-minute (docs/specs/always-open.md, docs/PLAN.md §10 decision 71): the
-- card supply asks for a draft every minute instead of every 20, so while the
-- supply is short the drafts run back to back instead of one per 20 minutes. A
-- draft took about a minute in production on 10 October 2026, so the floor of 6
-- refilled at one card each 20 minutes, two hours from empty.
-- enqueue_supply_draft() still queues nothing while a draft_card run is queued
-- or running, while the supply is full, or past draft_runs_per_day, so a check
-- that finds nothing to do writes nothing and spends nothing; every spend cap
-- stands. public_supply()'s next_check_at becomes the next minute.
--
-- supply_draft_check() gains one reason, no_money: the latest draft run failed
-- for want of money (insufficient_balance) within the hour and no contribution
-- has been credited since, or it hit a daily, monthly or tier cap earlier this
-- New York day. On 11 October 2026 the pool held 0.7447 USD against a draft
-- budget of 0.75, so every check would have queued a run that failed at once and
-- used up the day's draft_runs_per_day; now one failure waits for the next
-- contribution. Every other reason and its order is unchanged, and
-- enqueue_supply_draft() queues nothing while any reason holds.
--
-- Applies after 20261011100000_always_open.sql and can run twice.

set lock_timeout = '5s';

create or replace function public.supply_draft_check() returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_studio public.studio_state%rowtype;
  v_job public.jobs%rowtype;
  v_since timestamptz := ((now() at time zone 'America/New_York')::date)::timestamp at time zone 'America/New_York';
  v_runs integer;
  v_supply jsonb;
  v_waiting integer;
  v_waiting_big integer;
  v_waiting_small integer;
  v_short_open integer;
  v_short_big integer;
  v_short_small integer;
  v_floor jsonb;
  v_reason text;
  v_no_money boolean;
begin
  select * into v_studio from public.studio_state where id = 1;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;
  select * into v_job from public.jobs where name = 'draft_card';
  select count(*)::integer into v_runs
  from public.job_runs r
  where r.job_name = 'draft_card' and r.created_at >= v_since and r.status <> 'skipped';

  v_supply := public.card_supply();
  select
    count(*)::integer,
    (count(*) filter (where c.funding_target_usd >= v_studio.card_big_min_usd))::integer,
    (count(*) filter (where c.funding_target_usd < v_studio.card_small_max_usd))::integer
  into v_waiting, v_waiting_big, v_waiting_small
  from public.cards c
  where public.card_needs_approval(c.source, c.drafter_role_id)
    and c.stage = 'proposed'
    and c.horizon in ('next', 'later')
    and c.opens_at is not null
    and not c.board_vetoed
    and c.director_stance <> 'vetoed'
    and public.card_approved(c.id);
  v_short_open := greatest((v_supply ->> 'short_open')::integer - v_waiting, 0);
  v_short_big := case
    when v_studio.card_big_min_usd <= v_studio.card_max_usd then greatest((v_supply ->> 'short_big')::integer - v_waiting_big, 0)
    else 0
  end;
  v_short_small := greatest((v_supply ->> 'short_small')::integer - v_waiting_small, 0);
  v_floor := jsonb_build_object(
    'short_open', v_short_open,
    'short_big', v_short_big,
    'short_small', v_short_small,
    'big_min_usd', v_studio.card_big_min_usd,
    'small_max_usd', v_studio.card_small_max_usd
  );

  -- The latest draft run failed for want of money (the dispatcher's money stop), and no contribution
  -- has been credited since: another run would fail the same way, so none is queued until one is, or
  -- for an hour, since a build that finishes also frees money held for it.
  -- A daily, monthly or tier cap clears on its own, so it holds only on the New York day it failed.
  select coalesce((
    select r.reason like 'insufficient_balance%'
           and r.finished_at > now() - interval '1 hour'
           and not exists (select 1 from public.contributions k where k.credited_at > r.finished_at)
        or ((r.reason like 'daily_cap%' or r.reason like 'monthly_cap%' or r.reason like 'tier_cap%') and r.finished_at >= v_since)
    from public.job_runs r
    where r.job_name = 'draft_card' and r.status in ('succeeded', 'failed') and r.finished_at is not null
    order by r.finished_at desc
    limit 1
  ), false) into v_no_money;

  v_reason := case
    when v_studio.paused then 'studio_paused'
    when v_job.name is null or not v_job.enabled then 'job_disabled'
    when exists (select 1 from public.roles r where r.id = v_job.role_id and r.paused) then 'role_paused'
    when exists (select 1 from public.roles r where r.name = 'Game Director' and r.paused) then 'grader_paused'
    when exists (select 1 from public.job_runs r where r.job_name = 'draft_card' and r.status in ('queued', 'running')) then 'already_queued'
    when v_runs >= v_studio.draft_runs_per_day then 'daily_limit'
    when v_short_open + v_short_big + v_short_small = 0 then 'not_short'
    when v_no_money then 'no_money'
  end;
  return jsonb_build_object(
    'short', v_short_open + v_short_big + v_short_small > 0,
    'reason', v_reason,
    'floor', v_floor,
    'waiting', v_waiting,
    'runs_today', v_runs
  );
end;
$$;

revoke all on function public.supply_draft_check() from public, anon, authenticated;
grant execute on function public.supply_draft_check() to service_role;

create or replace function public.public_supply() returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'drafting', exists (
      select 1 from public.job_runs r
      where r.job_name = 'draft_card' and r.status in ('queued', 'running')
    ),
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

-- A database that does not ship pg_cron (PGlite in the tests) skips the schedule.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; enqueue_supply_draft is not rescheduled';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('supply-draft', '* * * * *', $c$select public.enqueue_supply_draft()$c$);
end $$;

notify pgrst, 'reload schema';
