-- The live cut (docs/specs/live-cut.md, next-cards.md, unattended-mode.md).
-- Applies on top of 20260914000000_week1_schema.sql. Every statement is
-- create or replace / add column if not exists, so the file can run twice.
-- No new tables, no policy changes, no publication changes.

-- apply_contribution --------------------------------------------------------
-- Same signature as week 1. Three changes: the goal card is resolved and
-- locked before the pool row, the card's bar is credited with the agents' net
-- amount (agents_usd - incident_usd) and its estimate is seeded from the
-- target, and a proposed or voted card whose bar reaches its target moves to
-- funded. The returned jsonb gains goal_card_id, goal_stage and
-- goal_funded_usd; all three are null when the contribution has no goal card.

create or replace function public.apply_contribution(
  p_stripe_event_id text,
  p_contributor_id text,
  p_display_name text,
  p_amount_usd numeric,
  p_net_usd numeric,
  p_studio_pct integer,
  p_goal_card_id uuid
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
  v_incident_held numeric(12,4);
  v_reserve numeric(12,4);
  v_remainder numeric(12,4);
  v_studio numeric(12,4);
  v_agents numeric(12,4);
  v_incident numeric(12,4);
  v_room numeric(12,4);
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

  select reserve_pct, incident_pct, incident_cap_usd
  into v_reserve_pct, v_incident_pct, v_incident_cap
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

  insert into public.contributions (
    rail, contributor_id, display_name, amount_usd, net_usd, reserve_usd, agents_usd,
    studio_usd, incident_usd, studio_pct_chosen, kind, public, goal_card_id,
    stripe_event_id, credited_at
  ) values (
    'stripe', p_contributor_id, p_display_name, v_amount, v_net, v_reserve, v_agents,
    v_studio, v_incident, p_studio_pct, 'cash', true, v_goal,
    p_stripe_event_id, now()
  )
  on conflict (stripe_event_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.contributions where stripe_event_id = p_stripe_event_id;
    return jsonb_build_object(
      'inserted', false,
      'contribution_id', v_id,
      'reserve_usd', v_reserve,
      'studio_usd', v_studio,
      'agents_usd', v_agents,
      'incident_usd', v_incident,
      'pool_credit_usd', v_agents - v_incident,
      'goal_card_id', v_goal,
      'goal_stage', v_goal_stage,
      'goal_funded_usd', v_goal_funded
    );
  end if;

  update public.pool
  set balance_usd = balance_usd + (v_agents - v_incident),
      incident_reserve_usd = incident_reserve_usd + v_incident,
      reserve_usd = reserve_usd + v_reserve
  where id = 1;

  -- The bar rises by the amount that reached the pool, so a full bar means the
  -- pool holds the card's estimate. The estimate is seeded from the target the
  -- first time money arrives. A proposed or voted card that reaches its target
  -- moves to funded; a card in any other stage keeps its stage.
  if v_goal is not null then
    update public.cards
    set funded_usd = funded_usd + (v_agents - v_incident),
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
    'pool_credit_usd', v_agents - v_incident,
    'goal_card_id', v_goal,
    'goal_stage', v_goal_stage,
    'goal_funded_usd', v_goal_funded
  );
end;
$$;

-- file_card -----------------------------------------------------------------
-- The board files a Next card: a goal card with a funding target at or below
-- the per-card maximum, at stage proposed (Open) or voted (Decided). A
-- config-lane card exists only for seed-1 and must carry a check: line for the
-- dispatcher's pre-check and post-check.

create or replace function public.file_card(
  p_bucket public.card_bucket,
  p_lane public.card_lane,
  p_folder public.card_folder,
  p_title text,
  p_intent text,
  p_acceptance_test text,
  p_funding_target_usd numeric,
  p_stage public.card_stage,
  p_executor_role_id uuid,
  p_board_reason text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card_max numeric(12,4);
  v_id uuid;
begin
  if public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Board membership is required';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'A title is required';
  end if;
  if p_stage is null or p_stage not in ('proposed', 'voted') then
    raise exception 'A Next card starts at proposed or voted';
  end if;
  select card_max_usd into v_card_max from public.studio_state where id = 1;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;
  if p_funding_target_usd is null or p_funding_target_usd <= 0 then
    raise exception 'The funding target must be above zero';
  end if;
  if p_funding_target_usd > v_card_max then
    raise exception 'The funding target must not exceed the per-card maximum of %', v_card_max;
  end if;
  if p_lane = 'config' and p_folder <> 'seed-1' then
    raise exception 'The config lane exists only for seed-1';
  end if;
  if p_lane = 'config' and coalesce(p_acceptance_test, '') !~ '(^|\n)\s*check:\s' then
    raise exception 'A config-lane card needs a check: line in its acceptance test';
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
    title, intent, acceptance_test, funding_target_usd, funded_usd, estimate_usd,
    confidence, proposer_role_id, stage
  ) values (
    p_bucket, 'board', 'goal', p_lane, 100, nullif(btrim(p_board_reason), ''), p_folder, p_executor_role_id,
    btrim(p_title), p_intent, p_acceptance_test, round(p_funding_target_usd, 4), 0, round(p_funding_target_usd, 4),
    'low', null, p_stage
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- studio_state: launch stamp and dispatcher heartbeat ----------------------

alter table public.studio_state add column if not exists launched_at timestamptz;
alter table public.studio_state add column if not exists dispatcher_seen_at timestamptz;

-- set_launched stamps launched_at once. A second call leaves the first stamp
-- in place and returns it.
create or replace function public.set_launched() returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_launched timestamptz;
begin
  if public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Board membership is required';
  end if;
  update public.studio_state
  set launched_at = now()
  where id = 1 and launched_at is null;
  select launched_at into v_launched from public.studio_state where id = 1;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;
  return v_launched;
end;
$$;

-- set_agent_mode records which mode the dispatcher must run in. The dispatcher
-- refuses to boot when its own mode differs from this value.
create or replace function public.set_agent_mode(p_mode text) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Board membership is required';
  end if;
  if p_mode is null or p_mode not in ('attended', 'unattended') then
    raise exception 'agent_mode must be attended or unattended';
  end if;
  update public.studio_state set agent_mode = p_mode where id = 1;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;
end;
$$;

-- board_studio_state is the board page's window onto studio_state, which stays
-- revoked from anon and authenticated. Board and moderator may read it.
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
    'card_max_usd', card_max_usd
  ) into v_state
  from public.studio_state where id = 1;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;
  return v_state;
end;
$$;

-- Public views --------------------------------------------------------------
-- Both run with the view owner's rights on purpose, the way public_agent_events
-- does: studio_state and contributions are closed to anon and authenticated,
-- and these views are the only public windows onto them.

-- public_studio: the launch stamp and nothing else.
create or replace view public.public_studio with (security_invoker = false) as
  select launched_at from public.studio_state where id = 1;

-- public_card_funding: per goal card, how many distinct contributors named it
-- and how much of their money reached the pool. A contributor who pays twice
-- counts once. No names, no amounts per person.
create or replace view public.public_card_funding with (security_invoker = false) as
  select
    goal_card_id as card_id,
    count(distinct contributor_id)::integer as contributors,
    sum(agents_usd - incident_usd)::numeric(12,4) as credited_usd
  from public.contributions
  where goal_card_id is not null
  group by goal_card_id;

revoke all on table public.public_studio, public.public_card_funding from anon, authenticated;
grant select on public.public_studio to anon, authenticated;
grant select on public.public_card_funding to anon, authenticated;

-- Function privileges -------------------------------------------------------

revoke all on function public.file_card(public.card_bucket, public.card_lane, public.card_folder, text, text, text, numeric, public.card_stage, uuid, text) from public, anon;
revoke all on function public.set_launched() from public, anon;
revoke all on function public.set_agent_mode(text) from public, anon;
revoke all on function public.board_studio_state() from public, anon;
grant execute on function public.file_card(public.card_bucket, public.card_lane, public.card_folder, text, text, text, numeric, public.card_stage, uuid, text) to authenticated, service_role;
grant execute on function public.set_launched() to authenticated, service_role;
grant execute on function public.set_agent_mode(text) to authenticated, service_role;
grant execute on function public.board_studio_state() to authenticated, service_role;
