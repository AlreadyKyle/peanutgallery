-- Public card columns and the ship stamp (docs/specs/card-columns-and-open-funding.md).
-- Applies on top of 20260921000000_open_goal_funding.sql and can run twice.
--
-- cards.live_at records when a card last moved to live. It exists for the
-- site's ship date: a hold released onto a shipped card's bar, or a refund
-- taken off it, still moves updated_at, so the ship date the site shows moves
-- with them until the site reads live_at. Anon and authenticated stop reading
-- cards at table level and read a named list of columns instead. actual_usd
-- is withheld because it counts turns billed to the founder, whose tokens are
-- tracked and never published. severity and priority are withheld because
-- they mark incidents (priority 1 is an S1), and the incident list is private
-- until its post-mortem (PLAN.md §4 The Board). The realtime publication is
-- not changed.
--
-- A lock wait longer than five seconds fails the migration rather than
-- queueing every reader of cards behind it.

set lock_timeout = '5s';

alter table public.cards add column if not exists live_at timestamptz;

-- Backfill ------------------------------------------------------------------
-- A card already live takes the time of its last ship event, or its
-- updated_at when it has none. The updated_at trigger is off for the update
-- so the backfill does not move every shipped card's updated_at to now. The
-- block runs as one statement, and the table lock it takes holds other writes
-- to cards until it commits, so no other update runs without the trigger.

do $$
begin
  alter table public.cards disable trigger cards_set_updated_at;
  update public.cards c
  set live_at = coalesce(
    (select max(e.created_at) from public.agent_events e where e.card_id = c.id and e.type = 'ship'),
    c.updated_at
  )
  where c.stage = 'live' and c.live_at is null;
  alter table public.cards enable trigger cards_set_updated_at;
end $$;

-- set_live_at ---------------------------------------------------------------
-- A card inserted live keeps the live_at it was given, or is stamped now. A
-- card whose stage changes to live is stamped now. An update that leaves the
-- stage alone, or sets live again on a live card, keeps the stamp. A card
-- that leaves live and ships again is stamped again. The search path is empty
-- because the body names no relation.

create or replace function public.set_live_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.stage = 'live' then
      new.live_at := coalesce(new.live_at, now());
    end if;
  elsif new.stage = 'live' and old.stage is distinct from 'live' then
    new.live_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists cards_set_live_at on public.cards;
create trigger cards_set_live_at
  before insert or update of stage on public.cards
  for each row execute function public.set_live_at();

revoke all on function public.set_live_at() from public, anon, authenticated;

-- Column grants on cards ----------------------------------------------------
-- Before this file anon and authenticated held SELECT and, on Postgres 17,
-- MAINTAIN on cards; every write goes through the service role or a security
-- definer RPC, and realtime needs SELECT only. Revoking everything also
-- removes any column grants, so a second run starts from nothing. New card
-- columns are private until granted here. The board's RPCs are security
-- definer and service_role keeps its table-level grant, so neither is limited
-- by this list.

revoke all on public.cards from anon, authenticated;
grant select (
  id, bucket, source, shape, lane, board_reason, folder, executor_role_id,
  title, summary, intent, acceptance_test, design_spec_url,
  funding_target_usd, funded_usd, estimate_usd, confidence, proposer_role_id,
  director_stance, veto_reason, stage, branch, commit_sha, failing_check,
  created_at, updated_at, live_at
) on public.cards to anon, authenticated;
