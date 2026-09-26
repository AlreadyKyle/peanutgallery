-- copy-pass (docs/specs/copy-pass.md): the board-work marker. A card is board
-- work when its change lands in the kernel: the rules, the money, the card
-- system, the dispatcher, the gate, the agents and their prompts (PLAN.md §4
-- Work). The board makes board work itself through reviewed pull requests and no
-- card funds it, so /roadmap groups it apart. file-backlog sets it from each
-- docs/BACKLOG.md entry's board: bullet; every other card keeps the default,
-- false.
--
-- Additive: one column with a default, its column grant and site_cards()
-- re-created from supporter-pages' version with board_work added to each card
-- and every other key kept. The cards column grant is agent-system-core's list
-- with board_work appended; revoking first clears any column grant, so a second
-- run starts from nothing, and actual_usd, severity, priority and design-review's
-- review_rounds stay withheld. No view or function the dispatcher reads changes.
--
-- Re-runnable: the column is added if missing, the grant is revoked and given
-- again, and the function is replaced.

set lock_timeout = '5s';

-- a. The column ------------------------------------------------------------------

alter table public.cards add column if not exists board_work boolean not null default false;

-- b. Column grants on cards: agent-system-core's list with board_work -------------

revoke all on public.cards from anon, authenticated;
grant select (
  id, bucket, source, shape, lane, board_reason, folder, executor_role_id,
  title, summary, intent, acceptance_test, design_spec_url,
  funding_target_usd, funded_usd, estimate_usd, confidence, proposer_role_id,
  director_stance, veto_reason, stage, branch, commit_sha, failing_check,
  created_at, updated_at, live_at, horizon, rank,
  drafter_role_id, check_author_role_id, opens_at, board_vetoed, board_veto_reason,
  board_work
) on public.cards to anon, authenticated;

-- c. site_cards(), with board_work on each card ----------------------------------
-- supporter-pages' text (20260924600000_supporter_pages.sql), board_work added
-- after board_veto_reason. Each card's keys stay exactly the cards columns anon
-- may select (site-snapshot's migration test).

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
        'board_work', c.board_work
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

revoke all on function public.site_cards() from public;
grant execute on function public.site_cards() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
