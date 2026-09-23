-- Money fixes (docs/specs/launch-db.md).
-- Applies after 20260922000000_ledger_overhead.sql and can run twice. Every
-- new function argument has a default and every new column is nullable or
-- defaulted, so the deployed site, the deployed webhook and the dispatcher keep
-- working between this file and their own updates.
--
-- founder_credit is dropped: the pool holds customer money only.
-- record_usage takes overhead rows: spend on the studio's own key that belongs
-- to no card. Like a founder row it leaves the pool, the day's spend and the
-- incident reserve alone, because the studio share pays it; unlike a founder
-- row it is public.
-- Each payment records a payer key: "card:" and a hash of the card's Stripe
-- fingerprint, or "email:" and the contributor id when the payment carries no
-- card fingerprint. The $50 daily window counts every payment that shares the
-- payer key or the contributor id, and a studio-wide daily room on immediate
-- credit backs it up.
-- The board gains set_caps and record_credit_purchase. Like every board RPC
-- added for launch, each refuses anyone who is not a board member (a
-- moderator included), then a session without the second factor, and writes
-- a board_actions row.
-- reverse_contribution also reports the money waiting cards hold on their bars
-- and how far a reversal leaves them short.

set lock_timeout = '5s';

-- founder_credit ------------------------------------------------------------

drop function if exists public.founder_credit(numeric, public.contribution_kind, text);

-- record_usage --------------------------------------------------------------
-- Same nine arguments as the request-id version. An overhead row names no card
-- and leaves the pool alone; everything else is unchanged.

create or replace function public.record_usage(
  p_card_id uuid,
  p_role_id uuid,
  p_model text,
  p_input_tokens integer,
  p_cached_tokens integer,
  p_output_tokens integer,
  p_usd numeric,
  p_billed_to public.ledger_billing default 'studio',
  p_request_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usd numeric(12,4);
  v_today date := (now() at time zone 'America/New_York')::date;
  v_ledger_id uuid;
  v_day date;
  v_incident_held numeric(12,4);
  v_severity public.card_severity;
  v_draw numeric(12,4) := 0;
  v_balance numeric(12,4);
  v_daily numeric(12,4);
  v_actual numeric(12,4);
  v_existing public.ledger%rowtype;
begin
  if p_model is null or p_model = '' then
    raise exception 'p_model is required';
  end if;
  if p_usd is null or p_usd < 0 then
    raise exception 'p_usd must be zero or more';
  end if;
  if p_billed_to is null then
    raise exception 'p_billed_to is required';
  end if;
  if p_billed_to = 'overhead'::public.ledger_billing and p_card_id is not null then
    raise exception 'An overhead row names no card';
  end if;
  v_usd := round(p_usd, 4);

  if p_card_id is not null then
    select severity into v_severity from public.cards where id = p_card_id for update;
    if not found then
      raise exception 'card % does not exist', p_card_id;
    end if;
  end if;

  -- A repeated request id is a retry of a write that already landed: return
  -- that row's result and change nothing. The same id with other values is a
  -- fault in the caller and is refused. The card lock above, or the pool lock
  -- when there is no card, makes a concurrent retry wait for the first.
  if p_request_id is not null then
    if p_card_id is null then
      perform 1 from public.pool where id = 1 for update;
    end if;
    select * into v_existing from public.ledger where request_id = p_request_id;
    if found then
      if v_existing.card_id is distinct from p_card_id
        or v_existing.model is distinct from p_model
        or v_existing.usd is distinct from v_usd
        or v_existing.billed_to is distinct from p_billed_to then
        raise exception 'request id % was written with different values', p_request_id;
      end if;
      select balance_usd, daily_spent_usd into v_balance, v_daily from public.pool where id = 1;
      if p_card_id is not null then
        select actual_usd into v_actual from public.cards where id = p_card_id;
      end if;
      return jsonb_build_object(
        'ledger_id', v_existing.id,
        'balance_usd', v_balance,
        'daily_spent_usd', v_daily,
        'actual_usd', v_actual
      );
    end if;
  end if;

  insert into public.ledger (card_id, role_id, model, input_tokens, cached_tokens, output_tokens, usd, billed_to, request_id)
  values (p_card_id, p_role_id, p_model, coalesce(p_input_tokens, 0), coalesce(p_cached_tokens, 0), coalesce(p_output_tokens, 0), v_usd, p_billed_to, p_request_id)
  returning id into v_ledger_id;

  if p_billed_to in ('founder'::public.ledger_billing, 'overhead'::public.ledger_billing) then
    select balance_usd, daily_spent_usd into v_balance, v_daily from public.pool where id = 1;
    if not found then
      raise exception 'pool row 1 is missing';
    end if;
  else
    select day, incident_reserve_usd into v_day, v_incident_held
    from public.pool where id = 1 for update;
    if not found then
      raise exception 'pool row 1 is missing';
    end if;

    if v_day is distinct from v_today then
      update public.pool set daily_spent_usd = 0, day = v_today where id = 1;
    end if;

    if v_severity = 's1'::public.card_severity then
      v_draw := least(v_usd, greatest(v_incident_held, 0));
    end if;

    update public.pool
    set incident_reserve_usd = incident_reserve_usd - v_draw,
        balance_usd = balance_usd - (v_usd - v_draw),
        daily_spent_usd = daily_spent_usd + v_usd
    where id = 1
    returning balance_usd, daily_spent_usd into v_balance, v_daily;
  end if;

  if p_card_id is not null then
    update public.cards set actual_usd = actual_usd + v_usd where id = p_card_id
    returning actual_usd into v_actual;
  end if;

  return jsonb_build_object(
    'ledger_id', v_ledger_id,
    'balance_usd', v_balance,
    'daily_spent_usd', v_daily,
    'actual_usd', v_actual
  );
end;
$$;

-- The public ledger ---------------------------------------------------------
-- Anon reads studio and overhead rows; founder rows stay private (PLAN.md §4
-- The Board). The totals keep their studio-only columns, which the site shows
-- as agent spend, and gain overhead_usd for overhead alone.

drop policy if exists ledger_public_read on public.ledger;
create policy ledger_public_read on public.ledger for select to anon, authenticated using (billed_to in ('studio', 'overhead'));

create or replace view public.public_ledger_totals with (security_invoker = true) as
  select
    coalesce(sum(usd) filter (where billed_to = 'studio'), 0)::numeric(12,4) as usd_total,
    coalesce(sum(input_tokens) filter (where billed_to = 'studio'), 0)::bigint as input_tokens,
    coalesce(sum(cached_tokens) filter (where billed_to = 'studio'), 0)::bigint as cached_tokens,
    coalesce(sum(output_tokens) filter (where billed_to = 'studio'), 0)::bigint as output_tokens,
    (count(*) filter (where billed_to = 'studio'))::bigint as row_count,
    coalesce(sum(usd) filter (where billed_to = 'overhead'), 0)::numeric(12,4) as overhead_usd
  from public.ledger
  where billed_to in ('studio', 'overhead');

-- Payer key -----------------------------------------------------------------
-- Existing payments take their email key. A payment row always carries a key;
-- release, refund and dispute rows do not need one.

alter table public.contributions add column if not exists payer_key text;
update public.contributions set payer_key = 'email:' || contributor_id where entry = 'payment' and payer_key is null;
alter table public.contributions drop constraint if exists contributions_payer_key_check;
alter table public.contributions add constraint contributions_payer_key_check
  check (entry <> 'payment' or (payer_key is not null and payer_key ~ '^(card|email):.+$'));
create index if not exists contributions_payer_day_idx on public.contributions (payer_key, created_at) where entry = 'payment';

-- Caps ----------------------------------------------------------------------
-- The studio-wide daily room on immediate credit, and the monthly cap that
-- mirrors the Console's monthly limit. The board edits both with set_caps.

alter table public.studio_state add column if not exists credit_studio_daily_cap_usd numeric(12,4) not null default 500;
alter table public.studio_state add column if not exists monthly_cap_usd numeric(12,4) not null default 500;

-- board_actions -------------------------------------------------------------
-- One row per board action taken through the launch board RPCs. Written only
-- inside those security definer functions; anon and authenticated hold nothing.

create table if not exists public.board_actions (
  id uuid primary key default gen_random_uuid(),
  action text not null constraint board_actions_action_check
    check (action in ('set_caps', 'record_credit_purchase', 'file_card', 'set_card_horizon', 'cancel_card', 'resume_card')),
  card_id uuid references public.cards (id) on delete set null,
  actor_email text not null,
  reason text not null constraint board_actions_reason_check check (btrim(reason) <> ''),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists board_actions_created_idx on public.board_actions (created_at desc);
alter table public.board_actions enable row level security;
revoke all on table public.board_actions from anon, authenticated;
grant all on table public.board_actions to service_role;

-- credit_purchases ----------------------------------------------------------
-- Console credit the board has bought for the studio's key, recorded after
-- each purchase. Private: anon and authenticated hold nothing.

create table if not exists public.credit_purchases (
  id uuid primary key default gen_random_uuid(),
  amount_usd numeric(12,4) not null constraint credit_purchases_amount_check check (amount_usd > 0),
  stripe_payout_id text,
  reason text not null constraint credit_purchases_reason_check check (btrim(reason) <> ''),
  created_by text not null,
  created_at timestamptz not null default now()
);
alter table public.credit_purchases enable row level security;
revoke all on table public.credit_purchases from anon, authenticated;
grant all on table public.credit_purchases to service_role;

-- set_caps ------------------------------------------------------------------
-- A null argument leaves that cap as it is. Every cap is zero or more and at
-- most $10,000, a guard against a mistyped amount; the hourly rate is above
-- zero because the dispatcher divides by it. After the change the per-card
-- maximum fits inside the daily cap and the daily cap inside the monthly cap.

create or replace function public.set_caps(
  p_daily_cap_usd numeric default null,
  p_card_max_usd numeric default null,
  p_agent_hourly_rate_usd numeric default null,
  p_reason text default null,
  p_monthly_cap_usd numeric default null,
  p_credit_studio_daily_cap_usd numeric default null
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
  if p_daily_cap_usd is null and p_card_max_usd is null and p_agent_hourly_rate_usd is null
    and p_monthly_cap_usd is null and p_credit_studio_daily_cap_usd is null then
    raise exception 'Name at least one cap to change';
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
      credit_studio_daily_cap_usd = coalesce(round(p_credit_studio_daily_cap_usd, 4), credit_studio_daily_cap_usd)
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
      'credit_studio_daily_cap_usd', v_before.credit_studio_daily_cap_usd
    ),
    'after', jsonb_build_object(
      'daily_cap_usd', v_after.daily_cap_usd,
      'card_max_usd', v_after.card_max_usd,
      'agent_hourly_rate_usd', v_after.agent_hourly_rate_usd,
      'monthly_cap_usd', v_after.monthly_cap_usd,
      'credit_studio_daily_cap_usd', v_after.credit_studio_daily_cap_usd
    )
  ));

  return jsonb_build_object(
    'daily_cap_usd', v_after.daily_cap_usd,
    'card_max_usd', v_after.card_max_usd,
    'agent_hourly_rate_usd', v_after.agent_hourly_rate_usd,
    'monthly_cap_usd', v_after.monthly_cap_usd,
    'credit_studio_daily_cap_usd', v_after.credit_studio_daily_cap_usd
  );
end;
$$;

-- record_credit_purchase ----------------------------------------------------
-- Records Console credit the board bought, with the Stripe payout it came
-- from when there is one. The amount is above zero and at most $10,000.

create or replace function public.record_credit_purchase(
  p_amount_usd numeric,
  p_stripe_payout_id text default null,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_payout text := nullif(btrim(p_stripe_payout_id), '');
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
  if p_amount_usd is null or p_amount_usd <= 0 then
    raise exception 'The amount must be above zero';
  end if;
  if p_amount_usd > 10000 then
    raise exception 'The amount must be at most $10,000';
  end if;
  insert into public.credit_purchases (amount_usd, stripe_payout_id, reason, created_by)
  values (round(p_amount_usd, 4), v_payout, btrim(p_reason), auth.email())
  returning id into v_id;
  insert into public.board_actions (action, card_id, actor_email, reason, details)
  values ('record_credit_purchase', null, auth.email(), btrim(p_reason), jsonb_build_object(
    'credit_purchase_id', v_id,
    'amount_usd', round(p_amount_usd, 4),
    'stripe_payout_id', v_payout
  ));
  return v_id;
end;
$$;

-- board_studio_state --------------------------------------------------------
-- The live-cut version with every cap, and the Console credit bought and
-- spent so far: spent is every studio and overhead ledger row.

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

-- apply_contribution --------------------------------------------------------
-- The open-goal-funding version with p_payer_key added last, defaulting to
-- null so the deployed webhook's eight named arguments keep working: a missing
-- key is the email key. The eight-argument signature is dropped so only this
-- one exists. Immediate credit is the smaller of the payer's room and the
-- studio's room today; the rest is held.

drop function if exists public.apply_contribution(text, text, text, numeric, numeric, integer, uuid, text);

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

-- reverse_contribution ------------------------------------------------------
-- The open-goal-funding version, returning earmarked_usd and shortfall_usd.

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
  v_studio_reserve numeric(12,4);
  v_earmarked numeric(12,4);
  v_shortfall numeric(12,4);
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

  -- Money on the bars of cards waiting for the agents (funded, voted or
  -- paused), less what each has already spent, is earmarked. A reversal of
  -- money already spent comes out of the balance, so it takes money that names
  -- no card first; once that is gone the waiting cards are short, and the
  -- figure goes to the board.
  select coalesce(sum(greatest(c.funded_usd - coalesce(s.spent_usd, 0), 0)), 0) into v_earmarked
  from public.cards c
  left join (
    select card_id, sum(usd) as spent_usd from public.ledger
    where billed_to = 'studio' and card_id is not null
    group by card_id
  ) s on s.card_id = c.id
  where c.stage in ('funded', 'voted', 'paused');
  select studio_reserve_usd into v_studio_reserve from public.studio_state where id = 1;
  v_shortfall := greatest(v_earmarked - (v_balance - coalesce(v_studio_reserve, 0)), 0);

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
    'goal_target_usd', v_goal_target,
    'earmarked_usd', v_earmarked,
    'shortfall_usd', v_shortfall
  );
end;
$$;

-- Grants --------------------------------------------------------------------

revoke all on table public.public_ledger_totals from anon, authenticated;
grant select on public.public_ledger_totals to anon, authenticated;

revoke all on function public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing, text) from public, anon, authenticated;
grant execute on function public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing, text) to service_role;
revoke all on function public.apply_contribution(text, text, text, numeric, numeric, integer, uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_contribution(text, text, text, numeric, numeric, integer, uuid, text, text) to service_role;
revoke all on function public.reverse_contribution(text, text, public.contribution_entry, numeric) from public, anon, authenticated;
grant execute on function public.reverse_contribution(text, text, public.contribution_entry, numeric) to service_role;
revoke all on function public.set_caps(numeric, numeric, numeric, text, numeric, numeric) from public, anon;
grant execute on function public.set_caps(numeric, numeric, numeric, text, numeric, numeric) to authenticated, service_role;
revoke all on function public.record_credit_purchase(numeric, text, text) from public, anon;
grant execute on function public.record_credit_purchase(numeric, text, text) to authenticated, service_role;
revoke all on function public.board_studio_state() from public, anon;
grant execute on function public.board_studio_state() to authenticated, service_role;

-- PostgREST caches function signatures; reload so the new arguments work at once.
notify pgrst, 'reload schema';
