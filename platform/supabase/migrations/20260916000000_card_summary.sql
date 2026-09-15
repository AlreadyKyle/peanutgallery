-- Card summaries (docs/specs/card-summary.md).
-- Applies on top of 20260915000000_live_cut.sql and can run twice.
-- A card gains a public summary of at most 200 characters, and file_card
-- requires one. Anon already reads cards at table level (week-1 grants), and
-- realtime already publishes the whole cards table, so no grant, policy or
-- publication changes are needed.

alter table public.cards add column if not exists summary text check (summary is null or char_length(summary) <= 200);

-- file_card -----------------------------------------------------------------
-- Same as the live-cut version with p_summary added after p_title. The old
-- ten-argument signature is dropped so only this one exists.

drop function if exists public.file_card(public.card_bucket, public.card_lane, public.card_folder, text, text, text, numeric, public.card_stage, uuid, text);

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

-- Function privileges -------------------------------------------------------

revoke all on function public.file_card(public.card_bucket, public.card_lane, public.card_folder, text, text, text, text, numeric, public.card_stage, uuid, text) from public, anon;
grant execute on function public.file_card(public.card_bucket, public.card_lane, public.card_folder, text, text, text, text, numeric, public.card_stage, uuid, text) to authenticated, service_role;
