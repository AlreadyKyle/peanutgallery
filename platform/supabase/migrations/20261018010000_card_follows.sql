-- Card follows: "Tell me when this ships" for anyone with a profile (docs/specs/card-follows.md).
--
-- A signed-in player follows a card; when it goes live the notices job (platform/ops/jobs/notices.mjs)
-- sends one email per follow, after the payers' ship notices (docs/specs/ship-notices.md) and inside
-- the same daily budget. The studio stores no new address: the job reads the profile's email from
-- Supabase Auth with the service key at send time and forgets it, as it reads a payer's from Stripe.
--
-- a. community.card_follows: one row per (profile, card), the primary key. state is open until the
--    card ships, then sending (claimed before the send), and sent, covered (a ship notice to the same
--    address went for this card, so no second email), no_address or failed. A claim left at sending
--    is never sent again; the board reads it through follow_notices_stuck.
-- b. community.follow_settings: one row holding a 32-byte unsubscribe secret made here (as
--    ship_notice_settings makes its own: PGlite has no pgcrypto), which no role reads. An unsubscribe
--    link carries sha256(secret || the profile's user id as 16 bytes) in hex; only the database
--    computes or checks it.
-- c. The player RPCs (authenticated, through the site's /api/community/rpc/*): follow_card,
--    unfollow_card and my_follows. follow_card takes a public card that is not live or rejected,
--    at most 100 open follows a profile and 50 new follows a day, while the follows_open flag is on.
--    Follows hold no free text, so nothing here passes the content filter or reaches an agent.
-- d. The job's functions (service_role): follow_notices_due, follow_notice_claim,
--    follow_notice_settle and follow_notices_stuck. A follow is due when its card went live at or
--    after the follow was made. Dedup with the payers' notices: the profile's sign-in email, hashed
--    here from auth.users as the receipt email is hashed into contributor_id, is compared with the
--    payers of the card; a follow waits while a ship notice to that hash is still due, and is due
--    with covered true once one was claimed or sent. The address itself is never returned.
-- e. follow_unsubscribe(user, token): anon may call it, as /api/unsubscribe does with the
--    publishable key. With a matching token it ends every follow of that profile; it reads no free
--    text and answers only true or false.
--
-- Every statement runs twice without error, as the migration test applies it.

set lock_timeout = '5s';

-- a. Follows ------------------------------------------------------------------------

create table if not exists community.card_follows (
  user_id uuid not null references community.profiles (user_id) on delete cascade,
  card_id uuid not null references public.cards (id),
  state text not null default 'open' constraint card_follows_state_check
    check (state in ('open', 'sending', 'sent', 'covered', 'no_address', 'failed')),
  provider_id text check (provider_id is null or char_length(provider_id) <= 200),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  settled_at timestamptz,
  primary key (user_id, card_id)
);
create index if not exists card_follows_open_idx on community.card_follows (card_id, created_at) where state = 'open';
create index if not exists card_follows_user_idx on community.card_follows (user_id, created_at desc);

-- b. The unsubscribe secret ------------------------------------------------------------

create table if not exists community.follow_settings (
  id smallint primary key default 1 check (id = 1),
  unsubscribe_secret bytea not null default sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8'))
    check (length(unsubscribe_secret) = 32)
);
insert into community.follow_settings (id) values (1) on conflict (id) do nothing;

-- Row level security on, no policy and no grant, as every community table: only the definer
-- functions below read or write them.
alter table community.card_follows enable row level security;
alter table community.follow_settings enable row level security;
revoke all on community.card_follows, community.follow_settings from public, anon, authenticated, service_role;

-- The backup role reads the community schema as it reads public (20261017100000_community_core.sql).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'peanutgallery_backup') then
    grant select on community.card_follows, community.follow_settings to peanutgallery_backup;
  end if;
end
$$;

insert into community.flags (key, value) values ('follows_open', 'true'::jsonb) on conflict (key) do nothing;

-- The unsubscribe token for a profile: no role may call it; the functions below do.
create or replace function community.follow_token(p_user uuid) returns text
language sql
stable
security definer
set search_path = community, public
as $$
  select encode(sha256(s.unsubscribe_secret || uuid_send(p_user)), 'hex') from community.follow_settings s where s.id = 1
$$;

-- The sha256 of an account's lowercased sign-in email, as community-core hashes it into
-- profiles.email_hash and Stripe receipts are hashed into contributor_id; null with no email.
create or replace function community.account_email_hash(p_user uuid) returns text
language sql
stable
security definer
set search_path = community, public
as $$
  select case when coalesce(btrim(u.email), '') = '' then null
    else encode(sha256(convert_to(lower(btrim(u.email)), 'UTF8')), 'hex') end
  from auth.users u where u.id = p_user
$$;

-- One follow as the player sees it.
create or replace function community.follow_json(p_user uuid, p_card uuid) returns jsonb
language sql
stable
security definer
set search_path = community, public
as $$
  select jsonb_build_object(
    'cardId', c.id, 'title', c.title, 'stage', c.stage, 'suit', coalesce(c.suit, 'game'), 'rarity', coalesce(c.rarity, 'common'),
    'state', f.state, 'followedAt', f.created_at, 'liveAt', c.live_at
  )
  from community.card_follows f join public.cards c on c.id = f.card_id
  where f.user_id = p_user and f.card_id = p_card
$$;

-- c. The player RPCs -------------------------------------------------------------------

-- Follows a card for the signed-in player, so the studio emails them once when it ships. Following
-- a card already followed answers that follow again and changes nothing.
create or replace function public.follow_card(card_id uuid) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_uid uuid := community.require_player();
  v_card public.cards;
begin
  if not community.flag_on('follows_open') then raise exception 'Following cards is closed for now'; end if;
  select * into v_card from public.cards c where c.id = follow_card.card_id;
  if not found or not public.card_is_public(v_card.id) then raise exception 'There is no card to follow at that address'; end if;
  if exists (select 1 from community.card_follows f where f.user_id = v_uid and f.card_id = v_card.id) then
    return community.follow_json(v_uid, v_card.id) || jsonb_build_object('following', true);
  end if;
  if v_card.stage = 'live' then raise exception 'That card has already shipped'; end if;
  if v_card.stage = 'rejected' then raise exception 'That card will not be built'; end if;
  if (select count(*) from community.card_follows f where f.user_id = v_uid and f.state = 'open') >= 100 then
    raise exception 'You can follow 100 cards at a time';
  end if;
  if (select count(*) from community.card_follows f where f.user_id = v_uid and f.created_at > now() - interval '1 day') >= 50 then
    raise exception 'You can follow 50 cards a day';
  end if;
  insert into community.card_follows (user_id, card_id) values (v_uid, v_card.id) on conflict do nothing;
  return community.follow_json(v_uid, v_card.id) || jsonb_build_object('following', true);
end;
$$;

-- Ends the signed-in player's follow of a card, whatever its state; a card not followed is a no-op.
create or replace function public.unfollow_card(card_id uuid) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_uid uuid := community.require_player();
begin
  delete from community.card_follows f where f.user_id = v_uid and f.card_id = unfollow_card.card_id;
  return jsonb_build_object('cardId', unfollow_card.card_id, 'following', false);
end;
$$;

-- The signed-in player's follows, newest first, at most 200, public cards only; with how many are
-- open and the cap.
create or replace function public.my_follows() returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_uid uuid := community.require_player();
begin
  return jsonb_build_object(
    'follows', coalesce((
      select jsonb_agg(community.follow_json(v_uid, x.card_id) order by x.created_at desc, x.card_id)
      from (
        select f.card_id, f.created_at from community.card_follows f
        where f.user_id = v_uid and public.card_is_public(f.card_id)
        order by f.created_at desc, f.card_id
        limit 200
      ) x), '[]'::jsonb),
    'open', (select count(*) from community.card_follows f where f.user_id = v_uid and f.state = 'open'),
    'cap', 100
  );
end;
$$;

-- d. The job's functions ---------------------------------------------------------------

-- Each open follow whose public card went live at or after the follow was made, for a profile that
-- is not suspended, with the card's title, folder and studio spend and the profile's unsubscribe
-- token. A follow waits while a ship notice is still due to a payment made with the profile's
-- sign-in email for the same card (the payers go first); covered is true once such a notice was
-- claimed or sent, and the job then settles the follow without a second email.
create or replace function public.follow_notices_due(p_limit integer default 50)
returns table (
  user_id uuid,
  card_id uuid,
  card_title text,
  card_folder text,
  live_at timestamptz,
  cost_usd numeric,
  unsubscribe_token text,
  covered boolean
)
language sql
stable
security definer
set search_path = community, public
as $$
  with due as (
    select f.user_id as follower, f.card_id as card, f.created_at as followed_at, c.title, c.folder::text as folder,
      c.live_at as shipped_at, community.account_email_hash(f.user_id) as email_hash
    from community.card_follows f
    join community.profiles p on p.user_id = f.user_id
    join public.cards c on c.id = f.card_id
    where f.state = 'open'
      and not p.suspended
      and c.stage = 'live'
      and c.live_at is not null
      and c.live_at >= f.created_at
      and public.card_is_public(c.id)
  ),
  pending as (
    select distinct n.card_id as card, x.contributor_id
    from public.ship_notices_due(1000000) n
    join public.contributions x on x.id = n.payment_id
    where n.card_id in (select d.card from due d)
  )
  select d.follower, d.card, d.title, d.folder, d.shipped_at, money.card_studio_spend(d.card), community.follow_token(d.follower),
    d.email_hash is not null and exists (
      select 1 from public.ship_notices n join public.contributions x on x.id = n.payment_id
      where n.card_id = d.card and n.status in ('sending', 'sent') and x.contributor_id = d.email_hash
    )
  from due d
  where d.email_hash is null
    or not exists (select 1 from pending q where q.card = d.card and q.contributor_id = d.email_hash)
  order by d.shipped_at, d.card, d.followed_at, d.follower
  limit greatest(coalesce(p_limit, 50), 0)
$$;

-- Claims one open follow before the send: true when this call moved it to sending, false when it was
-- not open (claimed by another run, settled, or unfollowed), so the caller sends only on true.
create or replace function public.follow_notice_claim(p_user uuid, p_card uuid) returns boolean
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_rows integer;
begin
  update community.card_follows
  set state = 'sending', claimed_at = now()
  where user_id = p_user and card_id = p_card and state = 'open';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Settles a claimed follow: sent (with Resend's id), failed, no_address or covered. Only a row still
-- at sending moves, so a settle never rewrites a finished follow.
create or replace function public.follow_notice_settle(p_user uuid, p_card uuid, p_status text, p_provider_id text default null)
returns boolean
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_rows integer;
begin
  if p_status is null or p_status not in ('sent', 'failed', 'no_address', 'covered') then
    raise exception 'follow_notice_settle: status % is not sent, failed, no_address or covered', p_status;
  end if;
  update community.card_follows
  set state = p_status, provider_id = left(nullif(p_provider_id, ''), 200), settled_at = now()
  where user_id = p_user and card_id = p_card and state = 'sending';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Follows claimed before p_before and never settled: a send whose answer was lost. Ids only.
create or replace function public.follow_notices_stuck(p_before timestamptz)
returns table (user_id uuid, card_id uuid)
language sql
stable
security definer
set search_path = community, public
as $$
  select f.user_id, f.card_id from community.card_follows f
  where f.state = 'sending' and f.claimed_at < p_before
  order by f.claimed_at, f.user_id, f.card_id
  limit 100
$$;

-- e. The unsubscribe -------------------------------------------------------------------

-- The link in a follow email names the profile and carries its token; with a matching token every
-- follow of that profile ends, so no follow email goes to it again until the player follows a card
-- again. True when the token matches a profile (a second call is a no-op that still answers true);
-- false for anything else, with nothing changed.
create or replace function public.follow_unsubscribe(p_user uuid, p_token text) returns boolean
language plpgsql
security definer
set search_path = community, public
as $$
begin
  if p_user is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  if p_token <> community.follow_token(p_user) then
    return false;
  end if;
  if not exists (select 1 from community.profiles p where p.user_id = p_user) then
    return false;
  end if;
  delete from community.card_follows f where f.user_id = p_user;
  return true;
end;
$$;

-- Grants ---------------------------------------------------------------------------------

do $$
declare
  f text;
begin
  -- Nothing in community is callable from outside but through the public functions.
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'community' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end
$$;

revoke all on function public.follow_card(uuid) from public, anon, service_role;
revoke all on function public.unfollow_card(uuid) from public, anon, service_role;
revoke all on function public.my_follows() from public, anon, service_role;
grant execute on function public.follow_card(uuid) to authenticated;
grant execute on function public.unfollow_card(uuid) to authenticated;
grant execute on function public.my_follows() to authenticated;

revoke all on function public.follow_notices_due(integer) from public, anon, authenticated;
revoke all on function public.follow_notice_claim(uuid, uuid) from public, anon, authenticated;
revoke all on function public.follow_notice_settle(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.follow_notices_stuck(timestamptz) from public, anon, authenticated;
grant execute on function public.follow_notices_due(integer) to service_role;
grant execute on function public.follow_notice_claim(uuid, uuid) to service_role;
grant execute on function public.follow_notice_settle(uuid, uuid, text, text) to service_role;
grant execute on function public.follow_notices_stuck(timestamptz) to service_role;

revoke all on function public.follow_unsubscribe(uuid, text) from public;
grant execute on function public.follow_unsubscribe(uuid, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
