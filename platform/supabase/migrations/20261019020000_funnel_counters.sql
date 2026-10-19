-- The step from interest to payment (docs/specs/counter-senders.md, Funnel).
--
-- Three more aggregate counters from the site: contribute_load (/contribute is shown, once a page
-- load), checkout_open (a press on a Payment Link, a link to https://buy.stripe.com/, once a page
-- load) and home_play_click (a press on a link from home into the game, once a view of home). Each is
-- still one daily total per name: no cookie, no identifier, no address, no free text
-- (docs/specs/play-counts.md). refresh_daily_metrics already copies every play_counts name into
-- daily_metrics as play.<name>, so the funnel reaches the benchmark review with no change there.
--
-- The lists below are the ones 20261018110000_channel_counters.sql wrote, with the three names added
-- at the end, and the same list as the site's PLAY_EVENTS (platform/site/netlify/functions/card.mts).
--
-- Every statement runs twice without error.

set lock_timeout = '5s';

alter table public.play_counts drop constraint if exists play_counts_event_check;
alter table public.play_counts add constraint play_counts_event_check
  check (event in (
    'dust_load', 'dust_share', 'card_share', 'dust_next_card',
    'dust_return_1d', 'dust_return_7d', 'dust_session_2m', 'dust_session_4m', 'dust_seed_save', 'dust_seed_open',
    'home_load', 'home_dwell_mid', 'home_dwell_long', 'broadcast_load', 'broadcast_qr', 'discord_click',
    'dust_daily_start', 'dust_daily_finish', 'dust_daily_share',
    'from_x', 'from_bsky', 'from_threads', 'from_mastodon', 'from_discord', 'from_yt', 'from_tiktok', 'from_ig', 'from_linkedin',
    'from_reddit', 'from_hn', 'from_itch', 'from_ph', 'from_creator',
    'contribute_load', 'checkout_open', 'home_play_click'
  ));

create or replace function public.count_play_event(p_event text) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The same list as the site's PLAY_EVENTS (platform/site/netlify/functions/card.mts).
  if p_event is null or p_event not in ('dust_load', 'dust_share', 'card_share', 'dust_next_card', 'dust_return_1d', 'dust_return_7d', 'dust_session_2m', 'dust_session_4m', 'dust_seed_save', 'dust_seed_open', 'home_load', 'home_dwell_mid', 'home_dwell_long', 'broadcast_load', 'broadcast_qr', 'discord_click', 'dust_daily_start', 'dust_daily_finish', 'dust_daily_share', 'from_x', 'from_bsky', 'from_threads', 'from_mastodon', 'from_discord', 'from_yt', 'from_tiktok', 'from_ig', 'from_linkedin', 'from_reddit', 'from_hn', 'from_itch', 'from_ph', 'from_creator', 'contribute_load', 'checkout_open', 'home_play_click') then
    return false;
  end if;
  insert into public.play_counts (day, event, count)
  values ((now() at time zone 'utc')::date, p_event, 1)
  on conflict (day, event) do update set count = public.play_counts.count + 1;
  return true;
end;
$$;

-- create or replace keeps the grants the earlier migrations gave; restated so the anon key can count.
revoke all on function public.count_play_event(text) from public;
grant execute on function public.count_play_event(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
