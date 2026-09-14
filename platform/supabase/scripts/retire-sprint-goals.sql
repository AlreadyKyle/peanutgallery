-- Retires the three sprint goal cards and the stray $0 goal card
-- (docs/specs/next-cards.md, decision of 2026-09-14: delete, not reject).
--
-- Run the select first and expect exactly 4 rows. Then run the delete, which
-- carries the same where clause and returns the same 4 ids. Both statements
-- are guarded: only goal cards in proposed or voted, with no money credited
-- and none spent, whose id starts with one of the four known prefixes, and
-- with no row in any table that references a card, qualify. A card that fails
-- any guard is left alone, so a partial match returns fewer than 4 rows and
-- the delete must not be run until the difference is understood.

select c.id, c.title, c.stage, c.funded_usd, c.actual_usd, c.created_at
from public.cards c
where c.shape = 'goal'
  and c.stage in ('proposed', 'voted')
  and c.funded_usd = 0
  and c.actual_usd = 0
  and (
    c.id::text like '0188195f%'
    or c.id::text like '37bef76d%'
    or c.id::text like '5426d31c%'
    or c.id::text like '19f02221%'
  )
  and not exists (select 1 from public.contributions x where x.goal_card_id = c.id)
  and not exists (select 1 from public.ledger x where x.card_id = c.id)
  and not exists (select 1 from public.agent_events x where x.card_id = c.id)
  and not exists (select 1 from public.votes x where x.card_id = c.id)
  and not exists (select 1 from public.board_notes x where x.card_id = c.id)
  and not exists (select 1 from public.decisions x where x.card_id = c.id)
  and not exists (select 1 from public.images x where x.card_id = c.id)
order by c.created_at;

delete from public.cards c
where c.shape = 'goal'
  and c.stage in ('proposed', 'voted')
  and c.funded_usd = 0
  and c.actual_usd = 0
  and (
    c.id::text like '0188195f%'
    or c.id::text like '37bef76d%'
    or c.id::text like '5426d31c%'
    or c.id::text like '19f02221%'
  )
  and not exists (select 1 from public.contributions x where x.goal_card_id = c.id)
  and not exists (select 1 from public.ledger x where x.card_id = c.id)
  and not exists (select 1 from public.agent_events x where x.card_id = c.id)
  and not exists (select 1 from public.votes x where x.card_id = c.id)
  and not exists (select 1 from public.board_notes x where x.card_id = c.id)
  and not exists (select 1 from public.decisions x where x.card_id = c.id)
  and not exists (select 1 from public.images x where x.card_id = c.id)
returning c.id, c.title;
