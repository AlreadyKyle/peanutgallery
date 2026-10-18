-- The pipe's history (docs/specs/community-core.md, Data model): community.events was created at
-- go-live and its triggers only post what happens after it, so the pipe beside the studio opened
-- empty while the studio already had public cards, shipped cards and payments. This posts the same
-- lines those triggers would have posted, at the time each happened:
--   a. 'card_opened' for every public card that is not rejected, at its created_at;
--   b. 'shipped' for every public live card, at its live_at;
--   c. 'contribution' for every payment, at its created_at, naming no one ({actor} is resolved at
--      read time from the payment's public flag, as the trigger's lines are).
-- Each line carries the trigger's own dedupe key, so this is idempotent and never doubles a line a
-- trigger already posted. Lines are inserted oldest first, so ids follow time when the feed was
-- empty. Writes only community.events; awards no XP and no badge.

insert into community.events (at, kind, text, dedupe, card_id, actor_user, contribution_id, rarity, suit, amount_cents)
select at, kind, left(text, 300), dedupe, card_id, null, contribution_id, rarity, suit, amount_cents
from (
  select c.created_at as at, 'card_opened' as kind,
    case when c.rarity in ('rare', 'legendary') then 'A ' || c.rarity || ' card appeared: ' || c.title
      else 'A new card opened: ' || c.title end as text,
    'opened:' || c.id as dedupe, c.id as card_id, null::uuid as contribution_id,
    c.rarity, c.suit, null::bigint as amount_cents
  from public.cards c
  where c.stage::text <> 'rejected' and public.card_is_public(c.id)
  union all
  select coalesce(c.live_at, c.updated_at), 'shipped', c.title || ' shipped',
    'shipped:' || c.id, c.id, null, c.rarity, c.suit, null
  from public.cards c
  where c.stage::text = 'live' and public.card_is_public(c.id)
  union all
  select p.created_at, 'contribution',
    '{actor} put ' || community.money_text(round(p.amount_usd * 100)::bigint) || ' ' || case
      when k.id is null then 'into the Machine'
      when public.card_is_public(k.id) then 'on ' || k.title
      else 'on a card'
    end,
    'payment:' || p.id, k.id, p.id, coalesce(k.rarity, 'common'), coalesce(k.suit, 'machine'),
    round(p.amount_usd * 100)::bigint
  from public.contributions p
  left join public.cards k on k.id = community.payment_card(p)
  where p.entry = 'payment'
) history
order by at, dedupe
on conflict (dedupe) do nothing;
