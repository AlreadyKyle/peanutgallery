-- Public card spend (docs/specs/launch-pages.md).
-- Applies on top of 20260919000000_board_two_factor.sql and can run twice.
-- cards.actual_usd counts every priced turn, including turns billed to the
-- founder, whose tokens are tracked and never published (PLAN.md §4 The
-- Board). The site reads what a card cost from this view instead: the sum of
-- its studio-billed ledger rows, the same rows anon already reads in ledger.

create or replace view public.public_card_spend with (security_invoker = false) as
  select
    card_id,
    sum(usd)::numeric(12,4) as spent_usd
  from public.ledger
  where billed_to = 'studio' and card_id is not null
  group by card_id;

revoke all on table public.public_card_spend from anon, authenticated;
grant select on public.public_card_spend to anon, authenticated;
