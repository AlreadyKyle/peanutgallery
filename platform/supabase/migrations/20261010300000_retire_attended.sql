-- retire-attended (docs/specs/unattended-roles.md, PR5; docs/PLAN.md §10
-- decision 66): attended mode leaves the dispatcher, which has one mode,
-- unattended. Applies after 20261010200000_supply_refill.sql and can run twice.
--
-- studio_state.agent_mode is unattended: the row is set, the column defaults
-- to it and is not null, and a check constraint refuses any other value, so no
-- write can put the studio back in attended mode. The dispatcher no longer
-- reads the column. set_agent_mode keeps its signature, its privileges and
-- its board and second-factor checks, and then refuses every call: attended
-- mode is retired. board_heartbeat and board_members.last_seen_at stay in the
-- database; nothing in the dispatcher reads them any more.

set lock_timeout = '5s';

update public.studio_state set agent_mode = 'unattended' where agent_mode is distinct from 'unattended';

alter table public.studio_state alter column agent_mode set default 'unattended';
alter table public.studio_state alter column agent_mode set not null;
alter table public.studio_state drop constraint if exists studio_state_agent_mode_unattended;
alter table public.studio_state add constraint studio_state_agent_mode_unattended check (agent_mode = 'unattended');

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
  raise exception 'attended mode is retired';
end;
$$;

revoke all on function public.set_agent_mode(text) from public, anon;
grant execute on function public.set_agent_mode(text) to authenticated, service_role;
