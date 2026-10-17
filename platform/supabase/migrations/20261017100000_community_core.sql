-- Community core (docs/specs/community-core.md, docs/specs/final-state.md): profiles, claims, XP,
-- badges, card suits and rarity, suggestions (quarantined), seeds, goals, studio eras, the public
-- feed, flags and the moderation log, with the player RPCs and the public documents the site's
-- /api/community/* function serves.
--
-- a. Schema community. Nothing in it is granted to anon, authenticated or service_role: every
--    read and write goes through a security-definer function below (or the admin and Scout
--    functions in 20261017100200_community_admin.sql). Row level security is on for every table
--    as a second wall. The backup role reads it as it reads public.
-- b. The content filter: community.clean_text strips links, code fences and markup;
--    community.text_allowed refuses any one-to-four token phrase whose sha256 is a deny-list term
--    (platform/gate/denylist, normalized as platform/gate/lib/banned-scan.awk does; the digests are
--    20261017100100_community_digests.sql).
-- b2. Player sign-in: restrict_auth_users_to_board admits any email while the profiles_open flag
--    is on; board_members alone still decides who reaches a board function.
-- c. Rarity and XP: community.card_rarity(text) is the SQL twin of platform/site/src/lib/rarity.ts,
--    xp_for_level, level_for, tier_for and contribution_xp the twins of xp.ts. XP is not money.
-- d. cards.suit and cards.rarity: rarity from card_rarity(id) when a card is inserted, suit from
--    its folder (seed-1 game, platform platform). The Machine card is not a row: it is how the
--    feed and the collection show a payment that names no card (the general pool, which funds
--    the next card in line). No money path changes.
-- e. Tables: profiles, contribution_claims, xp_events (append-only), badges and badge_awards,
--    suggestions (quarantined), suggestion_triage, suggestion_clusters, suggestion_votes, seeds,
--    seed_votes, goals, studio_eras, events (append-only), flags, admin_log (append-only).
-- f. Triggers that write the feed: a card opening (with its rarity), a stage change, a ship, a
--    payment (its supporter named only when they made it public), a badge, a milestone and an era.
--    A feed failure never blocks a payment or a card: each trigger body catches its own error.
-- g. The player RPCs (community-types.ts): my_profile, update_profile, claim_contributions,
--    set_contribution_public, submit_suggestion, vote_suggestion, save_seed, vote_seed.
-- h. The public documents (anon): community_feed, community_goals, community_studio,
--    community_seeds, community_suggestions, community_profile. Keyset cursors throughout.
-- i. site_cards() gains suit and rarity on each card.
--
-- Every statement runs twice without error.

set lock_timeout = '5s';

-- a. Schema -----------------------------------------------------------------------

create schema if not exists community;
revoke all on schema community from public, anon, authenticated, service_role;

create sequence if not exists community.supporter_seq;

-- The signed-in player's user id, from the session's JWT.
create or replace function community.uid() returns uuid
language sql
stable
as $$
  select nullif(auth.jwt()->>'sub', '')::uuid
$$;

-- b. The content filter -----------------------------------------------------------

create table if not exists community.denied_digests (
  digest text primary key check (digest ~ '^[0-9a-f]{64}$')
);

-- Player text as the site may show it: no code fences, markup, links or control characters, white
-- space collapsed, cut to p_max characters.
create or replace function community.clean_text(p_text text, p_max integer) returns text
language plpgsql
immutable
as $$
declare
  s text := coalesce(p_text, '');
begin
  s := regexp_replace(s, '```.*?```', ' ', 'g');
  s := replace(s, '`', '');
  s := regexp_replace(s, '\[([^\]]*)\]\([^)]*\)', '\1', 'g');
  s := regexp_replace(s, '<[^>]*>', ' ', 'g');
  s := regexp_replace(s, '[a-zA-Z][a-zA-Z0-9+.-]*://[^[:space:]]*', ' ', 'g');
  s := regexp_replace(s, 'www\.[^[:space:]]+', ' ', 'g');
  s := regexp_replace(s, '[<>{}]', '', 'g');
  s := regexp_replace(s, '[[:cntrl:]]', ' ', 'g');
  s := btrim(regexp_replace(s, '[[:space:]]+', ' ', 'g'));
  return left(s, greatest(p_max, 0));
end;
$$;

-- The tokens banned-scan.awk compares: lowercase; a run of three or more single characters with
-- one separator between them joined; split on anything outside [a-z0-9@$]; a trailing $ dropped;
-- the leet map on tokens that hold a letter.
create or replace function community.normalize_tokens(p_text text) returns text[]
language plpgsql
immutable
as $$
declare
  s text := lower(coalesce(p_text, ''));
  m text[];
  run text;
  at integer;
  tries integer := 0;
  raw text[];
  t text;
  out text[] := '{}';
begin
  loop
    m := regexp_match(s, '(^|[^a-z0-9@$])([a-z0-9@$](?:[-_ .*+][a-z0-9@$]){2,})([^a-z0-9@$]|$)');
    exit when m is null or tries > 50;
    tries := tries + 1;
    run := m[2];
    at := strpos(s, run);
    exit when at = 0;
    s := overlay(s placing regexp_replace(run, '[-_ .*+]', '', 'g') from at for length(run));
  end loop;
  raw := string_to_array(btrim(regexp_replace(s, '[^a-z0-9@$]+', ' ', 'g')), ' ');
  foreach t in array coalesce(raw, '{}') loop
    continue when t = '';
    if t ~ '[a-z0-9@][$]$' then t := left(t, length(t) - 1); end if;
    if t ~ '[a-z@$]' then t := translate(t, '013457@$', 'oieastas'); end if;
    out := out || t;
  end loop;
  return out;
end;
$$;

-- False when any phrase of one to four tokens is a deny-list term.
create or replace function community.text_allowed(p_text text) returns boolean
language plpgsql
stable
security definer
set search_path = community, public
as $$
declare
  toks text[] := community.normalize_tokens(p_text);
  n integer := coalesce(array_length(toks, 1), 0);
  i integer;
  k integer;
begin
  for i in 1 .. n loop
    for k in 0 .. 3 loop
      exit when i + k > n;
      if exists (
        select 1 from community.denied_digests
        where digest = encode(sha256(convert_to(array_to_string(toks[i:i + k], ' '), 'UTF8')), 'hex')
      ) then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

-- c. Rarity and XP -----------------------------------------------------------------

-- rarity.ts: u = the first four bytes of sha256(utf8(id)) over 2^32; the same float8 sums.
create or replace function community.card_rarity(p_id text) returns text
language sql
immutable
as $$
  with u as (
    select (('x' || lpad(substr(encode(sha256(convert_to(p_id, 'UTF8')), 'hex'), 1, 8), 16, '0'))::bit(64)::bigint)::float8
      / 4294967296::float8 as u
  )
  select case
    when u < 0.02::float8 then 'legendary'
    when u < 0.02::float8 + 0.08::float8 then 'rare'
    when u < 0.02::float8 + 0.08::float8 + 0.2::float8 then 'uncommon'
    else 'common'
  end
  from u
$$;

create or replace function community.rarity_multiplier(p_rarity text) returns float8
language sql
immutable
as $$
  select case p_rarity when 'uncommon' then 1.5 when 'rare' then 2 when 'legendary' then 3 else 1 end::float8
$$;

-- xp.ts contributionXp: floor((cents / 100) * 10 * multiplier), in float8 as JavaScript does it.
create or replace function community.contribution_xp(p_cents bigint, p_rarity text) returns integer
language sql
immutable
as $$
  select floor((p_cents::float8 / 100::float8) * 10::float8 * community.rarity_multiplier(p_rarity))::integer
$$;

-- xp.ts xpForLevel: round(100 * (n - 1)^1.5); level 1 needs 0.
create or replace function community.xp_for_level(p_level integer) returns integer
language sql
immutable
as $$
  select case when p_level <= 1 then 0 else round(100::float8 * power((p_level - 1)::float8, 1.5::float8))::integer end
$$;

create or replace function community.level_for(p_xp bigint) returns integer
language plpgsql
immutable
as $$
declare
  n integer := 1;
begin
  while n < 10000 and community.xp_for_level(n + 1) <= coalesce(p_xp, 0) loop
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function community.tier_for(p_level integer) returns text
language sql
immutable
as $$
  select (array['Spectator', 'Regular', 'Backer', 'Patron', 'Producer', 'Executive', 'Legend'])[
    least(7, greatest(1, floor((greatest(p_level, 1) - 1) / 10.0)::integer + 1))
  ]
$$;

-- d. Card suits and rarity ------------------------------------------------------------

alter table public.cards add column if not exists suit text;
alter table public.cards add column if not exists rarity text;
alter table public.cards drop constraint if exists cards_suit_check;
alter table public.cards add constraint cards_suit_check
  check (suit is null or suit in ('game', 'new_game', 'studio', 'platform', 'machine'));
alter table public.cards drop constraint if exists cards_rarity_check;
alter table public.cards add constraint cards_rarity_check
  check (rarity is null or rarity in ('common', 'uncommon', 'rare', 'legendary'));

create or replace function community.default_suit(p_folder text) returns text
language sql
immutable
as $$
  select case p_folder when 'platform' then 'platform' else 'game' end
$$;

create or replace function community.cards_face() returns trigger
language plpgsql
security definer
set search_path = community, public
as $$
begin
  if new.rarity is null then new.rarity := community.card_rarity(new.id::text); end if;
  if new.suit is null then new.suit := community.default_suit(new.folder::text); end if;
  return new;
end;
$$;

drop trigger if exists cards_community_face on public.cards;
create trigger cards_community_face before insert on public.cards
  for each row execute function community.cards_face();

do $$
begin
  if exists (select 1 from public.cards where rarity is null or suit is null) then
    alter table public.cards disable trigger cards_set_updated_at;
    perform set_config('community.quiet', 'on', true);
    update public.cards
    set rarity = coalesce(rarity, community.card_rarity(id::text)),
        suit = coalesce(suit, community.default_suit(folder::text))
    where rarity is null or suit is null;
    alter table public.cards enable trigger cards_set_updated_at;
  end if;
end
$$;

-- The cards column grant: board-work's list with suit and rarity.
revoke all on public.cards from anon, authenticated;
grant select (
  id, bucket, source, shape, lane, board_reason, folder, executor_role_id,
  title, summary, intent, acceptance_test, design_spec_url,
  funding_target_usd, funded_usd, estimate_usd, confidence, proposer_role_id,
  director_stance, veto_reason, stage, branch, commit_sha, failing_check,
  created_at, updated_at, live_at, horizon, rank,
  drafter_role_id, check_author_role_id, opens_at, board_vetoed, board_veto_reason,
  board_work, suit, rarity
) on public.cards to anon, authenticated;

-- e. Tables ------------------------------------------------------------------------------

create table if not exists community.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9-]{3,24}$'),
  display_name text not null check (char_length(display_name) between 2 and 32),
  avatar jsonb not null default '{"body":"round","eyes":"two","antennae":"none","pattern":"plain","fill":"mint"}'::jsonb,
  frame text check (frame is null or frame ~ '^[a-z_]{2,20}$'),
  flair text check (flair is null or char_length(flair) <= 24),
  public_by_default boolean not null default true,
  suspended boolean not null default false,
  -- sha256 of the account's lowercased email: the contributor_id a Stripe receipt to that address
  -- carries, so a claim matches on the server and never reads another payer's row.
  email_hash text check (email_hash is null or email_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_email_hash_idx on community.profiles (email_hash);
create index if not exists profiles_created_idx on community.profiles (created_at desc, user_id desc);

create table if not exists community.contribution_claims (
  contribution_id uuid primary key references public.contributions (id),
  user_id uuid not null references community.profiles (user_id) on delete cascade,
  public boolean not null default false,
  claimed_at timestamptz not null default now()
);
create index if not exists contribution_claims_user_idx on community.contribution_claims (user_id, claimed_at desc);

create table if not exists community.xp_events (
  id bigserial primary key,
  user_id uuid not null references community.profiles (user_id) on delete cascade,
  kind text not null check (kind in ('funding', 'suggestion_accepted', 'suggestion_shipped', 'seed_featured', 'upvote')),
  amount integer not null check (amount >= 0),
  multiplier numeric(4,2) not null default 1 check (multiplier > 0),
  source text not null,
  created_at timestamptz not null default now(),
  unique (user_id, kind, source)
);
create index if not exists xp_events_user_idx on community.xp_events (user_id, created_at desc);

create table if not exists community.badges (
  id text primary key check (id ~ '^[a-z0-9_]+$'),
  name text not null,
  rule text not null,
  glyph text not null,
  sort integer not null default 0
);

create table if not exists community.badge_awards (
  user_id uuid not null references community.profiles (user_id) on delete cascade,
  badge_id text not null references community.badges (id),
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

-- Quarantined: player free text. No role the agents or the dispatcher use may select it.
create table if not exists community.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references community.profiles (user_id) on delete cascade,
  area text not null check (area in ('dust', 'new_game', 'studio', 'site')),
  title text not null check (char_length(title) between 3 and 80),
  body text not null default '' check (char_length(body) <= 500),
  state text not null default 'received'
    check (state in ('received', 'reviewed', 'clustered', 'drafted', 'open', 'building', 'live', 'declined')),
  decline_reason text check (decline_reason is null or decline_reason in
    ('duplicate', 'off_pillar', 'not_all_ages', 'instruction_to_agents', 'too_large', 'already_planned', 'not_feasible')),
  held boolean not null default false,
  cluster_id uuid,
  votes integer not null default 0 check (votes >= 0),
  scout_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint suggestions_declined_check check ((state = 'declined') = (decline_reason is not null))
);
create index if not exists suggestions_new_idx on community.suggestions (created_at desc, id desc);
create index if not exists suggestions_top_idx on community.suggestions (votes desc, created_at desc, id desc);
create index if not exists suggestions_user_idx on community.suggestions (user_id, created_at desc);
create index if not exists suggestions_queue_idx on community.suggestions (created_at) where state = 'received';
create index if not exists suggestions_cluster_idx on community.suggestions (cluster_id);

create table if not exists community.suggestion_clusters (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9-]{3,48}$'),
  area text not null check (area in ('dust', 'new_game', 'studio', 'site')),
  kind text not null check (kind in ('bug', 'feature', 'content', 'balance')),
  summary text not null check (char_length(summary) between 1 and 140),
  fit numeric(4,3) not null check (fit between 0 and 1),
  card_id uuid references public.cards (id),
  merged_into uuid references community.suggestion_clusters (id),
  created_at timestamptz not null default now()
);
create index if not exists suggestion_clusters_card_idx on community.suggestion_clusters (card_id);

-- The Scout's structured output, one row per suggestion. Its summary is the Scout's own words,
-- never the player's, and it is null when the suggestion was flagged as an instruction to agents.
create table if not exists community.suggestion_triage (
  suggestion_id uuid primary key references community.suggestions (id) on delete cascade,
  area text not null check (area in ('dust', 'new_game', 'studio', 'site')),
  kind text not null check (kind in ('bug', 'feature', 'content', 'balance')),
  cluster_key text not null check (cluster_key ~ '^[a-z0-9-]{3,48}$'),
  fit numeric(4,3) not null check (fit between 0 and 1),
  flags text[] not null default '{}'
    check (flags <@ array['instruction_to_agents', 'not_all_ages', 'personal_data', 'spam', 'off_topic', 'money_or_secrets']),
  summary text check (summary is null or char_length(summary) between 1 and 140),
  job_run_id uuid,
  created_at timestamptz not null default now(),
  constraint suggestion_triage_instruction_check check (not ('instruction_to_agents' = any (flags)) or summary is null)
);

create table if not exists community.suggestion_votes (
  suggestion_id uuid not null references community.suggestions (id) on delete cascade,
  user_id uuid not null references community.profiles (user_id) on delete cascade,
  value smallint not null default 1 check (value = 1),
  created_at timestamptz not null default now(),
  primary key (suggestion_id, user_id)
);
create index if not exists suggestion_votes_user_idx on community.suggestion_votes (user_id, created_at desc);

create table if not exists community.seeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references community.profiles (user_id) on delete cascade,
  game text not null check (game ~ '^[a-z0-9-]{2,20}$'),
  code text not null check (char_length(code) <= 2000),
  title text check (title is null or char_length(title) between 1 and 60),
  published boolean not null default false,
  unpublished boolean not null default false,
  featured boolean not null default false,
  up integer not null default 0 check (up >= 0),
  down integer not null default 0 check (down >= 0),
  created_at timestamptz not null default now(),
  constraint seeds_published_title_check check (not published or title is not null)
);
create index if not exists seeds_new_idx on community.seeds (created_at desc, id desc) where published and not unpublished;
create index if not exists seeds_top_idx on community.seeds ((up - down) desc, id desc) where published and not unpublished;
create index if not exists seeds_user_idx on community.seeds (user_id, created_at desc);

create table if not exists community.seed_votes (
  seed_id uuid not null references community.seeds (id) on delete cascade,
  user_id uuid not null references community.profiles (user_id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (seed_id, user_id)
);
create index if not exists seed_votes_user_idx on community.seed_votes (user_id, created_at desc);

create table if not exists community.goals (
  id uuid primary key default gen_random_uuid(),
  amount_cents bigint not null check (amount_cents > 0),
  title text not null check (char_length(title) between 1 and 80),
  outcome text not null check (char_length(outcome) between 1 and 280),
  link text check (link is null or link ~ '^(/|https://)[^[:space:]]{0,255}$'),
  reached_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists goals_amount_idx on community.goals (amount_cents, id);

create table if not exists community.studio_eras (
  id text primary key check (id ~ '^[a-z_]+$'),
  idx integer not null unique check (idx >= 0),
  name text not null,
  unlocked_by text not null,
  unlock_cents bigint check (unlock_cents is null or unlock_cents > 0),
  goal_id uuid references community.goals (id),
  stations text[] not null default '{}',
  decor text[] not null default '{}',
  reached_at timestamptz
);

-- The public feed: append-only. text is composed here from fixed templates; {actor} is filled at
-- read time with the supporter's public name or "Anonymous supporter", so a supporter who later
-- makes a payment anonymous is never named again.
create table if not exists community.events (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('contribution', 'card_opened', 'stage', 'shipped', 'suggestion', 'badge', 'milestone', 'seed_featured', 'era')),
  text text not null check (char_length(text) between 1 and 300),
  card_id uuid,
  role text,
  actor_user uuid,
  contribution_id uuid,
  rarity text check (rarity is null or rarity in ('common', 'uncommon', 'rare', 'legendary')),
  suit text check (suit is null or suit in ('game', 'new_game', 'studio', 'platform', 'machine')),
  amount_cents bigint,
  dedupe text unique
);
create index if not exists events_card_idx on community.events (card_id, id desc);

create table if not exists community.flags (
  key text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists community.admin_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_email text not null,
  action text not null,
  target text,
  reason text not null check (char_length(reason) between 1 and 500),
  details jsonb not null default '{}'::jsonb
);

-- Append-only: no update or delete on the feed, the XP record or the moderation log.
create or replace function community.append_only() returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

drop trigger if exists events_append_only on community.events;
create trigger events_append_only before update or delete on community.events
  for each row execute function community.append_only();
drop trigger if exists xp_events_append_only on community.xp_events;
create trigger xp_events_append_only before update or delete on community.xp_events
  for each row execute function community.append_only();
drop trigger if exists admin_log_append_only on community.admin_log;
create trigger admin_log_append_only before update or delete on community.admin_log
  for each row execute function community.append_only();

-- Row level security on, no policy and no grant: only the definer functions read or write.
do $$
declare
  t text;
begin
  foreach t in array array['denied_digests', 'profiles', 'contribution_claims', 'xp_events', 'badges', 'badge_awards',
    'suggestions', 'suggestion_clusters', 'suggestion_triage', 'suggestion_votes', 'seeds', 'seed_votes', 'goals',
    'studio_eras', 'events', 'flags', 'admin_log'] loop
    execute format('alter table community.%I enable row level security', t);
    execute format('revoke all on community.%I from public, anon, authenticated, service_role', t);
  end loop;
end
$$;
revoke all on all sequences in schema community from public, anon, authenticated, service_role;

-- The backup role reads the community schema as it reads public: it is a read-only login for the
-- nightly dump, not an agent, and runs no model.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'peanutgallery_backup') then
    grant usage on schema community to peanutgallery_backup;
    grant select on all tables in schema community to peanutgallery_backup;
  end if;
end
$$;

-- Seed rows: badges (platform/supabase/seed/badges.json), eras and flags.
insert into community.badges (id, name, rule, glyph, sort) values
  ('first_card', 'First card', 'Fund any card, the Machine included.', 'card', 1),
  ('five_suits', 'Full hand', 'Fund a card of each of the five suits.', 'hand', 2),
  ('first_rare', 'Rare find', 'Fund a rare card.', 'gem', 3),
  ('first_legendary', 'Legend spotted', 'Fund a legendary card.', 'crown', 4),
  ('card_shipped', 'It shipped', 'A card you funded ships.', 'box', 5),
  ('first_suggestion', 'Idea box', 'Send your first suggestion.', 'plane', 6),
  ('suggestion_shipped', 'Ideas made real', 'A suggestion of yours ships.', 'bulb', 7),
  ('first_seed', 'Planted', 'Publish your first seed to the gallery.', 'sprout', 8),
  ('ten_seeds', 'Gardener', 'Publish ten seeds to the gallery.', 'tree', 9),
  ('seed_featured', 'Featured', 'A seed of yours is featured.', 'star', 10),
  ('level_11', 'Regular', 'Reach level 11.', 'badge', 11),
  ('level_31', 'Patron', 'Reach level 31.', 'medal', 12)
on conflict (id) do update set name = excluded.name, rule = excluded.rule, glyph = excluded.glyph, sort = excluded.sort;

insert into community.studio_eras (id, idx, name, unlocked_by, unlock_cents, stations, decor, reached_at) values
  ('garage', 0, 'Garage', 'Where the studio starts.', null,
    array['desks', 'whiteboard', 'test_bench', 'gate', 'shipping_dock'], array[]::text[], now()),
  ('workshop', 1, 'Workshop', 'Reached when the studio has raised $1,000 in all.', 100000,
    array['desks', 'whiteboard', 'test_bench', 'gate', 'shipping_dock', 'art_corner'], array['trophy_shelf'], null),
  ('studio', 2, 'Studio', 'Reached when the studio has raised $10,000 in all.', 1000000,
    array['desks', 'whiteboard', 'test_bench', 'gate', 'shipping_dock', 'art_corner', 'sound_booth', 'broadcast_desk'],
    array['trophy_shelf', 'legendary_wall'], null),
  ('campus', 3, 'Campus', 'Reached when the studio has raised $100,000 in all.', 10000000,
    array['desks', 'whiteboard', 'test_bench', 'gate', 'shipping_dock', 'art_corner', 'sound_booth', 'broadcast_desk', 'arcade', 'garden'],
    array['trophy_shelf', 'legendary_wall', 'statue'], null)
on conflict (id) do nothing;

insert into community.flags (key, value) values
  ('suggestions_open', 'true'::jsonb),
  ('seeds_open', 'true'::jsonb),
  ('profiles_open', 'true'::jsonb),
  ('scout_triage', 'false'::jsonb)
on conflict (key) do nothing;

-- Player sign-in: the week-1 restriction let only board emails into auth.users. Players now sign in
-- by magic link to keep a profile, while profiles_open is on. Membership of public.board_members
-- still alone decides who reaches any board function; a player account reaches none.
create or replace function public.restrict_auth_users_to_board() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.board_members where lower(email) = lower(new.email)) then
    return new;
  end if;
  if coalesce((select value = 'true'::jsonb from community.flags where key = 'profiles_open'), false) then
    return new;
  end if;
  raise exception 'Sign-in is limited to board accounts';
end;
$$;
revoke all on function public.restrict_auth_users_to_board() from public, anon, authenticated;
grant execute on function public.restrict_auth_users_to_board() to supabase_auth_admin;

-- Helpers ------------------------------------------------------------------------------------

create or replace function community.flag_on(p_key text) returns boolean
language sql
stable
security definer
set search_path = community, public
as $$
  select coalesce((select value = 'true'::jsonb from community.flags where key = p_key), false)
$$;

create or replace function community.money_text(p_cents bigint) returns text
language sql
immutable
as $$
  select '$' || to_char(p_cents / 100.0, 'FM999999990.00')
$$;

-- The card a payment names (its goal, else the card it asked for), or null for the Machine.
create or replace function community.payment_card(c public.contributions) returns uuid
language sql
immutable
as $$
  select coalesce(c.goal_card_id, c.requested_card_id)
$$;

create or replace function community.total_xp(p_user uuid) returns bigint
language sql
stable
security definer
set search_path = community, public
as $$
  select coalesce(sum(amount), 0)::bigint from community.xp_events where user_id = p_user
$$;

-- A player as the public sees them, or null when there is no such profile or it is suspended.
create or replace function community.person_json(p_user uuid) returns jsonb
language sql
stable
security definer
set search_path = community, public
as $$
  select jsonb_build_object(
    'handle', p.handle,
    'displayName', p.display_name,
    'level', community.level_for(community.total_xp(p.user_id)),
    'avatar', p.avatar,
    'frame', p.frame,
    'flair', p.flair
  )
  from community.profiles p
  where p.user_id = p_user and not p.suspended
$$;

create or replace function community.add_event(
  p_kind text, p_text text, p_dedupe text default null, p_card uuid default null, p_actor uuid default null,
  p_contribution uuid default null, p_rarity text default null, p_suit text default null, p_cents bigint default null,
  p_role text default null
) returns void
language plpgsql
security definer
set search_path = community, public
as $$
begin
  if coalesce(current_setting('community.quiet', true), '') = 'on' then return; end if;
  insert into community.events (kind, text, dedupe, card_id, actor_user, contribution_id, rarity, suit, amount_cents, role)
  values (p_kind, left(p_text, 300), p_dedupe, p_card, p_actor, p_contribution, p_rarity, p_suit, p_cents, p_role)
  on conflict (dedupe) do nothing;
end;
$$;

-- Ensures the signed-in player has a profile ("Supporter n" until they name themselves) and
-- returns their id. Refuses a signed-out caller and a suspended account.
create or replace function community.require_player() returns uuid
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_uid uuid := community.uid();
  v_email text;
  v_n bigint;
  v_suspended boolean;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  select suspended into v_suspended from community.profiles where user_id = v_uid;
  if not found then
    if not community.flag_on('profiles_open') then raise exception 'Profiles are closed for now'; end if;
    select lower(btrim(email)) into v_email from auth.users where id = v_uid;
    v_email := coalesce(v_email, lower(btrim(auth.email())));
    v_n := nextval('community.supporter_seq');
    insert into community.profiles (user_id, handle, display_name, email_hash)
    values (v_uid, 'supporter-' || v_n, 'Supporter ' || v_n,
      case when coalesce(v_email, '') = '' then null else encode(sha256(convert_to(v_email, 'UTF8')), 'hex') end)
    on conflict (user_id) do nothing;
    v_suspended := false;
  end if;
  if v_suspended then raise exception 'This account is suspended'; end if;
  return v_uid;
end;
$$;

-- XP: append one award, at most once per (player, kind, source). Participation kinds share a cap of
-- 100 a UTC day; funding and a shipped suggestion are not capped. Returns the XP awarded.
create or replace function community.award_xp(p_user uuid, p_kind text, p_amount integer, p_multiplier numeric, p_source text)
returns integer
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_amount integer := greatest(coalesce(p_amount, 0), 0);
  v_used integer;
  v_id bigint;
begin
  if p_kind in ('suggestion_accepted', 'seed_featured', 'upvote') then
    select coalesce(sum(amount), 0) into v_used from community.xp_events
    where user_id = p_user and kind in ('suggestion_accepted', 'seed_featured', 'upvote')
      and created_at >= ((now() at time zone 'utc')::date)::timestamp at time zone 'utc';
    v_amount := least(v_amount, greatest(100 - v_used, 0));
  end if;
  if v_amount = 0 then return 0; end if;
  insert into community.xp_events (user_id, kind, amount, multiplier, source)
  values (p_user, p_kind, v_amount, coalesce(p_multiplier, 1), p_source)
  on conflict (user_id, kind, source) do nothing
  returning id into v_id;
  if v_id is null then return 0; end if;
  perform community.award_badges(p_user);
  return v_amount;
end;
$$;

-- The player's claimed payments with the card each names (null for the Machine), its suit and rarity.
create or replace function community.claimed_cards(p_user uuid, p_public_only boolean)
returns table (contribution_id uuid, card_id uuid, suit text, rarity text, stage text, cents bigint, public boolean, at timestamptz)
language sql
stable
security definer
set search_path = community, public
as $$
  select k.contribution_id, c.id, coalesce(c.suit, 'machine'), coalesce(c.rarity, 'common'), c.stage::text,
    round(p.amount_usd * 100)::bigint, k.public, p.created_at
  from community.contribution_claims k
  join public.contributions p on p.id = k.contribution_id
  left join public.cards c on c.id = community.payment_card(p)
  where k.user_id = p_user and (not p_public_only or k.public)
$$;

-- Every badge whose rule now holds is awarded once, with a feed line.
create or replace function community.award_badges(p_user uuid) returns integer
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_level integer := community.level_for(community.total_xp(p_user));
  v_earned text[] := '{}';
  b record;
  v_new integer := 0;
begin
  if exists (select 1 from community.claimed_cards(p_user, false)) then v_earned := array_append(v_earned, 'first_card'); end if;
  if (select count(distinct suit) from community.claimed_cards(p_user, false)) >= 5 then v_earned := array_append(v_earned, 'five_suits'); end if;
  if exists (select 1 from community.claimed_cards(p_user, false) where rarity = 'rare') then v_earned := array_append(v_earned, 'first_rare'); end if;
  if exists (select 1 from community.claimed_cards(p_user, false) where rarity = 'legendary') then v_earned := array_append(v_earned, 'first_legendary'); end if;
  if exists (select 1 from community.claimed_cards(p_user, false) where stage = 'live') then v_earned := array_append(v_earned, 'card_shipped'); end if;
  if exists (select 1 from community.suggestions where user_id = p_user) then v_earned := array_append(v_earned, 'first_suggestion'); end if;
  if exists (select 1 from community.suggestions where user_id = p_user and state = 'live') then v_earned := array_append(v_earned, 'suggestion_shipped'); end if;
  if (select count(*) from community.seeds where user_id = p_user and published and not unpublished) >= 1 then v_earned := array_append(v_earned, 'first_seed'); end if;
  if (select count(*) from community.seeds where user_id = p_user and published and not unpublished) >= 10 then v_earned := array_append(v_earned, 'ten_seeds'); end if;
  if exists (select 1 from community.seeds where user_id = p_user and featured) then v_earned := array_append(v_earned, 'seed_featured'); end if;
  if v_level >= 11 then v_earned := array_append(v_earned, 'level_11'); end if;
  if v_level >= 31 then v_earned := array_append(v_earned, 'level_31'); end if;
  for b in
    insert into community.badge_awards (user_id, badge_id)
    select p_user, x from unnest(v_earned) x
    on conflict do nothing
    returning badge_id
  loop
    v_new := v_new + 1;
    perform community.add_event('badge', '{actor} earned the ' || (select name from community.badges where id = b.badge_id) || ' badge',
      'badge:' || p_user || ':' || b.badge_id, null, p_user);
  end loop;
  return v_new;
end;
$$;

-- A claim of one payment: funding XP at the card's rarity (the Machine at 1x), then badges.
create or replace function community.claim_payment(p_user uuid, p_contribution uuid, p_public boolean) returns boolean
language plpgsql
security definer
set search_path = community, public
as $$
declare
  p public.contributions;
  v_rarity text;
  v_cents bigint;
  v_claimed uuid;
begin
  select * into p from public.contributions where id = p_contribution and entry = 'payment';
  if not found then return false; end if;
  insert into community.contribution_claims (contribution_id, user_id, public)
  values (p_contribution, p_user, p_public)
  on conflict (contribution_id) do nothing
  returning contribution_id into v_claimed;
  if v_claimed is null then return false; end if;
  select coalesce(c.rarity, 'common') into v_rarity from public.cards c where c.id = community.payment_card(p);
  v_rarity := coalesce(v_rarity, 'common');
  v_cents := round(p.amount_usd * 100)::bigint;
  perform community.award_xp(p_user, 'funding', community.contribution_xp(v_cents, v_rarity),
    community.rarity_multiplier(v_rarity)::numeric, 'contribution:' || p_contribution);
  perform community.award_badges(p_user);
  return true;
end;
$$;

-- Lifetime funding: every payment, less what refunds and disputes took back.
create or replace function community.lifetime_cents() returns bigint
language sql
stable
security definer
set search_path = community, public
as $$
  select coalesce(round(sum(amount_usd) * 100), 0)::bigint from public.contributions where entry <> 'release'
$$;

-- Milestones reached and eras unlocked by the lifetime total, each posted once.
create or replace function community.check_milestones() returns void
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_total bigint := community.lifetime_cents();
  g record;
  e record;
begin
  for g in
    update community.goals set reached_at = now()
    where reached_at is null and amount_cents <= v_total
    returning id, title
  loop
    perform community.add_event('milestone', 'Milestone reached: ' || g.title, 'goal:' || g.id);
  end loop;
  for e in
    update community.studio_eras s set reached_at = now()
    where s.reached_at is null
      and ((s.unlock_cents is not null and s.unlock_cents <= v_total)
        or (s.goal_id is not null and exists (select 1 from community.goals x where x.id = s.goal_id and x.reached_at is not null)))
    returning id, name
  loop
    perform community.add_event('era', 'The studio grew into the ' || e.name, 'era:' || e.id);
  end loop;
end;
$$;

-- f. Triggers that write the feed ---------------------------------------------------------

create or replace function community.on_payment() returns trigger
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_card public.cards;
  v_owner uuid;
  v_public boolean;
  v_cents bigint := round(new.amount_usd * 100)::bigint;
  v_where text;
begin
  if new.entry <> 'payment' then
    begin
      perform community.check_milestones();
    exception when others then
      raise warning 'community milestones skipped: %', sqlerrm;
    end;
    return null;
  end if;
  begin
    -- A signed-in supporter whose account email is the receipt's: claimed at once, public as they chose.
    select user_id, public_by_default into v_owner, v_public
    from community.profiles where email_hash = new.contributor_id and not suspended
    order by created_at limit 1;
    if v_owner is not null then perform community.claim_payment(v_owner, new.id, v_public); end if;
    select * into v_card from public.cards where id = community.payment_card(new);
    v_where := case
      when v_card.id is null then 'into the Machine'
      when public.card_is_public(v_card.id) then 'on ' || v_card.title
      else 'on a card'
    end;
    perform community.add_event('contribution', '{actor} put ' || community.money_text(v_cents) || ' ' || v_where,
      'payment:' || new.id, v_card.id, null, new.id, coalesce(v_card.rarity, 'common'), coalesce(v_card.suit, 'machine'), v_cents);
    perform community.check_milestones();
  exception when others then
    raise warning 'community feed skipped payment %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists contributions_community_feed on public.contributions;
create trigger contributions_community_feed after insert on public.contributions
  for each row execute function community.on_payment();

create or replace function community.stage_word(p_stage text) returns text
language sql
immutable
as $$
  select case p_stage
    when 'funded' then 'funded'
    when 'building' then 'building'
    when 'gated' then 'at the gate'
    when 'live' then 'live'
    when 'paused' then 'paused'
    else p_stage end
$$;

-- What a cluster's suggestions show once its card moves: open, building, live.
create or replace function community.suggestion_state_for(p_stage text) returns text
language sql
immutable
as $$
  select case
    when p_stage in ('proposed', 'designing', 'voted', 'funded') then 'open'
    when p_stage in ('building', 'gated', 'paused') then 'building'
    when p_stage = 'live' then 'live'
    else null end
$$;

create or replace function community.on_card() returns trigger
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_public boolean;
  v_state text;
  s record;
  u record;
begin
  if coalesce(current_setting('community.quiet', true), '') = 'on' then return null; end if;
  begin
    v_public := public.card_is_public(new.id);
    if v_public and new.stage in ('proposed', 'designing', 'voted', 'funded') then
      perform community.add_event('card_opened',
        case when new.rarity in ('rare', 'legendary') then 'A ' || new.rarity || ' card appeared: ' || new.title
          else 'A new card opened: ' || new.title end,
        'opened:' || new.id, new.id, null, null, new.rarity, new.suit);
    end if;
    if tg_op = 'UPDATE' and old.stage is distinct from new.stage then
      if v_public and new.stage = 'live' then
        perform community.add_event('shipped', new.title || ' shipped', 'shipped:' || new.id, new.id, null, null, new.rarity, new.suit);
        -- Funders' badges, and 150 XP to each player whose suggestion became this card.
        for u in select distinct k.user_id from community.contribution_claims k
          join public.contributions p on p.id = k.contribution_id where community.payment_card(p) = new.id loop
          perform community.award_badges(u.user_id);
        end loop;
      elsif v_public and new.stage in ('funded', 'building', 'gated') then
        perform community.add_event('stage', new.title || ' is ' || community.stage_word(new.stage::text),
          'stage:' || new.id || ':' || new.stage, new.id, null, null, new.rarity, new.suit);
      end if;
      v_state := community.suggestion_state_for(new.stage::text);
      if v_state is not null then
        for s in
          update community.suggestions x set state = v_state
          from community.suggestion_clusters c
          where c.card_id = new.id and x.cluster_id = c.id and x.state <> 'declined'
          returning x.id, x.user_id
        loop
          if v_state = 'live' then
            perform community.award_xp(s.user_id, 'suggestion_shipped', 150, 1, 'suggestion:' || s.id);
            perform community.award_badges(s.user_id);
          end if;
        end loop;
      end if;
    end if;
  exception when others then
    raise warning 'community feed skipped card %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists cards_community_feed on public.cards;
create trigger cards_community_feed after insert or update on public.cards
  for each row execute function community.on_card();

-- g. The player RPCs ------------------------------------------------------------------------

create or replace function community.profile_doc(p_user uuid, p_self boolean) returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
declare
  p community.profiles;
  v_xp bigint;
  v_level integer;
  v_doc jsonb;
begin
  select * into p from community.profiles where user_id = p_user;
  if not found then return null; end if;
  v_xp := community.total_xp(p_user);
  v_level := community.level_for(v_xp);
  v_doc := jsonb_build_object(
    'handle', p.handle,
    'displayName', p.display_name,
    'level', v_level,
    'avatar', p.avatar,
    'frame', p.frame,
    'flair', p.flair,
    'xp', v_xp,
    'tier', community.tier_for(v_level),
    'nextLevelXp', community.xp_for_level(v_level + 1),
    'joinedAt', p.created_at,
    'badges', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'rule', b.rule, 'glyph', b.glyph, 'awardedAt', a.awarded_at)
        order by a.awarded_at, b.sort)
      from community.badge_awards a join community.badges b on b.id = a.badge_id where a.user_id = p_user), '[]'::jsonb),
    'collection', coalesce((
      select jsonb_agg(jsonb_build_object('cardId', coalesce(x.card_id::text, 'machine'), 'title', x.title, 'suit', x.suit,
        'rarity', x.rarity, 'cents', x.cents) order by x.cents desc, x.title)
      from (
        select k.card_id, coalesce(c.title, 'The Machine') as title, k.suit, k.rarity, sum(k.cents)::bigint as cents
        from community.claimed_cards(p_user, not p_self) k
        left join public.cards c on c.id = k.card_id
        where k.card_id is null or public.card_is_public(k.card_id)
        group by k.card_id, c.title, k.suit, k.rarity
      ) x), '[]'::jsonb),
    'seeds', coalesce((
      select jsonb_agg(community.seed_json(s) order by s.created_at desc)
      from community.seeds s where s.id in (select x.id from community.seeds x where x.user_id = p_user
        and (p_self or (x.published and not x.unpublished)) order by x.created_at desc limit 50)), '[]'::jsonb),
    'suggestions', coalesce((
      select jsonb_agg(community.suggestion_json(s) order by s.created_at desc)
      from community.suggestions s where s.id in (select x.id from community.suggestions x where x.user_id = p_user
        and (p_self or (not x.held and coalesce(x.decline_reason, '') not in ('instruction_to_agents', 'not_all_ages')))
        order by x.created_at desc limit 50)), '[]'::jsonb)
  );
  if p_self then
    v_doc := v_doc || jsonb_build_object(
      'publicByDefault', p.public_by_default,
      'frames', to_jsonb(community.unlocked_frames(p_user)),
      'contributions', coalesce((
        select jsonb_agg(jsonb_build_object('id', k.contribution_id, 'cardId', coalesce(k.card_id::text, 'machine'),
          'cents', k.cents, 'public', k.public, 'at', k.at) order by k.at desc)
        from community.claimed_cards(p_user, false) k), '[]'::jsonb));
  end if;
  return v_doc;
end;
$$;

-- Frames a player may wear: one per level tier reached, and one per rarity collected.
create or replace function community.unlocked_frames(p_user uuid) returns text[]
language sql
stable
security definer
set search_path = community, public
as $$
  select array(
    select lower(t) from unnest(array['Spectator', 'Regular', 'Backer', 'Patron', 'Producer', 'Executive', 'Legend']) with ordinality as x(t, n)
    where n <= least(7, floor((community.level_for(community.total_xp(p_user)) - 1) / 10.0)::integer + 1)
    union all
    select distinct rarity from community.claimed_cards(p_user, false)
  )
$$;

create or replace function community.seed_score(p_up integer, p_down integer, p_created timestamptz) returns float8
language sql
stable
as $$
  select (p_up - p_down)::float8 / power(greatest(extract(epoch from (now() - p_created)) / 3600.0, 0)::float8 + 2, 1.5::float8)
$$;

create or replace function community.seed_json(s community.seeds) returns jsonb
language sql
stable
security definer
set search_path = community, public
as $$
  select jsonb_build_object(
    'id', s.id, 'code', s.code, 'game', s.game, 'title', coalesce(s.title, ''),
    'author', community.person_json(s.user_id), 'up', s.up, 'down', s.down,
    'score', community.seed_score(s.up, s.down, s.created_at), 'createdAt', s.created_at, 'featured', s.featured
  )
$$;

create or replace function community.suggestion_json(s community.suggestions) returns jsonb
language sql
stable
security definer
set search_path = community, public
as $$
  select jsonb_build_object(
    'id', s.id, 'area', s.area, 'title', s.title,
    'summary', (select t.summary from community.suggestion_triage t where t.suggestion_id = s.id),
    'state', s.state, 'declineReason', s.decline_reason, 'upvotes', s.votes,
    'clusterId', s.cluster_id,
    'cardId', (select c.card_id from community.suggestion_clusters c where c.id = s.cluster_id),
    'author', community.person_json(s.user_id), 'createdAt', s.created_at
  )
$$;

create or replace function public.my_profile() returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_uid uuid;
begin
  v_uid := community.require_player();
  return community.profile_doc(v_uid, true);
end;
$$;

create or replace function public.update_profile(
  display_name text default null,
  avatar jsonb default null,
  frame text default null,
  flair text default null,
  public_by_default boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_uid uuid := community.require_player();
  v_name text;
  v_flair text;
  k text;
begin
  if display_name is not null then
    v_name := community.clean_text(display_name, 32);
    if char_length(v_name) < 2 then raise exception 'A display name needs 2 to 32 characters'; end if;
    if not community.text_allowed(v_name) then raise exception 'That name did not pass the content filter'; end if;
    update community.profiles set display_name = v_name, updated_at = now() where user_id = v_uid;
  end if;
  if avatar is not null then
    if jsonb_typeof(avatar) <> 'object'
      or (select array_agg(x order by x) from jsonb_object_keys(avatar) x) <> array['antennae', 'body', 'eyes', 'fill', 'pattern'] then
      raise exception 'An avatar names exactly body, eyes, antennae, pattern and fill';
    end if;
    foreach k in array array['antennae', 'body', 'eyes', 'fill', 'pattern'] loop
      if jsonb_typeof(avatar->k) <> 'string' or (avatar->>k) !~ '^[a-z0-9-]{1,20}$' then
        raise exception 'An avatar part is a short lowercase name';
      end if;
    end loop;
    update community.profiles set avatar = update_profile.avatar, updated_at = now() where user_id = v_uid;
  end if;
  if frame is not null then
    if frame = '' then
      update community.profiles set frame = null, updated_at = now() where user_id = v_uid;
    elsif not (frame = any (community.unlocked_frames(v_uid))) then
      raise exception 'That frame is not unlocked yet';
    else
      update community.profiles set frame = update_profile.frame, updated_at = now() where user_id = v_uid;
    end if;
  end if;
  if flair is not null then
    v_flair := community.clean_text(flair, 24);
    if v_flair <> '' and not community.text_allowed(v_flair) then raise exception 'That flair did not pass the content filter'; end if;
    update community.profiles set flair = nullif(v_flair, ''), updated_at = now() where user_id = v_uid;
  end if;
  if public_by_default is not null then
    update community.profiles set public_by_default = update_profile.public_by_default, updated_at = now() where user_id = v_uid;
  end if;
  return community.profile_doc(v_uid, true);
end;
$$;

-- Claims every unclaimed payment whose receipt email is the session's, matched on the server by
-- its hash. Claimed payments start anonymous; each can be made public with set_contribution_public.
create or replace function public.claim_contributions() returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_uid uuid := community.require_player();
  v_email text;
  v_hash text;
  v_n integer := 0;
  r record;
begin
  select lower(btrim(email)) into v_email from auth.users where id = v_uid;
  v_email := coalesce(nullif(v_email, ''), lower(btrim(auth.email())));
  if coalesce(v_email, '') = '' then return jsonb_build_object('claimed', 0); end if;
  v_hash := encode(sha256(convert_to(v_email, 'UTF8')), 'hex');
  update community.profiles set email_hash = v_hash where user_id = v_uid and email_hash is distinct from v_hash;
  for r in
    select p.id from public.contributions p
    where p.entry = 'payment' and p.contributor_id = v_hash
      and not exists (select 1 from community.contribution_claims k where k.contribution_id = p.id)
    order by p.created_at
  loop
    if community.claim_payment(v_uid, r.id, false) then v_n := v_n + 1; end if;
  end loop;
  return jsonb_build_object('claimed', v_n);
end;
$$;

create or replace function public.set_contribution_public(contribution_id uuid, make_public boolean) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_uid uuid := community.require_player();
begin
  update community.contribution_claims k set public = coalesce(make_public, false)
  where k.contribution_id = set_contribution_public.contribution_id and k.user_id = v_uid;
  if not found then raise exception 'That payment is not one of yours'; end if;
  return jsonb_build_object('public', coalesce(make_public, false));
end;
$$;

-- How many votes a player cast in the last day, both kinds together.
create or replace function community.votes_today(p_user uuid) returns integer
language sql
stable
security definer
set search_path = community, public
as $$
  select ((select count(*) from community.suggestion_votes where user_id = p_user and created_at > now() - interval '1 day')
    + (select count(*) from community.seed_votes where user_id = p_user and created_at > now() - interval '1 day'))::integer
$$;

create or replace function public.submit_suggestion(area text, title text, body text default '') returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_uid uuid := community.require_player();
  v_title text := community.clean_text(title, 80);
  v_body text := community.clean_text(body, 500);
  v_id uuid;
begin
  if not community.flag_on('suggestions_open') then raise exception 'Suggestions are closed for now'; end if;
  if area is null or area not in ('dust', 'new_game', 'studio', 'site') then raise exception 'Choose a game or area from the list'; end if;
  if char_length(coalesce(title, '')) > 80 then raise exception 'A title has at most 80 characters'; end if;
  if char_length(coalesce(body, '')) > 500 then raise exception 'A description has at most 500 characters'; end if;
  if char_length(v_title) < 3 then raise exception 'A title needs at least 3 characters'; end if;
  if not community.text_allowed(v_title) or not community.text_allowed(v_body) then
    raise exception 'That suggestion did not pass the content filter';
  end if;
  if (select count(*) from community.suggestions s where s.user_id = v_uid and s.created_at > now() - interval '1 day') >= 3 then
    raise exception 'You can send 3 suggestions a day';
  end if;
  insert into community.suggestions (user_id, area, title, body) values (v_uid, area, v_title, v_body) returning id into v_id;
  perform community.award_badges(v_uid);
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.vote_suggestion(id uuid, value smallint) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_uid uuid := community.require_player();
  v_target community.suggestions;
  v_had boolean;
begin
  if value is null or value not in (0, 1) then raise exception 'A suggestion vote is 1, or 0 to clear it'; end if;
  select * into v_target from community.suggestions s where s.id = vote_suggestion.id;
  if not found or v_target.held or v_target.state = 'declined' then raise exception 'That suggestion is not open for votes'; end if;
  v_had := exists (select 1 from community.suggestion_votes v where v.suggestion_id = v_target.id and v.user_id = v_uid);
  if value = 1 and not v_had then
    if community.votes_today(v_uid) >= 200 then raise exception 'You have cast 200 votes today'; end if;
    insert into community.suggestion_votes (suggestion_id, user_id) values (v_target.id, v_uid);
    update community.suggestions s set votes = s.votes + 1 where s.id = v_target.id;
    perform community.award_xp(v_uid, 'upvote', 1, 1, 'vote:suggestion:' || v_target.id);
  elsif value = 0 and v_had then
    delete from community.suggestion_votes v where v.suggestion_id = v_target.id and v.user_id = v_uid;
    update community.suggestions s set votes = greatest(s.votes - 1, 0) where s.id = v_target.id;
  end if;
  return jsonb_build_object('votes', (select s.votes from community.suggestions s where s.id = v_target.id));
end;
$$;

create or replace function public.save_seed(game text, code text, title text default null, publish boolean default false) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_uid uuid := community.require_player();
  v_title text := nullif(community.clean_text(title, 60), '');
  v_id uuid;
begin
  if not community.flag_on('seeds_open') then raise exception 'Seeds are closed for now'; end if;
  if game is null or game !~ '^[a-z0-9-]{2,20}$' then raise exception 'Name the game the seed is for'; end if;
  if code is null or char_length(code) > 2000 or code !~ ('^' || game || ':v[0-9]{1,4}:[A-Za-z0-9_-]+$') then
    raise exception 'That is not a seed code for %', game;
  end if;
  if char_length(coalesce(title, '')) > 60 then raise exception 'A seed title has at most 60 characters'; end if;
  if coalesce(publish, false) and v_title is null then raise exception 'A published seed needs a title'; end if;
  if v_title is not null and not community.text_allowed(v_title) then raise exception 'That title did not pass the content filter'; end if;
  if (select count(*) from community.seeds s where s.user_id = v_uid and s.created_at > now() - interval '1 day') >= 30 then
    raise exception 'You can save 30 seeds a day';
  end if;
  insert into community.seeds (user_id, game, code, title, published) values (v_uid, game, code, v_title, coalesce(publish, false))
  returning id into v_id;
  perform community.award_badges(v_uid);
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.vote_seed(id uuid, value smallint) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_uid uuid := community.require_player();
  v_seed community.seeds;
  v_old smallint;
begin
  if value is null or value not in (-1, 0, 1) then raise exception 'A seed vote is 1, -1, or 0 to clear it'; end if;
  select * into v_seed from community.seeds s where s.id = vote_seed.id;
  if not found or not v_seed.published or v_seed.unpublished then raise exception 'That seed is not in the gallery'; end if;
  if v_seed.user_id = v_uid then raise exception 'You cannot vote on your own seed'; end if;
  select v.value into v_old from community.seed_votes v where v.seed_id = v_seed.id and v.user_id = v_uid;
  if v_old is not distinct from value or (v_old is null and value = 0) then
    return jsonb_build_object('up', v_seed.up, 'down', v_seed.down);
  end if;
  if v_old is null and community.votes_today(v_uid) >= 200 then raise exception 'You have cast 200 votes today'; end if;
  if v_old is not null then
    delete from community.seed_votes v where v.seed_id = v_seed.id and v.user_id = v_uid;
    update community.seeds s set up = s.up - (v_old = 1)::integer, down = s.down - (v_old = -1)::integer where s.id = v_seed.id;
  end if;
  if value <> 0 then
    insert into community.seed_votes (seed_id, user_id, value) values (v_seed.id, v_uid, value);
    update community.seeds s set up = s.up + (value = 1)::integer, down = s.down + (value = -1)::integer where s.id = v_seed.id;
    if value = 1 then perform community.award_xp(v_uid, 'upvote', 1, 1, 'vote:seed:' || v_seed.id); end if;
  end if;
  select * into v_seed from community.seeds s where s.id = v_seed.id;
  return jsonb_build_object('up', v_seed.up, 'down', v_seed.down);
end;
$$;

-- h. The public documents -----------------------------------------------------------------

create or replace function community.event_json(e community.events) returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
declare
  v_actor jsonb;
  v_name text;
begin
  if e.kind = 'contribution' then
    select community.person_json(k.user_id) into v_actor
    from community.contribution_claims k where k.contribution_id = e.contribution_id and k.public;
    v_name := coalesce(v_actor->>'displayName', 'Anonymous supporter');
  elsif e.actor_user is not null then
    v_actor := community.person_json(e.actor_user);
    v_name := coalesce(v_actor->>'displayName', 'A supporter');
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'id', e.id::text, 'at', e.at, 'kind', e.kind, 'text', replace(e.text, '{actor}', coalesce(v_name, 'A supporter')),
    'cardId', e.card_id, 'role', e.role, 'rarity', e.rarity, 'suit', e.suit, 'amountCents', e.amount_cents
  )) || case when e.kind = 'contribution' or e.actor_user is not null then jsonb_build_object('actor', v_actor) else '{}'::jsonb end;
end;
$$;

-- FeedDoc, newest first, 30 a page; the cursor is the last event's id.
create or replace function public.community_feed(p_cursor text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
declare
  v_before bigint := case when p_cursor ~ '^[0-9]{1,18}$' then p_cursor::bigint else null end;
  v_events jsonb;
  v_n integer;
  v_min bigint;
begin
  if p_cursor is not null and v_before is null then raise exception 'Bad cursor'; end if;
  select coalesce(jsonb_agg(community.event_json(e) order by e.id desc), '[]'::jsonb), count(*), min(e.id)
  into v_events, v_n, v_min
  from (select x.id from community.events x where v_before is null or x.id < v_before order by x.id desc limit 30) page
  join community.events e on e.id = page.id;
  return jsonb_build_object('events', v_events, 'next', case when v_n = 30 then v_min::text else null end);
end;
$$;

create or replace function public.community_goals() returns jsonb
language sql
stable
security definer
set search_path = community, public
as $$
  with total as (select community.lifetime_cents() as cents),
  g as (
    select x.*, (x.reached_at is not null or x.amount_cents <= t.cents) as reached from community.goals x, total t
  ),
  nxt as (select id from g where not reached order by amount_cents, id limit 1)
  select jsonb_build_object(
    'lifetimeCents', (select cents from total),
    'goals', coalesce((select jsonb_agg(jsonb_build_object(
      'id', g.id, 'amountCents', g.amount_cents, 'title', g.title, 'outcome', g.outcome,
      'state', case when g.reached then 'reached' when g.id in (select id from nxt) then 'next' else 'later' end,
      'reachedAt', g.reached_at, 'link', g.link) order by g.amount_cents, g.id) from g), '[]'::jsonb)
  )
$$;

create or replace function community.era_json(e community.studio_eras) returns jsonb
language sql
stable
as $$
  select jsonb_build_object('id', e.id, 'index', e.idx, 'name', e.name, 'reachedAt', e.reached_at,
    'unlockedBy', e.unlocked_by, 'stations', to_jsonb(e.stations), 'decor', to_jsonb(e.decor))
$$;

create or replace function public.community_studio() returns jsonb
language sql
stable
security definer
set search_path = community, public
as $$
  select jsonb_build_object(
    'era', (select community.era_json(e) from community.studio_eras e where e.reached_at is not null order by e.idx desc limit 1),
    'eras', coalesce((select jsonb_agg(community.era_json(e) order by e.idx) from community.studio_eras e), '[]'::jsonb)
  )
$$;

-- PageDoc<SeedSummary>, 24 a page. trending: the gravity score; top_week: net votes this week;
-- top_all: net votes; new: newest. The cursor is "<sort key>|<id>" from the last item.
create or replace function community.seed_key(p_sort text, s community.seeds) returns float8
language sql
stable
as $$
  select case p_sort
    when 'trending' then community.seed_score(s.up, s.down, s.created_at)
    when 'new' then trunc(extract(epoch from s.created_at) * 1000000)::float8
    else (s.up - s.down)::float8 end
$$;

create or replace function public.community_seeds(p_sort text default 'trending', p_cursor text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
declare
  v_sort text := coalesce(p_sort, 'trending');
  v_key float8;
  v_id uuid;
  v_items jsonb;
  v_n integer;
  v_last_key float8;
  v_last_id uuid;
begin
  if v_sort not in ('trending', 'top_week', 'top_all', 'new') then raise exception 'Bad sort'; end if;
  if p_cursor is not null then
    if p_cursor !~ '^-?[0-9][0-9.e+-]{0,29}\|[0-9a-f-]{36}$' then raise exception 'Bad cursor'; end if;
    v_key := split_part(p_cursor, '|', 1)::float8;
    v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  with page as (
    select s.id, community.seed_key(v_sort, s) as k
    from community.seeds s
    where s.published and not s.unpublished
      and (v_sort <> 'top_week' or s.created_at > now() - interval '7 days')
      and (v_key is null or (community.seed_key(v_sort, s), s.id) < (v_key, v_id))
    order by 2 desc, 1 desc
    limit 24
  )
  select coalesce(jsonb_agg(community.seed_json(s) order by page.k desc, page.id desc), '[]'::jsonb), count(*)
  into v_items, v_n
  from page join community.seeds s on s.id = page.id;
  if v_n = 24 then
    select k, id into v_last_key, v_last_id from (
      select s.id, community.seed_key(v_sort, s) as k
      from community.seeds s
      where s.published and not s.unpublished
        and (v_sort <> 'top_week' or s.created_at > now() - interval '7 days')
        and (v_key is null or (community.seed_key(v_sort, s), s.id) < (v_key, v_id))
      order by 2 desc, 1 desc
      limit 24
    ) z order by k asc, id asc limit 1;
  end if;
  return jsonb_build_object('items', v_items,
    'next', case when v_n = 24 then v_last_key::text || '|' || v_last_id else null end);
end;
$$;

-- PageDoc<SuggestionSummary>, 30 a page: top (votes) or new, optionally one area. A held
-- suggestion, and one declined as an instruction to agents or as not all-ages, is never listed.
-- The cursor is "<votes>|<created micros>|<id>" from the last item.
create or replace function public.community_suggestions(p_sort text default 'top', p_area text default null, p_cursor text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
declare
  v_sort text := coalesce(p_sort, 'top');
  v_votes integer := 0;
  v_at bigint;
  v_id uuid;
  v_ids uuid[];
  v_last community.suggestions;
  v_items jsonb;
begin
  if v_sort not in ('top', 'new') then raise exception 'Bad sort'; end if;
  if p_area is not null and p_area not in ('dust', 'new_game', 'studio', 'site') then raise exception 'Bad area'; end if;
  if p_cursor is not null then
    if p_cursor !~ '^[0-9]{1,9}\|[0-9]{1,20}\|[0-9a-f-]{36}$' then raise exception 'Bad cursor'; end if;
    v_votes := case when v_sort = 'top' then split_part(p_cursor, '|', 1)::integer else 0 end;
    v_at := split_part(p_cursor, '|', 2)::bigint;
    v_id := split_part(p_cursor, '|', 3)::uuid;
  end if;
  select array_agg(z.id order by z.ord) into v_ids from (
    select s.id, row_number() over (order by case when v_sort = 'top' then s.votes else 0 end desc,
      trunc(extract(epoch from s.created_at) * 1000000) desc, s.id desc) as ord
    from community.suggestions s
    where not s.held and coalesce(s.decline_reason, '') not in ('instruction_to_agents', 'not_all_ages')
      and (p_area is null or s.area = p_area)
      and (p_cursor is null or
        (case when v_sort = 'top' then s.votes else 0 end, trunc(extract(epoch from s.created_at) * 1000000)::bigint, s.id)
          < (v_votes, v_at, v_id))
    order by ord
    limit 30
  ) z;
  select coalesce(jsonb_agg(community.suggestion_json(s) order by array_position(v_ids, s.id)), '[]'::jsonb) into v_items
  from community.suggestions s where s.id = any (coalesce(v_ids, '{}'));
  if coalesce(array_length(v_ids, 1), 0) = 30 then select * into v_last from community.suggestions where id = v_ids[30]; end if;
  return jsonb_build_object(
    'items', v_items,
    'next', case when v_last.id is null then null
      else (case when v_sort = 'top' then v_last.votes else 0 end)::text || '|'
        || trunc(extract(epoch from v_last.created_at) * 1000000)::bigint::text || '|' || v_last.id end
  );
end;
$$;

create or replace function public.community_profile(p_handle text) returns jsonb
language sql
stable
security definer
set search_path = community, public
as $$
  select community.profile_doc(p.user_id, false)
  from community.profiles p
  where p_handle ~ '^[a-z0-9-]{3,24}$' and p.handle = p_handle and not p.suspended
$$;

-- i. site_cards() with suit and rarity --------------------------------------------------------
-- board-work's text, suit and rarity added after board_work; each card's keys stay exactly the
-- cards columns anon may select.

create or replace function public.site_cards() returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with listed as (
    select c.id from public.cards c
    where c.stage in ('proposed', 'designing', 'voted', 'funded', 'building', 'gated', 'paused')
    union all
    (select c.id from public.cards c where c.stage = 'live' order by c.live_at desc nulls last, c.id desc limit 200)
    union all
    (select c.id from public.cards c where c.stage = 'rejected' order by c.updated_at desc, c.id desc limit 50)
  )
  select jsonb_build_object(
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'bucket', c.bucket, 'source', c.source, 'shape', c.shape, 'lane', c.lane,
        'board_reason', c.board_reason, 'folder', c.folder, 'executor_role_id', c.executor_role_id,
        'title', c.title, 'summary', c.summary, 'intent', c.intent, 'acceptance_test', c.acceptance_test,
        'design_spec_url', c.design_spec_url, 'funding_target_usd', c.funding_target_usd,
        'funded_usd', c.funded_usd, 'estimate_usd', c.estimate_usd, 'confidence', c.confidence,
        'proposer_role_id', c.proposer_role_id, 'director_stance', c.director_stance,
        'veto_reason', c.veto_reason, 'stage', c.stage, 'branch', c.branch, 'commit_sha', c.commit_sha,
        'failing_check', c.failing_check, 'created_at', c.created_at, 'updated_at', c.updated_at,
        'live_at', c.live_at, 'horizon', c.horizon, 'rank', c.rank, 'drafter_role_id', c.drafter_role_id,
        'check_author_role_id', c.check_author_role_id, 'opens_at', c.opens_at,
        'board_vetoed', c.board_vetoed, 'board_veto_reason', c.board_veto_reason,
        'board_work', c.board_work, 'suit', c.suit, 'rarity', c.rarity
      ) order by c.created_at, c.id)
      from public.cards c
      where c.id in (select id from listed)
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.hired_at, r.title, r.id) from public.public_roles r
    ), '[]'::jsonb),
    'terms', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.version) from public.public_terms_versions t
    ), '[]'::jsonb)
  )
$$;

-- Grants ----------------------------------------------------------------------------------------

do $$
declare
  f text;
begin
  -- Nothing in community is callable from outside but through the public functions below.
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'community' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end
$$;

revoke all on function public.my_profile() from public, anon;
revoke all on function public.update_profile(text, jsonb, text, text, boolean) from public, anon;
revoke all on function public.claim_contributions() from public, anon;
revoke all on function public.set_contribution_public(uuid, boolean) from public, anon;
revoke all on function public.submit_suggestion(text, text, text) from public, anon;
revoke all on function public.vote_suggestion(uuid, smallint) from public, anon;
revoke all on function public.save_seed(text, text, text, boolean) from public, anon;
revoke all on function public.vote_seed(uuid, smallint) from public, anon;
grant execute on function public.my_profile() to authenticated;
grant execute on function public.update_profile(text, jsonb, text, text, boolean) to authenticated;
grant execute on function public.claim_contributions() to authenticated;
grant execute on function public.set_contribution_public(uuid, boolean) to authenticated;
grant execute on function public.submit_suggestion(text, text, text) to authenticated;
grant execute on function public.vote_suggestion(uuid, smallint) to authenticated;
grant execute on function public.save_seed(text, text, text, boolean) to authenticated;
grant execute on function public.vote_seed(uuid, smallint) to authenticated;
-- The player RPCs act for a signed-in player only: the service role (the dispatcher) holds none.
revoke all on function public.my_profile() from service_role;
revoke all on function public.update_profile(text, jsonb, text, text, boolean) from service_role;
revoke all on function public.claim_contributions() from service_role;
revoke all on function public.set_contribution_public(uuid, boolean) from service_role;
revoke all on function public.submit_suggestion(text, text, text) from service_role;
revoke all on function public.vote_suggestion(uuid, smallint) from service_role;
revoke all on function public.save_seed(text, text, text, boolean) from service_role;
revoke all on function public.vote_seed(uuid, smallint) from service_role;

revoke all on function public.community_feed(text) from public;
revoke all on function public.community_goals() from public;
revoke all on function public.community_studio() from public;
revoke all on function public.community_seeds(text, text) from public;
revoke all on function public.community_suggestions(text, text, text) from public;
revoke all on function public.community_profile(text) from public;
grant execute on function public.community_feed(text) to anon, authenticated;
grant execute on function public.community_goals() to anon, authenticated;
grant execute on function public.community_studio() to anon, authenticated;
grant execute on function public.community_seeds(text, text) to anon, authenticated;
grant execute on function public.community_suggestions(text, text, text) to anon, authenticated;
grant execute on function public.community_profile(text) to anon, authenticated;
revoke all on function public.community_feed(text) from service_role;
revoke all on function public.community_goals() from service_role;
revoke all on function public.community_studio() from service_role;
revoke all on function public.community_seeds(text, text) from service_role;
revoke all on function public.community_suggestions(text, text, text) from service_role;
revoke all on function public.community_profile(text) from service_role;

revoke all on function public.site_cards() from public;
grant execute on function public.site_cards() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
