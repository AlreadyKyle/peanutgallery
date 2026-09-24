-- Agent system core: approvals, dealing after the cooling window, the board's
-- and the roles' controls, and the job queue (docs/specs/agent-system-core.md).
-- Applies after 20260924200000_money_logic.sql and can run twice.
--
-- A card an agent wrote any of (source agent, or a drafter set) needs an
-- approval: a row of card_approvals whose content hash is the card's current
-- one. The hash covers what a builder or funder relies on (bucket, lane,
-- folder, executor, title, summary, intent, acceptance test, design spec URL
-- and funding target), not the estimate, which the board's resume and the
-- resume rule change. record_card_approval, for the service role only,
-- enforces separation of duties and changes nothing on the card. On a card
-- that needs an approval a hashed field changes only through a board RPC
-- (cards_agent_text_guard), and set_card_horizon records a board approval of
-- the new content.
--
-- Outside the board an agent-written card is readable only while its
-- approval is current (card_is_public), everywhere the public reads cards;
-- board members read every card through their own policy. The one money
-- predicate, money.card_takes_money, gains the same test and the board's
-- veto, so no money reaches an unapproved or vetoed card.
--
-- An approved agent card waits on next or later until opens_at (its approval
-- time plus studio_state.cooling_window_minutes, which ships at 0), then the
-- dispatcher's tick deals it to now (deal_due_cards). Every funding path
-- already requires horizon now, so no money reaches it before it is dealt.
--
-- The board vetoes a card, sets the cooling window and resumes a role at the
-- second factor; the moderator may pause a role. jobs and job_runs are the
-- queue the dispatcher drains: pg_cron (in later pull requests) and the board
-- enqueue, a key makes each enqueue happen once, and a job holds at most one
-- queued scheduled run. record_usage refuses a studio row with no card.
--
-- A card paused at its ceiling for the first time resumes by rule when the
-- money on its bar covers the room a new ceiling adds, topped up from money
-- not on a card yet through money.top_up_card, all or nothing.

set lock_timeout = '5s';

-- a. The allocation reason for a top-up ---------------------------------------
-- money-logic's check with ceiling_top_up added. A constraint change fires no
-- row trigger, so the append-only guard lets it pass.

alter table public.contribution_allocations drop constraint if exists contribution_allocations_reason_check;
alter table public.contribution_allocations add constraint contribution_allocations_reason_check
  check (reason in ('credit', 'drain', 'card_release', 'unwind', 'backfill', 'ceiling_top_up'));

-- b. Columns --------------------------------------------------------------------

alter table public.roles add column if not exists agent_class text;
alter table public.roles drop constraint if exists roles_agent_class_check;
alter table public.roles add constraint roles_agent_class_check
  check (agent_class is null or agent_class in ('writer', 'planner', 'reviewer', 'read_only', 'web_only'));
alter table public.roles add column if not exists paused boolean not null default false;
alter table public.roles add column if not exists paused_reason text;
alter table public.roles drop constraint if exists roles_paused_reason_check;
alter table public.roles add constraint roles_paused_reason_check
  check (paused_reason is null or char_length(paused_reason) <= 200);
alter table public.roles add column if not exists paused_at timestamptz;

alter table public.cards add column if not exists drafter_role_id uuid references public.roles (id);
alter table public.cards add column if not exists check_author_role_id uuid references public.roles (id);
alter table public.cards add column if not exists opens_at timestamptz;
alter table public.cards add column if not exists board_vetoed boolean not null default false;
alter table public.cards add column if not exists board_veto_reason text;
alter table public.cards drop constraint if exists cards_board_veto_reason_check;
alter table public.cards add constraint cards_board_veto_reason_check
  check (board_veto_reason is null or char_length(board_veto_reason) <= 200);

alter table public.studio_state add column if not exists cooling_window_minutes integer not null default 0;
alter table public.studio_state drop constraint if exists studio_state_cooling_window_minutes_check;
alter table public.studio_state add constraint studio_state_cooling_window_minutes_check
  check (cooling_window_minutes between 0 and 10080);

-- Column grants on cards: the backlog list with the five new columns added.
-- Revoking first clears any column grant, so a second run starts from nothing.
-- actual_usd, severity and priority stay withheld.
revoke all on public.cards from anon, authenticated;
grant select (
  id, bucket, source, shape, lane, board_reason, folder, executor_role_id,
  title, summary, intent, acceptance_test, design_spec_url,
  funding_target_usd, funded_usd, estimate_usd, confidence, proposer_role_id,
  director_stance, veto_reason, stage, branch, commit_sha, failing_check,
  created_at, updated_at, live_at, horizon, rank,
  drafter_role_id, check_author_role_id, opens_at, board_vetoed, board_veto_reason
) on public.cards to anon, authenticated;

-- c. Tables ---------------------------------------------------------------------

create table if not exists public.jobs (
  name text primary key check (name ~ '^[a-z_]+$'),
  role_id uuid references public.roles (id),
  calls_model boolean not null,
  runs_when_paused boolean not null default false,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null references public.jobs (name),
  idem_key text not null unique,
  origin text not null check (origin in ('board', 'schedule', 'event', 'operator')),
  parent_run_id uuid references public.job_runs (id),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  reason text,
  card_id uuid references public.cards (id),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  holder text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists job_runs_status_created_idx on public.job_runs (status, created_at);
create unique index if not exists job_runs_one_queued_schedule on public.job_runs (job_name) where status = 'queued' and origin = 'schedule';

-- seq orders approvals written in one transaction, which share created_at.
create table if not exists public.card_approvals (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  card_id uuid not null references public.cards (id) on delete restrict,
  kind text not null check (kind in ('draft', 'visual', 'qa_verify', 'board')),
  verdict jsonb not null,
  approver_role_id uuid references public.roles (id),
  approver_email text,
  maker_role_id uuid references public.roles (id),
  maker_ref text,
  grader_ref text not null unique,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  job_run_id uuid references public.job_runs (id),
  created_at timestamptz not null default now(),
  constraint card_approvals_approver_check check ((approver_role_id is null) <> (approver_email is null)),
  constraint card_approvals_board_email_check check ((kind = 'board') = (approver_email is not null))
);
create index if not exists card_approvals_card_idx on public.card_approvals (card_id, created_at desc);

alter table public.jobs enable row level security;
alter table public.job_runs enable row level security;
alter table public.card_approvals enable row level security;
revoke all on public.jobs, public.job_runs from anon, authenticated;
grant all on public.jobs, public.job_runs to service_role;
-- Approvals are written only by record_card_approval and the board RPCs.
revoke all on public.card_approvals from anon, authenticated, service_role;
grant select on public.card_approvals to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'peanutgallery_backup') then
    grant select on public.jobs, public.job_runs, public.card_approvals to peanutgallery_backup;
  end if;
end
$$;

-- card_approvals is append-only, with the money tables' guard.
drop trigger if exists card_approvals_append_only on public.card_approvals;
create trigger card_approvals_append_only before update or delete on public.card_approvals
  for each row execute function public.refuse_money_change();
drop trigger if exists card_approvals_no_truncate on public.card_approvals;
create trigger card_approvals_no_truncate before truncate on public.card_approvals
  for each statement execute function public.refuse_money_change();

-- d. Helpers --------------------------------------------------------------------

-- The content hash: sha256 hex of what a builder or funder relies on.
create or replace function public.card_content_hash_of(c public.cards) returns text
language sql
immutable
security definer
set search_path = public
as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'bucket', c.bucket,
    'lane', c.lane,
    'folder', c.folder,
    'executor_role_id', c.executor_role_id,
    'title', c.title,
    'summary', c.summary,
    'intent', c.intent,
    'acceptance_test', c.acceptance_test,
    'design_spec_url', c.design_spec_url,
    'funding_target_usd', c.funding_target_usd
  )::text, 'UTF8')), 'hex')
$$;

create or replace function public.card_content_hash(p_card uuid) returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.card_content_hash_of(c) from public.cards c where c.id = p_card
$$;

-- A card needs an approval when an agent wrote any of it.
create or replace function public.card_needs_approval(p_source public.card_source, p_drafter uuid) returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select coalesce(p_source = 'agent', false) or p_drafter is not null
$$;

-- The newest draft or board approval carries the card's current hash.
create or replace function public.card_approved(p_card uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select a.content_sha256 = public.card_content_hash(p_card)
    from public.card_approvals a
    where a.card_id = p_card and a.kind in ('draft', 'board')
    order by a.seq desc
    limit 1
  ), false)
$$;

-- What the public may read: a card needing no approval, or one whose approval
-- is current. A policy's functions run as the caller, so anon executes it.
create or replace function public.card_is_public(p_card uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select not public.card_needs_approval(c.source, c.drafter_role_id) or public.card_approved(c.id)
    from public.cards c
    where c.id = p_card
  ), false)
$$;

-- Money on the card's bar, or a payment on hold naming it: the test
-- set_card_horizon has applied to leaving now.
create or replace function public.card_money_held(p_card uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select c.funded_usd <> 0 from public.cards c where c.id = p_card), false)
    or exists (
      select 1 from public.contributions p
      where p.goal_card_id = p_card
        and p.entry = 'payment'
        and p.held_usd + coalesce((select sum(h.held_usd) from public.contributions h where h.parent_id = p.id), 0) > 0
    )
$$;

-- The definition of ready (PLAN.md §4), on a card as it stands; null when it
-- is ready. set_card_horizon and deal_due_cards both apply it.
create or replace function public.card_ready_problem(c public.cards) returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when c.shape <> 'goal' then 'Only a goal card moves to now'
    when btrim(coalesce(c.title, '')) = '' then 'A card on now needs a title'
    when btrim(coalesce(c.summary, '')) = '' then 'A card on now needs a public summary'
    when btrim(coalesce(c.intent, '')) = '' then 'A card on now needs an intent'
    when coalesce(c.acceptance_test, '') !~ '(^|\n)\s*check:\s' then 'A card on now needs a check: line in its acceptance test'
    when c.lane = 'config' and c.folder <> 'seed-1' then 'The config lane exists only for seed-1'
    when c.folder = 'platform' and c.lane = 'code'
      and not coalesce((select s.platform_lane_open from public.studio_state s where s.id = 1), false)
      then 'The platform code lane is closed until the board has its own site'
    when c.executor_role_id is null then 'A card on now needs an executor role'
    when not exists (select 1 from public.roles r where r.id = c.executor_role_id and r.state = 'active') then 'The executor must be an active role'
    when c.funding_target_usd <= 0 then 'The funding target must be above zero'
    when c.funding_target_usd > 10000 then 'The funding target must be at most $10,000'
  end
$$;

-- e. The card text guard ------------------------------------------------------
-- On a card that needs an approval, before or after the update, a hashed field
-- changes only while a board RPC has set peanutgallery.card_writer to board
-- for its own update; so does turning an agent card into one that needs none.

create or replace function public.cards_agent_text_guard() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_needs boolean := public.card_needs_approval(old.source, old.drafter_role_id);
  v_new_needs boolean := public.card_needs_approval(new.source, new.drafter_role_id);
begin
  if coalesce(current_setting('peanutgallery.card_writer', true), '') = 'board' then
    return new;
  end if;
  if (v_old_needs or v_new_needs)
    and public.card_content_hash_of(old) is distinct from public.card_content_hash_of(new) then
    raise exception 'An agent-written card''s content changes only through a board RPC';
  end if;
  if v_old_needs and not v_new_needs then
    raise exception 'An agent-written card stays agent-written';
  end if;
  return new;
end;
$$;

drop trigger if exists cards_agent_text_guard on public.cards;
create trigger cards_agent_text_guard before update on public.cards
  for each row execute function public.cards_agent_text_guard();

-- f. record_card_approval -----------------------------------------------------
-- The service role writes an approval from the grader's own result. Each
-- refusal has its own message; nothing on the card changes.

create or replace function public.record_card_approval(
  p_card uuid,
  p_kind text,
  p_verdict jsonb,
  p_approver_role uuid,
  p_maker_role uuid,
  p_maker_ref text,
  p_grader_ref text,
  p_content_sha256 text,
  p_job_run uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
  v_approver public.roles%rowtype;
  v_id uuid;
begin
  if p_card is null then
    raise exception 'A card is required';
  end if;
  if p_kind is null or p_kind not in ('draft', 'visual', 'qa_verify') then
    raise exception 'The kind must be draft, visual or qa_verify; a board approval is written by a board RPC';
  end if;
  if p_verdict is null or jsonb_typeof(p_verdict) <> 'object' then
    raise exception 'The verdict must be a JSON object';
  end if;
  if p_approver_role is null then
    raise exception 'An approver role is required';
  end if;
  select * into v_card from public.cards where id = p_card;
  if not found then
    raise exception 'Card % does not exist', p_card;
  end if;
  select * into v_approver from public.roles where id = p_approver_role;
  if not found then
    raise exception 'Role % does not exist', p_approver_role;
  end if;
  if p_grader_ref is null or btrim(p_grader_ref) = '' then
    raise exception 'A grader ref is required';
  end if;

  if p_kind = 'qa_verify' and (
    p_approver_role = v_card.executor_role_id
    or btrim(p_grader_ref) = btrim(coalesce(p_maker_ref, ''))
    or exists (
      select 1 from public.agent_events e
      where e.card_id = p_card and e.type = 'start' and e.payload_json ->> 'session_id' = btrim(p_grader_ref)
    )
  ) then
    raise exception 'A qa_verify approval cannot come from the executor or name the build session';
  end if;
  if p_approver_role in (v_card.proposer_role_id, v_card.drafter_role_id, v_card.executor_role_id) then
    raise exception 'The approver cannot be the card''s proposer, drafter or executor';
  end if;
  if v_card.check_author_role_id is not null and v_card.check_author_role_id = v_card.executor_role_id then
    raise exception 'The author of the card''s check lines cannot be its executor';
  end if;
  if p_maker_ref is not null and btrim(p_grader_ref) = btrim(p_maker_ref) then
    raise exception 'The grader ref must differ from the maker ref';
  end if;
  if exists (select 1 from public.card_approvals where grader_ref = btrim(p_grader_ref)) then
    raise exception 'The grader ref % is already used', btrim(p_grader_ref);
  end if;
  if p_content_sha256 is distinct from public.card_content_hash_of(v_card) then
    raise exception 'The content hash is not the card''s current content hash';
  end if;
  if v_approver.paused then
    raise exception 'The approver role is paused';
  end if;
  if v_approver.state <> 'active' then
    raise exception 'The approver role is retired';
  end if;
  if coalesce(v_approver.agent_class, '') not in ('reviewer', 'planner')
    and not (p_kind = 'qa_verify' and v_approver.agent_class = 'writer') then
    raise exception 'The approver role''s class may not approve a % card', p_kind;
  end if;
  if p_kind = 'draft' and coalesce(p_verdict ->> 'verdict', '') <> 'approved' then
    raise exception 'A draft approval needs the verdict approved';
  end if;

  insert into public.card_approvals (
    card_id, kind, verdict, approver_role_id, maker_role_id, maker_ref, grader_ref, content_sha256, job_run_id
  ) values (
    p_card, p_kind, p_verdict, p_approver_role, p_maker_role, nullif(btrim(p_maker_ref), ''), btrim(p_grader_ref), p_content_sha256, p_job_run
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- g. The money predicate ------------------------------------------------------
-- money-logic's body with two more conditions: not vetoed by the board, and
-- public (no approval needed, or a current one). A paused executor role does
-- not stop a dealt card taking money.

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
    and not c.board_vetoed
    and public.card_is_public(c.id)
$$;

-- h. money.top_up_card ----------------------------------------------------------
-- Moves p_usd of money not on a card yet onto one card's bar, oldest payment
-- first, all or nothing: never more than money.drainable_usd() or than the
-- unassigned money there is. Each move is two rows of one batch, reason
-- ceiling_top_up: minus on the payment's unassigned place, plus on the card.

create or replace function money.top_up_card(p_card uuid, p_usd numeric) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usd numeric(12,4) := round(coalesce(p_usd, 0), 4);
  v_rem numeric(12,4);
  v_left numeric(12,4);
  v_batch uuid := gen_random_uuid();
  v_from jsonb := '[]'::jsonb;
  v_place record;
  v_x numeric(12,4);
begin
  perform money.money_lock();
  if v_usd <= 0 then
    raise exception 'A top-up must be above zero';
  end if;
  perform 1 from public.cards where id = p_card for update;
  if not found then
    raise exception 'Card % does not exist', p_card;
  end if;
  if v_usd > money.drainable_usd() then
    raise exception 'A top-up of % is more than the % that may leave Not on a card yet', v_usd, money.drainable_usd();
  end if;
  select coalesce(sum(net), 0) into v_left
  from (
    select sum(amount_usd) as net from public.contribution_allocations
    where destination = 'unassigned'
    group by payment_id
    having sum(amount_usd) > 0
  ) u;
  if v_usd > v_left then
    raise exception 'A top-up of % is more than the % of unassigned money', v_usd, v_left;
  end if;

  v_rem := v_usd;
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
    values (v_place.payment_id, null, 'unassigned', null, -v_x, 'ceiling_top_up', null, v_batch);
    insert into public.contribution_allocations (payment_id, entry_id, destination, card_id, amount_usd, reason, step, batch_id)
    values (v_place.payment_id, null, 'card', p_card, v_x, 'ceiling_top_up', null, v_batch);
    perform money.bump_card(p_card, v_x);
    v_from := v_from || jsonb_build_object('payment_id', v_place.payment_id, 'usd', v_x);
    v_rem := v_rem - v_x;
  end loop;
  return jsonb_build_object('moved_usd', v_usd - v_rem, 'from_payments', v_from);
end;
$$;

revoke all on function money.top_up_card(uuid, numeric) from public, anon, authenticated, service_role;

-- i. set_card_horizon -----------------------------------------------------------
-- board-site's version, same signature. The ready checks are card_ready_problem;
-- opens_at is cleared when the card leaves now or moves between next and
-- later; a change to what an approval covers, on a card that needs one, is
-- written as the board's and records a board approval of the new content.

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
  v_problem text;
  v_action uuid;
  v_hash text;
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

  perform set_config('peanutgallery.card_writer', 'board', true);
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
    update public.cards
    set horizon = p_horizon,
        rank = p_rank,
        opens_at = case when p_horizon is distinct from v_card.horizon then null else opens_at end
    where id = p_card
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
    v_problem := public.card_ready_problem(v_after);
    if v_problem is not null then
      raise exception '%', v_problem;
    end if;
  end if;
  perform set_config('peanutgallery.card_writer', '', true);

  insert into public.board_actions (action, card_id, actor_email, reason, details)
  values ('set_card_horizon', p_card, auth.email(), btrim(p_reason), jsonb_build_object(
    'from_horizon', v_card.horizon,
    'to_horizon', v_after.horizon,
    'from_rank', v_card.rank,
    'to_rank', v_after.rank,
    'from_target_usd', v_card.funding_target_usd,
    'to_target_usd', v_after.funding_target_usd
  ))
  returning id into v_action;

  v_hash := public.card_content_hash_of(v_after);
  if public.card_needs_approval(v_after.source, v_after.drafter_role_id) and v_hash is distinct from public.card_content_hash_of(v_card) then
    insert into public.card_approvals (card_id, kind, verdict, approver_email, grader_ref, content_sha256)
    values (p_card, 'board', jsonb_build_object('verdict', 'approved', 'reason', btrim(p_reason)), auth.email(), 'board:' || v_action, v_hash);
  end if;

  return jsonb_build_object(
    'card_id', v_after.id,
    'horizon', v_after.horizon,
    'rank', v_after.rank,
    'stage', v_after.stage,
    'funding_target_usd', v_after.funding_target_usd
  );
end;
$$;

-- j. Who reads cards ------------------------------------------------------------

drop policy if exists cards_public_read on public.cards;
create policy cards_public_read on public.cards for select to anon, authenticated using (public.card_is_public(id));
drop policy if exists cards_board_read on public.cards;
create policy cards_board_read on public.cards for select to authenticated using (public.is_board_member());

-- The public views, each filtered to the cards the public may read. An event
-- that names no card stays, and a stopped card's money moved to a card the
-- public may not read shows no title for it.

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
  where public.card_is_public(r.card_id)
  group by r.card_id;

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
      select jsonb_agg(jsonb_build_object('to_card_id', m.card_id, 'to_title', case when public.card_is_public(m.card_id) then t.title end, 'usd', m.usd) order by m.usd desc, m.card_id nulls last)
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
  where c.horizon = 'now' and c.stage in ('rejected', 'paused') and public.card_is_public(c.id);

create or replace view public.public_card_spend with (security_invoker = false) as
  select
    card_id,
    sum(usd)::numeric(12,4) as spent_usd
  from public.ledger
  where billed_to = 'studio' and card_id is not null and public.card_is_public(card_id)
  group by card_id;

create or replace view public.public_agent_events with (security_invoker = false) as
  select id, card_id, role_id, type, created_at
  from public.agent_events
  where card_id is null or public.card_is_public(card_id);

create or replace view public.public_roles with (security_invoker = false) as
  select id, name, title, description, species_note, avatar_url, model, write_access, state, hired_at, status, trigger,
    agent_class, paused, paused_reason
  from public.roles;

revoke all on table public.public_card_funding, public.public_stopped_cards from anon, authenticated, service_role;
grant select on public.public_card_funding, public.public_stopped_cards to anon, authenticated, service_role;
revoke all on table public.public_card_spend, public.public_agent_events, public.public_roles from anon, authenticated;
grant select on public.public_card_spend, public.public_agent_events, public.public_roles to anon, authenticated;

-- What the dispatcher reads about its cards: every card, with the approval,
-- the vetoes and the executor's pause. The view keeps no stage list of its
-- own; each caller asks for its stages (a tick the hold stages and building,
-- startup recovery building and gated), so no stage a caller asks for is
-- ever dropped here.
create or replace view public.dispatcher_cards with (security_invoker = false) as
  select
    c.*,
    public.card_needs_approval(c.source, c.drafter_role_id) as needs_approval,
    public.card_approved(c.id) as approved,
    coalesce(r.paused, false) as executor_paused
  from public.cards c
  left join public.roles r on r.id = c.executor_role_id;

revoke all on table public.dispatcher_cards from anon, authenticated, service_role;
grant select on public.dispatcher_cards to service_role;

-- k. Dealing and resume by rule (service role) --------------------------------

-- Deals every approved agent card whose cooling window has passed to now, if
-- it is still approved, vetoed by neither the board nor the Director, its
-- executor is not paused and it is ready.
create or replace function public.deal_due_cards() returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
begin
  perform money.money_lock();
  for v_card in
    select c.* from public.cards c
    left join public.roles r on r.id = c.executor_role_id
    where public.card_needs_approval(c.source, c.drafter_role_id)
      and c.stage = 'proposed'
      and c.horizon in ('next', 'later')
      and c.opens_at <= now()
      and not c.board_vetoed
      and c.director_stance <> 'vetoed'
      and not coalesce(r.paused, false)
    order by c.opens_at, c.id
    for update of c
  loop
    continue when not public.card_approved(v_card.id);
    continue when public.card_ready_problem(v_card) is not null;
    update public.cards set horizon = 'now' where id = v_card.id;
    insert into public.agent_events (card_id, role_id, type, payload_json)
    values (v_card.id, null, 'message', jsonb_build_object('step', 'dealt', 'opens_at', v_card.opens_at));
    return next v_card.id;
  end loop;
  return;
end;
$$;

-- Whether a card has been resumed from a ceiling pause before, by the rule (a
-- resume_rule event) or by the board (a resume_card action taken while the
-- card was paused at its ceiling). The rule resumes a card once; a card paused
-- at its ceiling again waits for the board, however the first pause ended.
create or replace function public.card_ceiling_resumed(p_card uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.agent_events e where e.card_id = p_card and e.payload_json ->> 'step' = 'resume_rule')
    or exists (select 1 from public.board_actions b where b.card_id = p_card and b.action = 'resume_card' and b.details ->> 'failing_check' = 'ceiling')
$$;

-- A card paused at its ceiling for the first time: the new estimate is its
-- actual cost, the new ceiling the lower of 1.5 times that and the card
-- maximum. The money on its bar (funded less its studio spend) must cover the
-- room the new ceiling adds; if it is short, the bar is topped up from money
-- not on a card yet, all or nothing, or the card waits and nothing changes.
create or replace function public.resume_card_by_rule(p_card uuid) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
  v_max numeric(12,4);
  v_e numeric(12,4);
  v_c numeric(12,4);
  v_bar numeric(12,4);
  v_room numeric(12,4);
  v_need numeric(12,4) := 0;
  v_available numeric(12,4);
begin
  perform money.money_lock();
  perform money.lock_money_cards(array[p_card]);
  select * into v_card from public.cards where id = p_card;
  if not found then
    raise exception 'Card % does not exist', p_card;
  end if;
  if v_card.stage <> 'paused' or v_card.failing_check is distinct from 'ceiling' or v_card.horizon <> 'now' then
    return jsonb_build_object('card_id', p_card, 'skipped', 'not_paused_at_its_ceiling');
  end if;
  if not public.card_is_public(p_card) then
    return jsonb_build_object('card_id', p_card, 'skipped', 'approval_not_current');
  end if;
  if public.card_ceiling_resumed(p_card) then
    return jsonb_build_object('card_id', p_card, 'blocked', 'resumed_before');
  end if;
  select card_max_usd into v_max from public.studio_state where id = 1;
  v_e := round(v_card.actual_usd, 4);
  v_c := least(round(1.5 * v_e, 4), coalesce(v_max, 0));
  if v_c <= v_card.actual_usd then
    return jsonb_build_object('card_id', p_card, 'blocked', 'card_max');
  end if;
  v_bar := v_card.funded_usd - money.card_studio_spend(p_card);
  v_room := v_c - v_card.actual_usd;
  if v_bar < v_room then
    v_need := v_room - v_bar;
    select coalesce(sum(net), 0) into v_available
    from (
      select sum(amount_usd) as net from public.contribution_allocations
      where destination = 'unassigned'
      group by payment_id
      having sum(amount_usd) > 0
    ) u;
    v_available := least(v_available, money.drainable_usd());
    if v_available < v_need then
      return jsonb_build_object('card_id', p_card, 'waiting', true, 'need_usd', v_need);
    end if;
    perform money.top_up_card(p_card, v_need);
    insert into public.agent_events (card_id, role_id, type, payload_json)
    values (p_card, null, 'message', jsonb_build_object('step', 'ceiling_top_up', 'usd', v_need));
  end if;
  update public.cards set estimate_usd = v_e, stage = 'funded', failing_check = null where id = p_card;
  insert into public.agent_events (card_id, role_id, type, payload_json)
  values (p_card, null, 'message', jsonb_build_object(
    'step', 'resume_rule',
    'estimate_usd', v_e,
    'ceiling_usd', v_c,
    'actual_usd', v_card.actual_usd,
    'top_up_usd', v_need
  ));
  return jsonb_build_object('card_id', p_card, 'resumed', true, 'estimate_usd', v_e, 'ceiling_usd', v_c, 'top_up_usd', v_need);
end;
$$;

create or replace function public.resume_due_by_rule() returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  for v_id in
    select c.id from public.cards c
    where c.stage = 'paused'
      and c.failing_check = 'ceiling'
      and c.horizon = 'now'
      and not public.card_ceiling_resumed(c.id)
    order by c.id
  loop
    v_result := public.resume_card_by_rule(v_id);
    v_results := v_results || v_result;
  end loop;
  return jsonb_build_object(
    'resumed', (select count(*) from jsonb_array_elements(v_results) r where (r ->> 'resumed')::boolean is true),
    'results', v_results
  );
end;
$$;

-- l. Board RPCs -------------------------------------------------------------------

alter table public.board_actions drop constraint if exists board_actions_action_check;
alter table public.board_actions add constraint board_actions_action_check
  check (action in ('set_caps', 'record_credit_purchase', 'file_card', 'set_card_horizon', 'cancel_card', 'resume_card', 'record_adjustment', 'redact_display_name',
    'set_card_veto', 'set_role_pause', 'set_cooling_window', 'enqueue_manual_job'));

create or replace function public.set_cooling_window(p_minutes integer, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before integer;
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
  if p_minutes is null or p_minutes < 0 or p_minutes > 10080 then
    raise exception 'The cooling window must be between 0 and 10,080 minutes';
  end if;
  select cooling_window_minutes into v_before from public.studio_state where id = 1 for update;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;
  update public.studio_state set cooling_window_minutes = p_minutes where id = 1;
  insert into public.board_actions (action, card_id, actor_email, reason, details)
  values ('set_cooling_window', null, auth.email(), btrim(p_reason), jsonb_build_object('from_minutes', v_before, 'to_minutes', p_minutes));
  return jsonb_build_object('cooling_window_minutes', p_minutes);
end;
$$;

-- The board or the moderator pauses a role; only the board resumes one. The
-- board acts at the second factor, the moderator's pause at the first.
create or replace function public.set_role_pause(p_role uuid, p_paused boolean, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
begin
  if public.board_role() is null then
    raise exception 'Board or moderator membership is required';
  end if;
  if p_paused is null then
    raise exception 'p_paused is required';
  end if;
  if not p_paused and public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Only the board resumes a role';
  end if;
  if public.board_role() = 'board'::public.board_role and not public.board_aal2() then
    raise exception 'A second factor is required';
  end if;
  if p_role is null then
    raise exception 'A role is required';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required';
  end if;
  if char_length(btrim(p_reason)) > 200 then
    raise exception 'The reason must be 200 characters or fewer';
  end if;
  select * into v_role from public.roles where id = p_role for update;
  if not found then
    raise exception 'Role % does not exist', p_role;
  end if;
  update public.roles
  set paused = p_paused,
      paused_reason = case when p_paused then btrim(p_reason) end,
      paused_at = case when p_paused then now() end
  where id = p_role;
  insert into public.board_actions (action, card_id, actor_email, reason, details)
  values ('set_role_pause', null, auth.email(), btrim(p_reason), jsonb_build_object(
    'role_id', p_role, 'role', v_role.name, 'from_paused', v_role.paused, 'to_paused', p_paused
  ));
  return jsonb_build_object('role_id', p_role, 'paused', p_paused);
end;
$$;

-- The board's veto, apart from the Director's stance. Only a card open for
-- funding with no money on its bar or on hold; a vetoed card on now moves to
-- next. Unvetoing an approved agent card starts its cooling window again.
create or replace function public.set_card_veto(p_card uuid, p_vetoed boolean, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
  v_after public.cards%rowtype;
  v_window integer;
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
  if p_vetoed is null then
    raise exception 'p_vetoed is required';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required';
  end if;
  if char_length(btrim(p_reason)) > 200 then
    raise exception 'The reason must be 200 characters or fewer';
  end if;
  perform money.money_lock();
  select * into v_card from public.cards where id = p_card for update;
  if not found then
    raise exception 'Card % does not exist', p_card;
  end if;
  if v_card.stage not in ('proposed', 'designing', 'voted') then
    raise exception 'Only a proposed, designing or voted card can be vetoed or unvetoed';
  end if;
  if p_vetoed then
    if v_card.board_vetoed then
      raise exception 'The card is already vetoed';
    end if;
    if public.card_money_held(p_card) then
      raise exception 'A card holding money cannot be vetoed; cancel it with a reason instead';
    end if;
    update public.cards
    set board_vetoed = true,
        board_veto_reason = btrim(p_reason),
        horizon = case when horizon = 'now' then 'next'::public.card_horizon else horizon end,
        opens_at = case when horizon = 'now' then null else opens_at end
    where id = p_card
    returning * into v_after;
  else
    if not v_card.board_vetoed then
      raise exception 'The card is not vetoed';
    end if;
    select cooling_window_minutes into v_window from public.studio_state where id = 1;
    update public.cards
    set board_vetoed = false,
        board_veto_reason = null,
        opens_at = case
          when public.card_needs_approval(source, drafter_role_id) and public.card_approved(id)
            then now() + make_interval(mins => coalesce(v_window, 0))
          else opens_at
        end
    where id = p_card
    returning * into v_after;
  end if;
  insert into public.board_actions (action, card_id, actor_email, reason, details)
  values ('set_card_veto', p_card, auth.email(), btrim(p_reason), jsonb_build_object(
    'vetoed', p_vetoed,
    'from_horizon', v_card.horizon,
    'to_horizon', v_after.horizon,
    'opens_at', v_after.opens_at
  ));
  return jsonb_build_object('card_id', p_card, 'board_vetoed', v_after.board_vetoed, 'horizon', v_after.horizon, 'opens_at', v_after.opens_at);
end;
$$;

-- m. The job queue ------------------------------------------------------------------

-- Queues a run once per key. A scheduled run's default key is its UTC minute,
-- and a job holds at most one queued scheduled run, so an outage does not pile
-- up stale slots. A run queued by a board-origin run is board origin. Later
-- pull requests schedule a job with
--   cron.schedule('<job>', '<UTC cron>', $$select public.enqueue_job_run('<job>', 'schedule')$$).
create or replace function public.enqueue_job_run(
  p_job text,
  p_origin text,
  p_key text default null,
  p_card uuid default null,
  p_input jsonb default '{}'::jsonb,
  p_parent uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origin text := p_origin;
  v_key text;
  v_input jsonb := coalesce(p_input, '{}'::jsonb);
  v_id uuid;
  v_parent_origin text;
begin
  if p_job is null or not exists (select 1 from public.jobs where name = p_job) then
    raise exception 'Job % does not exist', p_job;
  end if;
  if v_origin is null or v_origin not in ('board', 'schedule', 'event', 'operator') then
    raise exception 'The origin must be board, schedule, event or operator';
  end if;
  if jsonb_typeof(v_input) <> 'object' then
    raise exception 'The input must be a JSON object';
  end if;
  if octet_length(v_input::text) > 4096 then
    raise exception 'The input must be at most 4 KB';
  end if;
  if p_parent is not null then
    select origin into v_parent_origin from public.job_runs where id = p_parent;
    if not found then
      raise exception 'Job run % does not exist', p_parent;
    end if;
    if v_parent_origin = 'board' then
      v_origin := 'board';
    end if;
  end if;
  v_key := coalesce(
    nullif(btrim(p_key), ''),
    case
      when v_origin = 'schedule' then p_job || ':' || to_char(date_trunc('minute', now() at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI"Z"')
      else p_job || ':' || v_origin || ':' || gen_random_uuid()
    end
  );

  insert into public.job_runs (job_name, idem_key, origin, parent_run_id, status, card_id, input)
  values (p_job, v_key, v_origin, p_parent, 'queued', p_card, v_input)
  on conflict do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'created', true);
  end if;
  select id into v_id from public.job_runs where idem_key = v_key;
  if v_id is null and v_origin = 'schedule' then
    select id into v_id from public.job_runs where job_name = p_job and status = 'queued' and origin = 'schedule';
  end if;
  return jsonb_build_object('id', v_id, 'created', false);
end;
$$;

-- Queued to running, only while the caller holds the dispatcher lease.
create or replace function public.claim_job_run(p_run uuid, p_holder text) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_holder is null or btrim(p_holder) = '' then
    raise exception 'p_holder is required';
  end if;
  update public.job_runs
  set status = 'running', started_at = now(), holder = p_holder
  where id = p_run
    and status = 'queued'
    and exists (select 1 from public.dispatcher_lease l where l.id = 1 and l.holder = p_holder and l.expires_at > now());
  return found;
end;
$$;

create or replace function public.finish_job_run(p_run uuid, p_status text, p_reason text, p_output jsonb) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status is null or p_status not in ('succeeded', 'failed', 'skipped') then
    raise exception 'The status must be succeeded, failed or skipped';
  end if;
  if p_status in ('failed', 'skipped') and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'A failed or skipped run needs a reason';
  end if;
  update public.job_runs
  set status = p_status,
      reason = nullif(left(btrim(coalesce(p_reason, '')), 500), ''),
      output = p_output,
      finished_at = now()
  where id = p_run
    and (status = 'running' or (status = 'queued' and p_status = 'skipped'));
  if not found then
    raise exception 'Job run % is not running (or queued, to skip)', p_run;
  end if;
end;
$$;

-- At startup: every run still marked running is finished as failed, only by
-- the lease holder.
create or replace function public.fail_running_job_runs(p_holder text, p_reason text) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not exists (select 1 from public.dispatcher_lease l where l.id = 1 and l.holder = p_holder and l.expires_at > now()) then
    raise exception 'Only the dispatcher lease holder fails running job runs';
  end if;
  update public.job_runs
  set status = 'failed', reason = coalesce(nullif(btrim(p_reason), ''), 'dispatcher_restart'), finished_at = now()
  where status = 'running';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- The board's Run now, with typed input: a board-origin run, keyed once.
create or replace function public.enqueue_manual_job(p_job text, p_card uuid, p_reason text, p_input jsonb default '{}'::jsonb) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := coalesce(p_input, '{}'::jsonb);
  v_run jsonb;
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
  if p_job is null or not exists (select 1 from public.jobs where name = p_job) then
    raise exception 'Job % does not exist', p_job;
  end if;
  if jsonb_typeof(v_input) <> 'object' then
    raise exception 'The input must be a JSON object';
  end if;
  if octet_length(v_input::text) > 4096 then
    raise exception 'The input must be at most 4 KB';
  end if;
  if p_card is not null and not exists (select 1 from public.cards where id = p_card) then
    raise exception 'Card % does not exist', p_card;
  end if;
  v_run := public.enqueue_job_run(p_job, 'board', p_job || ':manual:' || gen_random_uuid(), p_card, v_input, null);
  insert into public.board_actions (action, card_id, actor_email, reason, details)
  values ('enqueue_manual_job', p_card, auth.email(), btrim(p_reason), jsonb_build_object('job', p_job, 'run_id', v_run ->> 'id', 'input', v_input));
  return (v_run ->> 'id')::uuid;
end;
$$;

-- n. The board site's reads --------------------------------------------------------

-- Each job with its last ten runs.
create or replace function public.board_jobs() returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_board_member() then
    raise exception 'Board or moderator membership is required';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', j.name,
      'role_id', j.role_id,
      'role_name', r.name,
      'calls_model', j.calls_model,
      'runs_when_paused', j.runs_when_paused,
      'description', j.description,
      'runs', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', x.id, 'origin', x.origin, 'status', x.status, 'reason', x.reason, 'card_id', x.card_id,
          'input', x.input, 'output', x.output,
          'created_at', x.created_at, 'started_at', x.started_at, 'finished_at', x.finished_at
        ) order by x.created_at desc, x.id)
        from (
          select * from public.job_runs jr where jr.job_name = j.name order by jr.created_at desc, jr.id limit 10
        ) x
      ), '[]'::jsonb)
    ) order by j.name)
    from public.jobs j
    left join public.roles r on r.id = j.role_id
  ), '[]'::jsonb);
end;
$$;

-- Each role with its class and pause.
create or replace function public.board_roles() returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_board_member() then
    raise exception 'Board or moderator membership is required';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'title', r.title, 'agent_class', r.agent_class, 'state', r.state, 'status', r.status,
      'paused', r.paused, 'paused_reason', r.paused_reason, 'paused_at', r.paused_at
    ) order by r.name)
    from public.roles r
  ), '[]'::jsonb);
end;
$$;

-- board-site's board_studio_state with the cooling window.
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
    'cooling_window_minutes', cooling_window_minutes,
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

-- board-site's board_needs_you with two more lists: the ceiling pauses the
-- resume rule will not resume (at the card maximum, or paused at the ceiling a
-- second time), and the cards holding money whose approval is not current.
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
  v_max numeric(12,4);
  v_rule jsonb;
  v_void jsonb;
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
  select card_max_usd into v_max from public.studio_state where id = 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id, 'title', x.title, 'actual_usd', x.actual_usd, 'card_max_usd', v_max,
    'why', case when x.resumed_before then 'resumed_before' else 'card_max' end
  ) order by x.created_at, x.id), '[]'::jsonb)
  into v_rule
  from (
    select c.id, c.title, c.actual_usd, c.created_at,
      public.card_ceiling_resumed(c.id) as resumed_before
    from public.cards c
    where c.stage = 'paused' and c.failing_check = 'ceiling' and c.horizon = 'now'
  ) x
  where x.resumed_before or least(round(1.5 * round(x.actual_usd, 4), 4), coalesce(v_max, 0)) <= x.actual_usd;
  -- A void card whose money the board can still move by cancelling it: a stage
  -- cancel_card takes, with unspent money on its bar or a payment on hold naming
  -- it. Spent money stays on a bar after a cancel, and the sweep moves a live or
  -- rejected card's unspent money on by itself, so neither is listed.
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'stage', x.stage, 'money_usd', x.unspent_usd + x.held_usd) order by x.created_at, x.id), '[]'::jsonb)
  into v_void
  from (
    select c.id, c.title, c.stage, c.created_at,
      greatest(c.funded_usd - money.card_studio_spend(c.id), 0) as unspent_usd,
      coalesce((
        select sum(greatest(p.held_usd + coalesce((select sum(h.held_usd) from public.contributions h where h.parent_id = p.id), 0), 0))
        from public.contributions p
        where p.goal_card_id = c.id and p.entry = 'payment'
      ), 0) as held_usd
    from public.cards c
    where public.card_needs_approval(c.source, c.drafter_role_id)
      and not public.card_approved(c.id)
      and c.stage in ('proposed', 'designing', 'voted', 'funded', 'paused')
  ) x
  where x.unspent_usd + x.held_usd > 0;
  return jsonb_build_object(
    'controller', v_controller,
    'last_credit_purchase', v_purchase,
    'incident_reserve_usd', coalesce(v_incident, 0),
    's1_cards', v_cards,
    'rule_blocked', v_rule,
    'approval_void', v_void
  );
end;
$$;

-- o. record_usage -------------------------------------------------------------------
-- The money-fixes version, same nine arguments, refusing a studio row that
-- names no card: studio money is spent only on a card.

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
  if p_billed_to = 'studio'::public.ledger_billing and p_card_id is null then
    raise exception 'A studio row names a card';
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

-- p. Function privileges -----------------------------------------------------------

revoke all on function public.cards_agent_text_guard() from public, anon, authenticated;

revoke all on function public.card_is_public(uuid) from public;
grant execute on function public.card_is_public(uuid) to anon, authenticated, service_role;

revoke all on function public.card_content_hash_of(public.cards) from public, anon, authenticated;
grant execute on function public.card_content_hash_of(public.cards) to service_role;
revoke all on function public.card_content_hash(uuid) from public, anon, authenticated;
grant execute on function public.card_content_hash(uuid) to service_role;
revoke all on function public.card_needs_approval(public.card_source, uuid) from public, anon, authenticated;
grant execute on function public.card_needs_approval(public.card_source, uuid) to service_role;
revoke all on function public.card_approved(uuid) from public, anon, authenticated;
grant execute on function public.card_approved(uuid) to service_role;
revoke all on function public.card_money_held(uuid) from public, anon, authenticated;
grant execute on function public.card_money_held(uuid) to service_role;
revoke all on function public.card_ready_problem(public.cards) from public, anon, authenticated;
grant execute on function public.card_ready_problem(public.cards) to service_role;
revoke all on function public.card_ceiling_resumed(uuid) from public, anon, authenticated;
grant execute on function public.card_ceiling_resumed(uuid) to service_role;

revoke all on function public.record_card_approval(uuid, text, jsonb, uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_card_approval(uuid, text, jsonb, uuid, uuid, text, text, text, uuid) to service_role;
revoke all on function public.deal_due_cards() from public, anon, authenticated;
grant execute on function public.deal_due_cards() to service_role;
revoke all on function public.resume_card_by_rule(uuid) from public, anon, authenticated;
grant execute on function public.resume_card_by_rule(uuid) to service_role;
revoke all on function public.resume_due_by_rule() from public, anon, authenticated;
grant execute on function public.resume_due_by_rule() to service_role;
revoke all on function public.enqueue_job_run(text, text, text, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.enqueue_job_run(text, text, text, uuid, jsonb, uuid) to service_role;
revoke all on function public.claim_job_run(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_job_run(uuid, text) to service_role;
revoke all on function public.finish_job_run(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.finish_job_run(uuid, text, text, jsonb) to service_role;
revoke all on function public.fail_running_job_runs(text, text) from public, anon, authenticated;
grant execute on function public.fail_running_job_runs(text, text) to service_role;

revoke all on function public.set_card_horizon(uuid, public.card_horizon, integer, text, numeric, text, uuid, public.card_lane, text) from public, anon;
grant execute on function public.set_card_horizon(uuid, public.card_horizon, integer, text, numeric, text, uuid, public.card_lane, text) to authenticated, service_role;
revoke all on function public.set_cooling_window(integer, text) from public, anon;
grant execute on function public.set_cooling_window(integer, text) to authenticated, service_role;
revoke all on function public.set_role_pause(uuid, boolean, text) from public, anon;
grant execute on function public.set_role_pause(uuid, boolean, text) to authenticated, service_role;
revoke all on function public.set_card_veto(uuid, boolean, text) from public, anon;
grant execute on function public.set_card_veto(uuid, boolean, text) to authenticated, service_role;
revoke all on function public.enqueue_manual_job(text, uuid, text, jsonb) from public, anon;
grant execute on function public.enqueue_manual_job(text, uuid, text, jsonb) to authenticated, service_role;
revoke all on function public.board_jobs() from public, anon;
grant execute on function public.board_jobs() to authenticated, service_role;
revoke all on function public.board_roles() from public, anon;
grant execute on function public.board_roles() to authenticated, service_role;
revoke all on function public.board_studio_state() from public, anon;
grant execute on function public.board_studio_state() to authenticated, service_role;
revoke all on function public.board_needs_you() from public, anon;
grant execute on function public.board_needs_you() to authenticated, service_role;

revoke all on function public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing, text) from public, anon, authenticated;
grant execute on function public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing, text) to service_role;

notify pgrst, 'reload schema';
