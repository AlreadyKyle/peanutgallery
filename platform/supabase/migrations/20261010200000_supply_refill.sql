-- supply-refill (docs/specs/unattended-roles.md, PR4; docs/PLAN.md §10 decision
-- 66): the card supply refills itself, and ranking is a rule. Applies after
-- 20261006000000_launch_stamp.sql and can run twice. It reads nothing the
-- auto-resume migrations add, so it applies before or after them.
--
-- A draft is billed to the card it drafts, so the card is opened first:
-- open_draft_card(run) names it on the run before any session starts. It is
-- the run's own card when the run names one, an unfinished new card an earlier
-- run opened (so a run that died leaves no second one), the next seed-1 backlog
-- card (next_backlog_card()), or with none a new private seed-1 card: source
-- agent, stage proposed on next, the Game Designer as proposer, drafter and
-- check author, no executor, target or approval, so no reader and no money
-- reaches it. The draft path fills that card: record_card_draft_for keeps each
-- round's draft against it (a backlog card keeps the board's title and
-- summary), and approve_card_draft, given a draft with a target, writes the
-- draft's intent, check lines, executor, lane and estimate (also the funding
-- target) onto it under the draft path's card writer, sets the drafter and
-- opens_at, and records the draft approval, so deal_due_cards deals it after
-- the cooling window. A withdrawn draft leaves a backlog card as it was;
-- reject_draft_card rejects a new card with failing_check draft_withdrawn, its
-- spend kept on the ledger. A backlog card whose draft was withdrawn is passed
-- over until the card changes, so a run never spends twice on the same refusal.
--
-- enqueue_supply_draft() queues one draft_card run with origin schedule while
-- card_supply() is short of the floor once the approved agent cards waiting to
-- be dealt are counted: never while the studio is paused, the job is retired,
-- its role or the Game Director is paused, a draft_card run is queued or
-- running, or studio_state.draft_runs_per_day runs (4) have been queued since
-- New York midnight. pg_cron calls it every 20 minutes. draft_card no longer
-- runs while the studio is paused, since it spends studio money.
--
-- jobs gains enabled. A disabled job takes no run (job_runs_job_enabled, a
-- trigger on every insert, so neither the board's Run now nor pg_cron queues
-- one), and the dispatcher skips any run of one already queued. studio_ranking
-- is retired that way: the line is the backlog's rank, then age
-- (money.funding_order), and no model ranks.
--
-- Re-runnable: columns are added if missing, functions replaced, the trigger
-- dropped and created, the job rows updated by name, and cron.schedule with a
-- job name replaces the existing job.

set lock_timeout = '5s';

-- a. Jobs: enabled, studio_ranking retired, draft_card stops with the studio -----

alter table public.jobs add column if not exists enabled boolean not null default true;

-- A trigger function, never an RPC: it returns trigger, so PostgREST cannot call it.
create or replace function public.job_runs_job_enabled() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce((select j.enabled from public.jobs j where j.name = new.job_name), true) then
    raise exception 'Job % is retired and takes no run', new.job_name;
  end if;
  return new;
end;
$$;

drop trigger if exists job_runs_job_enabled on public.job_runs;
create trigger job_runs_job_enabled before insert on public.job_runs
  for each row execute function public.job_runs_job_enabled();

update public.jobs
set enabled = false,
    description = 'Retired (PLAN.md §10 decision 66): the line is the backlog''s rank, then age, and no model ranks.'
where name = 'studio_ranking';

update public.jobs
set runs_when_paused = false,
    description = 'The card supply refills itself: while the supply is short, the Game Designer fills the next seed-1 backlog card or a new one, the checks run, and the Game Director grades it; up to three rounds, billed to that card.'
where name = 'draft_card';

-- b. The daily limit on draft runs ------------------------------------------------

alter table public.studio_state add column if not exists draft_runs_per_day integer not null default 4;
alter table public.studio_state drop constraint if exists studio_state_draft_runs_per_day_check;
alter table public.studio_state add constraint studio_state_draft_runs_per_day_check check (draft_runs_per_day between 0 and 48);

-- c. A draft's target card ----------------------------------------------------------

alter table public.card_drafts add column if not exists target_card_id uuid references public.cards (id);
create index if not exists card_drafts_target_idx on public.card_drafts (target_card_id) where target_card_id is not null;

-- d. Which cards a draft may fill -----------------------------------------------------
-- backlog: a board goal card filed for seed-1, at proposed on next or later,
-- not board work, never drafted, not waiting to be dealt and vetoed by no one,
-- with a title and a summary a draft can carry unchanged.
-- new: a card a draft run opened, still private: source agent, the drafter
-- p_designer, at proposed on next or later, not waiting to be dealt, with no
-- approval, vetoed by no one. Null for any other card.

create or replace function public.draft_target_kind(c public.cards, p_designer uuid) returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when c.id is null or c.folder <> 'seed-1' or c.shape <> 'goal' or c.stage <> 'proposed'
      or c.horizon not in ('next', 'later') or c.opens_at is not null
      or c.board_vetoed or c.director_stance = 'vetoed' then null
    -- A backlog card keeps the board's title and summary, so they must be ones a draft can carry.
    when c.source = 'board' and not c.board_work and c.drafter_role_id is null
      and btrim(coalesce(c.summary, '')) <> '' and btrim(c.title) <> '' and char_length(btrim(c.title)) <= 120 then 'backlog'
    when c.source = 'agent' and p_designer is not null and c.drafter_role_id = p_designer
      and not exists (select 1 from public.card_approvals a where a.card_id = c.id) then 'new'
  end
$$;

-- e. next_backlog_card ------------------------------------------------------------------
-- The next seed-1 backlog card a draft may fill: next before later, then by
-- rank, then by age. A card whose draft was withdrawn is passed over until it
-- changes (updated_at moves on any update, the board's or file-backlog's).

create or replace function public.next_backlog_card() returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.cards c
  where public.draft_target_kind(c, null) = 'backlog'
    and not exists (
      select 1 from public.job_runs r
      where r.job_name = 'draft_card'
        and r.card_id = c.id
        and r.status = 'succeeded'
        and r.output ->> 'result' = 'withdrawn'
        and r.finished_at >= c.updated_at
    )
  order by case c.horizon when 'next' then 0 else 1 end, c.rank asc nulls last, c.created_at, c.id
  limit 1
$$;

-- f. open_draft_card ---------------------------------------------------------------------
-- The card a running draft_card run is billed to, named on the run before any
-- session starts. kind is backlog or new; opened says how it was found; card
-- carries the fields the Designer's prompt shows and the session budget reads.

create or replace function public.draft_card_answer(p_card uuid, p_kind text, p_opened text) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'card_id', c.id,
    'kind', p_kind,
    'opened', p_opened,
    'card', jsonb_build_object(
      'title', c.title, 'summary', c.summary, 'intent', c.intent, 'horizon', c.horizon, 'rank', c.rank,
      'funded_usd', c.funded_usd, 'severity', c.severity
    )
  )
  from public.cards c
  where c.id = p_card
$$;

create or replace function public.open_draft_card(p_run uuid) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.job_runs%rowtype;
  v_designer uuid;
  v_card public.cards%rowtype;
  v_id uuid;
  v_opened text;
  v_kind text;
begin
  perform pg_advisory_xact_lock(hashtext('public.open_draft_card'));
  select * into v_run from public.job_runs where id = p_run for update;
  if not found then
    raise exception 'Job run % does not exist', p_run;
  end if;
  if v_run.job_name <> 'draft_card' then
    raise exception 'Job run % is not a draft_card run', p_run;
  end if;
  if v_run.status <> 'running' then
    raise exception 'Job run % is not running', p_run;
  end if;
  select j.role_id into v_designer from public.jobs j where j.name = 'draft_card';
  if v_designer is null then
    raise exception 'draft_card has no role';
  end if;

  if v_run.card_id is not null then
    select * into v_card from public.cards where id = v_run.card_id;
    v_kind := public.draft_target_kind(v_card, v_designer);
    if v_kind is null then
      raise exception 'Card % is not a card a draft may fill', v_run.card_id;
    end if;
    return public.draft_card_answer(v_run.card_id, v_kind, 'named');
  end if;

  select c.id into v_id
  from public.cards c
  where public.draft_target_kind(c, v_designer) = 'new'
  order by c.created_at, c.id
  limit 1;
  if v_id is not null then
    v_opened := 'reused';
    v_kind := 'new';
  else
    v_id := public.next_backlog_card();
    if v_id is not null then
      v_opened := 'backlog';
      v_kind := 'backlog';
    end if;
  end if;
  if v_id is null then
    insert into public.cards (
      bucket, source, shape, lane, priority, folder, title,
      funding_target_usd, funded_usd, estimate_usd, confidence,
      proposer_role_id, drafter_role_id, check_author_role_id, stage, horizon, director_stance
    ) values (
      'game', 'agent', 'goal', 'config', 100, 'seed-1', 'A game card the Game Designer is drafting',
      0, 0, 0, 'low',
      v_designer, v_designer, v_designer, 'proposed', 'next', 'neutral'
    )
    returning id into v_id;
    v_opened := 'new';
    v_kind := 'new';
  end if;
  update public.job_runs set card_id = v_id where id = p_run;
  return public.draft_card_answer(v_id, v_kind, v_opened);
end;
$$;

-- g. The card a draft would make of its target ------------------------------------------
-- card_from_draft's checks on the fields, written onto the target: its title,
-- summary, intent, acceptance test, lane, executor, one estimate that is also
-- the funding target, and the drafter as drafter and check author. Bucket,
-- folder, shape, design spec URL and proposer stay the card's.

create or replace function public.card_from_draft_onto(p_card public.cards, p_fields jsonb, p_role uuid) returns public.cards
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_draft public.cards%rowtype := public.card_from_draft(p_fields, p_role);
  v_card public.cards%rowtype := p_card;
begin
  v_card.lane := v_draft.lane;
  v_card.executor_role_id := v_draft.executor_role_id;
  v_card.title := v_draft.title;
  v_card.summary := v_draft.summary;
  v_card.intent := v_draft.intent;
  v_card.acceptance_test := v_draft.acceptance_test;
  v_card.funding_target_usd := v_draft.funding_target_usd;
  v_card.estimate_usd := v_draft.estimate_usd;
  v_card.drafter_role_id := p_role;
  v_card.check_author_role_id := p_role;
  return v_card;
end;
$$;

-- h. record_card_draft_for -----------------------------------------------------------------
-- record_card_draft for a target card: the run must name the card, the card
-- must be one a draft may fill, and a backlog card keeps the board's title and
-- summary. The hash is the target's content with the draft written onto it.

create or replace function public.record_card_draft_for(p_card uuid, p_run uuid, p_role uuid, p_fields jsonb, p_maker_ref text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
  v_target public.cards%rowtype;
  v_card public.cards%rowtype;
  v_kind text;
  v_hash text;
  v_id uuid;
begin
  if p_role is null then
    raise exception 'A drafter role is required';
  end if;
  select * into v_role from public.roles where id = p_role;
  if not found then
    raise exception 'Role % does not exist', p_role;
  end if;
  if coalesce(v_role.agent_class, '') <> 'planner' then
    raise exception 'Only a planner drafts a card';
  end if;
  if p_maker_ref is null or btrim(p_maker_ref) = '' then
    raise exception 'A maker ref is required';
  end if;
  if p_run is not null and not exists (select 1 from public.job_runs where id = p_run and card_id = p_card) then
    raise exception 'Job run % does not name card %', p_run, p_card;
  end if;
  select * into v_target from public.cards where id = p_card;
  if not found then
    raise exception 'Card % does not exist', p_card;
  end if;
  v_kind := public.draft_target_kind(v_target, p_role);
  if v_kind is null then
    raise exception 'Card % is not a card a draft may fill', p_card;
  end if;
  v_card := public.card_from_draft_onto(v_target, p_fields, p_role);
  if v_kind = 'backlog' and (v_card.title is distinct from v_target.title or v_card.summary is distinct from v_target.summary) then
    raise exception 'A backlog card keeps the board''s title and summary';
  end if;
  v_hash := public.card_content_hash_of(v_card);
  insert into public.card_drafts (job_run_id, role_id, fields, content_sha256, maker_ref, target_card_id)
  values (p_run, p_role, p_fields, v_hash, btrim(p_maker_ref), p_card)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'content_sha256', v_hash);
end;
$$;

-- i. approve_card_draft -----------------------------------------------------------------------
-- agent-workflows' approval, with a target: a draft recorded against a card is
-- written onto that card, which must still be one a draft may fill (a backlog
-- card still with the board's title and summary), instead of inserting one. A
-- draft with no target inserts a card on next as before.

create or replace function public.approve_card_draft(p_draft uuid, p_approver_role uuid, p_grader_ref text, p_verdict jsonb) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.card_drafts%rowtype;
  v_target public.cards%rowtype;
  v_card public.cards%rowtype;
  v_kind text;
  v_window integer;
  v_problem text;
  v_id uuid;
begin
  if p_draft is null then
    raise exception 'A draft is required';
  end if;
  if p_grader_ref is null or btrim(p_grader_ref) = '' then
    raise exception 'A grader ref is required';
  end if;
  if p_verdict is null or jsonb_typeof(p_verdict) <> 'object' then
    raise exception 'The verdict must be a JSON object';
  end if;
  -- The grader's own result, never one this function supplies: only an approved verdict approves.
  if coalesce(p_verdict ->> 'result', '') <> 'approved' then
    raise exception 'Only an approved verdict approves a draft';
  end if;
  select * into v_draft from public.card_drafts where id = p_draft for update;
  if not found then
    raise exception 'Draft % does not exist', p_draft;
  end if;
  if v_draft.status <> 'drafted' then
    raise exception 'Draft % is already %', p_draft, v_draft.status;
  end if;
  if btrim(p_grader_ref) = btrim(v_draft.maker_ref) then
    raise exception 'The grader ref must differ from the maker ref';
  end if;
  select cooling_window_minutes into v_window from public.studio_state where id = 1;

  if v_draft.target_card_id is null then
    v_card := public.card_from_draft(v_draft.fields, v_draft.role_id);
    v_problem := public.card_ready_problem(v_card);
    if v_problem is not null then
      raise exception '%', v_problem;
    end if;
    perform set_config('peanutgallery.card_writer', 'draft', true);
    insert into public.cards (
      bucket, source, shape, lane, priority, folder, executor_role_id,
      title, summary, intent, acceptance_test, design_spec_url, funding_target_usd, funded_usd, estimate_usd,
      confidence, proposer_role_id, drafter_role_id, check_author_role_id, stage, horizon, director_stance, opens_at
    ) values (
      v_card.bucket, v_card.source, v_card.shape, v_card.lane, v_card.priority, v_card.folder, v_card.executor_role_id,
      v_card.title, v_card.summary, v_card.intent, v_card.acceptance_test, v_card.design_spec_url, v_card.funding_target_usd, 0, v_card.estimate_usd,
      v_card.confidence, v_card.proposer_role_id, v_card.drafter_role_id, v_card.check_author_role_id, 'proposed', 'next', 'neutral',
      now() + make_interval(mins => coalesce(v_window, 0))
    )
    returning id into v_id;
    perform set_config('peanutgallery.card_writer', '', true);
  else
    select * into v_target from public.cards where id = v_draft.target_card_id for update;
    v_kind := public.draft_target_kind(v_target, v_draft.role_id);
    if v_kind is null then
      raise exception 'Card % is no longer a card a draft may fill', v_draft.target_card_id;
    end if;
    v_card := public.card_from_draft_onto(v_target, v_draft.fields, v_draft.role_id);
    if v_kind = 'backlog' and (v_card.title is distinct from v_target.title or v_card.summary is distinct from v_target.summary) then
      raise exception 'A backlog card keeps the board''s title and summary';
    end if;
    v_problem := public.card_ready_problem(v_card);
    if v_problem is not null then
      raise exception '%', v_problem;
    end if;
    perform set_config('peanutgallery.card_writer', 'draft', true);
    update public.cards
    set lane = v_card.lane,
        executor_role_id = v_card.executor_role_id,
        title = v_card.title,
        summary = v_card.summary,
        intent = v_card.intent,
        acceptance_test = v_card.acceptance_test,
        funding_target_usd = v_card.funding_target_usd,
        estimate_usd = v_card.estimate_usd,
        drafter_role_id = v_card.drafter_role_id,
        check_author_role_id = v_card.check_author_role_id,
        opens_at = now() + make_interval(mins => coalesce(v_window, 0))
    where id = v_target.id;
    perform set_config('peanutgallery.card_writer', '', true);
    v_id := v_target.id;
  end if;

  if public.card_content_hash(v_id) is distinct from v_draft.content_sha256 then
    raise exception 'The card''s content hash is not the graded draft''s';
  end if;
  perform public.record_card_approval(
    v_id, 'draft', p_verdict || jsonb_build_object('verdict', p_verdict ->> 'result', 'draft_id', p_draft),
    p_approver_role, v_draft.role_id, v_draft.maker_ref, btrim(p_grader_ref), v_draft.content_sha256, v_draft.job_run_id
  );
  update public.card_drafts
  set status = 'approved', grader_ref = btrim(p_grader_ref), card_id = v_id, finished_at = now()
  where id = p_draft;
  return v_id;
end;
$$;

-- j. reject_draft_card ----------------------------------------------------------------------------
-- A withdrawn draft rejects the new card its run opened. A backlog card is
-- left as it was, so it is refused here. The card's spend stays on the ledger.

create or replace function public.reject_draft_card(p_card uuid, p_run uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
  v_designer uuid;
begin
  if not exists (select 1 from public.job_runs where id = p_run and job_name = 'draft_card' and card_id = p_card) then
    raise exception 'Job run % is not a draft_card run that names card %', p_run, p_card;
  end if;
  select j.role_id into v_designer from public.jobs j where j.name = 'draft_card';
  select * into v_card from public.cards where id = p_card for update;
  if not found then
    raise exception 'Card % does not exist', p_card;
  end if;
  if public.draft_target_kind(v_card, v_designer) is distinct from 'new' then
    raise exception 'Card % is not a new card a draft opened; a backlog card is left as it was', p_card;
  end if;
  update public.cards set stage = 'rejected', failing_check = 'draft_withdrawn' where id = p_card;
end;
$$;

-- k. enqueue_supply_draft ---------------------------------------------------------------------------
-- One scheduled draft_card run while the supply is short. The shortfalls are
-- card_supply()'s less the approved agent cards waiting to be dealt (each
-- counted as open, and as big or small by its target); a big shortfall counts
-- only while a draft can fill it (the big threshold within the card maximum).
-- The run's input is the floor the Designer's prompt spells out.

create or replace function public.enqueue_supply_draft() returns jsonb
language plpgsql
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
  v_run jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('public.enqueue_supply_draft'));
  select * into v_studio from public.studio_state where id = 1;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;
  if v_studio.paused then
    return jsonb_build_object('queued', false, 'reason', 'studio_paused');
  end if;
  select * into v_job from public.jobs where name = 'draft_card';
  if not found or not v_job.enabled then
    return jsonb_build_object('queued', false, 'reason', 'job_disabled');
  end if;
  if exists (select 1 from public.roles r where r.id = v_job.role_id and r.paused) then
    return jsonb_build_object('queued', false, 'reason', 'role_paused');
  end if;
  if exists (select 1 from public.roles r where r.name = 'Game Director' and r.paused) then
    return jsonb_build_object('queued', false, 'reason', 'grader_paused');
  end if;
  if exists (select 1 from public.job_runs r where r.job_name = 'draft_card' and r.status in ('queued', 'running')) then
    return jsonb_build_object('queued', false, 'reason', 'already_queued');
  end if;
  select count(*)::integer into v_runs
  from public.job_runs r
  where r.job_name = 'draft_card' and r.created_at >= v_since and r.status <> 'skipped';
  if v_runs >= v_studio.draft_runs_per_day then
    return jsonb_build_object('queued', false, 'reason', 'daily_limit', 'runs_today', v_runs);
  end if;

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
  v_floor := jsonb_build_object(
    'short_open', v_short_open,
    'short_big', v_short_big,
    'short_small', v_short_small,
    'big_min_usd', v_studio.card_big_min_usd,
    'small_max_usd', v_studio.card_small_max_usd
  );
  if v_short_open + v_short_big + v_short_small = 0 then
    return jsonb_build_object('queued', false, 'reason', 'not_short', 'floor', v_floor, 'waiting', v_waiting);
  end if;
  -- Its own key: the checks above keep it to one at a time, and a run that ended in the same
  -- minute (the default schedule key) must not stand in for the new one.
  v_run := public.enqueue_job_run('draft_card', 'schedule', 'draft_card:supply:' || gen_random_uuid(), null, jsonb_build_object('floor', v_floor), null);
  return jsonb_build_object('queued', coalesce((v_run ->> 'created')::boolean, false), 'run_id', v_run ->> 'id', 'reason', null, 'floor', v_floor, 'waiting', v_waiting);
end;
$$;

-- l. The schedule ---------------------------------------------------------------------------------------
-- Every 20 minutes. A database that does not ship pg_cron (PGlite in the tests)
-- skips it.

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; enqueue_supply_draft is not scheduled';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('supply-draft', '*/20 * * * *', $c$select public.enqueue_supply_draft()$c$);
end $$;

-- m. Function privileges ---------------------------------------------------------------------------------

revoke all on function public.job_runs_job_enabled() from public, anon, authenticated;
revoke all on function public.draft_target_kind(public.cards, uuid) from public, anon, authenticated;
grant execute on function public.draft_target_kind(public.cards, uuid) to service_role;
revoke all on function public.next_backlog_card() from public, anon, authenticated;
grant execute on function public.next_backlog_card() to service_role;
revoke all on function public.draft_card_answer(uuid, text, text) from public, anon, authenticated;
grant execute on function public.draft_card_answer(uuid, text, text) to service_role;
revoke all on function public.open_draft_card(uuid) from public, anon, authenticated;
grant execute on function public.open_draft_card(uuid) to service_role;
revoke all on function public.card_from_draft_onto(public.cards, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.card_from_draft_onto(public.cards, jsonb, uuid) to service_role;
revoke all on function public.record_card_draft_for(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_card_draft_for(uuid, uuid, uuid, jsonb, text) to service_role;
revoke all on function public.approve_card_draft(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.approve_card_draft(uuid, uuid, text, jsonb) to service_role;
revoke all on function public.reject_draft_card(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reject_draft_card(uuid, uuid) to service_role;
revoke all on function public.enqueue_supply_draft() from public, anon, authenticated;
grant execute on function public.enqueue_supply_draft() to service_role;

notify pgrst, 'reload schema';
