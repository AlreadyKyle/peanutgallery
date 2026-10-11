-- home-flow-supply (docs/specs/home-flow.md): home's four-lane flow says when
-- the Game Designer is drafting a card, and when the supply is next checked.
-- Applies after 20261010200000_supply_refill.sql and can run twice.
--
-- public_supply() is the drafting status as figures and fixed codes, never
-- text: drafting (a draft_card run is queued or running), short, reason and
-- runs_today as supply_draft_check() answers them (reason is one of its fixed
-- codes or null), run_limit (studio_state.draft_runs_per_day) and
-- next_check_at, the next 20-minute slot of the supply-draft schedule after
-- now. It carries no card text, title or free text (docs/PLAN.md §4 Kernel:
-- the read/write separation). It is security definer, since job_runs,
-- studio_state and supply_draft_check() are not anon's, and anon may execute
-- it, since site_live() runs as anon.
--
-- site_live() is supporter-pages' version with one change: its studio entry is
-- the public_studio row plus supply, public_supply(); with no public_studio
-- row it stays null.

set lock_timeout = '5s';

-- a. public_supply ----------------------------------------------------------------

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
    'next_check_at', date_trunc('hour', now()) + interval '20 min' * (floor(extract(minute from now()) / 20)::integer + 1)
  )
  from public.studio_state s
  cross join lateral (select public.supply_draft_check() as v) c
  where s.id = 1
$$;

revoke all on function public.public_supply() from public;
grant execute on function public.public_supply() to anon, authenticated, service_role;

-- b. site_live --------------------------------------------------------------------

create or replace function public.site_live() returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with listed as (
    select c.id from public.cards c
    where c.stage in ('proposed', 'designing', 'voted', 'funded', 'building', 'gated', 'paused')
    union all
    (select c.id from public.cards c where c.stage = 'live' order by c.live_at desc nulls last, c.id desc limit 200)
    union all
    (select c.id from public.cards c where c.stage = 'rejected' order by c.updated_at desc, c.id desc limit 50)
  )
  select jsonb_build_object(
    'built_at', now(),
    'pool', (
      select jsonb_build_object(
        'balance_usd', p.balance_usd, 'reserve_usd', p.reserve_usd,
        'incident_reserve_usd', p.incident_reserve_usd, 'held_usd', p.held_usd,
        'daily_spent_usd', p.daily_spent_usd, 'day', p.day
      )
      from public.pool p where p.id = 1
    ),
    'studio', (select to_jsonb(s) || jsonb_build_object('supply', public.public_supply()) from public.public_studio s limit 1),
    'totals', (select to_jsonb(t) from public.public_ledger_totals t),
    'money', (select to_jsonb(m) from public.public_money m limit 1),
    'stopped', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.stopped_at desc, x.card_id desc)
      from (
        select * from public.public_stopped_cards
        order by stopped_at desc, card_id desc
        limit 12
      ) x
    ), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_object_agg(c.id::text, jsonb_build_object(
        'stage', c.stage,
        'horizon', c.horizon,
        'rank', c.rank,
        'executor_role_id', c.executor_role_id,
        'funding_target_usd', c.funding_target_usd,
        'funded_usd', c.funded_usd,
        'spent_usd', coalesce(s.spent_usd, 0),
        'contributors', f.contributors,
        'credited_usd', f.credited_usd,
        'live_at', c.live_at,
        'updated_at', c.updated_at
      ))
      from public.cards c
      left join public.public_card_spend s on s.card_id = c.id
      left join public.public_card_funding f on f.card_id = c.id
      where c.id in (select id from listed)
    ), '{}'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'card_id', e.card_id, 'role_id', e.role_id, 'type', e.type,
        'created_at', e.created_at, 'step', e.step, 'usd', e.usd, 'card_title', c.title, 'line_key', e.line_key
      ) order by e.created_at desc, e.id desc)
      from (
        select id, card_id, role_id, type, created_at, step, usd, line_key from public.public_agent_events
        where line_key <> 'none'
        order by created_at desc, id desc
        limit 20
      ) e
      left join public.cards c on c.id = e.card_id
    ), '[]'::jsonb),
    'deploys', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'folder', d.folder, 'sha', d.sha, 'is_green', d.is_green, 'created_at', d.created_at
      ) order by d.created_at desc, d.id desc)
      from (
        select id, folder, sha, is_green, created_at from public.deploys
        order by created_at desc, id desc
        limit 10
      ) d
    ), '[]'::jsonb),
    'role_stats', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.role_id) from public.public_role_stats r
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.site_live() from public;
grant execute on function public.site_live() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
