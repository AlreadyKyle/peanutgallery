-- Agent workflows: the Game Designer's drafts, graded by the Game Director,
-- and the Studio Head's ranking (docs/specs/agent-workflows.md). Applies after
-- 20260924300000_agent_system_core.sql and can run twice.
--
-- A draft lives in card_drafts, which no API role but the service role reads,
-- until the dispatcher approves it from the Game Director's verdict. Approval
-- inserts one seed-1 card (source agent, horizon next, stage proposed, target
-- equal to the estimate, opens_at after the cooling window) whose content hash
-- equals the draft's, and records the approval with the grader's session as
-- its ref; the tick deals the card to now later. A withdrawn draft writes no
-- card. Agent-written card text changes only while a board RPC or the draft
-- path has set peanutgallery.card_writer.
--
-- apply_card_ranking writes rank only, on cards on now that are open for
-- funding and hold no money, at most ten changes a run, with one event that
-- names the moved cards and their positions. Both jobs are queued by the
-- board at /board and run while the studio is paused, since they spend no
-- studio money.

set lock_timeout = '5s';

-- a. card_drafts ------------------------------------------------------------------
-- One row per Designer round. fields is the card as approval would insert it,
-- apart from the columns approval sets itself: one estimate_usd, which is also
-- the funding target, and the executor the dispatcher resolved (null when the
-- draft named none it could resolve; the checks then refuse it).

create table if not exists public.card_drafts (
  id uuid primary key default gen_random_uuid(),
  job_run_id uuid references public.job_runs (id),
  role_id uuid not null references public.roles (id),
  fields jsonb not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'drafted' check (status in ('drafted', 'approved', 'withdrawn')),
  reason_codes text[] not null default '{}',
  maker_ref text not null check (btrim(maker_ref) <> ''),
  grader_ref text,
  card_id uuid references public.cards (id),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint card_drafts_card_check check ((status = 'approved') = (card_id is not null))
);
create index if not exists card_drafts_run_idx on public.card_drafts (job_run_id, created_at);

alter table public.card_drafts enable row level security;
revoke all on public.card_drafts from anon, authenticated;
grant all on public.card_drafts to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'peanutgallery_backup') then
    grant select on public.card_drafts to peanutgallery_backup;
  end if;
end
$$;

-- b. The card text guard ----------------------------------------------------------
-- agent-system-core's guard, with the draft path beside the board's: on a card
-- that needs an approval a hashed field changes only while a board RPC or the
-- draft path has set peanutgallery.card_writer for its own update.

create or replace function public.cards_agent_text_guard() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_needs boolean := public.card_needs_approval(old.source, old.drafter_role_id);
  v_new_needs boolean := public.card_needs_approval(new.source, new.drafter_role_id);
begin
  if coalesce(current_setting('peanutgallery.card_writer', true), '') in ('board', 'draft') then
    return new;
  end if;
  if (v_old_needs or v_new_needs)
    and public.card_content_hash_of(old) is distinct from public.card_content_hash_of(new) then
    raise exception 'An agent-written card''s content changes only through a board RPC or the draft path';
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

-- c. The card a draft would become --------------------------------------------------
-- The one place the draft's fields become a card row: record_card_draft hashes
-- it and approve_card_draft inserts it, so the two cannot differ.

create or replace function public.card_from_draft(p_fields jsonb, p_role uuid) returns public.cards
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
  v_estimate numeric(12,4);
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'The draft fields must be a JSON object';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_fields) k
    where k not in ('title', 'summary', 'intent', 'acceptance_test', 'lane', 'executor_role_id', 'estimate_usd')
  ) then
    raise exception 'The draft fields hold a key that is not a card field';
  end if;
  if jsonb_typeof(p_fields -> 'title') is distinct from 'string' or btrim(p_fields ->> 'title') = '' or char_length(btrim(p_fields ->> 'title')) > 120 then
    raise exception 'A draft needs a title of at most 120 characters';
  end if;
  if jsonb_typeof(p_fields -> 'summary') is distinct from 'string' or btrim(p_fields ->> 'summary') = '' or char_length(btrim(p_fields ->> 'summary')) > 200 then
    raise exception 'A draft needs a public summary of at most 200 characters';
  end if;
  if jsonb_typeof(p_fields -> 'intent') is distinct from 'string' or btrim(p_fields ->> 'intent') = '' then
    raise exception 'A draft needs an intent';
  end if;
  if jsonb_typeof(p_fields -> 'acceptance_test') is distinct from 'string' or btrim(p_fields ->> 'acceptance_test') = '' then
    raise exception 'A draft needs an acceptance test';
  end if;
  if coalesce(p_fields ->> 'lane', '') not in ('config', 'code') then
    raise exception 'A draft''s lane is config or code';
  end if;
  if jsonb_typeof(p_fields -> 'executor_role_id') not in ('string', 'null') then
    raise exception 'A draft''s executor is a role id or null';
  end if;
  if p_fields ->> 'executor_role_id' is not null
    and not exists (select 1 from public.roles r where r.id::text = p_fields ->> 'executor_role_id') then
    raise exception 'The draft''s executor is not a role';
  end if;
  if jsonb_typeof(p_fields -> 'estimate_usd') is distinct from 'number' then
    raise exception 'A draft carries one estimate_usd, a number';
  end if;
  v_estimate := round((p_fields ->> 'estimate_usd')::numeric, 4);
  if v_estimate <= 0 or v_estimate > 10000 then
    raise exception 'The estimate must be above zero and at most $10,000';
  end if;

  v_card.id := null;
  v_card.bucket := 'game';
  v_card.source := 'agent';
  v_card.shape := 'goal';
  v_card.lane := (p_fields ->> 'lane')::public.card_lane;
  v_card.priority := 100;
  v_card.folder := 'seed-1';
  v_card.executor_role_id := (p_fields ->> 'executor_role_id')::uuid;
  v_card.title := btrim(p_fields ->> 'title');
  v_card.summary := btrim(p_fields ->> 'summary');
  v_card.intent := p_fields ->> 'intent';
  v_card.acceptance_test := p_fields ->> 'acceptance_test';
  v_card.design_spec_url := null;
  v_card.funding_target_usd := v_estimate;
  v_card.estimate_usd := v_estimate;
  v_card.funded_usd := 0;
  v_card.confidence := 'low';
  v_card.proposer_role_id := p_role;
  v_card.drafter_role_id := p_role;
  v_card.check_author_role_id := p_role;
  v_card.stage := 'proposed';
  v_card.horizon := 'next';
  v_card.director_stance := 'neutral';
  v_card.board_vetoed := false;
  return v_card;
end;
$$;

-- d. record_card_draft --------------------------------------------------------------

create or replace function public.record_card_draft(p_run uuid, p_role uuid, p_fields jsonb, p_maker_ref text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
  v_card public.cards%rowtype;
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
  if p_run is not null and not exists (select 1 from public.job_runs where id = p_run) then
    raise exception 'Job run % does not exist', p_run;
  end if;
  v_card := public.card_from_draft(p_fields, p_role);
  v_hash := public.card_content_hash_of(v_card);
  insert into public.card_drafts (job_run_id, role_id, fields, content_sha256, maker_ref)
  values (p_run, p_role, p_fields, v_hash, btrim(p_maker_ref))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'content_sha256', v_hash);
end;
$$;

-- e. approve_card_draft ---------------------------------------------------------------
-- From the Game Director's approved verdict: one card on next at proposed,
-- dealt by the tick once opens_at passes, and its draft approval.

create or replace function public.approve_card_draft(p_draft uuid, p_approver_role uuid, p_grader_ref text, p_verdict jsonb default '{}'::jsonb) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.card_drafts%rowtype;
  v_card public.cards%rowtype;
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
  if p_verdict is not null and jsonb_typeof(p_verdict) <> 'object' then
    raise exception 'The verdict must be a JSON object';
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

  v_card := public.card_from_draft(v_draft.fields, v_draft.role_id);
  v_problem := public.card_ready_problem(v_card);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;
  select cooling_window_minutes into v_window from public.studio_state where id = 1;

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

  if public.card_content_hash(v_id) is distinct from v_draft.content_sha256 then
    raise exception 'The card''s content hash is not the graded draft''s';
  end if;
  perform public.record_card_approval(
    v_id, 'draft', coalesce(p_verdict, '{}'::jsonb) || jsonb_build_object('verdict', 'approved', 'draft_id', p_draft),
    p_approver_role, v_draft.role_id, v_draft.maker_ref, btrim(p_grader_ref), v_draft.content_sha256, v_draft.job_run_id
  );
  update public.card_drafts
  set status = 'approved', grader_ref = btrim(p_grader_ref), card_id = v_id, finished_at = now()
  where id = p_draft;
  return v_id;
end;
$$;

-- f. withdraw_card_draft ------------------------------------------------------------------

create or replace function public.withdraw_card_draft(p_draft uuid, p_reason_codes text[]) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if p_reason_codes is null or cardinality(p_reason_codes) = 0 then
    raise exception 'A withdrawal names at least one reason code';
  end if;
  select status into v_status from public.card_drafts where id = p_draft for update;
  if not found then
    raise exception 'Draft % does not exist', p_draft;
  end if;
  if v_status <> 'drafted' then
    raise exception 'Draft % is already %', p_draft, v_status;
  end if;
  update public.card_drafts
  set status = 'withdrawn', reason_codes = p_reason_codes, finished_at = now()
  where id = p_draft;
end;
$$;

-- g. apply_card_ranking ----------------------------------------------------------------------
-- The Studio Head's order, from a running studio_ranking run. Every id must be
-- a card on now at proposed, designing or voted with no money on its bar or on
-- hold; any other refuses the whole ranking. The card at position n (from 1)
-- gets rank n; the first ten whose rank changes are written, in the order
-- given, and one event names them with their old and new positions.

create or replace function public.apply_card_ranking(p_run uuid, p_order uuid[]) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.job_runs%rowtype;
  v_role uuid;
  v_card public.cards%rowtype;
  v_position integer := 0;
  v_id uuid;
  v_moves jsonb := '[]'::jsonb;
  v_unapplied integer := 0;
begin
  select * into v_run from public.job_runs where id = p_run;
  if not found then
    raise exception 'Job run % does not exist', p_run;
  end if;
  if v_run.job_name <> 'studio_ranking' or v_run.status <> 'running' then
    raise exception 'A ranking comes only from a running studio_ranking run';
  end if;
  if p_order is null then
    raise exception 'An order is required';
  end if;
  if (select count(*) from unnest(p_order)) <> (select count(distinct x) from unnest(p_order) x) then
    raise exception 'The order names a card twice';
  end if;
  if exists (select 1 from unnest(p_order) x where x is null) then
    raise exception 'The order names no card';
  end if;
  perform money.money_lock();
  select role_id into v_role from public.jobs where name = 'studio_ranking';

  -- Every card is checked before any is written.
  foreach v_id in array p_order loop
    select * into v_card from public.cards where id = v_id for update;
    if not found then
      raise exception 'Card % does not exist', v_id;
    end if;
    if v_card.horizon <> 'now' then
      raise exception 'Card % is not on now', v_id;
    end if;
    if v_card.stage not in ('proposed', 'designing', 'voted') then
      raise exception 'Card % is not open for funding', v_id;
    end if;
    if public.card_money_held(v_id) then
      raise exception 'Card % holds money', v_id;
    end if;
  end loop;

  foreach v_id in array p_order loop
    v_position := v_position + 1;
    select * into v_card from public.cards where id = v_id;
    continue when v_card.rank is not distinct from v_position;
    if jsonb_array_length(v_moves) >= 10 then
      v_unapplied := v_unapplied + 1;
      continue;
    end if;
    update public.cards set rank = v_position where id = v_id;
    v_moves := v_moves || jsonb_build_object('card_id', v_id, 'from', v_card.rank, 'to', v_position);
  end loop;

  insert into public.agent_events (card_id, role_id, type, payload_json)
  values (null, v_role, 'message', jsonb_build_object('step', 'ranked', 'moves', v_moves));
  return jsonb_build_object('moves', v_moves, 'unapplied', v_unapplied);
end;
$$;

-- h. The two jobs ---------------------------------------------------------------------------------
-- Manual only: the board's Rank now and Draft a game card. Both call a model,
-- on the founder's plan while a board member is signed in, and both run while
-- the studio is paused, so the launch floor can be drafted before launch.

insert into public.jobs (name, role_id, calls_model, runs_when_paused, description)
values
  ('studio_ranking', (select id from public.roles where name = 'Studio Head'), true, true,
    'Rank now: the Studio Head orders the open cards on now that hold no money; at most ten changes a run.'),
  ('draft_card', (select id from public.roles where name = 'Game Designer'), true, true,
    'Draft a game card: the Game Designer drafts a new seed-1 card, the checks run, and the Game Director grades it; up to three rounds.')
on conflict (name) do update
set role_id = coalesce(excluded.role_id, public.jobs.role_id),
    calls_model = excluded.calls_model,
    runs_when_paused = excluded.runs_when_paused,
    description = excluded.description;

-- i. Function privileges ------------------------------------------------------------------------------

revoke all on function public.cards_agent_text_guard() from public, anon, authenticated;
revoke all on function public.card_from_draft(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.card_from_draft(jsonb, uuid) to service_role;
revoke all on function public.record_card_draft(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_card_draft(uuid, uuid, jsonb, text) to service_role;
revoke all on function public.approve_card_draft(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.approve_card_draft(uuid, uuid, text, jsonb) to service_role;
revoke all on function public.withdraw_card_draft(uuid, text[]) from public, anon, authenticated;
grant execute on function public.withdraw_card_draft(uuid, text[]) to service_role;
revoke all on function public.apply_card_ranking(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.apply_card_ranking(uuid, uuid[]) to service_role;

notify pgrst, 'reload schema';
