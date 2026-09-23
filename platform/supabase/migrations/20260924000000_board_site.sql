-- The board's own site (docs/specs/board-site.md).
-- Applies after 20260923000200_rename_biz_dev.sql and can run twice.
--
-- The board now signs in on its own site, built only from kernel files, so
-- card-built code can ship on the public site again: the platform code lane
-- can open. It opens only when studio_state.platform_lane_open is set, which
-- the board's production step does once that site is live and the public
-- site holds no session. Until then file_card, set_card_horizon and
-- resume_card keep refusing a platform code card on now, as before, and the
-- dispatcher starts none. public_studio shows the flag, so /team can say
-- whether the Platform Builder runs.
--
-- set_caps takes the usage tier cap the scale change added to studio_state
-- (anthropic_tier_cap_usd). Because null already means "leave this cap as it
-- is", the tier cap changes only when p_set_anthropic_tier_cap is true, and
-- then null removes it. A cap is above zero and at most $1,000,000: it only
-- ever stops cards, so a high value is never a risk. board_studio_state
-- returns the tier cap and the lane flag.
--
-- board_needs_you is the board's first screen: the Controller's latest
-- reconcile figures (the credit to buy, the Minimum balance, the disputes to
-- answer and the latest payout), the last credit purchase, the emergency fund
-- and the S1 cards that may draw on it. It reads, for the board only, at aal1
-- like board_studio_state.

set lock_timeout = '5s';

-- The platform code lane ------------------------------------------------------

alter table public.studio_state add column if not exists platform_lane_open boolean not null default false;

-- file_card -------------------------------------------------------------------
-- The backlog version; a platform code card may go to now once the lane is open.

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
  if p_horizon = 'now' and p_folder = 'platform' and p_lane = 'code' and not coalesce((select s.platform_lane_open from public.studio_state s where s.id = 1), false) then
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

-- set_card_horizon ------------------------------------------------------------
-- The backlog version; the same lane rule.

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
    if v_after.folder = 'platform' and v_after.lane = 'code' and not coalesce((select s.platform_lane_open from public.studio_state s where s.id = 1), false) then
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

-- resume_card -----------------------------------------------------------------
-- The backlog version; the same lane rule.

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
  if v_card.folder = 'platform' and v_card.lane = 'code' and not coalesce((select s.platform_lane_open from public.studio_state s where s.id = 1), false) then
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

-- public_studio ---------------------------------------------------------------
-- The launch stamp, the pause and the lane flag, added at the end. Never who
-- paused it or when.

create or replace view public.public_studio with (security_invoker = false) as
  select launched_at, paused, platform_lane_open from public.studio_state where id = 1;

revoke all on table public.public_studio from anon, authenticated;
grant select on public.public_studio to anon, authenticated;

-- set_caps --------------------------------------------------------------------
-- The money-fixes version with the usage tier cap added last. The six-argument
-- signature is dropped so only this one exists.

drop function if exists public.set_caps(numeric, numeric, numeric, text, numeric, numeric);

create or replace function public.set_caps(
  p_daily_cap_usd numeric default null,
  p_card_max_usd numeric default null,
  p_agent_hourly_rate_usd numeric default null,
  p_reason text default null,
  p_monthly_cap_usd numeric default null,
  p_credit_studio_daily_cap_usd numeric default null,
  p_anthropic_tier_cap_usd numeric default null,
  p_set_anthropic_tier_cap boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.studio_state%rowtype;
  v_after public.studio_state%rowtype;
begin
  if public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Board membership is required';
  end if;
  if not public.board_aal2() then
    raise exception 'A second factor is required';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required';
  end if;
  if p_anthropic_tier_cap_usd is not null and not coalesce(p_set_anthropic_tier_cap, false) then
    raise exception 'Pass p_set_anthropic_tier_cap to change the usage tier cap';
  end if;
  if p_daily_cap_usd is null and p_card_max_usd is null and p_agent_hourly_rate_usd is null
    and p_monthly_cap_usd is null and p_credit_studio_daily_cap_usd is null
    and not coalesce(p_set_anthropic_tier_cap, false) then
    raise exception 'Name at least one cap to change';
  end if;
  if p_anthropic_tier_cap_usd <= 0 or p_anthropic_tier_cap_usd > 1000000 then
    raise exception 'The usage tier cap must be above zero and at most $1,000,000, or null for none';
  end if;
  if p_daily_cap_usd < 0 or p_card_max_usd < 0 or p_monthly_cap_usd < 0 or p_credit_studio_daily_cap_usd < 0 then
    raise exception 'A cap must be zero or more';
  end if;
  if p_agent_hourly_rate_usd <= 0 then
    raise exception 'The hourly rate must be above zero';
  end if;
  if greatest(p_daily_cap_usd, p_card_max_usd, p_agent_hourly_rate_usd, p_monthly_cap_usd, p_credit_studio_daily_cap_usd) > 10000 then
    raise exception 'A cap must be at most $10,000';
  end if;

  select * into v_before from public.studio_state where id = 1 for update;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;
  update public.studio_state
  set daily_cap_usd = coalesce(round(p_daily_cap_usd, 4), daily_cap_usd),
      card_max_usd = coalesce(round(p_card_max_usd, 4), card_max_usd),
      agent_hourly_rate_usd = coalesce(round(p_agent_hourly_rate_usd, 4), agent_hourly_rate_usd),
      monthly_cap_usd = coalesce(round(p_monthly_cap_usd, 4), monthly_cap_usd),
      credit_studio_daily_cap_usd = coalesce(round(p_credit_studio_daily_cap_usd, 4), credit_studio_daily_cap_usd),
      anthropic_tier_cap_usd = case when coalesce(p_set_anthropic_tier_cap, false) then round(p_anthropic_tier_cap_usd, 4) else anthropic_tier_cap_usd end
  where id = 1
  returning * into v_after;
  if v_after.card_max_usd > v_after.daily_cap_usd then
    raise exception 'The per-card maximum must not exceed the daily cap';
  end if;
  if v_after.daily_cap_usd > v_after.monthly_cap_usd then
    raise exception 'The daily cap must not exceed the monthly cap';
  end if;

  insert into public.board_actions (action, card_id, actor_email, reason, details)
  values ('set_caps', null, auth.email(), btrim(p_reason), jsonb_build_object(
    'before', jsonb_build_object(
      'daily_cap_usd', v_before.daily_cap_usd,
      'card_max_usd', v_before.card_max_usd,
      'agent_hourly_rate_usd', v_before.agent_hourly_rate_usd,
      'monthly_cap_usd', v_before.monthly_cap_usd,
      'credit_studio_daily_cap_usd', v_before.credit_studio_daily_cap_usd,
      'anthropic_tier_cap_usd', v_before.anthropic_tier_cap_usd
    ),
    'after', jsonb_build_object(
      'daily_cap_usd', v_after.daily_cap_usd,
      'card_max_usd', v_after.card_max_usd,
      'agent_hourly_rate_usd', v_after.agent_hourly_rate_usd,
      'monthly_cap_usd', v_after.monthly_cap_usd,
      'credit_studio_daily_cap_usd', v_after.credit_studio_daily_cap_usd,
      'anthropic_tier_cap_usd', v_after.anthropic_tier_cap_usd
    )
  ));

  return jsonb_build_object(
    'daily_cap_usd', v_after.daily_cap_usd,
    'card_max_usd', v_after.card_max_usd,
    'agent_hourly_rate_usd', v_after.agent_hourly_rate_usd,
    'monthly_cap_usd', v_after.monthly_cap_usd,
    'credit_studio_daily_cap_usd', v_after.credit_studio_daily_cap_usd,
    'anthropic_tier_cap_usd', v_after.anthropic_tier_cap_usd
  );
end;
$$;

-- board_studio_state ----------------------------------------------------------
-- The money-fixes version with the tier cap and the lane flag.

create or replace function public.board_studio_state() returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_state jsonb;
begin
  if not public.is_board_member() then
    raise exception 'Board or moderator membership is required';
  end if;
  select jsonb_build_object(
    'paused', paused,
    'paused_by', paused_by,
    'paused_at', paused_at,
    'agent_mode', agent_mode,
    'launched_at', launched_at,
    'dispatcher_seen_at', dispatcher_seen_at,
    'daily_cap_usd', daily_cap_usd,
    'card_max_usd', card_max_usd,
    'agent_hourly_rate_usd', agent_hourly_rate_usd,
    'monthly_cap_usd', monthly_cap_usd,
    'credit_daily_cap_usd', credit_daily_cap_usd,
    'credit_studio_daily_cap_usd', credit_studio_daily_cap_usd,
    'anthropic_tier_cap_usd', anthropic_tier_cap_usd,
    'platform_lane_open', platform_lane_open,
    'credit_bought_usd', (select coalesce(sum(amount_usd), 0) from public.credit_purchases),
    'credit_spent_usd', (select coalesce(sum(usd), 0) from public.ledger where billed_to in ('studio', 'overhead'))
  ) into v_state
  from public.studio_state where id = 1;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;
  return v_state;
end;
$$;

-- board_needs_you -------------------------------------------------------------

create or replace function public.board_needs_you() returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_run public.controller_runs%rowtype;
  v_controller jsonb;
  v_purchase jsonb;
  v_incident numeric(12,4);
  v_cards jsonb;
begin
  if public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Board membership is required';
  end if;
  select * into v_run from public.controller_runs
  where job = 'reconcile'
  order by created_at desc, id desc
  limit 1;
  if found then
    v_controller := jsonb_build_object(
      'finished_at', v_run.finished_at,
      'ok', v_run.ok,
      'mismatches', v_run.mismatches,
      'credit_purchase_usd', v_run.figures -> 'credit_purchase_usd',
      'minimum_balance_usd', v_run.figures -> 'minimum_balance_usd',
      'settlement_amount', v_run.figures #> '{minimum_balance,settlement_amount}',
      'settlement_currency', v_run.figures #> '{minimum_balance,settlement_currency}',
      'disputes_to_answer', coalesce(v_run.figures -> 'disputes_to_answer', '[]'::jsonb),
      'latest_payout', v_run.figures -> 'latest_payout'
    );
  end if;
  select jsonb_build_object('created_at', p.created_at, 'amount_usd', p.amount_usd) into v_purchase
  from public.credit_purchases p
  order by p.created_at desc, p.id desc
  limit 1;
  select incident_reserve_usd into v_incident from public.pool where id = 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'stage', c.stage) order by c.created_at, c.id), '[]'::jsonb)
  into v_cards
  from public.cards c
  where c.severity = 's1' and c.stage in ('funded', 'building', 'gated', 'paused');
  return jsonb_build_object(
    'controller', v_controller,
    'last_credit_purchase', v_purchase,
    'incident_reserve_usd', coalesce(v_incident, 0),
    's1_cards', v_cards
  );
end;
$$;

-- Function privileges -------------------------------------------------------

revoke all on function public.file_card(public.card_bucket, public.card_lane, public.card_folder, text, text, text, text, numeric, public.card_stage, uuid, text, public.card_horizon) from public, anon;
grant execute on function public.file_card(public.card_bucket, public.card_lane, public.card_folder, text, text, text, text, numeric, public.card_stage, uuid, text, public.card_horizon) to authenticated, service_role;
revoke all on function public.set_card_horizon(uuid, public.card_horizon, integer, text, numeric, text, uuid, public.card_lane, text) from public, anon;
grant execute on function public.set_card_horizon(uuid, public.card_horizon, integer, text, numeric, text, uuid, public.card_lane, text) to authenticated, service_role;
revoke all on function public.resume_card(uuid, numeric, text) from public, anon;
grant execute on function public.resume_card(uuid, numeric, text) to authenticated, service_role;
revoke all on function public.set_caps(numeric, numeric, numeric, text, numeric, numeric, numeric, boolean) from public, anon;
grant execute on function public.set_caps(numeric, numeric, numeric, text, numeric, numeric, numeric, boolean) to authenticated, service_role;
revoke all on function public.board_studio_state() from public, anon;
grant execute on function public.board_studio_state() to authenticated, service_role;
revoke all on function public.board_needs_you() from public, anon;
grant execute on function public.board_needs_you() to authenticated, service_role;

notify pgrst, 'reload schema';
