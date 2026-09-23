-- Money logic: one waterfall, allocations, supporter numbers, the terms stamp
-- and the fees Stripe keeps (docs/specs/money-logic.md).
-- Applies after 20260924100100_terms_version_2.sql and can run twice.
--
-- Every piece of credit (a payment's agents share less the incident carve-out
-- and any hold, a released hold, a won dispute's reinstatement, a board
-- adjustment's agents amount) is placed by one waterfall, and each placement
-- is a row of contribution_allocations naming the payment the money belongs
-- to:
--   1  the card the payment named, up to its target, if that card takes money;
--   2  the cards that take money, in rank order (unranked last, then oldest,
--      then id), each up to its target;
--   3  whatever is left, to Not on a card yet (destination unassigned).
-- One predicate, money.card_takes_money, decides which cards take money at
-- every step. It mirrors runnable() in platform/dispatcher/src/select.ts; a
-- change to either changes both in the same pull request.
--
-- A card's studio-billed spend uses its oldest money first. A refund or
-- dispute unwinds only that payment's allocations, newest first, each place
-- giving up only that payment's unspent money there; the spent remainder comes
-- off Not on a card yet. Not on a card yet is the pool balance less every
-- card's unspent bar, less the board's test money; below zero it is a
-- shortfall. waterfall_sweep(), every five minutes on pg_cron, releases a live
-- or rejected card's unspent money back in at step 2, promotes full cards and
-- drains Not on a card yet onto the cards that take money, never more than it
-- holds less the studio reserve less what building cards may still draw
-- beyond their bars.
--
-- Stripe keeps its fee on a refund or dispute: the row's net is the whole
-- amount reversed, and the part beyond its pro-rata share of the payment's net
-- comes off the studio share. record_stripe_fee books a dispute fee once per
-- balance transaction.
--
-- The board's own $1 test payment (its session is the one row of
-- board_test_payments) is placed on board_test: it reaches no card and not Not
-- on a card yet, gets no supporter number and is in no money-in figure.
--
-- Every function that places money takes money.money_lock(), then the cards it
-- may touch in id order (money.lock_money_cards), then the pool. record_usage
-- locks one card then the pool, so the two cannot deadlock.
--
-- The helpers live in a money schema the API does not expose. The new tables
-- are append-only and select-only even for service_role. The file ends by
-- checking ledger_identity() and rolls back entirely if it does not hold.

set lock_timeout = '5s';

-- a. The money schema -------------------------------------------------------

create schema if not exists money;
revoke all on schema money from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'peanutgallery_backup') then
    grant usage on schema money to peanutgallery_backup;
  end if;
end
$$;

-- b. Where an allocation puts money ------------------------------------------

do $$
begin
  create type public.allocation_destination as enum ('card', 'unassigned', 'board_test');
exception
  when duplicate_object then null;
end
$$;

-- c. contributions: the terms stamp and the card a payment asked for ---------
-- Adding a column fires no row trigger, so the append-only guard lets it pass.

alter table public.contributions add column if not exists terms_version integer references public.terms_versions (version);
alter table public.contributions drop constraint if exists contributions_terms_version_check;
alter table public.contributions add constraint contributions_terms_version_check check (terms_version is null or entry = 'payment');
alter table public.contributions add column if not exists requested_card_id uuid references public.cards (id);
alter table public.contributions drop constraint if exists contributions_requested_card_check;
alter table public.contributions add constraint contributions_requested_card_check check (requested_card_id is null or entry = 'payment');

-- d. Why the studio is paused -------------------------------------------------
-- Stored when the pause is set, never guessed at read time. A pause written
-- with no reason is board; resuming clears it.

alter table public.studio_state add column if not exists pause_reason text;
alter table public.studio_state drop constraint if exists studio_state_pause_reason_check;
alter table public.studio_state add constraint studio_state_pause_reason_check
  check (pause_reason in ('awaiting_credit', 'spend_limit', 'incident', 'board'));

create or replace function public.studio_pause_reason() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.paused then
    if new.pause_reason is null then
      new.pause_reason := 'board';
    end if;
  else
    new.pause_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists studio_state_pause_reason on public.studio_state;
create trigger studio_state_pause_reason before insert or update on public.studio_state
  for each row execute function public.studio_pause_reason();

-- Production is paused, not launched, with no Console credit purchase: the
-- studio is waiting for a payout to buy the agents' credit.
update public.studio_state
set pause_reason = case
  when launched_at is null and not exists (select 1 from public.credit_purchases) then 'awaiting_credit'
  else 'board'
end
where id = 1 and paused and pause_reason is null;

-- e. Tables -------------------------------------------------------------------

create table if not exists public.board_test_payments (
  stripe_session_id text primary key,
  reason text not null,
  created_at timestamptz not null default now()
);

insert into public.board_test_payments (stripe_session_id, reason)
values ('cs_live_a1OkB7xDSosjVf25TF8aNhbzy8PoWHrjEpeRGDtUSMaFK0tG0NU5Zl5oOh', 'The board''s own $1 test payment of 15 September 2026')
on conflict do nothing;

create table if not exists public.contribution_allocations (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  payment_id uuid not null references public.contributions (id),
  entry_id uuid references public.contributions (id),
  destination public.allocation_destination not null,
  card_id uuid references public.cards (id),
  amount_usd numeric(12,4) not null check (amount_usd <> 0),
  reason text not null constraint contribution_allocations_reason_check
    check (reason in ('credit', 'drain', 'card_release', 'unwind', 'backfill')),
  step smallint check (step between 1 and 3),
  from_card_id uuid references public.cards (id),
  batch_id uuid not null,
  created_at timestamptz not null default now(),
  constraint contribution_allocations_card_check check ((destination = 'card') = (card_id is not null)),
  constraint contribution_allocations_from_card_check check (from_card_id is null or reason = 'card_release')
);
create index if not exists contribution_allocations_payment_idx on public.contribution_allocations (payment_id, seq);
create index if not exists contribution_allocations_card_idx on public.contribution_allocations (card_id, seq) where card_id is not null;
create index if not exists contribution_allocations_from_card_idx on public.contribution_allocations (from_card_id) where reason = 'card_release';

create table if not exists public.supporters (
  number integer primary key check (number > 0),
  contributor_id text not null unique,
  first_payment_id uuid not null unique references public.contributions (id),
  founding boolean not null,
  created_at timestamptz not null default now()
);

alter table public.board_test_payments enable row level security;
alter table public.contribution_allocations enable row level security;
alter table public.supporters enable row level security;
revoke all on public.board_test_payments, public.contribution_allocations, public.supporters from anon, authenticated, service_role;
grant select on public.board_test_payments, public.contribution_allocations, public.supporters to service_role;

-- f. The helpers --------------------------------------------------------------

-- The one lock every function that places money takes first.
create or replace function money.money_lock() returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(7240926200000);
end;
$$;

-- The one predicate: which cards take money, at every step and in the public
-- funding order. It mirrors runnable() in platform/dispatcher/src/select.ts
-- (the dispatcher could start the card once funded) plus the stage and the
-- room under the target; a change to either changes both in the same pull
-- request.
create or replace function money.card_takes_money(c public.cards, p_lane_open boolean) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select c.shape = 'goal'
    and c.horizon = 'now'
    and c.funding_target_usd > 0
    and c.funded_usd < c.funding_target_usd
    and c.stage in ('proposed', 'designing', 'voted', 'funded')
    and c.director_stance <> 'vetoed'
    and c.source in ('board', 'agent', 'decision')
    and c.executor_role_id is not null
    and not (c.folder = 'platform' and c.lane = 'code' and not coalesce(p_lane_open, false))
$$;

create or replace function money.lane_open() returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select platform_lane_open from public.studio_state where id = 1), false)
$$;

-- The cards step 2 fills, in order, with their room.
create or replace function money.funding_order() returns table ("position" integer, card_id uuid, room_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    (row_number() over (order by c.rank asc nulls last, c.created_at, c.id))::integer,
    c.id,
    (c.funding_target_usd - c.funded_usd)::numeric(12,4)
  from public.cards c
  where money.card_takes_money(c, money.lane_open())
  order by 1
$$;

create or replace function money.card_studio_spend(p_card uuid) returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(usd), 0)::numeric(12,4) from public.ledger where billed_to = 'studio' and card_id = p_card
$$;

-- Each payment's money on a card, oldest money first: the card's studio spend
-- is taken from the oldest payment's net there first, and what is left of a
-- payment's net is its unspent money there.
create or replace function money.place_unspent(p_card uuid)
returns table (payment_id uuid, net numeric, unspent numeric, first_seq bigint, last_seq bigint)
language sql
stable
security definer
set search_path = public
as $$
  with per as (
    select
      a.payment_id as pid,
      sum(a.amount_usd) as n,
      min(a.seq) filter (where a.amount_usd > 0) as f,
      max(a.seq) filter (where a.amount_usd > 0) as l
    from public.contribution_allocations a
    where a.destination = 'card' and a.card_id = p_card
    group by a.payment_id
    having sum(a.amount_usd) > 0
  ),
  ordered as (
    select per.pid, per.n, per.f, per.l,
      coalesce(sum(per.n) over (order by per.f rows between unbounded preceding and 1 preceding), 0) as before
    from per
  )
  select o.pid, o.n, (o.n - least(o.n, greatest(money.card_studio_spend(p_card) - o.before, 0)))::numeric(12,4), o.f, o.l
  from ordered o
  order by o.f
$$;

create or replace function money.board_test_usd() returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount_usd), 0)::numeric(12,4) from public.contribution_allocations where destination = 'board_test'
$$;

create or replace function money.is_board_test(p_payment uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.contributions p
    join public.board_test_payments b on b.stripe_session_id = p.stripe_session_id
    where p.id = p_payment
  )
$$;

-- Not on a card yet: the pool balance less every card's unspent bar, less the
-- board's test money. Below zero it is a shortfall.
create or replace function money.not_on_card_usd() returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce((select balance_usd from public.pool where id = 1), 0)
    - coalesce((
        select sum(greatest(c.funded_usd - coalesce(s.usd, 0), 0))
        from public.cards c
        left join (
          select card_id, sum(usd) as usd from public.ledger
          where billed_to = 'studio' and card_id is not null
          group by card_id
        ) s on s.card_id = c.id
      ), 0)
    - money.board_test_usd()
  )::numeric(12,4)
$$;

-- What the drain may move: Not on a card yet, less the studio reserve, less
-- what building cards may still draw beyond their bars up to their ceilings
-- (150% of the estimate, capped by the per-card maximum), so the drain never
-- puts spent money on a bar.
create or replace function money.drainable_usd() returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select (
    money.not_on_card_usd()
    - coalesce((select studio_reserve_usd from public.studio_state where id = 1), 0)
    - coalesce((
        select sum(greatest(
          least(round(1.5 * c.estimate_usd, 4), st.card_max_usd)
            - coalesce(s.usd, 0)
            - greatest(c.funded_usd - coalesce(s.usd, 0), 0),
          0))
        from public.cards c
        cross join public.studio_state st
        left join (
          select card_id, sum(usd) as usd from public.ledger
          where billed_to = 'studio' and card_id is not null
          group by card_id
        ) s on s.card_id = c.id
        where st.id = 1 and c.stage = 'building'
      ), 0)
  )::numeric(12,4)
$$;

-- Locks the named cards and every card that takes money, in id order.
create or replace function money.lock_money_cards(p_cards uuid[]) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lane boolean := money.lane_open();
begin
  perform 1 from public.cards c
  where c.id = any(coalesce(p_cards, '{}'::uuid[])) or money.card_takes_money(c, v_lane)
  order by c.id
  for update;
end;
$$;

-- Moves a card's bar, seeds its estimate from the target the first time money
-- arrives, and moves a full proposed or voted goal card on now to funded.
create or replace function money.bump_card(p_card uuid, p_usd numeric) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.cards
  set funded_usd = funded_usd + p_usd,
      estimate_usd = case when p_usd > 0 and estimate_usd = 0 then funding_target_usd else estimate_usd end
  where id = p_card;
  update public.cards
  set stage = 'funded'
  where id = p_card
    and shape = 'goal'
    and horizon = 'now'
    and stage in ('proposed', 'voted')
    and funding_target_usd > 0
    and funded_usd >= funding_target_usd;
end;
$$;

-- The waterfall. Places p_usd of the payment's credit from step p_from_step
-- (1: the named card; 2: the ranked cards, where releases and drains enter,
-- never back onto p_from_card) and returns the rows it wrote.
create or replace function money.place_credit(
  p_payment uuid,
  p_entry uuid,
  p_usd numeric,
  p_from_step integer,
  p_reason text,
  p_batch uuid,
  p_from_card uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rem numeric(12,4) := round(coalesce(p_usd, 0), 4);
  v_rows jsonb := '[]'::jsonb;
  v_lane boolean := money.lane_open();
  v_from uuid := case when p_reason = 'card_release' then p_from_card end;
  v_batch uuid := coalesce(p_batch, gen_random_uuid());
  v_goal uuid;
  v_card public.cards%rowtype;
  v_x numeric(12,4);
begin
  if v_rem <= 0 then
    return v_rows;
  end if;

  if money.is_board_test(p_payment) then
    insert into public.contribution_allocations (payment_id, entry_id, destination, card_id, amount_usd, reason, step, from_card_id, batch_id)
    values (p_payment, p_entry, 'board_test', null, v_rem, p_reason, null, v_from, v_batch);
    return jsonb_build_array(jsonb_build_object('destination', 'board_test', 'card_id', null, 'amount_usd', v_rem, 'step', null));
  end if;

  if p_from_step <= 1 then
    select goal_card_id into v_goal from public.contributions where id = p_payment;
    if v_goal is not null then
      select * into v_card from public.cards where id = v_goal;
      if found and money.card_takes_money(v_card, v_lane) then
        v_x := least(v_rem, v_card.funding_target_usd - v_card.funded_usd);
        if v_x > 0 then
          insert into public.contribution_allocations (payment_id, entry_id, destination, card_id, amount_usd, reason, step, from_card_id, batch_id)
          values (p_payment, p_entry, 'card', v_card.id, v_x, p_reason, 1, v_from, v_batch);
          perform money.bump_card(v_card.id, v_x);
          v_rows := v_rows || jsonb_build_object('destination', 'card', 'card_id', v_card.id, 'amount_usd', v_x, 'step', 1);
          v_rem := v_rem - v_x;
        end if;
      end if;
    end if;
  end if;

  if v_rem > 0 then
    for v_card in
      select * from public.cards c
      where money.card_takes_money(c, v_lane) and c.id is distinct from p_from_card
      order by c.rank asc nulls last, c.created_at, c.id
    loop
      exit when v_rem <= 0;
      v_x := least(v_rem, v_card.funding_target_usd - v_card.funded_usd);
      if v_x > 0 then
        insert into public.contribution_allocations (payment_id, entry_id, destination, card_id, amount_usd, reason, step, from_card_id, batch_id)
        values (p_payment, p_entry, 'card', v_card.id, v_x, p_reason, 2, v_from, v_batch);
        perform money.bump_card(v_card.id, v_x);
        v_rows := v_rows || jsonb_build_object('destination', 'card', 'card_id', v_card.id, 'amount_usd', v_x, 'step', 2);
        v_rem := v_rem - v_x;
      end if;
    end loop;
  end if;

  if v_rem > 0 then
    insert into public.contribution_allocations (payment_id, entry_id, destination, card_id, amount_usd, reason, step, from_card_id, batch_id)
    values (p_payment, p_entry, 'unassigned', null, v_rem, p_reason, 3, v_from, v_batch);
    v_rows := v_rows || jsonb_build_object('destination', 'unassigned', 'card_id', null, 'amount_usd', v_rem, 'step', 3);
  end if;

  return v_rows;
end;
$$;

-- Takes p_usd of a payment's credit back off its own allocations, newest place
-- first. A card gives up only the payment's unspent money there; Not on a card
-- yet gives up its net. The rest was already spent: it comes off Not on a card
-- yet as one negative row, which may take that place below zero.
create or replace function money.unwind_credit(p_payment uuid, p_entry uuid, p_usd numeric, p_batch uuid) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rem numeric(12,4) := round(coalesce(p_usd, 0), 4);
  v_rows jsonb := '[]'::jsonb;
  v_batch uuid := coalesce(p_batch, gen_random_uuid());
  v_place record;
  v_headroom numeric(12,4);
  v_x numeric(12,4);
begin
  if v_rem <= 0 then
    return jsonb_build_object('rows', v_rows, 'remainder_usd', 0);
  end if;

  if money.is_board_test(p_payment) then
    insert into public.contribution_allocations (payment_id, entry_id, destination, card_id, amount_usd, reason, step, batch_id)
    values (p_payment, p_entry, 'board_test', null, -v_rem, 'unwind', null, v_batch);
    return jsonb_build_object(
      'rows', jsonb_build_array(jsonb_build_object('destination', 'board_test', 'card_id', null, 'amount_usd', -v_rem)),
      'remainder_usd', 0
    );
  end if;

  for v_place in
    select a.destination, a.card_id, sum(a.amount_usd) as net, max(a.seq) filter (where a.amount_usd > 0) as last_seq
    from public.contribution_allocations a
    where a.payment_id = p_payment and a.destination in ('card', 'unassigned')
    group by a.destination, a.card_id
    having sum(a.amount_usd) > 0
    order by 4 desc nulls last
  loop
    exit when v_rem <= 0;
    if v_place.destination = 'card' then
      select u.unspent into v_headroom from money.place_unspent(v_place.card_id) u where u.payment_id = p_payment;
      v_headroom := coalesce(v_headroom, 0);
    else
      v_headroom := v_place.net;
    end if;
    v_x := least(v_rem, v_headroom);
    if v_x > 0 then
      insert into public.contribution_allocations (payment_id, entry_id, destination, card_id, amount_usd, reason, step, batch_id)
      values (p_payment, p_entry, v_place.destination, v_place.card_id, -v_x, 'unwind', null, v_batch);
      if v_place.destination = 'card' then
        perform money.bump_card(v_place.card_id, -v_x);
      end if;
      v_rows := v_rows || jsonb_build_object('destination', v_place.destination, 'card_id', v_place.card_id, 'amount_usd', -v_x);
      v_rem := v_rem - v_x;
    end if;
  end loop;

  if v_rem > 0 then
    insert into public.contribution_allocations (payment_id, entry_id, destination, card_id, amount_usd, reason, step, batch_id)
    values (p_payment, p_entry, 'unassigned', null, -v_rem, 'unwind', null, v_batch);
    v_rows := v_rows || jsonb_build_object('destination', 'unassigned', 'card_id', null, 'amount_usd', -v_rem);
  end if;

  return jsonb_build_object('rows', v_rows, 'remainder_usd', v_rem);
end;
$$;

-- Moves a card's unspent money, newest money first, back in at step 2, never
-- onto the card itself.
create or replace function money.release_card(p_card uuid) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_moved numeric(12,4) := 0;
  v_to jsonb := '[]'::jsonb;
  v_place record;
begin
  for v_place in
    select u.payment_id, u.unspent from money.place_unspent(p_card) u where u.unspent > 0 order by u.first_seq desc
  loop
    insert into public.contribution_allocations (payment_id, entry_id, destination, card_id, amount_usd, reason, step, from_card_id, batch_id)
    values (v_place.payment_id, null, 'card', p_card, -v_place.unspent, 'card_release', null, p_card, v_batch);
    perform money.bump_card(p_card, -v_place.unspent);
    v_to := v_to || money.place_credit(v_place.payment_id, null, v_place.unspent, 2, 'card_release', v_batch, p_card);
    v_moved := v_moved + v_place.unspent;
  end loop;
  return jsonb_build_object('moved_usd', v_moved, 'moved_to', v_to);
end;
$$;

-- Drains Not on a card yet onto the cards that take money, oldest payment
-- first, never more than drainable_usd() or the room the cards have.
create or replace function money.drain_unassigned() returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_left numeric(12,4);
  v_drain numeric(12,4);
  v_rem numeric(12,4);
  v_x numeric(12,4);
  v_place record;
begin
  select coalesce(sum(net), 0) into v_left
  from (
    select sum(amount_usd) as net from public.contribution_allocations
    where destination = 'unassigned'
    group by payment_id
    having sum(amount_usd) > 0
  ) u;
  v_drain := least(
    v_left,
    greatest(money.drainable_usd(), 0),
    coalesce((select sum(room_usd) from money.funding_order()), 0)
  );
  if v_drain <= 0 then
    return jsonb_build_object('drained_usd', 0);
  end if;
  v_rem := v_drain;
  for v_place in
    select a.payment_id, sum(a.amount_usd) as net
    from public.contribution_allocations a
    join public.contributions p on p.id = a.payment_id
    where a.destination = 'unassigned'
    group by a.payment_id, p.created_at
    having sum(a.amount_usd) > 0
    order by p.created_at, a.payment_id
  loop
    exit when v_rem <= 0;
    v_x := least(v_place.net, v_rem);
    insert into public.contribution_allocations (payment_id, entry_id, destination, card_id, amount_usd, reason, step, batch_id)
    values (v_place.payment_id, null, 'unassigned', null, -v_x, 'drain', null, v_batch);
    perform money.place_credit(v_place.payment_id, null, v_x, 2, 'drain', v_batch, null);
    v_rem := v_rem - v_x;
  end loop;
  return jsonb_build_object('drained_usd', v_drain - v_rem);
end;
$$;

-- One number per contributor, at their first payment, from 1 with no gaps. It
-- is founding when launched_at is unset or later than p_at, the payment's
-- Checkout Session time (else its row's time). The board's test payment gets
-- none.
create or replace function money.assign_supporter(p_payment uuid, p_at timestamptz) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contributor text;
  v_number integer;
begin
  if money.is_board_test(p_payment) then
    return null;
  end if;
  select contributor_id into v_contributor from public.contributions where id = p_payment and entry = 'payment';
  if v_contributor is null then
    return null;
  end if;
  insert into public.supporters (number, contributor_id, first_payment_id, founding)
  select coalesce((select max(number) from public.supporters), 0) + 1, v_contributor, p_payment,
    (s.launched_at is null or coalesce(p_at, now()) < s.launched_at)
  from public.studio_state s
  where s.id = 1
  on conflict (contributor_id) do nothing;
  select number into v_number from public.supporters where contributor_id = v_contributor;
  return v_number;
end;
$$;

-- The one definition of a payment that still credits its payer: not the
-- board's test payment, and not fully reversed by its refunds and disputes
-- (a won dispute's reinstatement gives it back).
create or replace function money.payment_counts(p_payment uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select not money.is_board_test(p.id)
      and coalesce((
        select -sum(c.amount_usd) from public.contributions c
        where c.parent_id = p.id and c.entry in ('refund', 'dispute', 'reinstated')
      ), 0) < p.amount_usd
    from public.contributions p
    where p.id = p_payment and p.entry = 'payment'
  ), false)
$$;

revoke all on all functions in schema money from public, anon, authenticated, service_role;

-- Postgres checks a view's function calls against the role reading the view,
-- so the four read-only helpers the public views call carry EXECUTE for the
-- API roles. No API role has USAGE on the schema, so none can call any money
-- function by name, and none of these writes.
grant execute on function money.payment_counts(uuid), money.not_on_card_usd(), money.board_test_usd(), money.funding_order()
  to anon, authenticated, service_role;

-- g. Backfill -------------------------------------------------------------------
-- Mirrors today's bars, never re-routes old money: each row's credit goes to
-- the board's test payment, else to the card its payment named (the only card
-- the old apply_contribution credited), else to Not on a card yet. Then the
-- supporters, in first-payment order.

do $$
declare
  v_batch uuid := gen_random_uuid();
  v_drift text;
begin
  if exists (select 1 from public.contribution_allocations) then
    return;
  end if;

  insert into public.contribution_allocations (payment_id, entry_id, destination, card_id, amount_usd, reason, step, batch_id)
  select
    fam.id,
    c.id,
    (case
      when b.stripe_session_id is not null then 'board_test'
      when fam.goal_card_id is not null then 'card'
      else 'unassigned'
    end)::public.allocation_destination,
    case when b.stripe_session_id is null then fam.goal_card_id end,
    c.agents_usd - c.incident_usd - c.held_usd,
    'backfill',
    null,
    v_batch
  from public.contributions c
  join public.contributions fam on fam.id = coalesce(c.parent_id, c.id)
  left join public.board_test_payments b on b.stripe_session_id = fam.stripe_session_id
  where c.agents_usd - c.incident_usd - c.held_usd <> 0
  order by c.created_at, c.id;

  select string_agg(format('%s (bar %s, allocations %s)', c.id, c.funded_usd, coalesce(a.usd, 0)), ', ' order by c.id) into v_drift
  from public.cards c
  left join (
    select card_id, sum(amount_usd) as usd from public.contribution_allocations
    where destination = 'card'
    group by card_id
  ) a on a.card_id = c.id
  where c.funded_usd <> coalesce(a.usd, 0);
  if v_drift is not null then
    raise exception 'money_logic: these cards'' bars differ from their allocations: %', v_drift;
  end if;

  if not exists (select 1 from public.supporters) then
    insert into public.supporters (number, contributor_id, first_payment_id, founding)
    select
      (row_number() over (order by f.created_at, f.id))::integer,
      f.contributor_id,
      f.id,
      (s.launched_at is null or f.created_at < s.launched_at)
    from (
      select distinct on (p.contributor_id) p.id, p.contributor_id, p.created_at
      from public.contributions p
      where p.entry = 'payment'
        and not exists (select 1 from public.board_test_payments b where b.stripe_session_id = p.stripe_session_id)
      order by p.contributor_id, p.created_at, p.id
    ) f
    cross join public.studio_state s
    where s.id = 1;
  end if;
end
$$;

-- h. The public RPCs ----------------------------------------------------------

-- apply_contribution --------------------------------------------------------
-- The backlog version, placed through the waterfall, with the Checkout
-- Session's created time added last so the deployed webhook's nine named
-- arguments still resolve. The payment is stamped with the Terms version
-- posted at or before that time (a future time counts as now; no time stamps
-- nothing). A named card that takes no money is kept in requested_card_id and
-- the credit starts at step 2. The nine-argument signature is dropped so only
-- this one exists.

drop function if exists public.apply_contribution(text, text, text, numeric, numeric, integer, uuid, text, text);

create or replace function public.apply_contribution(
  p_stripe_event_id text,
  p_contributor_id text,
  p_display_name text,
  p_amount_usd numeric,
  p_net_usd numeric,
  p_studio_pct integer,
  p_goal_card_id uuid,
  p_stripe_session_id text default null,
  p_payer_key text default null,
  p_session_created_at timestamptz default null
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
  v_card public.cards%rowtype;
  v_goal uuid;
  v_requested uuid;
  v_terms integer;
  v_goal_stage public.card_stage;
  v_goal_funded numeric(12,4);
  v_id uuid;
  v_row public.contributions%rowtype;
  v_allocations jsonb;
  v_number integer;
  v_founding boolean;
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

  -- The money lock, then the cards in id order, then the pool.
  perform money.money_lock();
  perform money.lock_money_cards(array[p_goal_card_id]);
  select incident_reserve_usd into v_incident_held
  from public.pool where id = 1 for update;
  if not found then
    raise exception 'pool row 1 is missing';
  end if;

  v_goal := null;
  v_requested := null;
  if p_goal_card_id is not null then
    select * into v_card from public.cards where id = p_goal_card_id;
    if found then
      if money.card_takes_money(v_card, money.lane_open()) then
        v_goal := v_card.id;
      else
        v_requested := v_card.id;
      end if;
    end if;
  end if;

  v_terms := case when p_session_created_at is null then null else public.terms_version_at(least(p_session_created_at, now())) end;

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
    stripe_event_id, stripe_session_id, credited_at, entry, held_usd, hold_until, payer_key,
    terms_version, requested_card_id
  ) values (
    'stripe', p_contributor_id, p_display_name, v_amount, v_net, v_reserve, v_agents,
    v_studio, v_incident, p_studio_pct, 'cash', true, v_goal,
    p_stripe_event_id, nullif(p_stripe_session_id, ''), now(), 'payment', v_held, v_hold_until, v_payer,
    v_terms, v_requested
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    -- A replay: what was stored, and where its money went.
    select * into v_row from public.contributions
    where stripe_event_id = p_stripe_event_id
       or (nullif(p_stripe_session_id, '') is not null and stripe_session_id = p_stripe_session_id)
    order by created_at asc
    limit 1;
    select stage, funded_usd into v_goal_stage, v_goal_funded from public.cards where id = v_row.goal_card_id;
    select number, founding into v_number, v_founding from public.supporters where first_payment_id = v_row.id or contributor_id = v_row.contributor_id;
    select coalesce(jsonb_agg(jsonb_build_object('destination', destination, 'card_id', card_id, 'amount_usd', amount_usd, 'step', step) order by seq), '[]'::jsonb)
    into v_allocations
    from public.contribution_allocations where payment_id = v_row.id;
    return jsonb_build_object(
      'inserted', false,
      'contribution_id', v_row.id,
      'reserve_usd', v_row.reserve_usd,
      'studio_usd', v_row.studio_usd,
      'agents_usd', v_row.agents_usd,
      'incident_usd', v_row.incident_usd,
      'pool_credit_usd', v_row.agents_usd - v_row.incident_usd - v_row.held_usd,
      'held_usd', v_row.held_usd,
      'hold_until', v_row.hold_until,
      'goal_card_id', v_row.goal_card_id,
      'goal_stage', v_goal_stage,
      'goal_funded_usd', v_goal_funded,
      'terms_version', v_row.terms_version,
      'requested_card_id', v_row.requested_card_id,
      'supporter_number', v_number,
      'founding', v_founding,
      'allocations', v_allocations,
      'not_on_card_usd', money.not_on_card_usd()
    );
  end if;

  update public.pool
  set balance_usd = balance_usd + (v_credit - v_held),
      held_usd = held_usd + v_held,
      incident_reserve_usd = incident_reserve_usd + v_incident,
      reserve_usd = reserve_usd + v_reserve
  where id = 1;

  -- What reached the pool goes through the waterfall; held money follows on
  -- release.
  v_allocations := money.place_credit(v_id, v_id, v_credit - v_held, 1, 'credit', gen_random_uuid(), null);
  v_number := money.assign_supporter(v_id, least(coalesce(p_session_created_at, now()), now()));
  select founding into v_founding from public.supporters where number = v_number;
  if v_goal is not null then
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
    'goal_funded_usd', v_goal_funded,
    'terms_version', v_terms,
    'requested_card_id', v_requested,
    'supporter_number', v_number,
    'founding', v_founding,
    'allocations', v_allocations,
    'not_on_card_usd', money.not_on_card_usd()
  );
end;
$$;

-- credit_held_contributions -------------------------------------------------
-- The backlog version; a released hold is credit and enters the waterfall at
-- step 1 (its named card if that card still takes money, else step 2),
-- replacing the direct bar update.

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
  v_batch uuid := gen_random_uuid();
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

  perform money.money_lock();
  perform money.lock_money_cards(v_cards);
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

    perform money.place_credit(v_parent.id, v_release, v_amount, 1, 'credit', v_batch, null);

    v_released := v_released + 1;
    v_released_usd := v_released_usd + v_amount;
  end loop;

  return jsonb_build_object('released', v_released, 'released_usd', v_released_usd);
end;
$$;

-- reverse_contribution ------------------------------------------------------
-- The append-only version. The pro-rata arithmetic is unchanged, and the row
-- carries the fee Stripe keeps: its net is minus the whole amount reversed,
-- and the part beyond the pro-rata shares comes off the studio share, so
-- net = reserve + agents + studio still holds and no supporter's money covers
-- it. The credit comes off the payment's own allocations through
-- money.unwind_credit, replacing the goal-bar update. shortfall_usd is the
-- negative part of Not on a card yet; earmarked_usd is gone.

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
  v_kept numeric(12,4);
  v_held_left numeric(12,4);
  v_held numeric(12,4);
  v_cover numeric(12,4) := 0;
  v_cover_balance numeric(12,4) := 0;
  v_cover_incident numeric(12,4) := 0;
  v_off_balance numeric(12,4);
  v_id uuid;
  v_unwound jsonb;
  v_not_on_card numeric(12,4);
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

  perform money.money_lock();

  select * into v_payment from public.contributions
  where stripe_session_id = p_stripe_session_id and entry = 'payment';
  if not found then
    return jsonb_build_object('found', false, 'inserted', false);
  end if;

  perform money.lock_money_cards(array(
    select distinct card_id from public.contribution_allocations where payment_id = v_payment.id and card_id is not null
  ));
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
  -- The fee Stripe keeps: the amount reversed less the pro-rata shares of the
  -- payment's net (v_net, to rounding), charged to the studio share.
  v_kept := v_delta - (v_reserve + v_agents + v_studio);

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
    p_kind, v_payment.id, v_payment.rail, v_payment.contributor_id, -v_delta, -v_delta,
    -(v_reserve + v_cover), -(v_agents - v_cover), -(v_studio + v_kept), -(v_incident - v_cover_incident),
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

  v_unwound := money.unwind_credit(v_payment.id, v_id, v_off_balance, gen_random_uuid());

  if v_payment.goal_card_id is not null then
    select stage, funded_usd, funding_target_usd into v_goal_stage, v_goal_funded, v_goal_target
    from public.cards where id = v_payment.goal_card_id;
  end if;
  v_not_on_card := money.not_on_card_usd();

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
    'kept_fee_usd', v_kept,
    'pool_balance_usd', v_balance,
    'pool_reserve_usd', v_reserve_after,
    'pool_incident_reserve_usd', v_incident_after,
    'goal_card_id', v_payment.goal_card_id,
    'goal_stage', v_goal_stage,
    'goal_funded_usd', v_goal_funded,
    'goal_target_usd', v_goal_target,
    'unwound', v_unwound,
    'not_on_card_usd', v_not_on_card,
    'shortfall_usd', greatest(-v_not_on_card, 0)
  );
end;
$$;

-- record_dispute_reinstated -------------------------------------------------
-- The append-only version. It already negates the dispute rows' sums, so the
-- fee part of each dispute row comes back with the rest. The credit re-enters
-- the waterfall at step 1, replacing the bar and stage updates.

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
  v_allocations jsonb;
  v_balance numeric(12,4);
  v_reserve_after numeric(12,4);
  v_incident_after numeric(12,4);
  v_goal_stage public.card_stage;
  v_goal_funded numeric(12,4);
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

  perform money.money_lock();

  select * into v_payment from public.contributions
  where stripe_session_id = p_stripe_session_id and entry = 'payment';
  if not found then
    return jsonb_build_object('found', false, 'inserted', false);
  end if;

  perform money.lock_money_cards(array[v_payment.goal_card_id]);
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
    v_payment.public, v_payment.goal_card_id, v_ref, 0, now()
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

  v_allocations := money.place_credit(v_payment.id, v_id, -(v_agents - v_incident), 1, 'credit', gen_random_uuid(), null);

  if v_payment.goal_card_id is not null then
    select stage, funded_usd into v_goal_stage, v_goal_funded from public.cards where id = v_payment.goal_card_id;
  end if;

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
    'pool_incident_reserve_usd', v_incident_after,
    'goal_card_id', v_payment.goal_card_id,
    'goal_stage', v_goal_stage,
    'goal_funded_usd', v_goal_funded,
    'allocations', v_allocations
  );
end;
$$;

-- record_stripe_fee ---------------------------------------------------------
-- The Controller books a fee Stripe charged or returned on a dispute, once per
-- balance transaction: an adjustment row with net -fee and studio -fee, keyed
-- "<txn id>:fee", so a second call inserts nothing. A negative fee (a returned
-- dispute fee) books it back. No supporter's money and no pool figure moves.

create or replace function public.record_stripe_fee(
  p_ref text,
  p_stripe_session_id text,
  p_fee_usd numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.contributions%rowtype;
  v_fee numeric(12,4);
  v_id uuid;
begin
  if p_ref is null or p_ref !~ '^txn_[A-Za-z0-9]+$' then
    raise exception 'p_ref must be a Stripe balance transaction id';
  end if;
  if p_stripe_session_id is null or p_stripe_session_id = '' then
    raise exception 'p_stripe_session_id is required';
  end if;
  v_fee := round(p_fee_usd, 4);
  if v_fee is null or v_fee = 0 or abs(v_fee) > 100 then
    raise exception 'p_fee_usd must be above zero and at most $100 either way';
  end if;

  select * into v_payment from public.contributions
  where stripe_session_id = p_stripe_session_id and entry = 'payment';
  if not found then
    return jsonb_build_object('found', false, 'inserted', false, 'replay', false);
  end if;

  insert into public.contributions (
    entry, parent_id, rail, contributor_id, amount_usd, net_usd, reserve_usd, agents_usd,
    studio_usd, incident_usd, studio_pct_chosen, kind, public, goal_card_id,
    stripe_event_id, held_usd, credited_at
  ) values (
    'adjustment', v_payment.id, v_payment.rail, v_payment.contributor_id, 0, -v_fee, 0, 0,
    -v_fee, 0, v_payment.studio_pct_chosen, v_payment.kind, v_payment.public, null,
    p_ref || ':fee', 0, now()
  )
  on conflict do nothing
  returning id into v_id;

  return jsonb_build_object(
    'found', true,
    'inserted', v_id is not null,
    'replay', v_id is null,
    'contribution_id', v_id,
    'parent_id', v_payment.id,
    'fee_usd', v_fee
  );
end;
$$;

-- record_adjustment ---------------------------------------------------------
-- The append-only version. A positive agents amount is credit and enters the
-- waterfall at step 2; a negative one comes off the payment's own allocations
-- as a refund does.

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
  v_moved jsonb := '[]'::jsonb;
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
  perform money.money_lock();
  perform money.lock_money_cards(array(
    select distinct card_id from public.contribution_allocations where payment_id = v_payment.id and card_id is not null
  ));
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

  if v_agents > 0 then
    v_moved := money.place_credit(v_payment.id, v_id, v_agents, 2, 'credit', gen_random_uuid(), null);
  elsif v_agents < 0 then
    v_moved := money.unwind_credit(v_payment.id, v_id, -v_agents, gen_random_uuid()) -> 'rows';
  end if;

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
    'pool_reserve_usd', v_reserve_after,
    'allocations', v_moved
  );
end;
$$;

-- cancel_card ---------------------------------------------------------------
-- The backlog version without the money refusal. A proposed, designing, voted,
-- funded or paused card is rejected with the board's reason, and its unspent
-- money moves at once to the next cards in line. A building or gated card is
-- still refused. A payment still on hold for it enters at step 2 when
-- released, since a rejected card takes no money.

create or replace function public.cancel_card(p_card uuid, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
  v_release jsonb;
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
  perform money.money_lock();
  perform money.lock_money_cards(array[p_card]);
  perform 1 from public.pool where id = 1 for update;
  select * into v_card from public.cards where id = p_card;
  if not found then
    raise exception 'Card % does not exist', p_card;
  end if;
  if v_card.stage in ('building', 'gated') then
    raise exception 'A building or gated card cannot be cancelled; pause the studio and cancel it once it shows paused';
  end if;
  if v_card.stage not in ('proposed', 'designing', 'voted', 'funded', 'paused') then
    raise exception 'A % card cannot be cancelled', v_card.stage;
  end if;
  update public.cards set stage = 'rejected', failing_check = 'cancelled_by_board' where id = p_card;
  v_release := money.release_card(p_card);
  insert into public.board_actions (action, card_id, actor_email, reason, details)
  values ('cancel_card', p_card, auth.email(), btrim(p_reason), jsonb_build_object(
    'from_stage', v_card.stage,
    'funded_usd', v_card.funded_usd,
    'moved_usd', v_release -> 'moved_usd',
    'moved_to', v_release -> 'moved_to'
  ));
  return jsonb_build_object(
    'card_id', p_card,
    'stage', 'rejected',
    'from_stage', v_card.stage,
    'moved_usd', v_release -> 'moved_usd',
    'moved_to', v_release -> 'moved_to'
  );
end;
$$;

-- set_paused ----------------------------------------------------------------
-- The board-two-factor version with the reason added last, board by default,
-- so the deployed board site's set_paused({p_paused}) still resolves. The
-- one-argument signature is dropped so only this one exists.

drop function if exists public.set_paused(boolean);

create or replace function public.set_paused(p_paused boolean, p_reason text default null) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.board_role() is null then
    raise exception 'Board or moderator membership is required';
  end if;
  if public.board_role() = 'board'::public.board_role and not public.board_aal2() then
    raise exception 'A second factor is required';
  end if;
  if p_paused is null then
    raise exception 'p_paused is required';
  end if;
  if p_paused and p_reason is not null and p_reason not in ('awaiting_credit', 'spend_limit', 'incident', 'board') then
    raise exception 'The pause reason must be awaiting_credit, spend_limit, incident or board';
  end if;
  update public.studio_state
  set paused = p_paused,
      paused_by = case when p_paused then auth.email() else null end,
      paused_at = case when p_paused then now() else null end,
      pause_reason = case when p_paused then coalesce(p_reason, 'board') else null end
  where id = 1;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;
end;
$$;

-- waterfall_sweep -----------------------------------------------------------
-- Every five minutes: moves each live or rejected card's unspent money back in
-- at step 2, newest money first; moves each full proposed or voted goal card
-- on now to funded; drains Not on a card yet onto the cards that take money.
-- A second sweep with nothing new moves nothing.

create or replace function public.waterfall_sweep() returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card uuid;
  v_release jsonb;
  v_released integer := 0;
  v_released_usd numeric(12,4) := 0;
  v_promoted integer := 0;
  v_drain jsonb;
begin
  perform money.money_lock();
  perform money.lock_money_cards(array(
    select id from public.cards where stage in ('live', 'rejected') and funded_usd > 0
  ));
  perform 1 from public.pool where id = 1 for update;

  for v_card in
    select c.id from public.cards c
    where c.stage in ('live', 'rejected') and c.funded_usd > money.card_studio_spend(c.id)
    order by c.id
  loop
    v_release := money.release_card(v_card);
    if (v_release ->> 'moved_usd')::numeric > 0 then
      v_released := v_released + 1;
      v_released_usd := v_released_usd + (v_release ->> 'moved_usd')::numeric;
    end if;
  end loop;

  update public.cards
  set stage = 'funded'
  where shape = 'goal'
    and horizon = 'now'
    and stage in ('proposed', 'voted')
    and funding_target_usd > 0
    and funded_usd >= funding_target_usd;
  get diagnostics v_promoted = row_count;

  v_drain := money.drain_unassigned();

  return jsonb_build_object(
    'released_cards', v_released,
    'released_usd', v_released_usd,
    'promoted', v_promoted,
    'drained_usd', (v_drain ->> 'drained_usd')::numeric
  );
end;
$$;

-- ledger_identity -----------------------------------------------------------
-- The backup-role version with two lines added, each a count:
--   I4  payments whose allocations differ from their family's credit
--       (agents less incident less held, over the payment and its children);
--   I5  cards whose funded_usd differs from their allocations.
-- holds needs I1 to I5. Not on a card yet is shown, not checked: a shortfall
-- is not an identity failure.

create or replace function public.ledger_identity() returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pool public.pool%rowtype;
  v_reserve numeric;
  v_agents numeric;
  v_held numeric;
  v_rows bigint;
  v_studio numeric;
  v_overhead numeric;
  v_studio_rows bigint;
  v_overhead_rows bigint;
  v_i1 numeric;
  v_i2 numeric;
  v_i3 numeric;
  v_i4 bigint;
  v_i5 bigint;
  v_not_on_card numeric;
begin
  select * into v_pool from public.pool where id = 1;
  if not found then
    return jsonb_build_object('holds', false, 'error', 'pool row 1 is missing');
  end if;
  select coalesce(sum(reserve_usd), 0), coalesce(sum(agents_usd), 0), coalesce(sum(held_usd), 0), count(*)
  into v_reserve, v_agents, v_held, v_rows
  from public.contributions;
  select
    coalesce(sum(usd) filter (where billed_to = 'studio'), 0),
    coalesce(sum(usd) filter (where billed_to = 'overhead'), 0),
    count(*) filter (where billed_to = 'studio'),
    count(*) filter (where billed_to = 'overhead')
  into v_studio, v_overhead, v_studio_rows, v_overhead_rows
  from public.ledger;

  select count(*) into v_i4
  from (
    select coalesce(c.payment_id, a.payment_id) as payment_id
    from (
      select coalesce(parent_id, id) as payment_id, sum(agents_usd - incident_usd - held_usd) as usd
      from public.contributions
      group by 1
    ) c
    full join (
      select payment_id, sum(amount_usd) as usd from public.contribution_allocations group by 1
    ) a on a.payment_id = c.payment_id
    where coalesce(c.usd, 0) <> coalesce(a.usd, 0)
  ) drifting;

  select count(*) into v_i5
  from public.cards c
  left join (
    select card_id, sum(amount_usd) as usd from public.contribution_allocations
    where destination = 'card'
    group by card_id
  ) a on a.card_id = c.id
  where c.funded_usd <> coalesce(a.usd, 0);

  v_i1 := v_pool.reserve_usd - v_reserve;
  v_i2 := (v_pool.balance_usd + v_pool.incident_reserve_usd + v_pool.held_usd) - (v_agents - v_studio);
  v_i3 := v_pool.held_usd - v_held;
  v_not_on_card := money.not_on_card_usd();

  return jsonb_build_object(
    'holds', v_i1 = 0 and v_i2 = 0 and v_i3 = 0 and v_i4 = 0 and v_i5 = 0,
    'lines', jsonb_build_array(
      jsonb_build_object('name', 'I1', 'left', v_pool.reserve_usd, 'right', v_reserve, 'drift', v_i1, 'holds', v_i1 = 0),
      jsonb_build_object('name', 'I2', 'left', v_pool.balance_usd + v_pool.incident_reserve_usd + v_pool.held_usd, 'right', v_agents - v_studio, 'drift', v_i2, 'holds', v_i2 = 0),
      jsonb_build_object('name', 'I3', 'left', v_pool.held_usd, 'right', v_held, 'drift', v_i3, 'holds', v_i3 = 0),
      jsonb_build_object('name', 'I4', 'left', v_i4, 'right', 0, 'drift', v_i4, 'holds', v_i4 = 0, 'counts', 'payments whose allocations differ from their credit'),
      jsonb_build_object('name', 'I5', 'left', v_i5, 'right', 0, 'drift', v_i5, 'holds', v_i5 = 0, 'counts', 'cards whose bar differs from their allocations')
    ),
    'contribution_rows', v_rows,
    'studio_rows', v_studio_rows,
    'overhead_rows', v_overhead_rows,
    'studio_usd', v_studio,
    'overhead_usd', v_overhead,
    'not_on_card_usd', greatest(v_not_on_card, 0),
    'short_usd', greatest(-v_not_on_card, 0),
    'checked_at', now()
  );
end;
$$;

-- controller_figures --------------------------------------------------------
-- The backup-role version; each family says whether it is the board's own test
-- payment, which the Controller leaves out of the agent money a credit
-- purchase may use.

create or replace function public.controller_figures() returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pool public.pool%rowtype;
  v_state public.studio_state%rowtype;
  v_last timestamptz;
  v_credit jsonb;
  v_cards jsonb;
  v_families jsonb;
begin
  select * into v_pool from public.pool where id = 1;
  if not found then
    raise exception 'pool row 1 is missing';
  end if;
  select * into v_state from public.studio_state where id = 1;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;
  select max(created_at) into v_last from public.credit_purchases;

  select jsonb_build_object(
    'bought_usd', coalesce((select sum(amount_usd) from public.credit_purchases), 0),
    'purchases', (select count(*) from public.credit_purchases),
    'last_purchase_at', v_last,
    'studio_spend_usd', coalesce(sum(usd) filter (where billed_to = 'studio'), 0),
    'overhead_usd', coalesce(sum(usd) filter (where billed_to = 'overhead'), 0),
    'overhead_since_last_purchase_usd', coalesce(sum(usd) filter (where billed_to = 'overhead' and (v_last is null or created_at > v_last)), 0)
  ) into v_credit
  from public.ledger;

  select jsonb_build_object(
    'count', count(*),
    'remaining_ceilings_usd', coalesce(sum(greatest(least(round(1.5 * c.estimate_usd, 4), v_state.card_max_usd) - coalesce(s.usd, 0), 0)), 0)
  ) into v_cards
  from public.cards c
  left join (
    select card_id, sum(usd) as usd from public.ledger
    where billed_to = 'studio' and card_id is not null
    group by card_id
  ) s on s.card_id = c.id
  where c.stage in ('funded', 'building');

  select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at, f.payment_id), '[]'::jsonb) into v_families
  from (
    select
      p.id as payment_id,
      p.stripe_session_id as session_id,
      p.rail::text as rail,
      p.created_at,
      p.amount_usd,
      p.net_usd,
      -coalesce(sum(c.amount_usd) filter (where c.entry = 'refund'), 0) as refunded_usd,
      -coalesce(sum(c.amount_usd) filter (where c.entry = 'dispute'), 0) as disputed_usd,
      coalesce(sum(c.amount_usd) filter (where c.entry = 'reinstated'), 0) as reinstated_usd,
      coalesce(sum(c.net_usd) filter (where c.entry = 'adjustment'), 0) as adjusted_net_usd,
      p.net_usd + coalesce(sum(c.net_usd), 0) as books_net_usd,
      (p.agents_usd - p.incident_usd - p.held_usd) + coalesce(sum(c.agents_usd - c.incident_usd - c.held_usd), 0) as agent_money_usd,
      p.held_usd + coalesce(sum(c.held_usd), 0) as held_usd,
      exists (select 1 from public.board_test_payments b where b.stripe_session_id = p.stripe_session_id) as board_test
    from public.contributions p
    left join public.contributions c on c.parent_id = p.id
    where p.entry = 'payment'
    group by p.id
  ) f;

  return jsonb_build_object(
    'pool', jsonb_build_object(
      'balance_usd', v_pool.balance_usd,
      'reserve_usd', v_pool.reserve_usd,
      'incident_reserve_usd', v_pool.incident_reserve_usd,
      'held_usd', v_pool.held_usd
    ),
    'studio_reserve_usd', v_state.studio_reserve_usd,
    'card_max_usd', v_state.card_max_usd,
    'credit', v_credit,
    'funded_cards', v_cards,
    'families', v_families
  );
end;
$$;

-- i. The sweep on pg_cron -----------------------------------------------------
-- A database that does not ship pg_cron (PGlite in the tests) skips the
-- schedule; any error on a database that does ship it fails the migration.
-- cron.schedule with a job name replaces the existing job, so a second run is
-- safe.

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; waterfall_sweep is not scheduled';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('waterfall-sweep', '*/5 * * * *', 'select public.waterfall_sweep()');
end $$;

-- j. The public reads ---------------------------------------------------------
-- None names a contributor, an email, a name, a session or a supporter's
-- single payment.

-- public_card_funding: per card, the payers whose counted payments reached it,
-- what reached it from them (money released on to other cards still counts,
-- so a shipped card keeps its funders), and the bar.
create or replace view public.public_card_funding with (security_invoker = false) as
  select
    r.card_id,
    (count(distinct p.contributor_id) filter (where r.reached_usd > 0 and money.payment_counts(r.payment_id)))::integer as contributors,
    coalesce(sum(r.reached_usd) filter (where r.reached_usd > 0 and money.payment_counts(r.payment_id)), 0)::numeric(12,4) as credited_usd,
    max(r.on_card_usd)::numeric(12,4) as on_card_usd
  from (
    select
      a.card_id,
      a.payment_id,
      sum(a.amount_usd) filter (where not (a.reason = 'card_release' and a.amount_usd < 0)) as reached_usd,
      sum(sum(a.amount_usd)) over (partition by a.card_id) as on_card_usd
    from public.contribution_allocations a
    where a.destination = 'card'
    group by a.card_id, a.payment_id
  ) r
  join public.contributions p on p.id = r.payment_id
  group by r.card_id;

-- public_money: the books in one row. The money-in columns leave out the
-- board's test payment's family (PLAN.md §10 decision 23), and they add up:
-- received - fees - refunded - disputed + corrections
--   = reserve + studio + incident + held + agent credit.
create or replace view public.public_money with (security_invoker = false) as
  with fam_rows as (
    select c.*
    from public.contributions c
    join public.contributions fam on fam.id = coalesce(c.parent_id, c.id)
    where not exists (select 1 from public.board_test_payments b where b.stripe_session_id = fam.stripe_session_id)
  ),
  books as (
    select
      (count(*) filter (where entry = 'payment'))::integer as payments,
      coalesce(sum(amount_usd) filter (where entry = 'payment'), 0)::numeric(12,4) as received_usd,
      (coalesce(sum(amount_usd - net_usd) filter (where entry <> 'adjustment'), 0)
        + coalesce(sum(-net_usd) filter (where entry = 'adjustment' and stripe_event_id is not null), 0))::numeric(12,4) as stripe_fees_usd,
      (-coalesce(sum(amount_usd) filter (where entry = 'refund'), 0))::numeric(12,4) as refunded_usd,
      (-coalesce(sum(amount_usd) filter (where entry in ('dispute', 'reinstated')), 0))::numeric(12,4) as disputed_usd,
      coalesce(sum(net_usd) filter (where entry = 'adjustment' and stripe_event_id is null), 0)::numeric(12,4) as corrections_usd,
      round(sum(studio_pct_chosen * net_usd) filter (where entry = 'payment') / nullif(sum(net_usd) filter (where entry = 'payment'), 0), 2) as studio_pct_avg,
      coalesce(sum(reserve_usd), 0)::numeric(12,4) as reserve_usd,
      coalesce(sum(studio_usd), 0)::numeric(12,4) as studio_usd,
      coalesce(sum(incident_usd), 0)::numeric(12,4) as incident_usd,
      coalesce(sum(held_usd), 0)::numeric(12,4) as held_usd,
      coalesce(sum(agents_usd - incident_usd - held_usd), 0)::numeric(12,4) as agent_credit_usd
    from fam_rows
  ),
  run as (
    select finished_at, ok from public.controller_runs
    where job = 'reconcile'
    order by created_at desc, id desc
    limit 1
  ),
  place as (
    select money.not_on_card_usd() as usd
  )
  select
    books.payments,
    books.received_usd,
    books.stripe_fees_usd,
    books.refunded_usd,
    books.disputed_usd,
    books.corrections_usd,
    books.studio_pct_avg,
    books.reserve_usd,
    books.studio_usd,
    books.incident_usd,
    books.held_usd,
    books.agent_credit_usd,
    greatest(place.usd, 0)::numeric(12,4) as not_on_card_usd,
    greatest(-place.usd, 0)::numeric(12,4) as short_usd,
    money.board_test_usd() as board_test_usd,
    (select case when run.ok then run.finished_at end from run) as reconciled_at,
    (select run.ok from run) as last_run_ok,
    coalesce((
      select jsonb_agg(jsonb_build_object('position', f."position", 'card_id', f.card_id, 'room_usd', f.room_usd) order by f."position")
      from money.funding_order() f
    ), '[]'::jsonb) as funding_order
  from books, place;

-- public_stopped_cards: the rejected and paused cards on now, what each spent
-- and held, and for a rejected card where its money went (a card with its
-- title, or null for Not on a card yet) and how much.
create or replace view public.public_stopped_cards with (security_invoker = false) as
  select
    c.id as card_id,
    c.title,
    c.stage,
    c.failing_check,
    coalesce(s.spent_usd, 0)::numeric(12,4) as spent_usd,
    c.funded_usd,
    coalesce(f.credited_usd, 0)::numeric(12,4) as credited_usd,
    coalesce((
      select jsonb_agg(jsonb_build_object('to_card_id', m.card_id, 'to_title', t.title, 'usd', m.usd) order by m.usd desc, m.card_id nulls last)
      from (
        select a.card_id, sum(a.amount_usd)::numeric(12,4) as usd
        from public.contribution_allocations a
        where a.reason = 'card_release' and a.amount_usd > 0 and a.from_card_id = c.id
        group by a.card_id
      ) m
      left join public.cards t on t.id = m.card_id
    ), '[]'::jsonb) as moved,
    c.updated_at as stopped_at
  from public.cards c
  left join (
    select card_id, sum(usd)::numeric(12,4) as spent_usd from public.ledger
    where billed_to = 'studio' and card_id is not null
    group by card_id
  ) s on s.card_id = c.id
  left join public.public_card_funding f on f.card_id = c.id
  where c.horizon = 'now' and c.stage in ('rejected', 'paused');

-- public_studio: the board-site view with why it is paused, null while it is
-- not. Never who paused it or when.
create or replace view public.public_studio with (security_invoker = false) as
  select launched_at, paused, platform_lane_open, case when paused then pause_reason end as pause_reason
  from public.studio_state where id = 1;

revoke all on table public.public_card_funding, public.public_money, public.public_stopped_cards, public.public_studio from anon, authenticated, service_role;
grant select on public.public_card_funding, public.public_money, public.public_stopped_cards, public.public_studio to anon, authenticated, service_role;

-- k. Append-only ----------------------------------------------------------------
-- The money tables' guard on the three new tables. terms_versions keeps its
-- own two triggers; this loop never touches them.

do $$
declare
  v_table text;
begin
  foreach v_table in array array['contribution_allocations', 'supporters', 'board_test_payments'] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_append_only', v_table);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.refuse_money_change()', v_table || '_append_only', v_table);
    execute format('drop trigger if exists %I on public.%I', v_table || '_no_truncate', v_table);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.refuse_money_change()', v_table || '_no_truncate', v_table);
  end loop;
end
$$;

-- l. Privileges and the closing check -----------------------------------------

revoke all on function public.studio_pause_reason() from public, anon, authenticated;
revoke all on function public.apply_contribution(text, text, text, numeric, numeric, integer, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_contribution(text, text, text, numeric, numeric, integer, uuid, text, text, timestamptz) to service_role;
revoke all on function public.credit_held_contributions() from public, anon, authenticated;
grant execute on function public.credit_held_contributions() to service_role;
revoke all on function public.reverse_contribution(text, text, public.contribution_entry, numeric) from public, anon, authenticated;
grant execute on function public.reverse_contribution(text, text, public.contribution_entry, numeric) to service_role;
revoke all on function public.record_dispute_reinstated(text, text, numeric) from public, anon, authenticated;
grant execute on function public.record_dispute_reinstated(text, text, numeric) to service_role;
revoke all on function public.record_stripe_fee(text, text, numeric) from public, anon, authenticated;
grant execute on function public.record_stripe_fee(text, text, numeric) to service_role;
revoke all on function public.record_adjustment(uuid, numeric, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.record_adjustment(uuid, numeric, numeric, numeric, numeric, text) to authenticated, service_role;
revoke all on function public.cancel_card(uuid, text) from public, anon;
grant execute on function public.cancel_card(uuid, text) to authenticated, service_role;
revoke all on function public.set_paused(boolean, text) from public, anon;
grant execute on function public.set_paused(boolean, text) to authenticated, service_role;
revoke all on function public.waterfall_sweep() from public, anon, authenticated;
grant execute on function public.waterfall_sweep() to service_role;
revoke all on function public.ledger_identity() from public, anon, authenticated;
grant execute on function public.ledger_identity() to service_role, peanutgallery_backup;
revoke all on function public.controller_figures() from public, anon, authenticated;
grant execute on function public.controller_figures() to service_role;

-- A database with no pool row yet (a fresh one, before its seed) has no
-- money to check.
do $$
declare
  v_identity jsonb := public.ledger_identity();
begin
  if exists (select 1 from public.pool where id = 1) and (v_identity ->> 'holds')::boolean is distinct from true then
    raise exception 'money_logic: the ledger identity does not hold after the migration: %', v_identity;
  end if;
end
$$;

notify pgrst, 'reload schema';
