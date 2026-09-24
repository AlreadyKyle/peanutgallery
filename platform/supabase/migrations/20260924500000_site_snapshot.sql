-- Site snapshot: the two documents the public site reads from its own origin
-- (docs/specs/site-snapshot.md). Applies after
-- 20260924400000_agent_workflows.sql and can run twice.
--
-- site_live() is the figures that move: the pool, the studio row, the ledger
-- totals, the books, the newest stopped cards, each listed card's state (every
-- cards column the pipeline, a payment or the board's deal to now writes: its
-- stage, horizon, rank, builder, target, bar, spend, funding figures, ship time
-- and last change), the newest events with their card's title and the newest
-- deploys. site_cards() is the text that rarely moves: the listed cards'
-- columns, the roles and the posted Terms versions. The site takes a card's
-- words from site_cards() and everything else from site_live(), so a card that
-- ships or is dealt to now shows its new stage, ship time and horizon together. The site's one Netlify
-- Function (platform/site/netlify/functions/snapshot.mts) calls each with the
-- publishable key and the CDN caches the answer, 60 seconds for the live
-- document and 300 for the card document.
--
-- Both are security invoker: they run as anon, under anon's own grants and row
-- level security, so neither can return anything anon could not already read.
-- Each returns one JSON value, so the project's Max Rows never truncates it.
--
-- The listed set is every card on stage proposed, designing, voted, funded,
-- building, gated or paused, plus the newest 200 live cards by live_at and the
-- newest 50 rejected cards by updated_at. Both functions compute it the same
-- way. The cards columns are named one by one: anon holds a column grant on
-- cards, so a whole-row reference would fail.

set lock_timeout = '5s';

-- a. site_cards ----------------------------------------------------------------

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
        'board_vetoed', c.board_vetoed, 'board_veto_reason', c.board_veto_reason
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

-- b. site_live -----------------------------------------------------------------

create or replace function public.site_live() returns jsonb
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
    'built_at', now(),
    'pool', (
      select jsonb_build_object(
        'balance_usd', p.balance_usd, 'reserve_usd', p.reserve_usd,
        'incident_reserve_usd', p.incident_reserve_usd, 'held_usd', p.held_usd,
        'daily_spent_usd', p.daily_spent_usd, 'day', p.day
      )
      from public.pool p where p.id = 1
    ),
    'studio', (select to_jsonb(s) from public.public_studio s limit 1),
    'totals', (select to_jsonb(t) from public.public_ledger_totals t),
    'money', (select to_jsonb(m) from public.public_money m limit 1),
    'stopped', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.stopped_at desc, x.card_id desc)
      from (
        select * from public.public_stopped_cards
        order by stopped_at desc, card_id desc
        limit 12
      ) x
    ), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_object_agg(c.id::text, jsonb_build_object(
        'stage', c.stage,
        'horizon', c.horizon,
        'rank', c.rank,
        'executor_role_id', c.executor_role_id,
        'funding_target_usd', c.funding_target_usd,
        'funded_usd', c.funded_usd,
        'spent_usd', coalesce(s.spent_usd, 0),
        'contributors', f.contributors,
        'credited_usd', f.credited_usd,
        'live_at', c.live_at,
        'updated_at', c.updated_at
      ))
      from public.cards c
      left join public.public_card_spend s on s.card_id = c.id
      left join public.public_card_funding f on f.card_id = c.id
      where c.id in (select id from listed)
    ), '{}'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'card_id', e.card_id, 'role_id', e.role_id, 'type', e.type,
        'created_at', e.created_at, 'step', e.step, 'usd', e.usd, 'card_title', c.title
      ) order by e.created_at desc, e.id desc)
      from (
        select id, card_id, role_id, type, created_at, step, usd from public.public_agent_events
        order by created_at desc, id desc
        limit 20
      ) e
      left join public.cards c on c.id = e.card_id
    ), '[]'::jsonb),
    'deploys', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'folder', d.folder, 'sha', d.sha, 'is_green', d.is_green, 'created_at', d.created_at
      ) order by d.created_at desc, d.id desc)
      from (
        select id, folder, sha, is_green, created_at from public.deploys
        order by created_at desc, id desc
        limit 10
      ) d
    ), '[]'::jsonb)
  )
$$;

-- c. Grants --------------------------------------------------------------------
-- Anon's own read, nothing more: both run as the caller.

revoke all on function public.site_live() from public;
revoke all on function public.site_cards() from public;
grant execute on function public.site_live() to anon, authenticated, service_role;
grant execute on function public.site_cards() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
