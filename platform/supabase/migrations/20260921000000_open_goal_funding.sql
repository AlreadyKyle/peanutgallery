-- Open goal funding (docs/specs/card-columns-and-open-funding.md).
-- Applies on top of 20260920000000_refunds_and_holds.sql and can run twice.
-- Both functions keep their signatures, their arithmetic and their grants.

-- apply_contribution --------------------------------------------------------
-- Same as the refunds-and-holds version except the goal lookup. A payment
-- credits a goal card only while the card is open to funding (proposed,
-- designing or voted). Money that names a funded, building, gated, live,
-- rejected or paused card funds the pool, and its row records no goal card.
-- Money already held for an open card still reaches that card's bar when
-- credit_held_contributions releases it, whatever the card's stage by then.

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
    select id into v_goal from public.cards where id = p_goal_card_id and shape = 'goal' and stage in ('proposed', 'designing', 'voted') for update;
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

-- reverse_contribution ------------------------------------------------------
-- Same as the refunds-and-holds version, and it returns three more figures.
-- The pool's 10% reserve and incident reserve after the reversal show a
-- reserve that a refund or dispute took below zero. kind_reversed_usd (what
-- this kind had already reversed on the payment before the call) and
-- kind_total_usd (the kind's cumulative total the call asked for) let the
-- webhook tell, when nothing is left to reverse, whether this kind already
-- reversed it or the other kind took it.

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
  v_reserve_after numeric(12,4);
  v_incident_after numeric(12,4);
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
      'kind_reversed_usd', v_before_kind,
      'kind_total_usd', round(p_kind_total_usd, 4),
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
  returning balance_usd, reserve_usd, incident_reserve_usd into v_balance, v_reserve_after, v_incident_after;

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
    'kind_reversed_usd', v_before_kind,
    'kind_total_usd', round(p_kind_total_usd, 4),
    'fully_reversed', v_before_all + v_delta >= v_payment.amount_usd,
    'held_cancelled_usd', v_held,
    'reserve_cover_usd', v_cover,
    'pool_balance_usd', v_balance,
    'pool_reserve_usd', v_reserve_after,
    'pool_incident_reserve_usd', v_incident_after,
    'goal_card_id', v_payment.goal_card_id,
    'goal_stage', v_goal_stage,
    'goal_funded_usd', v_goal_funded,
    'goal_target_usd', v_goal_target
  );
end;
$$;

-- Function privileges -------------------------------------------------------

revoke all on function public.apply_contribution(text, text, text, numeric, numeric, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.apply_contribution(text, text, text, numeric, numeric, integer, uuid, text) to service_role;
revoke all on function public.reverse_contribution(text, text, public.contribution_entry, numeric) from public, anon, authenticated;
grant execute on function public.reverse_contribution(text, text, public.contribution_entry, numeric) to service_role;
