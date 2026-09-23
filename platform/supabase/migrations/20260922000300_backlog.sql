-- Backlog horizons and the board's card controls (docs/specs/launch-db.md).
-- Applies after 20260922000200_dispatcher_lease.sql and can run twice.
--
-- A card sits on one of three horizons. now is the set players can fund and
-- the agents build; next and later are the planned backlog, listed on the
-- roadmap and never funded. rank orders a horizon, lower first. Every card
-- that exists today is on now. Anon reads both columns.
--
-- Money follows the horizon: a payment credits a card's bar only while the
-- card is open to funding and on now, and a released hold moves a card to
-- funded only on now. A card with money on its bar or on hold cannot leave
-- now; the board cancels it instead.
--
-- file_card takes a horizon, defaulting to now, and its target is no longer
-- capped by the per-card maximum, which stays the per-card spend ceiling.
-- The board gains set_card_horizon, cancel_card and resume_card. A card moves
-- to now only when it meets the definition of ready: a title, a summary, an
-- intent, an acceptance test with a check: line, a lane, a folder, an active
-- executor and a funding target above zero. The platform code lane is closed:
-- no platform code card goes to now until the board runs on its own site.

set lock_timeout = '5s';

-- Horizon and rank ----------------------------------------------------------

do $$
begin
  create type public.card_horizon as enum ('now', 'next', 'later');
exception
  when duplicate_object then null;
end
$$;

alter table public.cards add column if not exists horizon public.card_horizon not null default 'now';
alter table public.cards add column if not exists rank integer;
alter table public.cards drop constraint if exists cards_rank_check;
alter table public.cards add constraint cards_rank_check check (rank is null or rank >= 0);
create index if not exists cards_horizon_rank_idx on public.cards (horizon, rank);

-- Column grants on cards ----------------------------------------------------
-- The public-card-columns list with horizon and rank added. Revoking first
-- clears any column grant, so a second run starts from nothing. actual_usd,
-- severity and priority stay withheld.

revoke all on public.cards from anon, authenticated;
grant select (
  id, bucket, source, shape, lane, board_reason, folder, executor_role_id,
  title, summary, intent, acceptance_test, design_spec_url,
  funding_target_usd, funded_usd, estimate_usd, confidence, proposer_role_id,
  director_stance, veto_reason, stage, branch, commit_sha, failing_check,
  created_at, updated_at, live_at, horizon, rank
) on public.cards to anon, authenticated;

-- file_card -----------------------------------------------------------------
-- The board-two-factor version with p_horizon added last, defaulting to now,
-- so the deployed /board's eleven named arguments keep working. The target is
-- above zero and at most $10,000, a guard against a mistyped amount. The
-- eleven-argument signature is dropped so only this one exists.

drop function if exists public.file_card(public.card_bucket, public.card_lane, public.card_folder, text, text, text, text, numeric, public.card_stage, uuid, text);

create or replace function public.file_card(
  p_bucket public.card_bucket,
  p_lane public.card_lane,
  p_folder public.card_folder,
  p_title text,
  p_summary text,
  p_intent text,
  p_acceptance_test text,
  p_funding_target_usd numeric,
  p_stage public.card_stage,
  p_executor_role_id uuid,
  p_board_reason text,
  p_horizon public.card_horizon default 'now'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Board membership is required';
  end if;
  if not public.board_aal2() then
    raise exception 'A second factor is required';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'A title is required';
  end if;
  if p_summary is null or btrim(p_summary) = '' then
    raise exception 'A public summary is required';
  end if;
  if char_length(btrim(p_summary)) > 200 then
    raise exception 'The public summary must be 200 characters or fewer';
  end if;
  if p_stage is null or p_stage not in ('proposed', 'voted') then
    raise exception 'A Next card starts at proposed or voted';
  end if;
  if p_horizon is null then
    raise exception 'A horizon is required';
  end if;
  if p_funding_target_usd is null or p_funding_target_usd <= 0 then
    raise exception 'The funding target must be above zero';
  end if;
  if p_funding_target_usd > 10000 then
    raise exception 'The funding target must be at most $10,000';
  end if;
  if p_lane = 'config' and p_folder <> 'seed-1' then
    raise exception 'The config lane exists only for seed-1';
  end if;
  if p_lane = 'config' and coalesce(p_acceptance_test, '') !~ '(^|\n)\s*check:\s' then
    raise exception 'A config-lane card needs a check: line in its acceptance test';
  end if;
  if p_horizon = 'now' and p_folder = 'platform' and p_lane = 'code' then
    raise exception 'The platform code lane is closed until the board has its own site';
  end if;
  if p_executor_role_id is null then
    raise exception 'An executor role is required';
  end if;
  if not exists (
    select 1 from public.roles where id = p_executor_role_id and state = 'active'
  ) then
    raise exception 'The executor must be an active role';
  end if;
  insert into public.cards (
    bucket, source, shape, lane, priority, board_reason, folder, executor_role_id,
    title, summary, intent, acceptance_test, funding_target_usd, funded_usd, estimate_usd,
    confidence, proposer_role_id, stage, horizon
  ) values (
    p_bucket, 'board', 'goal', p_lane, 100, nullif(btrim(p_board_reason), ''), p_folder, p_executor_role_id,
    btrim(p_title), btrim(p_summary), p_intent, p_acceptance_test, round(p_funding_target_usd, 4), 0, round(p_funding_target_usd, 4),
    'low', null, p_stage, p_horizon
  )
  returning id into v_id;
  insert into public.board_actions (action, card_id, actor_email, reason, details)
  values ('file_card', v_id, auth.email(), coalesce(nullif(btrim(p_board_reason), ''), 'No reason given'), jsonb_build_object(
    'horizon', p_horizon,
    'stage', p_stage,
    'funding_target_usd', round(p_funding_target_usd, 4)
  ));
  return v_id;
end;
$$;

-- apply_contribution --------------------------------------------------------
-- The money-fixes version; the goal card must also be on now.

create or replace function public.apply_contribution(
  p_stripe_event_id text,
  p_contributor_id text,
  p_display_name text,
  p_amount_usd numeric,
  p_net_usd numeric,
  p_studio_pct integer,
  p_goal_card_id uuid,
  p_stripe_session_id text default null,
  p_payer_key text default null
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
  v_studio_cap numeric(12,4);
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
  v_studio_used numeric(12,4);
  v_payer text;
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
  v_payer := coalesce(nullif(btrim(p_payer_key), ''), 'email:' || p_contributor_id);
  if v_payer !~ '^(card|email):.+$' then
    raise exception 'p_payer_key must start with card: or email:';
  end if;

  v_amount := round(p_amount_usd, 4);
  v_net := round(p_net_usd, 4);

  select reserve_pct, incident_pct, incident_cap_usd, credit_daily_cap_usd, credit_hold_days, credit_studio_daily_cap_usd
  into v_reserve_pct, v_incident_pct, v_incident_cap, v_daily_cap, v_hold_days, v_studio_cap
  from public.studio_state where id = 1;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;

  -- The goal card is locked before the pool row. record_usage locks the card
  -- first and the pool second, so taking the locks in the same order here
  -- keeps the two functions from deadlocking against each other.
  v_goal := null;
  if p_goal_card_id is not null then
    select id into v_goal from public.cards where id = p_goal_card_id and shape = 'goal' and stage in ('proposed', 'designing', 'voted') and horizon = 'now' for update;
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

  -- Read after the pool lock, so two payments from one payer take turns and
  -- the second sees the first. A payer is the card behind the payment or the
  -- email: the day's window counts every payment that shares either one, so a
  -- second email on the same card and a second card on the same email share
  -- one $50. The studio-wide room counts every payment today. Refunds do not
  -- free room.
  select coalesce(sum(agents_usd - incident_usd - held_usd), 0) into v_used
  from public.contributions
  where (payer_key = v_payer or contributor_id = p_contributor_id)
    and entry = 'payment'
    and created_at >= (date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York');
  select coalesce(sum(agents_usd - incident_usd - held_usd), 0) into v_studio_used
  from public.contributions
  where entry = 'payment'
    and created_at >= (date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York');
  v_held := greatest(0, v_credit - least(greatest(0, v_daily_cap - v_used), greatest(0, v_studio_cap - v_studio_used)));
  v_hold_until := case when v_held > 0 then now() + make_interval(days => v_hold_days) end;

  insert into public.contributions (
    rail, contributor_id, display_name, amount_usd, net_usd, reserve_usd, agents_usd,
    studio_usd, incident_usd, studio_pct_chosen, kind, public, goal_card_id,
    stripe_event_id, stripe_session_id, credited_at, entry, held_usd, hold_until, payer_key
  ) values (
    'stripe', p_contributor_id, p_display_name, v_amount, v_net, v_reserve, v_agents,
    v_studio, v_incident, p_studio_pct, 'cash', true, v_goal,
    p_stripe_event_id, nullif(p_stripe_session_id, ''), now(), 'payment', v_held, v_hold_until, v_payer
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id, held_usd, hold_until, goal_card_id into v_id, v_held, v_hold_until, v_goal from public.contributions
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
-- The refunds-and-holds version; a release moves a card to funded only on
-- now. A release still credits the bar of the card the payment named, so the
-- bar and the refund arithmetic stay a plain sum over the payment's rows
-- (card-columns-and-open-funding.md, decision of 16 September 2026).

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
        and horizon = 'now'
        and funding_target_usd > 0
        and funded_usd >= funding_target_usd;
    end if;

    v_released := v_released + 1;
    v_released_usd := v_released_usd + v_amount;
  end loop;

  return jsonb_build_object('released', v_released, 'released_usd', v_released_usd);
end;
$$;

-- set_card_horizon ----------------------------------------------------------
-- Moves an open card (proposed, designing or voted) between horizons, or sets
-- its rank on the one it is on. A move off now is refused while the card has
-- money on its bar or on hold. A move to now takes a funding target and may
-- supply the other fields a backlog card lacks: an acceptance test, an
-- executor, a lane and an intent. The card must then meet the definition of
-- ready. Card fields are set only on a move to now.

create or replace function public.set_card_horizon(
  p_card uuid,
  p_horizon public.card_horizon,
  p_rank integer,
  p_reason text,
  p_target_usd numeric default null,
  p_acceptance_test text default null,
  p_executor_role_id uuid default null,
  p_lane public.card_lane default null,
  p_intent text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
  v_after public.cards%rowtype;
  v_fields boolean;
begin
  if public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Board membership is required';
  end if;
  if not public.board_aal2() then
    raise exception 'A second factor is required';
  end if;
  if p_card is null then
    raise exception 'A card is required';
  end if;
  if p_horizon is null then
    raise exception 'A horizon is required';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required';
  end if;
  if p_rank < 0 then
    raise exception 'The rank must be zero or more';
  end if;
  v_fields := p_target_usd is not null or p_acceptance_test is not null or p_executor_role_id is not null
    or p_lane is not null or p_intent is not null;

  select * into v_card from public.cards where id = p_card for update;
  if not found then
    raise exception 'Card % does not exist', p_card;
  end if;
  if v_card.stage not in ('proposed', 'designing', 'voted') then
    raise exception 'Only a card open for funding changes horizon; cancel it with a reason instead';
  end if;

  if p_horizon <> 'now' or v_card.horizon = 'now' then
    if v_fields then
      raise exception 'Card fields are set only when a card moves to now';
    end if;
    if v_card.horizon = 'now' and p_horizon <> 'now' then
      if v_card.funded_usd <> 0 then
        raise exception 'A card with money on its bar stays on now; cancel it with a reason instead';
      end if;
      if exists (
        select 1 from public.contributions p
        where p.goal_card_id = p_card
          and p.entry = 'payment'
          and p.held_usd + coalesce((select sum(c.held_usd) from public.contributions c where c.parent_id = p.id), 0) > 0
      ) then
        raise exception 'A card with money on hold stays on now; cancel it with a reason instead';
      end if;
    end if;
    update public.cards set horizon = p_horizon, rank = p_rank where id = p_card
    returning * into v_after;
  else
    if v_card.shape <> 'goal' then
      raise exception 'Only a goal card moves to now';
    end if;
    if p_target_usd is null then
      raise exception 'A funding target is required to move a card to now';
    end if;
    if p_target_usd <= 0 then
      raise exception 'The funding target must be above zero';
    end if;
    if p_target_usd > 10000 then
      raise exception 'The funding target must be at most $10,000';
    end if;
    update public.cards
    set horizon = 'now',
        rank = p_rank,
        funding_target_usd = round(p_target_usd, 4),
        estimate_usd = case when funded_usd = 0 then round(p_target_usd, 4) else estimate_usd end,
        acceptance_test = coalesce(p_acceptance_test, acceptance_test),
        executor_role_id = coalesce(p_executor_role_id, executor_role_id),
        lane = coalesce(p_lane, lane),
        intent = coalesce(nullif(btrim(p_intent), ''), intent)
    where id = p_card
    returning * into v_after;
    -- The definition of ready, on the card as it now stands.
    if btrim(coalesce(v_after.title, '')) = '' then
      raise exception 'A card on now needs a title';
    end if;
    if btrim(coalesce(v_after.summary, '')) = '' then
      raise exception 'A card on now needs a public summary';
    end if;
    if btrim(coalesce(v_after.intent, '')) = '' then
      raise exception 'A card on now needs an intent';
    end if;
    if coalesce(v_after.acceptance_test, '') !~ '(^|\n)\s*check:\s' then
      raise exception 'A card on now needs a check: line in its acceptance test';
    end if;
    if v_after.lane = 'config' and v_after.folder <> 'seed-1' then
      raise exception 'The config lane exists only for seed-1';
    end if;
    if v_after.folder = 'platform' and v_after.lane = 'code' then
      raise exception 'The platform code lane is closed until the board has its own site';
    end if;
    if v_after.executor_role_id is null then
      raise exception 'A card on now needs an executor role';
    end if;
    if not exists (
      select 1 from public.roles where id = v_after.executor_role_id and state = 'active'
    ) then
      raise exception 'The executor must be an active role';
    end if;
  end if;

  insert into public.board_actions (action, card_id, actor_email, reason, details)
  values ('set_card_horizon', p_card, auth.email(), btrim(p_reason), jsonb_build_object(
    'from_horizon', v_card.horizon,
    'to_horizon', v_after.horizon,
    'from_rank', v_card.rank,
    'to_rank', v_after.rank,
    'from_target_usd', v_card.funding_target_usd,
    'to_target_usd', v_after.funding_target_usd
  ));

  return jsonb_build_object(
    'card_id', v_after.id,
    'horizon', v_after.horizon,
    'rank', v_after.rank,
    'stage', v_after.stage,
    'funding_target_usd', v_after.funding_target_usd
  );
end;
$$;

-- cancel_card ---------------------------------------------------------------
-- Rejects a card with the board's reason. Only a card that no agent is
-- working on can be cancelled: proposed, designing, voted, funded or paused.
-- To stop a building or gated card the board pauses the studio first, which
-- stops the session and the merge, and cancels the card once it shows paused.
-- A card holding supporters' money (on its bar or on hold) is refused.

create or replace function public.cancel_card(p_card uuid, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
begin
  if public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Board membership is required';
  end if;
  if not public.board_aal2() then
    raise exception 'A second factor is required';
  end if;
  if p_card is null then
    raise exception 'A card is required';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required';
  end if;
  select * into v_card from public.cards where id = p_card for update;
  if not found then
    raise exception 'Card % does not exist', p_card;
  end if;
  if v_card.stage in ('building', 'gated') then
    raise exception 'A building or gated card cannot be cancelled; pause the studio and cancel it once it shows paused';
  end if;
  if v_card.stage not in ('proposed', 'designing', 'voted', 'funded', 'paused') then
    raise exception 'A % card cannot be cancelled', v_card.stage;
  end if;
  -- Supporters funded this card to be built. A card with money on its bar, or
  -- a payment still on hold for it, is not cancelled; its supporters are
  -- refunded first, which clears the bar.
  if v_card.funded_usd > 0 or exists (
    select 1
    from public.contributions p
    where p.goal_card_id = p_card
      and p.entry = 'payment'
      and not exists (
        select 1 from public.contributions r where r.parent_id = p.id and r.entry = 'release'
      )
      and (
        select coalesce(sum(c.held_usd), 0)
        from public.contributions c
        where c.id = p.id or c.parent_id = p.id
      ) > 0
  ) then
    raise exception 'A card holding supporters'' money cannot be cancelled; refund its supporters first';
  end if;
  update public.cards set stage = 'rejected', failing_check = 'cancelled_by_board' where id = p_card;
  insert into public.board_actions (action, card_id, actor_email, reason, details)
  values ('cancel_card', p_card, auth.email(), btrim(p_reason), jsonb_build_object(
    'from_stage', v_card.stage,
    'funded_usd', v_card.funded_usd
  ));
  return jsonb_build_object('card_id', p_card, 'stage', 'rejected', 'from_stage', v_card.stage);
end;
$$;

-- resume_card ---------------------------------------------------------------
-- Sends a paused card on now back to funded with a new estimate of at least
-- what it has already cost. The platform code lane stays closed.

create or replace function public.resume_card(p_card uuid, p_estimate_usd numeric, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
begin
  if public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Board membership is required';
  end if;
  if not public.board_aal2() then
    raise exception 'A second factor is required';
  end if;
  if p_card is null then
    raise exception 'A card is required';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required';
  end if;
  select * into v_card from public.cards where id = p_card for update;
  if not found then
    raise exception 'Card % does not exist', p_card;
  end if;
  if v_card.stage <> 'paused' then
    raise exception 'Only a paused card can be resumed';
  end if;
  if v_card.horizon <> 'now' then
    raise exception 'Only a card on now can be resumed';
  end if;
  if v_card.folder = 'platform' and v_card.lane = 'code' then
    raise exception 'The platform code lane is closed until the board has its own site';
  end if;
  if p_estimate_usd is null or p_estimate_usd <= 0 then
    raise exception 'The estimate must be above zero';
  end if;
  if p_estimate_usd > 10000 then
    raise exception 'The estimate must be at most $10,000';
  end if;
  if round(p_estimate_usd, 4) < v_card.actual_usd then
    raise exception 'The estimate must be at least the card''s cost so far of %', v_card.actual_usd;
  end if;
  update public.cards set stage = 'funded', estimate_usd = round(p_estimate_usd, 4) where id = p_card;
  insert into public.board_actions (action, card_id, actor_email, reason, details)
  values ('resume_card', p_card, auth.email(), btrim(p_reason), jsonb_build_object(
    'from_estimate_usd', v_card.estimate_usd,
    'to_estimate_usd', round(p_estimate_usd, 4),
    'actual_usd', v_card.actual_usd,
    'failing_check', v_card.failing_check
  ));
  return jsonb_build_object('card_id', p_card, 'stage', 'funded', 'estimate_usd', round(p_estimate_usd, 4));
end;
$$;

-- Function privileges -------------------------------------------------------

revoke all on function public.file_card(public.card_bucket, public.card_lane, public.card_folder, text, text, text, text, numeric, public.card_stage, uuid, text, public.card_horizon) from public, anon;
grant execute on function public.file_card(public.card_bucket, public.card_lane, public.card_folder, text, text, text, text, numeric, public.card_stage, uuid, text, public.card_horizon) to authenticated, service_role;
revoke all on function public.set_card_horizon(uuid, public.card_horizon, integer, text, numeric, text, uuid, public.card_lane, text) from public, anon;
grant execute on function public.set_card_horizon(uuid, public.card_horizon, integer, text, numeric, text, uuid, public.card_lane, text) to authenticated, service_role;
revoke all on function public.cancel_card(uuid, text) from public, anon;
grant execute on function public.cancel_card(uuid, text) to authenticated, service_role;
revoke all on function public.resume_card(uuid, numeric, text) from public, anon;
grant execute on function public.resume_card(uuid, numeric, text) to authenticated, service_role;
revoke all on function public.apply_contribution(text, text, text, numeric, numeric, integer, uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_contribution(text, text, text, numeric, numeric, integer, uuid, text, text) to service_role;
revoke all on function public.credit_held_contributions() from public, anon, authenticated;
grant execute on function public.credit_held_contributions() to service_role;

notify pgrst, 'reload schema';
