-- role-stats-public-only (security audit of 11 October 2026): public_role_stats
-- runs as its owner and summed every studio-billed ledger row of a role, the
-- rows of cards the public cannot see included, while the ledger's own policy
-- hides those rows. Subtracting the visible rows from a role's total gave the
-- spend on hidden cards. The two sums now count a row only when it names no card
-- or a card the public can see (card_is_public), as the ledger policy does. Its
-- columns, their order and its grants are unchanged. Applies after
-- 20261011200000_supply_every_minute.sql and can run twice.

set lock_timeout = '5s';

create or replace view public.public_role_stats with (security_invoker = false) as
  select
    r.id as role_id,
    coalesce((
      select sum(l.usd) from public.ledger l
      where l.role_id = r.id and l.billed_to = 'studio'
        and (l.card_id is null or public.card_is_public(l.card_id))
    ), 0)::numeric(12,4) as spent_usd,
    coalesce((
      select sum(l.usd) from public.ledger l
      where l.role_id = r.id and l.billed_to = 'studio' and l.created_at >= now() - interval '7 days'
        and (l.card_id is null or public.card_is_public(l.card_id))
    ), 0)::numeric(12,4) as spent_7d_usd,
    (
      select count(*) from public.cards c
      where c.executor_role_id = r.id and c.stage = 'live' and public.card_is_public(c.id)
    )::integer as shipped_cards
  from public.roles r;

revoke all on table public.public_role_stats from anon, authenticated, service_role;
grant select on public.public_role_stats to anon, authenticated, service_role;

notify pgrst, 'reload schema';
