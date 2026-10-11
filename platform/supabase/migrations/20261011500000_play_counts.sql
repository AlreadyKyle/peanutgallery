-- Play and share counts without tracking (docs/specs/play-counts.md).
--
-- a. play_counts: one row per (UTC day, event) holding a running total. Nothing else: no cookie, no
--    identifier, no address, no time finer than the day, no free text. The event is one of four
--    names, checked here and in count_play_event.
-- b. count_play_event(event): anon may call it, as the site's /api/count does with the publishable
--    key. It adds one to today's row for a known event and answers true; any other name answers false
--    with nothing written. It reads no free text into the table: an unknown name is dropped.
-- c. board_play_counts(days): the board's panel reads the last days' rows (a board member at the
--    second factor only).
--
-- Every statement runs twice without error, as the migration test applies it.

-- a. Counts ---------------------------------------------------------------------

create table if not exists public.play_counts (
  day date not null,
  event text not null constraint play_counts_event_check
    check (event in ('dust_load', 'dust_share', 'card_share', 'dust_next_card')),
  count bigint not null default 0 check (count >= 0),
  primary key (day, event)
);

alter table public.play_counts enable row level security;
revoke all on public.play_counts from public, anon, authenticated, service_role;
grant select on public.play_counts to service_role;

-- b. The public counter ---------------------------------------------------------

create or replace function public.count_play_event(p_event text) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event is null or p_event not in ('dust_load', 'dust_share', 'card_share', 'dust_next_card') then
    return false;
  end if;
  insert into public.play_counts (day, event, count)
  values ((now() at time zone 'utc')::date, p_event, 1)
  on conflict (day, event) do update set count = public.play_counts.count + 1;
  return true;
end;
$$;

-- c. The board's read -----------------------------------------------------------

-- The last p_days UTC days (today included, 1 to 90, default 14), newest first: one object per day
-- with each event's count, 0 where nothing was counted.
create or replace function public.board_play_counts(p_days integer default 14) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 14), 1), 90);
  v_today date := (now() at time zone 'utc')::date;
begin
  if public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Board membership is required';
  end if;
  if not public.board_aal2() then
    raise exception 'A second factor is required';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.day desc)
    from (
      select d.day,
        coalesce(sum(c.count) filter (where c.event = 'dust_load'), 0) as dust_load,
        coalesce(sum(c.count) filter (where c.event = 'dust_share'), 0) as dust_share,
        coalesce(sum(c.count) filter (where c.event = 'card_share'), 0) as card_share,
        coalesce(sum(c.count) filter (where c.event = 'dust_next_card'), 0) as dust_next_card
      from (select (v_today - g)::date as day from generate_series(0, v_days - 1) g) d
      left join public.play_counts c on c.day = d.day
      group by d.day
    ) r
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.count_play_event(text) from public;
revoke all on function public.board_play_counts(integer) from public, anon;
grant execute on function public.count_play_event(text) to anon, authenticated, service_role;
grant execute on function public.board_play_counts(integer) to authenticated, service_role;

notify pgrst, 'reload schema';
