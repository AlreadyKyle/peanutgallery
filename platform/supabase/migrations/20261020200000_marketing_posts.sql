-- The marketing engine (docs/specs/marketing-engine.md, docs/PLAN.md §10 decision 77): the ops job
-- platform/ops/jobs/marketing.mjs posts the studio's own news to Bluesky, Mastodon and Discord. It is
-- outbound only: it posts, and reads nothing back from any channel. Everything it posts is built from
-- structured fields the studio wrote (a card's id, folder, agent-written title, amounts and its
-- supporter count; a weekly report's counts and titles), never from anything a player wrote.
--
-- a. marketing_posts: one row per (channel, kind, ref), claimed before the post. The primary key is
--    the idempotency: a second claim of the same triple finds the row and posts nothing. A row is
--    never posted again, whatever its state, so a timeout, an error or a crash mid-request loses that
--    post rather than doubling it. The dispatcher's Discord outbox (outbound_posts) is left as it is.
-- b. marketing_posts_due(channels, since, limit): the posts due, with the studio's stop. Each item
--    lists the channels it is already claimed on, and an item claimed on every asked channel is left
--    out. Ships: public live cards that went live at or after p_since. Openings: public cards open for
--    funding now (on now, not vetoed, not yet full) that opened at or after p_since. Weekly: the newest
--    weekly report while its week is still the last one ended in New York. stop is 'kill_switch' when
--    the kill switch has fired, 'paused' while the studio is paused, else null.
-- c. marketing_post_claim(channel, kind, ref, state, reason): inserts the row as sending or skipped,
--    true once and false after. marketing_post_settle(channel, kind, ref, state, status, post id):
--    moves a sending row to posted or failed, and nothing else.
--
-- All three functions are service_role only. Every statement runs twice without error, as the
-- migration test applies it.

set lock_timeout = '5s';

-- a. marketing_posts ----------------------------------------------------------------------------

create table if not exists public.marketing_posts (
  channel text not null constraint marketing_posts_channel_check check (channel in ('bsky', 'mastodon', 'discord')),
  kind text not null constraint marketing_posts_kind_check check (kind in ('ship', 'opened', 'weekly')),
  ref text not null check (char_length(ref) between 1 and 80),
  state text not null constraint marketing_posts_state_check check (state in ('sending', 'posted', 'failed', 'skipped')),
  status integer,
  post_id text check (post_id is null or char_length(post_id) <= 300),
  skip_reason text check (skip_reason is null or skip_reason ~ '^[a-z_]{1,40}$'),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (channel, kind, ref)
);

alter table public.marketing_posts enable row level security;
revoke all on public.marketing_posts from public, anon, authenticated, service_role;
-- The board reads what went out with the service key; only the functions below write.
grant select on public.marketing_posts to service_role;

-- b. The posts due ------------------------------------------------------------------------------

create or replace function public.marketing_posts_due(p_channels text[], p_since timestamptz, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_channels text[];
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_stop text;
  v_items jsonb;
begin
  select coalesce(array_agg(distinct c), '{}') into v_channels
  from unnest(coalesce(p_channels, '{}')) c where c in ('bsky', 'mastodon', 'discord');
  select case when s.kill_switch_fired_at is not null then 'kill_switch' when s.paused then 'paused' end
    into v_stop
  from public.studio_state s where s.id = 1;

  with ships as (
    select 'ship'::text as kind, c.id::text as ref, c.live_at as at, c.id as card_id, c.folder, c.title,
      c.funded_usd, c.funding_target_usd, c.rarity,
      (select count(*) from public.public_card_supporters p where p.card_id = c.id)::integer as supporter_count
    from public.cards c
    where c.stage = 'live' and c.live_at is not null and c.live_at >= p_since and public.card_is_public(c.id)
  ),
  openings as (
    select 'opened'::text as kind, c.id::text as ref, coalesce(c.opens_at, c.created_at) as at, c.id as card_id, c.folder, c.title,
      c.funded_usd, c.funding_target_usd, c.rarity, null::integer as supporter_count
    from public.cards c
    where c.stage in ('proposed', 'designing', 'voted')
      and c.horizon = 'now'
      and coalesce(c.board_vetoed, false) = false
      and c.funding_target_usd > 0
      and c.funded_usd < c.funding_target_usd
      and coalesce(c.opens_at, c.created_at) >= p_since
      and coalesce(c.opens_at, c.created_at) <= now()
      and public.card_is_public(c.id)
  ),
  candidates as (
    select * from ships union all select * from openings
  ),
  cards_due as (
    select x.*, coalesce((select array_agg(m.channel order by m.channel) from public.marketing_posts m
      where m.kind = x.kind and m.ref = x.ref and m.channel = any (v_channels)), '{}') as claimed
    from candidates x
  ),
  report as (
    select r.week_start, r.facts from public.studio_reports r
    where r.week_start = money.last_ended_week(now())
    order by r.week_start desc limit 1
  ),
  weekly as (
    select r.week_start::text as ref, r.facts,
      coalesce((select array_agg(m.channel order by m.channel) from public.marketing_posts m
        where m.kind = 'weekly' and m.ref = r.week_start::text and m.channel = any (v_channels)), '{}') as claimed
    from report r
  ),
  items as (
    select jsonb_build_object(
        'kind', d.kind, 'ref', d.ref, 'at', d.at, 'card_id', d.card_id, 'folder', d.folder, 'title', d.title,
        'funded_usd', d.funded_usd, 'funding_target_usd', d.funding_target_usd, 'rarity', d.rarity,
        'supporter_count', d.supporter_count, 'claimed', to_jsonb(d.claimed)
      ) as item, d.at, d.kind, d.ref
    from cards_due d
    where cardinality(v_channels) > 0 and not (v_channels <@ d.claimed)
    union all
    select jsonb_build_object(
        'kind', 'weekly', 'ref', w.ref, 'at', w.ref,
        'shipped_count', coalesce((w.facts ->> 'shipped_count')::integer, 0),
        'shipped_titles', coalesce((select jsonb_agg(s ->> 'title') from jsonb_array_elements(case when jsonb_typeof(w.facts -> 'shipped') = 'array' then w.facts -> 'shipped' else '[]'::jsonb end) s where s ->> 'title' is not null), '[]'::jsonb),
        'open_count', coalesce((w.facts ->> 'open_count')::integer, 0),
        'claimed', to_jsonb(w.claimed)
      ), (w.ref || 'T00:00:00Z')::timestamptz, 'weekly', w.ref
    from weekly w
    where cardinality(v_channels) > 0 and not (v_channels <@ w.claimed)
  )
  select coalesce(jsonb_agg(i.item order by i.at, i.kind, i.ref), '[]'::jsonb) into v_items
  from (select * from items order by at, kind, ref limit v_limit) i;

  return jsonb_build_object('stop', v_stop, 'items', v_items);
end;
$$;

-- c. Claim and settle ---------------------------------------------------------------------------

create or replace function public.marketing_post_claim(p_channel text, p_kind text, p_ref text, p_state text default 'sending', p_skip_reason text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_state not in ('sending', 'skipped') then
    raise exception 'marketing_post_claim: state must be sending or skipped' using errcode = '22023';
  end if;
  if p_state = 'skipped' and p_skip_reason is null then
    raise exception 'marketing_post_claim: a skip needs a reason' using errcode = '22023';
  end if;
  insert into public.marketing_posts (channel, kind, ref, state, skip_reason, finished_at)
  values (p_channel, p_kind, p_ref, p_state, case when p_state = 'skipped' then p_skip_reason end, case when p_state = 'skipped' then now() end)
  on conflict (channel, kind, ref) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.marketing_post_settle(p_channel text, p_kind text, p_ref text, p_state text, p_status integer default null, p_post_id text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_state not in ('posted', 'failed') then
    raise exception 'marketing_post_settle: state must be posted or failed' using errcode = '22023';
  end if;
  update public.marketing_posts
     set state = p_state, status = p_status, post_id = left(p_post_id, 300), finished_at = now()
   where channel = p_channel and kind = p_kind and ref = p_ref and state = 'sending';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Grants ----------------------------------------------------------------------------------------

revoke all on function public.marketing_posts_due(text[], timestamptz, integer) from public, anon, authenticated;
revoke all on function public.marketing_post_claim(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.marketing_post_settle(text, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.marketing_posts_due(text[], timestamptz, integer) to service_role;
grant execute on function public.marketing_post_claim(text, text, text, text, text) to service_role;
grant execute on function public.marketing_post_settle(text, text, text, text, integer, text) to service_role;

notify pgrst, 'reload schema';
