-- The moderator pauses only (docs/specs/moderator-pause-only.md, PLAN.md §4 The Board, §10 decision 77).
--
-- The kill switch: the board or the moderator pauses the studio, and only the board resumes it.
-- set_paused keeps its signature, grants and pause rules; a resume (p_paused false) now needs the
-- board at the second factor, the check the board's other actions use, so the moderator can no
-- longer lift any pause (an incident, the dispatcher's awaiting_credit or spend_limit, the board's).
-- dispatcher_resume_studio still lifts the dispatcher's own money pauses (§10 decision 66).
--
-- studio_pause_log records every change of studio_state.paused, whoever makes it: one row for each
-- pause and each resume, and one when a pause is taken over (a new holder or reason while paused).
-- The row says who (the signed-in email, else the pause's paused_by, else the caller's role or the
-- database user), which role (board, moderator, dispatcher for the service role's key, database for
-- SQL run as the database's own user: the SQL editor, a migration, pg_cron), paused or resumed, the
-- pause's reason (the one set, or the one a resume lifted) and when. An after trigger writes it, so
-- set_paused, the dispatcher's pause and resume and a statement in the SQL editor are all recorded.
-- The log is append-only (refuse_money_change, as card_approvals and terms_versions use it): no
-- role updates, deletes or truncates a row. The board and the moderator read it; nobody writes it
-- but the trigger.
--
-- Additive: one table, one trigger function, set_paused's body. Every statement runs twice without
-- error.

set lock_timeout = '5s';

-- a. The pause log ----------------------------------------------------------

create table if not exists public.studio_pause_log (
  id bigint generated always as identity primary key,
  action text not null check (action in ('paused', 'resumed')),
  actor text not null,
  actor_role text not null check (actor_role in ('board', 'moderator', 'dispatcher', 'database')),
  pause_reason text check (pause_reason in ('awaiting_credit', 'spend_limit', 'incident', 'board')),
  created_at timestamptz not null default now()
);

alter table public.studio_pause_log enable row level security;
revoke all on public.studio_pause_log from anon, authenticated, service_role;
grant select on public.studio_pause_log to authenticated, service_role;
drop policy if exists studio_pause_log_board_read on public.studio_pause_log;
create policy studio_pause_log_board_read on public.studio_pause_log for select to authenticated using (public.is_board_member());

drop trigger if exists studio_pause_log_append_only on public.studio_pause_log;
create trigger studio_pause_log_append_only before update or delete on public.studio_pause_log
  for each row execute function public.refuse_money_change();
drop trigger if exists studio_pause_log_no_truncate on public.studio_pause_log;
create trigger studio_pause_log_no_truncate before truncate on public.studio_pause_log
  for each statement execute function public.refuse_money_change();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'peanutgallery_backup') then
    grant select on public.studio_pause_log to peanutgallery_backup;
  end if;
end
$$;

-- b. The trigger that writes it ---------------------------------------------
-- Security definer so it writes the log for a caller who cannot (the service role, a board RPC).

create or replace function public.studio_pause_logged() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_role public.board_role;
  v_jwt_role text;
begin
  if tg_op = 'INSERT' then
    if not new.paused then
      return null;
    end if;
    v_reason := new.pause_reason;
  elsif new.paused then
    if old.paused and old.pause_reason is not distinct from new.pause_reason and old.paused_by is not distinct from new.paused_by then
      return null;
    end if;
    v_reason := new.pause_reason;
  else
    if not old.paused then
      return null;
    end if;
    v_reason := old.pause_reason;
  end if;
  v_role := public.board_role();
  v_jwt_role := auth.jwt() ->> 'role';
  insert into public.studio_pause_log (action, actor, actor_role, pause_reason)
  values (
    case when new.paused then 'paused' else 'resumed' end,
    coalesce(auth.email(), case when new.paused then new.paused_by end, v_jwt_role, session_user::text),
    case
      when v_role is not null then v_role::text
      when v_jwt_role = 'service_role' then 'dispatcher'
      else 'database'
    end,
    v_reason
  );
  return null;
end;
$$;

-- Only a write that names the pause's columns can change it; the dispatcher's heartbeat does not.
drop trigger if exists studio_state_pause_logged on public.studio_state;
create trigger studio_state_pause_logged after insert or update of paused, paused_by, pause_reason on public.studio_state
  for each row execute function public.studio_pause_logged();

-- c. set_paused ---------------------------------------------------------------
-- The money-logic version, with the resume the board's alone, as set_role_pause resumes a role.

create or replace function public.set_paused(p_paused boolean, p_reason text default null) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.board_role() is null then
    raise exception 'Board or moderator membership is required';
  end if;
  if p_paused is null then
    raise exception 'p_paused is required';
  end if;
  if not p_paused and public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Only the board resumes the studio';
  end if;
  if public.board_role() = 'board'::public.board_role and not public.board_aal2() then
    raise exception 'A second factor is required';
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

-- d. Function privileges ------------------------------------------------------

revoke all on function public.studio_pause_logged() from public, anon, authenticated;
revoke all on function public.set_paused(boolean, text) from public, anon;
grant execute on function public.set_paused(boolean, text) to authenticated, service_role;

notify pgrst, 'reload schema';
