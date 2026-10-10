-- studio-auto-resume (docs/specs/unattended-roles.md, PR3): the dispatcher
-- unpauses a studio it paused itself for money it could not spend, once a
-- one-token call on the studio key goes through again. Applies after
-- 20261010000000_auto_resume.sql and can run twice.
--
-- dispatcher_resume_studio(p_reason, p_detail) acts only while the studio is
-- paused with pause_reason awaiting_credit (the Console credit or spend limit
-- refused the key) or spend_limit (the usage tier's monthly cap), and paused_by
-- starts with "dispatcher" (pipeline.ts writes "dispatcher: ..."). A pause the
-- board or the moderator set (paused_by is their email, and set_paused writes
-- it again on a studio already paused, so the board takes a dispatcher's pause
-- over by pausing), an incident pause (a failed revert) and a fired kill switch
-- are never lifted here. It clears paused, paused_by and paused_at as
-- set_paused(false) does; the studio_state_pause_reason trigger clears
-- pause_reason. It writes one agent_events row with no card and no role, step
-- studio_resumed, whose payload names the pause it lifted; event_line_key gives
-- it the key none, so it reaches no public page. It returns whether it acted.

set lock_timeout = '5s';

create or replace function public.dispatcher_resume_studio(p_reason text, p_detail jsonb) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.studio_state%rowtype;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required';
  end if;
  select * into v_state from public.studio_state where id = 1 for update;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;
  if not v_state.paused
    or v_state.pause_reason is null
    or v_state.pause_reason not in ('awaiting_credit', 'spend_limit')
    or coalesce(v_state.paused_by, '') not like 'dispatcher:%'
    or v_state.kill_switch_fired_at is not null then
    return false;
  end if;
  update public.studio_state
  set paused = false,
      paused_by = null,
      paused_at = null
  where id = 1;
  insert into public.agent_events (card_id, role_id, type, payload_json)
  values (null, null, 'message', jsonb_build_object(
    'step', 'studio_resumed',
    'reason', btrim(p_reason),
    'from_reason', v_state.pause_reason,
    'paused_by', v_state.paused_by,
    'paused_at', v_state.paused_at,
    'detail', coalesce(p_detail, '{}'::jsonb)
  ));
  return true;
end;
$$;

revoke all on function public.dispatcher_resume_studio(text, jsonb) from public, anon, authenticated;
grant execute on function public.dispatcher_resume_studio(text, jsonb) to service_role;
