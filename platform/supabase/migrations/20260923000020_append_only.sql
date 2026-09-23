-- Append-only money tables, and the rows that correct them
-- (docs/specs/money-safety.md).
-- Applies after 20260923000010_backup_role.sql and can run twice.
--
-- The money record is kernel (PLAN.md §4 Kernel): no row of ledger,
-- contributions, credit_purchases, board_actions or controller_runs is ever
-- deleted or truncated, and no column of one is ever changed, with three
-- exceptions that change no money:
--   contributions.decision_id  set once, from null, as apply_contribution
--                              links a payment to an open decision;
--   contributions.display_name nulled, never set, and only inside
--                              redact_contribution_name, the board's
--                              second-factor privacy RPC;
--   board_actions.card_id      nulled by its own foreign key when the card it
--                              names is deleted.
-- An UPDATE that changes nothing passes. Corrections are new rows:
--   reinstated  record_dispute_reinstated, which the Controller calls when
--               Stripe closes a dispute as won, puts back exactly what the
--               payment's disputes took. The money returns to the pool
--               without a card, the 10% reserve and the incident fund take
--               their shares back, and nothing is held again.
--   adjustment  record_adjustment, the board's second-factor RPC with a
--               reason, books a correction against one payment: net_usd is
--               split into reserve_usd, agents_usd and studio_usd. A fee
--               Stripe kept, charged to the studio share, is net -fee and
--               studio -fee.
-- reverse_contribution counts reinstated rows, so a refund after a won
-- dispute can still reverse the whole payment.
-- contribution_allocations and card_approvals do not exist yet; the pull
-- request that creates each adds it to the append-only triggers below.
-- A later migration that must rewrite one of these tables disables the named
-- trigger in its own transaction and says why.

set lock_timeout = '5s';

-- board_actions: the two new board actions -----------------------------------

alter table public.board_actions drop constraint if exists board_actions_action_check;
alter table public.board_actions add constraint board_actions_action_check
  check (action in ('set_caps', 'record_credit_purchase', 'file_card', 'set_card_horizon', 'cancel_card', 'resume_card', 'record_adjustment', 'redact_display_name'));

-- The append-only guard -----------------------------------------------------

create or replace function public.refuse_money_change() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed text;
begin
  if tg_op = 'TRUNCATE' then
    raise exception '% is append-only: TRUNCATE is refused', tg_table_name;
  end if;
  if tg_op = 'DELETE' then
    raise exception '% is append-only: DELETE is refused; correct it with a new row', tg_table_name;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  if v_new = v_old then
    return new;
  end if;
  if tg_table_name = 'contributions' then
    if old.decision_id is null and new.decision_id is not null
      and v_new - 'decision_id' = v_old - 'decision_id' then
      return new;
    end if;
    if old.display_name is not null and new.display_name is null
      and v_new - 'display_name' = v_old - 'display_name'
      and current_setting('peanutgallery.redact_name', true) = 'on' then
      return new;
    end if;
  elsif tg_table_name = 'board_actions' then
    if old.card_id is not null and new.card_id is null
      and v_new - 'card_id' = v_old - 'card_id'
      and not exists (select 1 from public.cards where id = old.card_id) then
      return new;
    end if;
  end if;

  select string_agg(key, ', ' order by key) into v_changed
  from jsonb_each(v_new) n
  where n.value is distinct from v_old -> n.key;
  raise exception '% is append-only: UPDATE of % is refused; correct it with a new row', tg_table_name, coalesce(v_changed, 'a column');
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['ledger', 'contributions', 'credit_purchases', 'board_actions', 'controller_runs'] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_append_only', v_table);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.refuse_money_change()', v_table || '_append_only', v_table);
    execute format('drop trigger if exists %I on public.%I', v_table || '_no_truncate', v_table);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.refuse_money_change()', v_table || '_no_truncate', v_table);
  end loop;
end
$$;

-- reverse_contribution ------------------------------------------------------
-- The money-fixes version, with reinstated rows counted in what the payment
-- has had reversed so far: a won dispute gives the payment back, so a later
-- refund may reverse all of it. The kind's own total still counts only rows of
-- that kind, so a dispute event replayed after the win reverses nothing.

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
    -coalesce(sum(amount_usd) filter (where entry in ('refund', 'dispute', 'reinstated')), 0),
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

-- record_dispute_reinstated -------------------------------------------------
-- The Controller's call when Stripe reports a dispute on this payment closed as
-- won. It writes one reinstated row that is the negative of what the
-- payment's disputes still hold (net of earlier reinstatements), keyed
-- "<dispute id>:reinstated" so a second call changes nothing. p_amount_usd is
-- what Stripe says it reinstated: it must cover what is booked as disputed,
-- or the call is refused for the board to look at.

create or replace function public.record_dispute_reinstated(
  p_dispute_id text,
  p_stripe_session_id text,
  p_amount_usd numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.contributions%rowtype;
  v_ref text;
  v_amount numeric(12,4);
  v_net numeric(12,4);
  v_reserve numeric(12,4);
  v_agents numeric(12,4);
  v_studio numeric(12,4);
  v_incident numeric(12,4);
  v_id uuid;
  v_balance numeric(12,4);
  v_reserve_after numeric(12,4);
  v_incident_after numeric(12,4);
begin
  if p_dispute_id is null or p_dispute_id !~ '^(dp|du)_[A-Za-z0-9]+$' then
    raise exception 'p_dispute_id must be a Stripe dispute id';
  end if;
  if p_stripe_session_id is null or p_stripe_session_id = '' then
    raise exception 'p_stripe_session_id is required';
  end if;
  if p_amount_usd is null or p_amount_usd <= 0 then
    raise exception 'p_amount_usd must be above zero';
  end if;
  v_ref := p_dispute_id || ':reinstated';

  select * into v_payment from public.contributions
  where stripe_session_id = p_stripe_session_id and entry = 'payment';
  if not found then
    return jsonb_build_object('found', false, 'inserted', false);
  end if;

  perform 1 from public.pool where id = 1 for update;
  if not found then
    raise exception 'pool row 1 is missing';
  end if;

  if exists (select 1 from public.contributions where stripe_event_id = v_ref) then
    return jsonb_build_object('found', true, 'inserted', false, 'replay', true, 'parent_id', v_payment.id);
  end if;

  select
    coalesce(sum(amount_usd), 0), coalesce(sum(net_usd), 0), coalesce(sum(reserve_usd), 0),
    coalesce(sum(agents_usd), 0), coalesce(sum(studio_usd), 0), coalesce(sum(incident_usd), 0)
  into v_amount, v_net, v_reserve, v_agents, v_studio, v_incident
  from public.contributions
  where parent_id = v_payment.id and entry in ('dispute', 'reinstated');

  if v_amount >= 0 then
    return jsonb_build_object('found', true, 'inserted', false, 'replay', false, 'parent_id', v_payment.id, 'reinstated_usd', 0);
  end if;
  if round(p_amount_usd, 4) < -v_amount then
    raise exception 'Stripe reinstated % but % is booked as disputed on contribution %', round(p_amount_usd, 4), -v_amount, v_payment.id;
  end if;

  insert into public.contributions (
    entry, parent_id, rail, contributor_id, amount_usd, net_usd, reserve_usd, agents_usd,
    studio_usd, incident_usd, studio_pct_chosen, kind, public, goal_card_id,
    stripe_event_id, held_usd, credited_at
  ) values (
    'reinstated', v_payment.id, v_payment.rail, v_payment.contributor_id, -v_amount, -v_net,
    -v_reserve, -v_agents, -v_studio, -v_incident, v_payment.studio_pct_chosen, v_payment.kind,
    v_payment.public, null, v_ref, 0, now()
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('found', true, 'inserted', false, 'replay', true, 'parent_id', v_payment.id);
  end if;

  update public.pool
  set reserve_usd = reserve_usd - v_reserve,
      incident_reserve_usd = incident_reserve_usd - v_incident,
      balance_usd = balance_usd - (v_agents - v_incident)
  where id = 1
  returning balance_usd, reserve_usd, incident_reserve_usd into v_balance, v_reserve_after, v_incident_after;

  return jsonb_build_object(
    'found', true,
    'inserted', true,
    'replay', false,
    'contribution_id', v_id,
    'parent_id', v_payment.id,
    'reinstated_usd', -v_amount,
    'reserve_usd', -v_reserve,
    'agents_usd', -v_agents,
    'incident_usd', -v_incident,
    'pool_balance_usd', v_balance,
    'pool_reserve_usd', v_reserve_after,
    'pool_incident_reserve_usd', v_incident_after
  );
end;
$$;

-- record_adjustment ---------------------------------------------------------
-- The board books a correction against one payment, with a reason. Every
-- amount is given, zero included; net_usd must equal reserve_usd + agents_usd
-- + studio_usd; each is at most $10,000 either way. The reserve and the pool
-- balance move with the row, so the ledger identity still holds; the studio
-- share touches no pool figure.

create or replace function public.record_adjustment(
  p_parent_id uuid,
  p_net_usd numeric,
  p_studio_usd numeric,
  p_agents_usd numeric,
  p_reserve_usd numeric,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.contributions%rowtype;
  v_net numeric(12,4);
  v_studio numeric(12,4);
  v_agents numeric(12,4);
  v_reserve numeric(12,4);
  v_id uuid;
  v_balance numeric(12,4);
  v_reserve_after numeric(12,4);
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
  if p_parent_id is null or p_net_usd is null or p_studio_usd is null or p_agents_usd is null or p_reserve_usd is null then
    raise exception 'The payment and every amount are required; give 0 for an amount that does not move';
  end if;
  v_net := round(p_net_usd, 4);
  v_studio := round(p_studio_usd, 4);
  v_agents := round(p_agents_usd, 4);
  v_reserve := round(p_reserve_usd, 4);
  if v_net = 0 and v_studio = 0 and v_agents = 0 and v_reserve = 0 then
    raise exception 'An adjustment moves some money';
  end if;
  if greatest(abs(v_net), abs(v_studio), abs(v_agents), abs(v_reserve)) > 10000 then
    raise exception 'An amount must be at most $10,000 either way';
  end if;
  if v_net <> v_reserve + v_agents + v_studio then
    raise exception 'net_usd must equal reserve_usd + agents_usd + studio_usd';
  end if;

  select * into v_payment from public.contributions where id = p_parent_id and entry = 'payment';
  if not found then
    raise exception 'p_parent_id must name a payment';
  end if;
  perform 1 from public.pool where id = 1 for update;
  if not found then
    raise exception 'pool row 1 is missing';
  end if;

  insert into public.contributions (
    entry, parent_id, rail, contributor_id, amount_usd, net_usd, reserve_usd, agents_usd,
    studio_usd, incident_usd, studio_pct_chosen, kind, public, goal_card_id, held_usd, credited_at
  ) values (
    'adjustment', v_payment.id, v_payment.rail, v_payment.contributor_id, 0, v_net, v_reserve, v_agents,
    v_studio, 0, v_payment.studio_pct_chosen, v_payment.kind, v_payment.public, null, 0, now()
  )
  returning id into v_id;

  update public.pool
  set reserve_usd = reserve_usd + v_reserve,
      balance_usd = balance_usd + v_agents
  where id = 1
  returning balance_usd, reserve_usd into v_balance, v_reserve_after;

  insert into public.board_actions (action, card_id, actor_email, reason, details)
  values ('record_adjustment', null, auth.email(), btrim(p_reason), jsonb_build_object(
    'contribution_id', v_id,
    'parent_id', v_payment.id,
    'net_usd', v_net,
    'studio_usd', v_studio,
    'agents_usd', v_agents,
    'reserve_usd', v_reserve
  ));

  return jsonb_build_object(
    'contribution_id', v_id,
    'parent_id', v_payment.id,
    'pool_balance_usd', v_balance,
    'pool_reserve_usd', v_reserve_after
  );
end;
$$;

-- redact_contribution_name --------------------------------------------------
-- The board's privacy RPC: nulls the display name of one contribution, with a
-- reason, and records the action without the name. Returns whether a name was
-- there to null.

create or replace function public.redact_contribution_name(
  p_contribution_id uuid,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nulled boolean;
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
  if not exists (select 1 from public.contributions where id = p_contribution_id) then
    raise exception 'contribution % does not exist', p_contribution_id;
  end if;

  perform set_config('peanutgallery.redact_name', 'on', true);
  update public.contributions set display_name = null
  where id = p_contribution_id and display_name is not null;
  v_nulled := found;
  perform set_config('peanutgallery.redact_name', 'off', true);

  insert into public.board_actions (action, card_id, actor_email, reason, details)
  values ('redact_display_name', null, auth.email(), btrim(p_reason), jsonb_build_object(
    'contribution_id', p_contribution_id,
    'nulled', v_nulled
  ));
  return v_nulled;
end;
$$;

-- Function privileges -------------------------------------------------------

revoke all on function public.refuse_money_change() from public, anon, authenticated;
revoke all on function public.reverse_contribution(text, text, public.contribution_entry, numeric) from public, anon, authenticated;
grant execute on function public.reverse_contribution(text, text, public.contribution_entry, numeric) to service_role;
revoke all on function public.record_dispute_reinstated(text, text, numeric) from public, anon, authenticated;
grant execute on function public.record_dispute_reinstated(text, text, numeric) to service_role;
revoke all on function public.record_adjustment(uuid, numeric, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.record_adjustment(uuid, numeric, numeric, numeric, numeric, text) to authenticated, service_role;
revoke all on function public.redact_contribution_name(uuid, text) from public, anon;
grant execute on function public.redact_contribution_name(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
