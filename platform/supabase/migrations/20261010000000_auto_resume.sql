-- auto-resume (docs/specs/unattended-roles.md, PR3): a card paused for a reason
-- that is not the card's own resumes with no one acting, within bounds, so
-- nothing stays paused waiting on the board. Applies after
-- 20261006000000_launch_stamp.sql and can run twice.
--
-- auto_resume_checks lists the failing checks a paused card may resume from on
-- its own, each with its kind:
--   free     the dispatcher stopped or restarted, the studio or the board
--            session paused it, the Console credit or the usage tier refused
--            the key, the Claude Code pin: nothing about the card's change.
--   infra    an outage or a dispatcher, GitHub, Managed Agents or gate fault.
--   session  the session stopped at a bound below the card's ceiling: the
--            throttle's budget, the wall clock or the turn cap. A resume starts
--            a new session, so these get fewer.
-- Every other check (the ceiling, which the resume rule handles once; the
-- board's horizon move; a veto; a read token that can write; an unpriced model;
-- anything not listed) waits for the board. platform/dispatcher/src/
-- pause-checks.ts holds the same lists, and its test reads this file.
--
-- auto_resume_due() moves each such card back to funded, on horizon now only,
-- with failing_check cleared, and writes an agent_events row with step
-- auto_resume. It does nothing while the studio is paused, and skips a card
-- that is vetoed, in the closed platform code lane, whose approval is not
-- current, whose executor role is paused or missing, or that has no room left
-- under its ceiling (the lower of 1.5 times the estimate and the card maximum).
-- The card's own auto_resume rows bound it: at most 3 in the last 24 hours,
-- at most 8 in all (2 in all of kind session), and the newest at least
-- 15 minutes times 2 to the power of the last 24 hours' count ago.
--
-- public_agent_events gains the auto_resume step beside dealt, ceiling_top_up
-- and resume_rule, and event_line_key gives it the public line auto_resumed.

set lock_timeout = '5s';

-- a. The checks that resume on their own ---------------------------------------

create table if not exists public.auto_resume_checks (
  failing_check text primary key,
  kind text not null check (kind in ('free', 'infra', 'session'))
);

alter table public.auto_resume_checks enable row level security;
revoke all on table public.auto_resume_checks from anon, authenticated, service_role;
grant select on public.auto_resume_checks to service_role;

insert into public.auto_resume_checks (failing_check, kind) values
  ('dispatcher_restart', 'free'),
  ('dispatcher_stopped', 'free'),
  ('session_unsettled', 'free'),
  ('paused_by_board', 'free'),
  ('console_credit', 'free'),
  ('usage_tier_cap', 'free'),
  ('board_session', 'free'),
  ('board_review', 'free'),
  ('cli_version', 'free'),
  ('outage', 'infra'),
  ('frames', 'infra'),
  ('visual_review', 'session'),
  ('dispatcher_error', 'infra'),
  ('pr_head', 'infra'),
  ('stream_lost', 'infra'),
  ('ledger', 'infra'),
  ('managed_api', 'infra'),
  ('system_prompt', 'infra'),
  ('repo_skills', 'infra'),
  ('card_spend', 'infra'),
  ('patch_conflict', 'session'),
  ('deploy_timeout', 'infra'),
  ('post_merge_outage', 'infra'),
  ('adapter', 'infra'),
  ('gate_missing', 'infra'),
  ('gate_pending', 'infra'),
  ('gate_infrastructure', 'infra'),
  ('main_red', 'infra'),
  ('budget', 'session'),
  ('wall_clock', 'session'),
  ('turn_cap', 'session')
on conflict (failing_check) do update set kind = excluded.kind;

-- b. auto_resume_due -------------------------------------------------------------

create or replace function public.auto_resume_due() returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_card public.cards%rowtype;
  v_kind text;
  v_state public.studio_state%rowtype;
  v_day integer;
  v_ever integer;
  v_session_ever integer;
  v_last timestamptz;
  v_skip text;
  v_results jsonb := '[]'::jsonb;
  v_resumed integer := 0;
begin
  perform money.money_lock();
  select * into v_state from public.studio_state where id = 1;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;
  -- Nothing resumes while the studio is paused; the first tick after it resumes tries again.
  if v_state.paused then
    return jsonb_build_object('resumed', 0, 'results', v_results);
  end if;
  for v_id, v_kind in
    select c.id, k.kind from public.cards c
    join public.auto_resume_checks k on k.failing_check = c.failing_check
    where c.stage = 'paused' and c.horizon = 'now'
    order by c.id
    for update of c
  loop
    select * into v_card from public.cards where id = v_id;
    select
      count(*) filter (where e.created_at > now() - interval '24 hours'),
      count(*),
      count(*) filter (where e.payload_json ->> 'kind' = 'session'),
      max(e.created_at)
    into v_day, v_ever, v_session_ever, v_last
    from public.agent_events e
    where e.card_id = v_card.id and e.role_id is null and e.type = 'message' and e.payload_json ->> 'step' = 'auto_resume';

    v_skip := case
      when v_card.board_vetoed or v_card.director_stance = 'vetoed' then 'vetoed'
      when v_card.folder = 'platform' and v_card.lane = 'code' and not coalesce(v_state.platform_lane_open, false) then 'closed_lane'
      when not public.card_is_public(v_card.id) then 'approval_not_current'
      when v_card.executor_role_id is null
        or coalesce((select r.paused or r.state <> 'active' from public.roles r where r.id = v_card.executor_role_id), true) then 'executor_paused'
      when least(round(1.5 * v_card.estimate_usd, 4), v_state.card_max_usd) - v_card.actual_usd <= 0 then 'no_room'
      when v_ever >= 8 then 'limit_ever'
      when v_kind = 'session' and v_session_ever >= 2 then 'limit_session'
      when v_day >= 3 then 'limit_day'
      when v_last is not null and v_last > now() - make_interval(mins => (15 * power(2, v_day))::integer) then 'backoff'
    end;
    if v_skip is not null then
      v_results := v_results || jsonb_build_object('card_id', v_card.id, 'from_check', v_card.failing_check, 'skipped', v_skip);
      continue;
    end if;

    update public.cards set stage = 'funded', failing_check = null where id = v_card.id;
    insert into public.agent_events (card_id, role_id, type, payload_json)
    values (v_card.id, null, 'message', jsonb_build_object('step', 'auto_resume', 'from_check', v_card.failing_check, 'kind', v_kind, 'n', v_ever + 1));
    v_resumed := v_resumed + 1;
    v_results := v_results || jsonb_build_object('card_id', v_card.id, 'from_check', v_card.failing_check, 'kind', v_kind, 'n', v_ever + 1, 'resumed', true);
  end loop;
  return jsonb_build_object('resumed', v_resumed, 'results', v_results);
end;
$$;

revoke all on function public.auto_resume_due() from public, anon, authenticated;
grant execute on function public.auto_resume_due() to service_role;

-- c. The public line ---------------------------------------------------------------
-- supporter-pages' event_line_key with auto_resume added as auto_resumed.

create or replace function public.event_line_key(p_type public.agent_event_type, p_payload jsonb) returns text
language sql
immutable
set search_path = public
as $$
  select case p_type::text
    when 'start' then 'started'
    when 'tool_call' then
      case lower(coalesce(p_payload ->> 'name', ''))
        when 'read' then 'read'
        when 'grep' then 'read'
        when 'glob' then 'read'
        when 'ls' then 'read'
        when 'edit' then 'edited'
        when 'write' then 'edited'
        when 'multiedit' then 'edited'
        when 'notebookedit' then 'edited'
        when 'bash' then 'ran'
        when 'submit_patch' then 'submitted'
        else 'used_tool'
      end
    when 'message' then
      case coalesce(p_payload ->> 'step', '')
        when 'smoke_pass' then 'smoke_passed'
        when 'requeue' then 'requeued'
        when 'infrastructure' then 'paused_infra'
        when 'patch_reused' then 'patch_reused'
        when 'dealt' then 'dealt'
        when 'ceiling_top_up' then 'topped_up'
        when 'resume_rule' then 'resumed'
        when 'auto_resume' then 'auto_resumed'
        when 'ranked' then 'ranked'
        else 'none'
      end
    when 'tool_result' then 'none'
    when 'gate_pass' then 'gate_passed'
    when 'gate_fail' then 'gate_failed'
    when 'ship' then 'shipped'
    when 'revert' then 'reverted'
    when 'error' then 'stopped'
    else 'other'
  end
$$;

revoke all on function public.event_line_key(public.agent_event_type, jsonb) from public;
grant execute on function public.event_line_key(public.agent_event_type, jsonb) to anon, authenticated, service_role;

-- supporter-pages' view, its columns in order, with auto_resume among the steps
-- the database writes about a card with no role.
create or replace view public.public_agent_events with (security_invoker = false) as
  select id, card_id, role_id, type, created_at,
    case when role_id is null and type = 'message' and payload_json ->> 'step' in ('dealt', 'ceiling_top_up', 'resume_rule', 'auto_resume')
      then payload_json ->> 'step' end as step,
    case when role_id is null and type = 'message' and payload_json ->> 'step' = 'ceiling_top_up'
      then (payload_json ->> 'usd')::numeric(12,4) end as usd,
    public.event_line_key(type, payload_json) as line_key
  from public.agent_events
  where card_id is null or public.card_is_public(card_id);

revoke all on table public.public_agent_events from anon, authenticated;
grant select on public.public_agent_events to anon, authenticated;
