-- design-review (docs/specs/design-review.md): the Directors' visual review
-- counts its revise rounds on the card, so the cap of two holds across a
-- dispatcher restart.
--
-- cards.review_rounds counts the revise rounds a card's visual review has
-- used; it is never granted to anon or authenticated (cards is granted column
-- by column). record_review_round, the service role's alone, adds one and
-- returns the new count, and refuses a card that does not exist.
-- dispatcher_cards is the dispatcher's only read of a card, so it is created
-- again with the column, and its revoke and grant are repeated.
--
-- Re-runnable: the column is added if missing, the function is replaced, and
-- the view is dropped and created again.

set lock_timeout = '5s';

-- a. The column -----------------------------------------------------------------

alter table public.cards add column if not exists review_rounds integer not null default 0;
alter table public.cards drop constraint if exists cards_review_rounds_check;
alter table public.cards add constraint cards_review_rounds_check check (review_rounds >= 0);

-- b. record_review_round -------------------------------------------------------

create or replace function public.record_review_round(p_card uuid) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rounds integer;
begin
  if p_card is null then
    raise exception 'A card is required';
  end if;
  update public.cards
    set review_rounds = review_rounds + 1
    where id = p_card
    returning review_rounds into v_rounds;
  if not found then
    raise exception 'Card % does not exist', p_card;
  end if;
  return v_rounds;
end;
$$;

revoke all on function public.record_review_round(uuid) from public, anon, authenticated;
grant execute on function public.record_review_round(uuid) to service_role;

-- c. dispatcher_cards, with review_rounds --------------------------------------
-- agent-system-core's columns in the same order, review_rounds appended.

drop view if exists public.dispatcher_cards;
create view public.dispatcher_cards with (security_invoker = false) as
  select
    c.id, c.bucket, c.source, c.shape, c.lane, c.priority, c.board_reason, c.folder, c.executor_role_id,
    c.title, c.intent, c.acceptance_test, c.design_spec_url, c.funding_target_usd, c.funded_usd,
    c.estimate_usd, c.confidence, c.proposer_role_id, c.director_stance, c.veto_reason, c.stage,
    c.severity, c.actual_usd, c.branch, c.commit_sha, c.failing_check, c.created_at, c.updated_at,
    c.summary, c.live_at, c.horizon, c.rank, c.drafter_role_id, c.check_author_role_id, c.opens_at,
    c.board_vetoed, c.board_veto_reason,
    public.card_needs_approval(c.source, c.drafter_role_id) as needs_approval,
    public.card_approved(c.id) as approved,
    coalesce(r.paused, false) as executor_paused,
    c.review_rounds
  from public.cards c
  left join public.roles r on r.id = c.executor_role_id;

revoke all on table public.dispatcher_cards from anon, authenticated, service_role;
grant select on public.dispatcher_cards to service_role;

notify pgrst, 'reload schema';
