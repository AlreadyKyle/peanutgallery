-- Reason to come back: the weekly report, the Discord outbox and the card
-- supply floor (docs/specs/studio-reports.md). Applies after
-- 20260925000000_terms_version_3.sql and can run twice.
--
-- studio_reports holds one row per New York week (Monday 00:00 to the next
-- Monday 00:00, America/New_York) in which a card shipped. Its facts come only
-- from public records, through SQL, never from an agent: each shipped card's
-- title, folder, live time, studio-billed cost and supporters by number (the
-- first 24 of public_card_supporters, plus a count); the number shipped; the
-- cards open for funding (money.funding_order(), the set every Fund button
-- follows) and the first three of them; the new supporters (supporters rows,
-- which never include the board's test payment); and the week's studio-billed
-- spend. No amount per supporter, name, email, founder-billed cost or board
-- payment is read.
--
-- publish_weekly_report() runs hourly on pg_cron, so the New York week
-- boundary is caught in both offsets. With no argument it takes the last
-- ended New York week; it publishes a week once, and a week in which no card
-- shipped gets no row. site_reports() is the one public read, for /reports.
--
-- outbound_posts is the dispatcher's Discord outbox: a (kind, ref) row is
-- inserted as 'sending' before a post, so the primary key refuses a second
-- claim, and it becomes 'posted', 'failed' or 'skipped'. A row is never posted
-- again, whatever its state.
--
-- studio_state gains the card supply floor, and card_supply() counts the open
-- cards, the big and the small ones against it for /board.

set lock_timeout = '5s';

-- a. studio_reports -----------------------------------------------------------

create table if not exists public.studio_reports (
  week_start date primary key check (extract(isodow from week_start) = 1),
  published_at timestamptz not null default now(),
  facts jsonb not null
);

alter table public.studio_reports enable row level security;
revoke all on public.studio_reports from anon, authenticated, service_role;
grant select on public.studio_reports to service_role;

-- The Monday of the last New York week that has ended at p_at. Security
-- definer like every money helper, though it reads nothing.
create or replace function money.last_ended_week(p_at timestamptz) returns date
language sql
immutable
security definer
set search_path = public
as $$
  select d - (extract(isodow from d)::integer - 1) - 7
  from (select (p_at at time zone 'America/New_York')::date as d) x
$$;

-- One week's facts, from public records only.
create or replace function money.report_facts(p_week_start date) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select
      (p_week_start::timestamp at time zone 'America/New_York') as from_at,
      ((p_week_start + 7)::timestamp at time zone 'America/New_York') as to_at
  ),
  shipped as (
    select c.id, c.title, c.folder, c.live_at
    from public.cards c, bounds b
    where c.stage = 'live'
      and c.live_at >= b.from_at and c.live_at < b.to_at
      and public.card_is_public(c.id)
  ),
  open_order as (
    select f."position", f.card_id, c.title
    from money.funding_order() f
    join public.cards c on c.id = f.card_id
  )
  select jsonb_build_object(
    'shipped_count', (select count(*) from shipped)::integer,
    'shipped', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'title', s.title,
        'folder', s.folder,
        'live_at', s.live_at,
        'cost_usd', money.card_studio_spend(s.id),
        'supporters', coalesce((
          select jsonb_agg(jsonb_build_object('number', p.supporter_number, 'founding', p.founding) order by p.supporter_number)
          from (
            select supporter_number, founding from public.public_card_supporters
            where card_id = s.id
            order by supporter_number
            limit 24
          ) p
        ), '[]'::jsonb),
        'supporter_count', (select count(*) from public.public_card_supporters where card_id = s.id)::integer
      ) order by s.live_at, s.id)
      from shipped s
    ), '[]'::jsonb),
    'open_count', (select count(*) from open_order)::integer,
    'open_first', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.card_id, 'title', o.title) order by o."position")
      from (select * from open_order order by "position" limit 3) o
    ), '[]'::jsonb),
    'new_supporters', (
      select count(*) from public.supporters s, bounds b
      where s.created_at >= b.from_at and s.created_at < b.to_at
    )::integer,
    'spend_usd', (
      select coalesce(sum(l.usd), 0)::numeric(12,4) from public.ledger l, bounds b
      where l.billed_to = 'studio'
        and l.created_at >= b.from_at and l.created_at < b.to_at
        and (l.card_id is null or public.card_is_public(l.card_id))
    )
  )
$$;

revoke all on function money.last_ended_week(timestamptz) from public, anon, authenticated, service_role;
revoke all on function money.report_facts(date) from public, anon, authenticated, service_role;

create or replace function public.publish_weekly_report(p_week_start date default null) returns public.studio_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date := coalesce(p_week_start, money.last_ended_week(now()));
  v_facts jsonb;
  v_row public.studio_reports;
begin
  if extract(isodow from v_week) <> 1 then
    raise exception 'publish_weekly_report: % is not a Monday', v_week;
  end if;
  if (now() at time zone 'America/New_York') < (v_week + 7)::timestamp then
    raise exception 'publish_weekly_report: the week of % has not ended in New York', v_week;
  end if;
  v_facts := money.report_facts(v_week);
  if (v_facts ->> 'shipped_count')::integer = 0 then
    return null;
  end if;
  insert into public.studio_reports (week_start, facts) values (v_week, v_facts)
  on conflict (week_start) do nothing;
  select * into v_row from public.studio_reports where week_start = v_week;
  return v_row;
end;
$$;

revoke all on function public.publish_weekly_report(date) from public, anon, authenticated;
grant execute on function public.publish_weekly_report(date) to service_role;

create or replace function public.site_reports(p_limit integer default 12) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('reports', coalesce((
    select jsonb_agg(jsonb_build_object('week_start', r.week_start, 'published_at', r.published_at, 'facts', r.facts) order by r.week_start desc)
    from (
      select week_start, published_at, facts from public.studio_reports
      order by week_start desc
      limit least(greatest(coalesce(p_limit, 12), 1), 52)
    ) r
  ), '[]'::jsonb))
$$;

revoke all on function public.site_reports(integer) from public;
grant execute on function public.site_reports(integer) to anon, authenticated, service_role;

-- b. The hourly publish -------------------------------------------------------
-- pg_cron runs in UTC; publish_weekly_report() does its own New York week
-- arithmetic, so an hourly run catches the boundary in both offsets. A database
-- that does not ship pg_cron (PGlite in the tests) skips the schedule.
-- cron.schedule with a job name replaces the existing job, so a second run is
-- safe.

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; publish_weekly_report is not scheduled';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('weekly-report', '7 * * * *', 'select public.publish_weekly_report()');
end $$;

-- c. outbound_posts -----------------------------------------------------------

create table if not exists public.outbound_posts (
  kind text not null check (kind in ('ship', 'weekly')),
  ref text not null,
  state text not null check (state in ('sending', 'posted', 'failed', 'skipped')),
  status integer,
  message_id text,
  skip_reason text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (kind, ref)
);

alter table public.outbound_posts enable row level security;
revoke all on public.outbound_posts from anon, authenticated, service_role;
grant select, insert, update on public.outbound_posts to service_role;

-- d. The card supply floor ----------------------------------------------------

alter table public.studio_state add column if not exists card_floor_open integer not null default 6;
alter table public.studio_state add column if not exists card_floor_big integer not null default 1;
alter table public.studio_state add column if not exists card_floor_small integer not null default 1;
alter table public.studio_state add column if not exists card_big_min_usd numeric(12,4) not null default 5;
alter table public.studio_state add column if not exists card_small_max_usd numeric(12,4) not null default 2;
alter table public.studio_state drop constraint if exists studio_state_card_floor_open_check;
alter table public.studio_state add constraint studio_state_card_floor_open_check check (card_floor_open between 0 and 50);
alter table public.studio_state drop constraint if exists studio_state_card_floor_big_check;
alter table public.studio_state add constraint studio_state_card_floor_big_check check (card_floor_big between 0 and 20);
alter table public.studio_state drop constraint if exists studio_state_card_floor_small_check;
alter table public.studio_state add constraint studio_state_card_floor_small_check check (card_floor_small between 0 and 20);
alter table public.studio_state drop constraint if exists studio_state_card_big_min_usd_check;
alter table public.studio_state add constraint studio_state_card_big_min_usd_check check (card_big_min_usd > 0);
alter table public.studio_state drop constraint if exists studio_state_card_small_max_usd_check;
alter table public.studio_state add constraint studio_state_card_small_max_usd_check check (card_small_max_usd > 0);

-- The cards open for funding (the set in money.funding_order()), the big ones
-- (target at or above card_big_min_usd) and the small ones (target under
-- card_small_max_usd), each shortfall against the floor, and the open cards in
-- funding order.
create or replace function public.card_supply() returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with fl as (
    select card_floor_open, card_floor_big, card_floor_small, card_big_min_usd, card_small_max_usd
    from public.studio_state where id = 1
  ),
  open_cards as (
    select f."position", c.id, c.title, c.funding_target_usd
    from money.funding_order() f
    join public.cards c on c.id = f.card_id
  ),
  counts as (
    select
      (select count(*) from open_cards)::integer as open,
      (select count(*) from open_cards o where o.funding_target_usd >= f.card_big_min_usd)::integer as big,
      (select count(*) from open_cards o where o.funding_target_usd < f.card_small_max_usd)::integer as small
    from fl f
  )
  select jsonb_build_object(
    'open', n.open,
    'big', n.big,
    'small', n.small,
    'floor_open', f.card_floor_open,
    'floor_big', f.card_floor_big,
    'floor_small', f.card_floor_small,
    'big_min_usd', f.card_big_min_usd,
    'small_max_usd', f.card_small_max_usd,
    'short_open', greatest(f.card_floor_open - n.open, 0),
    'short_big', greatest(f.card_floor_big - n.big, 0),
    'short_small', greatest(f.card_floor_small - n.small, 0),
    'open_cards', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'target_usd', o.funding_target_usd) order by o."position")
      from open_cards o
    ), '[]'::jsonb)
  )
  from fl f, counts n
$$;

revoke all on function public.card_supply() from public, anon;
grant execute on function public.card_supply() to authenticated, service_role;

-- e. ----------------------------------------------------------------------------

notify pgrst, 'reload schema';
