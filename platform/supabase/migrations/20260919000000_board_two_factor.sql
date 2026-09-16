-- Board two-factor (docs/specs/launch-pages.md).
-- Applies on top of 20260918000000_founder_billing.sql and can run twice.
-- The board RPCs that change state refuse a session that has not passed a
-- second factor. Supabase Auth writes the assurance level into the JWT's aal
-- claim: aal1 after the magic link, aal2 after a verified TOTP code. The
-- moderator's pause, the heartbeat, board_role and board_studio_state stay at
-- aal1, so attended dispatcher runs keep a board session before the second
-- factor. Every function below keeps its signature, body and grants; the only
-- change is the refusal placed right after the membership check.

-- board_aal2 ----------------------------------------------------------------

create or replace function public.board_aal2() returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return coalesce(auth.jwt()->>'aal', '') = 'aal2';
end;
$$;

-- set_paused ----------------------------------------------------------------
-- A moderator may pause and resume at aal1; a board member needs aal2.

create or replace function public.set_paused(p_paused boolean) returns void
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
  update public.studio_state
  set paused = p_paused,
      paused_by = case when p_paused then auth.email() else null end,
      paused_at = case when p_paused then now() else null end
  where id = 1;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;
end;
$$;

-- file_directive ------------------------------------------------------------

create or replace function public.file_directive(
  p_bucket public.card_bucket,
  p_lane public.card_lane,
  p_folder public.card_folder,
  p_title text,
  p_intent text,
  p_acceptance_test text,
  p_estimate_usd numeric,
  p_board_reason text,
  p_executor_role_id uuid
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
  if p_estimate_usd is null or p_estimate_usd < 0 then
    raise exception 'The estimate must be zero or more';
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
    title, intent, acceptance_test, estimate_usd, confidence, proposer_role_id, stage
  ) values (
    p_bucket, 'board', 'oneoff', p_lane, 0, p_board_reason, p_folder, p_executor_role_id,
    btrim(p_title), p_intent, p_acceptance_test, round(p_estimate_usd, 4), 'low', null, 'funded'
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- file_note -----------------------------------------------------------------

create or replace function public.file_note(p_text text) returns uuid
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
  if p_text is null or btrim(p_text) = '' then
    raise exception 'Note text is required';
  end if;
  insert into public.board_notes (author_email, text, state)
  values (auth.email(), p_text, 'new')
  returning id into v_id;
  return v_id;
end;
$$;

-- file_card -----------------------------------------------------------------
-- The eleven-argument version from 20260916000000_card_summary.sql.

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
    title, summary, intent, acceptance_test, funding_target_usd, funded_usd, estimate_usd,
    confidence, proposer_role_id, stage
  ) values (
    p_bucket, 'board', 'goal', p_lane, 100, nullif(btrim(p_board_reason), ''), p_folder, p_executor_role_id,
    btrim(p_title), btrim(p_summary), p_intent, p_acceptance_test, round(p_funding_target_usd, 4), 0, round(p_funding_target_usd, 4),
    'low', null, p_stage
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- set_launched --------------------------------------------------------------

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
  if not public.board_aal2() then
    raise exception 'A second factor is required';
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

-- set_agent_mode ------------------------------------------------------------

create or replace function public.set_agent_mode(p_mode text) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Board membership is required';
  end if;
  if not public.board_aal2() then
    raise exception 'A second factor is required';
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

-- Function privileges -------------------------------------------------------
-- The same grants the earlier migrations gave each function, repeated so this
-- file states them; board_aal2 is granted like is_board_member.

revoke all on function public.board_aal2() from public, anon;
revoke all on function public.set_paused(boolean) from public, anon;
revoke all on function public.file_directive(public.card_bucket, public.card_lane, public.card_folder, text, text, text, numeric, text, uuid) from public, anon;
revoke all on function public.file_note(text) from public, anon;
revoke all on function public.file_card(public.card_bucket, public.card_lane, public.card_folder, text, text, text, text, numeric, public.card_stage, uuid, text) from public, anon;
revoke all on function public.set_launched() from public, anon;
revoke all on function public.set_agent_mode(text) from public, anon;
grant execute on function public.board_aal2() to authenticated, service_role;
grant execute on function public.set_paused(boolean) to authenticated, service_role;
grant execute on function public.file_directive(public.card_bucket, public.card_lane, public.card_folder, text, text, text, numeric, text, uuid) to authenticated, service_role;
grant execute on function public.file_note(text) to authenticated, service_role;
grant execute on function public.file_card(public.card_bucket, public.card_lane, public.card_folder, text, text, text, text, numeric, public.card_stage, uuid, text) to authenticated, service_role;
grant execute on function public.set_launched() to authenticated, service_role;
grant execute on function public.set_agent_mode(text) to authenticated, service_role;
