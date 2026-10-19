-- Hold drafting while nothing sells (docs/specs/studio-reports.md, the card supply floor; docs/PLAN.md
-- §10 decision 77). Applies after 20261019020000_funnel_counters.sql and can run twice.
--
-- The floor kept asking the Game Designer for drafts while nothing sold: five cards open, none funded
-- for ten days, and every draft paid from Not on a card yet. Now, while no card was funded in the
-- last 7 days, the refill holds at the current open count: supply_draft_check() answers short false
-- with every shortfall 0 and reason no_sales, so enqueue_supply_draft() queues no draft. The first
-- card funded lifts the hold and the floor works as before. The hold needs a card to sell: with no
-- card open and none approved and waiting to be dealt, the floor refills as before, so the supply
-- never wedges with nothing to fund. The Machine card is not a card row
-- (20261017100000_community_core.sql) and is untouched: its money fills the open cards in line, and
-- a card it fills lifts the hold.
--
-- A card was funded when its bar reached its target: the contribution_allocations row (the
-- append-only record of where each payment's money went, whose card rows sum to the card's bar)
-- that brought the running sum of the card's rows to its funding target.
-- money.last_card_funded_at() is the latest such time. A card the board funded has no such row and
-- is not a sale.
--
-- Every other reason and its order is unchanged; no_sales comes after daily_limit and before
-- not_short. The answer also carries held and last_funded_at, for the dispatcher and the board.

set lock_timeout = '5s';

create or replace function money.last_card_funded_at() returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(x.created_at)
  from (
    select a.created_at, c.funding_target_usd,
      sum(a.amount_usd) over w as bar,
      sum(a.amount_usd) over w - a.amount_usd as before
    from public.contribution_allocations a
    join public.cards c on c.id = a.card_id
    where a.destination = 'card' and c.funding_target_usd > 0
    window w as (partition by a.card_id order by a.seq)
  ) x
  where x.bar >= x.funding_target_usd and x.before < x.funding_target_usd
$$;

revoke all on function money.last_card_funded_at() from public, anon, authenticated, service_role;

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
  v_last_funded timestamptz;
  v_held boolean;
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

  -- Nothing sells (§10 decision 77): with a card to fund and none funded in the last 7 days, the floor
  -- holds at the cards open now, so no shortfall is left to draft.
  v_last_funded := money.last_card_funded_at();
  v_held := v_short_open + v_short_big + v_short_small > 0
    and (v_supply ->> 'open')::integer + v_waiting > 0
    and (v_last_funded is null or v_last_funded < now() - interval '7 days');
  if v_held then
    v_short_open := 0;
    v_short_big := 0;
    v_short_small := 0;
  end if;

  v_floor := jsonb_build_object(
    'short_open', v_short_open,
    'short_big', v_short_big,
    'short_small', v_short_small,
    'big_min_usd', v_studio.card_big_min_usd,
    'small_max_usd', v_studio.card_small_max_usd
  );

  -- The latest draft run failed for want of money (the dispatcher's money stop): another run would fail
  -- the same way until the money changes, so none is queued until a contribution is credited, a card
  -- goes live or is rejected (which frees what it held), or the next New York day.
  -- A daily, monthly or tier cap clears on its own, so it holds only on the New York day it failed.
  select coalesce((
    select r.reason like 'insufficient_balance%'
           and r.finished_at >= v_since
           and not exists (select 1 from public.contributions k where k.credited_at > r.finished_at)
           and not exists (select 1 from public.cards c where c.stage in ('live', 'rejected') and c.updated_at > r.finished_at)
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
    when v_held then 'no_sales'
    when v_short_open + v_short_big + v_short_small = 0 then 'not_short'
    when v_no_money then 'no_money'
  end;
  return jsonb_build_object(
    'short', v_short_open + v_short_big + v_short_small > 0,
    'reason', v_reason,
    'floor', v_floor,
    'waiting', v_waiting,
    'runs_today', v_runs,
    'held', v_held,
    'last_funded_at', v_last_funded
  );
end;
$$;

revoke all on function public.supply_draft_check() from public, anon, authenticated;
grant execute on function public.supply_draft_check() to service_role;

notify pgrst, 'reload schema';
