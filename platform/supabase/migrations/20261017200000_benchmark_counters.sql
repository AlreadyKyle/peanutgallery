-- Aggregate counters for the benchmarks (docs/specs/operations.md, docs/strategy/benchmarks.md).
--
-- a. play_counts takes the counters benchmarks.md lists under "What has to be built to measure
--    everything above": a returning flag and a session-length bucket in the game's counts, a home
--    load and a dwell bucket on the site, seed opens from links, the broadcast's load and its QR
--    source, and clicks on Discord links. Each is still one daily total per name: no cookie, no
--    identifier, no address, no free text (docs/specs/play-counts.md).
-- b. daily_metrics: one row per (UTC day, metric) holding a number. Every value is a count or a sum
--    over rows that already exist (the contributions, the ledger, the cards, the deploys, the
--    community tables and play_counts); no row names a person, a payer key, a card or a text.
-- c. refresh_daily_metrics(day): recomputes one UTC day's rows from those tables;
--    refresh_recent_metrics() does today and yesterday, so late rows land, and pg_cron runs it hourly.
-- d. Reads: daily_metrics_window(days) for the dispatcher's benchmark review (service_role), and
--    board_daily_metrics(days) for the board at the second factor.
--
-- Every statement runs twice without error.

set lock_timeout = '5s';

-- a. The new aggregate counters ----------------------------------------------------------------

alter table public.play_counts drop constraint if exists play_counts_event_check;
alter table public.play_counts add constraint play_counts_event_check
  check (event in (
    'dust_load', 'dust_share', 'card_share', 'dust_next_card',
    'dust_return_1d', 'dust_return_7d', 'dust_session_2m', 'dust_session_4m', 'dust_seed_save', 'dust_seed_open',
    'home_load', 'home_dwell_15s', 'home_dwell_45s', 'broadcast_load', 'broadcast_qr', 'discord_click'
  ));

create or replace function public.count_play_event(p_event text) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event is null or p_event not in (
    'dust_load', 'dust_share', 'card_share', 'dust_next_card',
    'dust_return_1d', 'dust_return_7d', 'dust_session_2m', 'dust_session_4m', 'dust_seed_save', 'dust_seed_open',
    'home_load', 'home_dwell_15s', 'home_dwell_45s', 'broadcast_load', 'broadcast_qr', 'discord_click'
  ) then
    return false;
  end if;
  insert into public.play_counts (day, event, count)
  values ((now() at time zone 'utc')::date, p_event, 1)
  on conflict (day, event) do update set count = public.play_counts.count + 1;
  return true;
end;
$$;

-- b. daily_metrics -----------------------------------------------------------------------------

create table if not exists public.daily_metrics (
  day date not null,
  metric text not null check (metric ~ '^[a-z0-9_.]{2,60}$'),
  value numeric(16,4) not null default 0,
  computed_at timestamptz not null default now(),
  primary key (day, metric)
);

alter table public.daily_metrics enable row level security;
revoke all on public.daily_metrics from public, anon, authenticated, service_role;
grant select on public.daily_metrics to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'peanutgallery_backup') then
    grant select on public.daily_metrics to peanutgallery_backup;
  end if;
end
$$;

-- c. refresh_daily_metrics --------------------------------------------------------------------

-- One UTC day's rows, recomputed from the tables that hold the facts. Returns how many rows it
-- wrote. Each metric is a count or a sum; the distinct counts (supporters) are computed here and
-- only the number is kept.
create or replace function public.refresh_daily_metrics(p_day date) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from timestamptz := (p_day::timestamp at time zone 'utc');
  v_to timestamptz := ((p_day + 1)::timestamp at time zone 'utc');
  v_rows jsonb := '{}'::jsonb;
  v_part jsonb;
  v_key text;
  v_n integer := 0;
begin
  if p_day is null then raise exception 'Name a day'; end if;

  -- Money in: payments (cash), refunds and disputes, the chosen studio share, the Machine's share.
  select jsonb_build_object(
      'money.payments', count(*) filter (where c.entry = 'payment'),
      'money.gross_usd', coalesce(sum(c.amount_usd) filter (where c.entry = 'payment'), 0),
      'money.studio_usd', coalesce(sum(c.studio_usd) filter (where c.entry = 'payment'), 0),
      'money.agents_usd', coalesce(sum(c.agents_usd) filter (where c.entry = 'payment'), 0),
      'money.machine_usd', coalesce(sum(c.amount_usd) filter (where c.entry = 'payment' and c.goal_card_id is null and c.requested_card_id is null), 0),
      'money.studio_pct_sum', coalesce(sum(c.studio_pct_chosen) filter (where c.entry = 'payment'), 0),
      'money.refunded_usd', coalesce(abs(sum(c.amount_usd) filter (where c.entry in ('refund', 'dispute'))), 0),
      'money.refunds', count(*) filter (where c.entry in ('refund', 'dispute')),
      'money.supporters', count(distinct c.payer_key) filter (where c.entry = 'payment'),
      'money.payments_under_5', count(*) filter (where c.entry = 'payment' and c.amount_usd < 5)
    )
  into v_part
  from public.contributions c
  where c.kind = 'cash' and c.created_at >= v_from and c.created_at < v_to;
  v_rows := v_rows || v_part;

  -- The trailing 30 days ending with the day, for the two figures a sum of days cannot give: the
  -- distinct payer keys and the median payment.
  select jsonb_build_object(
      'money.supporters_30d', count(distinct c.payer_key),
      'money.median_30d', coalesce(percentile_cont(0.5) within group (order by c.amount_usd), 0)
    )
  into v_part
  from public.contributions c
  where c.kind = 'cash' and c.entry = 'payment' and c.created_at >= v_to - interval '30 days' and c.created_at < v_to;
  v_rows := v_rows || v_part;

  -- New and returning supporters, as counts: a payer key whose first payment fell on the day, and one
  -- whose second payment fell on the day within 60 days of its first.
  with firsts as (
    select c.payer_key, min(c.created_at) as first_at
    from public.contributions c
    where c.kind = 'cash' and c.entry = 'payment' and c.created_at < v_to
    group by c.payer_key
  ), seconds as (
    select f.payer_key, f.first_at,
      (select min(c.created_at) from public.contributions c
        where c.payer_key = f.payer_key and c.kind = 'cash' and c.entry = 'payment' and c.created_at > f.first_at) as second_at
    from firsts f
  )
  select jsonb_build_object(
      'money.new_supporters', count(*) filter (where s.first_at >= v_from),
      'money.repeat_supporters', count(*) filter (where s.second_at >= v_from and s.second_at < v_to and s.second_at <= s.first_at + interval '60 days')
    )
  into v_part
  from seconds s;
  v_rows := v_rows || v_part;

  -- Agent spend on the ledger.
  select jsonb_build_object('agents.spend_usd', coalesce(sum(l.usd), 0), 'agents.calls', count(*))
  into v_part from public.ledger l where l.created_at >= v_from and l.created_at < v_to;
  v_rows := v_rows || v_part;

  -- Cards: opened, gone live (and what they cost), rejected.
  select jsonb_build_object('cards.opened', count(*)) into v_part
  from public.cards c where c.created_at >= v_from and c.created_at < v_to;
  v_rows := v_rows || v_part;
  select jsonb_build_object('cards.live', count(*), 'cards.live_spend_usd', coalesce(sum(c.actual_usd), 0))
  into v_part from public.cards c where c.live_at >= v_from and c.live_at < v_to;
  v_rows := v_rows || v_part;
  select jsonb_build_object('cards.rejected', count(*)) into v_part
  from public.cards c where c.stage = 'rejected' and c.updated_at >= v_from and c.updated_at < v_to;
  v_rows := v_rows || v_part;

  -- Deploys: all, green, and smoke failures (the rollbacks follow those).
  select jsonb_build_object(
      'deploys.total', count(*),
      'deploys.green', count(*) filter (where d.is_green),
      'deploys.smoke_failed', count(*) filter (where d.smoke_result is not null and d.smoke_result <> 'pass' and not d.is_green)
    )
  into v_part from public.deploys d where d.created_at >= v_from and d.created_at < v_to;
  v_rows := v_rows || v_part;

  -- The community: new profiles, suggestions, seeds, votes and feed events.
  select jsonb_build_object('community.profiles_new', count(*)) into v_part
  from community.profiles p where p.created_at >= v_from and p.created_at < v_to;
  v_rows := v_rows || v_part;
  select jsonb_build_object(
      'community.suggestions', count(*),
      'community.suggestions_declined', count(*) filter (where s.state = 'declined'),
      'community.suggestions_held', count(*) filter (where s.held)
    )
  into v_part from community.suggestions s where s.created_at >= v_from and s.created_at < v_to;
  v_rows := v_rows || v_part;
  select jsonb_build_object('community.suggestions_live', count(*)) into v_part
  from community.events e where e.kind = 'shipped' and e.at >= v_from and e.at < v_to
    and exists (select 1 from community.suggestion_clusters k where k.card_id = e.card_id);
  v_rows := v_rows || v_part;
  select jsonb_build_object('community.seeds_saved', count(*), 'community.seeds_published', count(*) filter (where s.published))
  into v_part from community.seeds s where s.created_at >= v_from and s.created_at < v_to;
  v_rows := v_rows || v_part;
  select jsonb_build_object('community.suggestion_votes', count(*)) into v_part
  from community.suggestion_votes v where v.created_at >= v_from and v.created_at < v_to;
  v_rows := v_rows || v_part;
  select jsonb_build_object('community.seed_votes', count(*)) into v_part
  from community.seed_votes v where v.created_at >= v_from and v.created_at < v_to;
  v_rows := v_rows || v_part;
  select jsonb_build_object('community.events', count(*), 'community.milestones', count(*) filter (where e.kind = 'milestone'))
  into v_part from community.events e where e.at >= v_from and e.at < v_to;
  v_rows := v_rows || v_part;

  -- The play and share counts, as they are.
  select coalesce(jsonb_object_agg('play.' || p.event, p.count), '{}'::jsonb) into v_part
  from public.play_counts p where p.day = p_day;
  v_rows := v_rows || v_part;

  for v_key in select jsonb_object_keys(v_rows) loop
    insert into public.daily_metrics (day, metric, value, computed_at)
    values (p_day, v_key, coalesce((v_rows->>v_key)::numeric, 0), now())
    on conflict (day, metric) do update set value = excluded.value, computed_at = excluded.computed_at;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Today and yesterday (UTC), so a row that lands after midnight is still counted on its day.
create or replace function public.refresh_recent_metrics() returns integer
language sql
security definer
set search_path = public
as $$
  select public.refresh_daily_metrics(((now() at time zone 'utc')::date - 1))
    + public.refresh_daily_metrics((now() at time zone 'utc')::date)
$$;

-- d. Reads --------------------------------------------------------------------------------------

-- The last p_days UTC days (1 to 120, default 60), oldest first: {"days": [{"day": ..., "metrics":
-- {name: value}}], "until": today}. Only counts and sums.
create or replace function public.daily_metrics_window(p_days integer default 60) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select least(greatest(coalesce(p_days, 60), 1), 120) as n, (now() at time zone 'utc')::date as today
  ), days as (
    select (b.today - g)::date as day from bounds b, generate_series(0, (select n from bounds) - 1) g
  )
  select jsonb_build_object(
    'until', (select today from bounds),
    'days', coalesce(jsonb_agg(jsonb_build_object(
      'day', d.day,
      'metrics', coalesce((select jsonb_object_agg(m.metric, m.value) from public.daily_metrics m where m.day = d.day), '{}'::jsonb)
    ) order by d.day), '[]'::jsonb))
  from days d
$$;

create or replace function public.board_daily_metrics(p_days integer default 30) returns jsonb
language plpgsql
stable
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
  return public.daily_metrics_window(p_days);
end;
$$;

revoke all on function public.refresh_daily_metrics(date) from public, anon, authenticated;
revoke all on function public.refresh_recent_metrics() from public, anon, authenticated;
revoke all on function public.daily_metrics_window(integer) from public, anon, authenticated;
revoke all on function public.board_daily_metrics(integer) from public, anon;
grant execute on function public.refresh_daily_metrics(date) to service_role;
grant execute on function public.refresh_recent_metrics() to service_role;
grant execute on function public.daily_metrics_window(integer) to service_role;
grant execute on function public.board_daily_metrics(integer) to authenticated, service_role;

-- A database that does not ship pg_cron (PGlite in the tests) skips the schedule.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; refresh_daily_metrics is not scheduled';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('daily-metrics', '23 * * * *', $c$select public.refresh_recent_metrics()$c$);
end $$;

notify pgrst, 'reload schema';
