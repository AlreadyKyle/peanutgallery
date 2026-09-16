-- Refunds, disputes and the daily credit hold (docs/specs/refunds-and-holds.md).
-- Applies on top of the earlier migrations and can run twice.
--
-- The ledger is kernel, so no money row is ever changed. A payment row keeps
-- its Stripe ids and records how much of its pool credit is held. Every later
-- movement for that payment is its own child row, linked by parent_id, with
-- signed amounts: one release when the hold ends, and one negative row per
-- refund or dispute event. Every pool figure is then a plain sum over rows:
--   reserve_usd                                     = sum(reserve_usd)
--   balance_usd + incident_reserve_usd + held_usd   = sum(agents_usd) - studio ledger usd
--   held_usd                                        = sum(held_usd)

do $$
begin
  create type public.contribution_entry as enum ('payment', 'release', 'refund', 'dispute');
exception when duplicate_object then null;
end $$;

alter table public.contributions add column if not exists entry public.contribution_entry not null default 'payment';
alter table public.contributions add column if not exists parent_id uuid references public.contributions (id);
alter table public.contributions add column if not exists held_usd numeric(12,4) not null default 0;
alter table public.contributions add column if not exists hold_until timestamptz;

alter table public.contributions drop constraint if exists contributions_entry_parent_check;
alter table public.contributions add constraint contributions_entry_parent_check
  check ((entry = 'payment') = (parent_id is null));
alter table public.contributions drop constraint if exists contributions_child_session_check;
alter table public.contributions add constraint contributions_child_session_check
  check (entry = 'payment' or stripe_session_id is null);
alter table public.contributions drop constraint if exists contributions_reversal_event_check;
alter table public.contributions add constraint contributions_reversal_event_check
  check (entry not in ('refund', 'dispute') or stripe_event_id is not null);
alter table public.contributions drop constraint if exists contributions_held_sign_check;
alter table public.contributions add constraint contributions_held_sign_check
  check ((entry = 'payment' and held_usd >= 0) or (entry <> 'payment' and held_usd <= 0));
alter table public.contributions drop constraint if exists contributions_hold_until_check;
alter table public.contributions add constraint contributions_hold_until_check
  check (hold_until is null or entry = 'payment');

create unique index if not exists contributions_one_release on public.contributions (parent_id) where entry = 'release';
create index if not exists contributions_parent_idx on public.contributions (parent_id);
create index if not exists contributions_contributor_day_idx on public.contributions (contributor_id, created_at) where entry = 'payment';
create index if not exists contributions_hold_due_idx on public.contributions (hold_until) where entry = 'payment' and held_usd > 0;

alter table public.pool add column if not exists held_usd numeric(12,4) not null default 0;
alter table public.studio_state add column if not exists credit_daily_cap_usd numeric(12,4) not null default 50;
alter table public.studio_state add column if not exists credit_hold_days integer not null default 14;

-- apply_contribution --------------------------------------------------------
-- Same eight arguments as the contribution-session version. After the pool
-- lock it adds up what this contributor's payments credited immediately today
-- (New York day). Pool credit above credit_daily_cap_usd is held: it stays out
-- of the balance and the card bar until credit_held_contributions() releases
-- it. The 10% reserve and the incident reserve are credited in full at once.

create or replace function public.apply_contribution(
  p_stripe_event_id text,
  p_contributor_id text,
  p_display_name text,
  p_amount_usd numeric,
  p_net_usd numeric,
  p_studio_pct integer,
  p_goal_card_id uuid,
  p_stripe_session_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(12,4);
  v_net numeric(12,4);
  v_reserve_pct integer;
  v_incident_pct integer;
  v_incident_cap numeric(12,4);
  v_daily_cap numeric(12,4);
  v_hold_days integer;
  v_incident_held numeric(12,4);
  v_reserve numeric(12,4);
  v_remainder numeric(12,4);
  v_studio numeric(12,4);
  v_agents numeric(12,4);
  v_incident numeric(12,4);
  v_room numeric(12,4);
  v_credit numeric(12,4);
  v_used numeric(12,4);
  v_held numeric(12,4);
  v_hold_until timestamptz;
  v_goal uuid;
  v_goal_stage public.card_stage;
  v_goal_funded numeric(12,4);
  v_id uuid;
  v_size public.decision_size;
  v_decision uuid;
begin
  if p_stripe_event_id is null or p_stripe_event_id = '' then
    raise exception 'p_stripe_event_id is required';
  end if;
  if p_contributor_id is null or p_contributor_id = '' then
    raise exception 'p_contributor_id is required';
  end if;
  if p_amount_usd is null or p_amount_usd <= 0 then
    raise exception 'p_amount_usd must be above zero';
  end if;
  if p_net_usd is null or p_net_usd < 0 or p_net_usd > p_amount_usd then
    raise exception 'p_net_usd must be between zero and p_amount_usd';
  end if;
  if p_studio_pct is null or p_studio_pct < 0 or p_studio_pct > 100 then
    raise exception 'p_studio_pct must be between 0 and 100';
  end if;

  v_amount := round(p_amount_usd, 4);
  v_net := round(p_net_usd, 4);

  select reserve_pct, incident_pct, incident_cap_usd, credit_daily_cap_usd, credit_hold_days
  into v_reserve_pct, v_incident_pct, v_incident_cap, v_daily_cap, v_hold_days
  from public.studio_state where id = 1;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;

  -- The goal card is locked before the pool row. record_usage locks the card
  -- first and the pool second, so taking the locks in the same order here
  -- keeps the two functions from deadlocking against each other.
  v_goal := null;
  if p_goal_card_id is not null then
    select id into v_goal from public.cards where id = p_goal_card_id and shape = 'goal' for update;
  end if;

  select incident_reserve_usd into v_incident_held
  from public.pool where id = 1 for update;
  if not found then
    raise exception 'pool row 1 is missing';
  end if;

  v_reserve := round(v_net * v_reserve_pct / 100.0, 4);
  v_remainder := v_net - v_reserve;
  v_studio := round(v_remainder * p_studio_pct / 100.0, 4);
  v_agents := v_remainder - v_studio;
  v_room := greatest(0, v_incident_cap - v_incident_held);
  v_incident := least(round(v_agents * v_incident_pct / 100.0, 4), v_room);
  v_credit := v_agents - v_incident;

  -- Read after the pool lock, so two payments from one contributor take turns
  -- and the second sees the first. Refunds do not free room.
  select coalesce(sum(agents_usd - incident_usd - held_usd), 0) into v_used
  from public.contributions
  where contributor_id = p_contributor_id
    and entry = 'payment'
    and created_at >= (date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York');
  v_held := greatest(0, v_credit - greatest(0, v_daily_cap - v_used));
  v_hold_until := case when v_held > 0 then now() + make_interval(days => v_hold_days) end;

  insert into public.contributions (
    rail, contributor_id, display_name, amount_usd, net_usd, reserve_usd, agents_usd,
    studio_usd, incident_usd, studio_pct_chosen, kind, public, goal_card_id,
    stripe_event_id, stripe_session_id, credited_at, entry, held_usd, hold_until
  ) values (
    'stripe', p_contributor_id, p_display_name, v_amount, v_net, v_reserve, v_agents,
    v_studio, v_incident, p_studio_pct, 'cash', true, v_goal,
    p_stripe_event_id, nullif(p_stripe_session_id, ''), now(), 'payment', v_held, v_hold_until
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id, held_usd, hold_until into v_id, v_held, v_hold_until from public.contributions
    where stripe_event_id = p_stripe_event_id
       or (nullif(p_stripe_session_id, '') is not null and stripe_session_id = p_stripe_session_id)
    order by created_at asc
    limit 1;
    return jsonb_build_object(
      'inserted', false,
      'contribution_id', v_id,
      'reserve_usd', v_reserve,
      'studio_usd', v_studio,
      'agents_usd', v_agents,
      'incident_usd', v_incident,
      'pool_credit_usd', v_credit - coalesce(v_held, 0),
      'held_usd', coalesce(v_held, 0),
      'hold_until', v_hold_until,
      'goal_card_id', v_goal,
      'goal_stage', v_goal_stage,
      'goal_funded_usd', v_goal_funded
    );
  end if;

  update public.pool
  set balance_usd = balance_usd + (v_credit - v_held),
      held_usd = held_usd + v_held,
      incident_reserve_usd = incident_reserve_usd + v_incident,
      reserve_usd = reserve_usd + v_reserve
  where id = 1;

  -- The bar rises by the amount that reached the pool, so a full bar means the
  -- pool holds the card's estimate. Held money reaches the bar on release. The
  -- estimate is seeded from the target the first time money arrives. A
  -- proposed or voted card that reaches its target moves to funded; a card in
  -- any other stage keeps its stage.
  if v_goal is not null then
    update public.cards
    set funded_usd = funded_usd + (v_credit - v_held),
        estimate_usd = case when estimate_usd = 0 then funding_target_usd else estimate_usd end
    where id = v_goal;
    update public.cards
    set stage = 'funded'
    where id = v_goal
      and stage in ('proposed', 'voted')
      and funding_target_usd > 0
      and funded_usd >= funding_target_usd;
    select stage, funded_usd into v_goal_stage, v_goal_funded from public.cards where id = v_goal;
  end if;

  v_size := case
    when v_amount < 5 then 'small'::public.decision_size
    when v_amount < 50 then 'medium'::public.decision_size
    else 'large'::public.decision_size
  end;

  select id into v_decision
  from public.decisions
  where state = 'open' and size = v_size
  order by created_at asc
  limit 1
  for update skip locked;

  if v_decision is not null then
    update public.decisions
    set state = 'assigned',
        assigned_to = p_contributor_id,
        contribution_id = v_id,
        assigned_at = now()
    where id = v_decision;
    update public.contributions set decision_id = v_decision where id = v_id;
  end if;

  return jsonb_build_object(
    'inserted', true,
    'contribution_id', v_id,
    'reserve_usd', v_reserve,
    'studio_usd', v_studio,
    'agents_usd', v_agents,
    'incident_usd', v_incident,
    'pool_credit_usd', v_credit - v_held,
    'held_usd', v_held,
    'hold_until', v_hold_until,
    'goal_card_id', v_goal,
    'goal_stage', v_goal_stage,
    'goal_funded_usd', v_goal_funded
  );
end;
$$;

-- credit_held_contributions -------------------------------------------------
-- Releases every payment whose hold has ended: one release row per payment
-- (unique per parent), and only an inserted row moves money. The due payments
-- are found without locks, then their cards are locked in id order and the pool
-- last, the same card-then-pool order as apply_contribution and record_usage.
-- A hold that refunds already cancelled releases 0 so it leaves the queue.

create or replace function public.credit_held_contributions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_cards uuid[];
  v_parent record;
  v_amount numeric(12,4);
  v_release uuid;
  v_released integer := 0;
  v_released_usd numeric(12,4) := 0;
begin
  select coalesce(array_agg(due.id order by due.hold_until), '{}') into v_ids
  from (
    select p.id, p.hold_until
    from public.contributions p
    where p.entry = 'payment'
      and p.held_usd > 0
      and p.hold_until <= now()
      and not exists (
        select 1 from public.contributions r where r.parent_id = p.id and r.entry = 'release'
      )
    order by p.hold_until
    limit 500
  ) due;

  if cardinality(v_ids) = 0 then
    return jsonb_build_object('released', 0, 'released_usd', 0);
  end if;

  select coalesce(array_agg(distinct goal_card_id), '{}') into v_cards
  from public.contributions
  where id = any(v_ids) and goal_card_id is not null;

  perform 1 from public.cards where id = any(v_cards) order by id for update;
  perform 1 from public.pool where id = 1 for update;
  if not found then
    raise exception 'pool row 1 is missing';
  end if;

  for v_parent in
    select id, rail, contributor_id, studio_pct_chosen, kind, public, goal_card_id
    from public.contributions
    where id = any(v_ids)
    order by hold_until
  loop
    if exists (select 1 from public.contributions where parent_id = v_parent.id and entry = 'release') then
      continue;
    end if;
    select coalesce(sum(held_usd), 0) into v_amount
    from public.contributions
    where id = v_parent.id or parent_id = v_parent.id;
    v_amount := greatest(v_amount, 0);

    v_release := null;
    insert into public.contributions (
      entry, parent_id, rail, contributor_id, amount_usd, net_usd, reserve_usd, agents_usd,
      studio_usd, incident_usd, studio_pct_chosen, kind, public, goal_card_id, held_usd, credited_at
    ) values (
      'release', v_parent.id, v_parent.rail, v_parent.contributor_id, 0, 0, 0, 0,
      0, 0, v_parent.studio_pct_chosen, v_parent.kind, v_parent.public, v_parent.goal_card_id, -v_amount, now()
    )
    on conflict do nothing
    returning id into v_release;

    if v_release is null or v_amount = 0 then
      continue;
    end if;

    update public.pool
    set balance_usd = balance_usd + v_amount,
        held_usd = held_usd - v_amount
    where id = 1;

    if v_parent.goal_card_id is not null then
      update public.cards
      set funded_usd = funded_usd + v_amount,
          estimate_usd = case when estimate_usd = 0 then funding_target_usd else estimate_usd end
      where id = v_parent.goal_card_id and shape = 'goal';
      update public.cards
      set stage = 'funded'
      where id = v_parent.goal_card_id
        and shape = 'goal'
        and stage in ('proposed', 'voted')
        and funding_target_usd > 0
        and funded_usd >= funding_target_usd;
    end if;

    v_released := v_released + 1;
    v_released_usd := v_released_usd + v_amount;
  end loop;

  return jsonb_build_object('released', v_released, 'released_usd', v_released_usd);
end;
$$;

-- reverse_contribution ------------------------------------------------------
-- A refund or dispute event on the payment made through one Checkout session.
-- p_kind_total_usd is that kind's cumulative total from Stripe (a charge's
-- amount_refunded, or a dispute's amount), so a replay, several partial refunds
-- and events that arrive out of order each reverse only what is still due.
-- The reversed share is split in the payment's own proportions, rounded
-- cumulatively so a full reversal returns every column to zero. Held money is
-- cancelled before credited money. A dispute takes cover from the 10% reserve
-- first, so money already on the pool and the card bar stays while the reserve
-- can pay. The negative row records exactly what moved; the card keeps its
-- stage.

create or replace function public.reverse_contribution(
  p_stripe_event_id text,
  p_stripe_session_id text,
  p_kind public.contribution_entry,
  p_kind_total_usd numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.contributions%rowtype;
  v_pool_reserve numeric(12,4);
  v_before_kind numeric(12,4);
  v_before_all numeric(12,4);
  v_delta numeric(12,4);
  v_f0 numeric;
  v_f1 numeric;
  v_net numeric(12,4);
  v_reserve numeric(12,4);
  v_studio numeric(12,4);
  v_agents numeric(12,4);
  v_incident numeric(12,4);
  v_credit numeric(12,4);
  v_held_left numeric(12,4);
  v_held numeric(12,4);
  v_cover numeric(12,4) := 0;
  v_cover_balance numeric(12,4) := 0;
  v_cover_incident numeric(12,4) := 0;
  v_off_balance numeric(12,4);
  v_id uuid;
  v_goal_stage public.card_stage;
  v_goal_funded numeric(12,4);
  v_goal_target numeric(12,4);
  v_balance numeric(12,4);
begin
  if p_stripe_event_id is null or p_stripe_event_id = '' then
    raise exception 'p_stripe_event_id is required';
  end if;
  if p_stripe_session_id is null or p_stripe_session_id = '' then
    raise exception 'p_stripe_session_id is required';
  end if;
  if p_kind is null or p_kind not in ('refund', 'dispute') then
    raise exception 'p_kind must be refund or dispute';
  end if;
  if p_kind_total_usd is null or p_kind_total_usd < 0 then
    raise exception 'p_kind_total_usd must be zero or more';
  end if;

  select * into v_payment from public.contributions
  where stripe_session_id = p_stripe_session_id and entry = 'payment';
  if not found then
    return jsonb_build_object('found', false, 'inserted', false);
  end if;

  if v_payment.goal_card_id is not null then
    perform 1 from public.cards where id = v_payment.goal_card_id for update;
  end if;
  select reserve_usd into v_pool_reserve from public.pool where id = 1 for update;
  if not found then
    raise exception 'pool row 1 is missing';
  end if;

  if exists (select 1 from public.contributions where stripe_event_id = p_stripe_event_id) then
    return jsonb_build_object('found', true, 'inserted', false, 'replay', true, 'parent_id', v_payment.id);
  end if;

  select
    -coalesce(sum(amount_usd) filter (where entry = p_kind), 0),
    -coalesce(sum(amount_usd) filter (where entry in ('refund', 'dispute')), 0),
    coalesce(sum(held_usd), 0)
  into v_before_kind, v_before_all, v_held_left
  from public.contributions
  where parent_id = v_payment.id;
  v_held_left := greatest(v_held_left + v_payment.held_usd, 0);

  v_delta := least(round(p_kind_total_usd, 4) - v_before_kind, v_payment.amount_usd - v_before_all);
  if v_delta <= 0 then
    return jsonb_build_object(
      'found', true,
      'inserted', false,
      'replay', false,
      'parent_id', v_payment.id,
      'reversed_usd', 0,
      'reversed_total_usd', v_before_all,
      'fully_reversed', v_before_all >= v_payment.amount_usd
    );
  end if;

  v_f0 := v_before_all / v_payment.amount_usd;
  v_f1 := (v_before_all + v_delta) / v_payment.amount_usd;
  v_net := round(v_payment.net_usd * v_f1, 4) - round(v_payment.net_usd * v_f0, 4);
  v_reserve := round(v_payment.reserve_usd * v_f1, 4) - round(v_payment.reserve_usd * v_f0, 4);
  v_studio := round(v_payment.studio_usd * v_f1, 4) - round(v_payment.studio_usd * v_f0, 4);
  v_agents := round(v_payment.agents_usd * v_f1, 4) - round(v_payment.agents_usd * v_f0, 4);
  v_incident := round(v_payment.incident_usd * v_f1, 4) - round(v_payment.incident_usd * v_f0, 4);
  v_credit := v_agents - v_incident;
  v_held := least(v_credit, v_held_left);

  if p_kind = 'dispute' then
    v_cover := least(v_agents - v_held, greatest(v_pool_reserve - v_reserve, 0));
    v_cover_balance := least(v_cover, v_credit - v_held);
    v_cover_incident := v_cover - v_cover_balance;
  end if;
  v_off_balance := v_credit - v_held - v_cover_balance;

  insert into public.contributions (
    entry, parent_id, rail, contributor_id, amount_usd, net_usd, reserve_usd, agents_usd,
    studio_usd, incident_usd, studio_pct_chosen, kind, public, goal_card_id,
    stripe_event_id, held_usd, credited_at
  ) values (
    p_kind, v_payment.id, v_payment.rail, v_payment.contributor_id, -v_delta, -v_net,
    -(v_reserve + v_cover), -(v_agents - v_cover), -v_studio, -(v_incident - v_cover_incident),
    v_payment.studio_pct_chosen, v_payment.kind, v_payment.public, v_payment.goal_card_id,
    p_stripe_event_id, -v_held, now()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('found', true, 'inserted', false, 'replay', true, 'parent_id', v_payment.id);
  end if;

  update public.pool
  set balance_usd = balance_usd - v_off_balance,
      incident_reserve_usd = incident_reserve_usd - (v_incident - v_cover_incident),
      reserve_usd = reserve_usd - (v_reserve + v_cover),
      held_usd = held_usd - v_held
  where id = 1
  returning balance_usd into v_balance;

  if v_payment.goal_card_id is not null then
    update public.cards
    set funded_usd = funded_usd - v_off_balance
    where id = v_payment.goal_card_id
    returning stage, funded_usd, funding_target_usd into v_goal_stage, v_goal_funded, v_goal_target;
  end if;

  return jsonb_build_object(
    'found', true,
    'inserted', true,
    'replay', false,
    'contribution_id', v_id,
    'parent_id', v_payment.id,
    'kind', p_kind,
    'reversed_usd', v_delta,
    'reversed_total_usd', v_before_all + v_delta,
    'fully_reversed', v_before_all + v_delta >= v_payment.amount_usd,
    'held_cancelled_usd', v_held,
    'reserve_cover_usd', v_cover,
    'pool_balance_usd', v_balance,
    'goal_card_id', v_payment.goal_card_id,
    'goal_stage', v_goal_stage,
    'goal_funded_usd', v_goal_funded,
    'goal_target_usd', v_goal_target
  );
end;
$$;

-- public_card_funding -------------------------------------------------------
-- Same three columns. Only credited money counts toward a card (held money
-- joins on release, reversals subtract), and a contributor counts only while
-- their payments toward the card are not fully reversed.

create or replace view public.public_card_funding with (security_invoker = false) as
  select
    card_id,
    (count(*) filter (where paid_usd > 0))::integer as contributors,
    sum(credit_usd)::numeric(12,4) as credited_usd
  from (
    select
      goal_card_id as card_id,
      contributor_id,
      sum(amount_usd) as paid_usd,
      sum(agents_usd - incident_usd - held_usd) as credit_usd
    from public.contributions
    where goal_card_id is not null and credited_at is not null
    group by goal_card_id, contributor_id
  ) per_contributor
  group by card_id;

revoke all on table public.public_card_funding from anon, authenticated;
grant select on public.public_card_funding to anon, authenticated;

-- Function privileges -------------------------------------------------------

revoke all on function public.apply_contribution(text, text, text, numeric, numeric, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.apply_contribution(text, text, text, numeric, numeric, integer, uuid, text) to service_role;
revoke all on function public.credit_held_contributions() from public, anon, authenticated;
grant execute on function public.credit_held_contributions() to service_role;
revoke all on function public.reverse_contribution(text, text, public.contribution_entry, numeric) from public, anon, authenticated;
grant execute on function public.reverse_contribution(text, text, public.contribution_entry, numeric) to service_role;

-- The hourly release ---------------------------------------------------------
-- pg_cron runs credit_held_contributions() at minute 17 of every hour. A
-- database that does not ship pg_cron (PGlite in the tests) skips the
-- schedule; any error on a database that does ship it fails the migration.
-- cron.schedule with a job name replaces the existing job, so a second run is
-- safe.

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; credit_held_contributions is not scheduled';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('credit-held-contributions', '17 * * * *', 'select public.credit_held_contributions()');
end $$;
