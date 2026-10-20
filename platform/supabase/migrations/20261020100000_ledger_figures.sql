-- Ledger figures (docs/specs/ledger-figures.md): one definition of each public money figure, and
-- figures a reader can add up. Applies after 20261019040000_designer_model.sql and can run twice.
--
-- No money logic changes and no stored row changes: the waterfall, the allocations, the split, the
-- reserves, the caps, holds, refunds, the sweep and the drain are as they were, and so are
-- money.not_on_card_usd(), money.board_test_usd() and public_card_funding. This redefines four reads,
-- each keeping its columns in their order and adding new ones only at the end:
--
-- a. community.lifetime_cents(), /goals' total: received - refunded - disputed (net of disputes won
--    back), from the same rows as public_money's money-in figures, so the studio's own test payment's
--    family is left out as it is there. It counted every payment, the test payment included.
-- b. public_ledger_totals: every studio-billed and overhead row, a card the public may not read yet
--    included, so Agent spend is what the pool paid. It was security_invoker, so the ledger's row
--    policy left out spend on a card that is not public (production: $0.2631 drafting one card).
--    unlisted_usd is that part. Neither names a card; the pool's balance already carries the sum.
-- c. public_money: last_run_ok and reconciled_at read the Controller run's books checks, every check
--    but minimum_balance, which compares Stripe's balance with a buffer the operator sets in Stripe
--    and alerts the operator as before. reconciled_at is the latest run whose books checks passed.
--    test_paid_usd, test_reserve_usd and test_incident_usd are the test payment's family's paid
--    amount and its reserve and emergency fund shares, so the Funding band can say what the balances
--    hold beyond the money-in figures: pool.reserve_usd = reserve_usd + test_reserve_usd and
--    pool.incident_reserve_usd = incident_usd + test_incident_usd.
-- d. public_stopped_cards: from_cards_usd, the counted money released to the card from other cards,
--    so a Didn't ship row can say how much of what reached it came from another card.

set lock_timeout = '5s';

-- a. /goals' lifetime total -----------------------------------------------------------------------

create or replace function community.lifetime_cents() returns bigint
language sql
stable
security definer
set search_path = community, public
as $$
  select coalesce(round(sum(c.amount_usd) * 100), 0)::bigint
  from public.contributions c
  join public.contributions fam on fam.id = coalesce(c.parent_id, c.id)
  where c.entry in ('payment', 'refund', 'dispute', 'reinstated')
    and not exists (select 1 from public.board_test_payments b where b.stripe_session_id = fam.stripe_session_id)
$$;

-- b. Agent spend ------------------------------------------------------------------------------------

create or replace view public.public_ledger_totals with (security_invoker = false) as
  select
    coalesce(sum(usd) filter (where billed_to = 'studio'), 0)::numeric(12,4) as usd_total,
    coalesce(sum(input_tokens) filter (where billed_to = 'studio'), 0)::bigint as input_tokens,
    coalesce(sum(cached_tokens) filter (where billed_to = 'studio'), 0)::bigint as cached_tokens,
    coalesce(sum(output_tokens) filter (where billed_to = 'studio'), 0)::bigint as output_tokens,
    (count(*) filter (where billed_to = 'studio'))::bigint as row_count,
    coalesce(sum(usd) filter (where billed_to = 'overhead'), 0)::numeric(12,4) as overhead_usd,
    coalesce(sum(usd) filter (where billed_to = 'studio' and card_id is not null and not public.card_is_public(card_id)), 0)::numeric(12,4) as unlisted_usd
  from public.ledger
  where billed_to in ('studio', 'overhead');

alter view public.public_ledger_totals set (security_invoker = false);

-- c. The books --------------------------------------------------------------------------------------

create or replace view public.public_money with (security_invoker = false) as
  with fam_rows as (
    select c.*
    from public.contributions c
    join public.contributions fam on fam.id = coalesce(c.parent_id, c.id)
    where not exists (select 1 from public.board_test_payments b where b.stripe_session_id = fam.stripe_session_id)
  ),
  books as (
    select
      (count(*) filter (where entry = 'payment'))::integer as payments,
      coalesce(sum(amount_usd) filter (where entry = 'payment'), 0)::numeric(12,4) as received_usd,
      (coalesce(sum(amount_usd - net_usd) filter (where entry <> 'adjustment'), 0)
        + coalesce(sum(-net_usd) filter (where entry = 'adjustment' and stripe_event_id is not null), 0))::numeric(12,4) as stripe_fees_usd,
      (-coalesce(sum(amount_usd) filter (where entry = 'refund'), 0))::numeric(12,4) as refunded_usd,
      (-coalesce(sum(amount_usd) filter (where entry in ('dispute', 'reinstated')), 0))::numeric(12,4) as disputed_usd,
      coalesce(sum(net_usd) filter (where entry = 'adjustment' and stripe_event_id is null), 0)::numeric(12,4) as corrections_usd,
      round(sum(studio_pct_chosen * net_usd) filter (where entry = 'payment') / nullif(sum(net_usd) filter (where entry = 'payment'), 0), 2) as studio_pct_avg,
      coalesce(sum(reserve_usd), 0)::numeric(12,4) as reserve_usd,
      coalesce(sum(studio_usd), 0)::numeric(12,4) as studio_usd,
      coalesce(sum(incident_usd), 0)::numeric(12,4) as incident_usd,
      coalesce(sum(held_usd), 0)::numeric(12,4) as held_usd,
      coalesce(sum(agents_usd - incident_usd - held_usd), 0)::numeric(12,4) as agent_credit_usd
    from fam_rows
  ),
  test as (
    select
      coalesce(sum(c.amount_usd) filter (where c.entry in ('payment', 'refund', 'dispute', 'reinstated')), 0)::numeric(12,4) as paid_usd,
      coalesce(sum(c.reserve_usd), 0)::numeric(12,4) as reserve_usd,
      coalesce(sum(c.incident_usd), 0)::numeric(12,4) as incident_usd
    from public.contributions c
    join public.contributions fam on fam.id = coalesce(c.parent_id, c.id)
    where exists (select 1 from public.board_test_payments b where b.stripe_session_id = fam.stripe_session_id)
  ),
  -- A run's books checks: every check but minimum_balance. A run with no checks recorded is its own ok.
  runs as (
    select r.created_at, r.id, r.finished_at,
      case
        when jsonb_typeof(r.checks) = 'array' and jsonb_array_length(r.checks) > 0 then not exists (
          select 1 from jsonb_array_elements(r.checks) x
          where x ->> 'name' is distinct from 'minimum_balance' and (x -> 'ok') is distinct from 'true'::jsonb
        )
        else r.ok
      end as books_ok
    from public.controller_runs r
    where r.job = 'reconcile'
  ),
  run as (
    select books_ok as ok from runs order by created_at desc, id desc limit 1
  ),
  matched as (
    select max(finished_at) as finished_at from runs where books_ok
  ),
  place as (
    select money.not_on_card_usd() as usd
  )
  select
    books.payments,
    books.received_usd,
    books.stripe_fees_usd,
    books.refunded_usd,
    books.disputed_usd,
    books.corrections_usd,
    books.studio_pct_avg,
    books.reserve_usd,
    books.studio_usd,
    books.incident_usd,
    books.held_usd,
    books.agent_credit_usd,
    greatest(place.usd, 0)::numeric(12,4) as not_on_card_usd,
    greatest(-place.usd, 0)::numeric(12,4) as short_usd,
    money.board_test_usd() as board_test_usd,
    (select matched.finished_at from matched) as reconciled_at,
    (select run.ok from run) as last_run_ok,
    coalesce((
      select jsonb_agg(jsonb_build_object('position', f."position", 'card_id', f.card_id, 'room_usd', f.room_usd) order by f."position")
      from money.funding_order() f
    ), '[]'::jsonb) as funding_order,
    test.paid_usd as test_paid_usd,
    test.reserve_usd as test_reserve_usd,
    test.incident_usd as test_incident_usd
  from books, place, test;

-- d. Stopped cards --------------------------------------------------------------------------------

create or replace view public.public_stopped_cards with (security_invoker = false) as
  select
    c.id as card_id,
    c.title,
    c.stage,
    c.failing_check,
    coalesce(s.spent_usd, 0)::numeric(12,4) as spent_usd,
    c.funded_usd,
    coalesce(f.credited_usd, 0)::numeric(12,4) as credited_usd,
    coalesce((
      select jsonb_agg(jsonb_build_object('to_card_id', m.card_id, 'to_title', case when public.card_is_public(m.card_id) then t.title end, 'usd', m.usd) order by m.usd desc, m.card_id nulls last)
      from (
        select a.card_id, sum(a.amount_usd)::numeric(12,4) as usd
        from public.contribution_allocations a
        where a.reason = 'card_release' and a.amount_usd > 0 and a.from_card_id = c.id
        group by a.card_id
      ) m
      left join public.cards t on t.id = m.card_id
    ), '[]'::jsonb) as moved,
    c.updated_at as stopped_at,
    coalesce((
      select sum(a.amount_usd)
      from public.contribution_allocations a
      where a.destination = 'card' and a.card_id = c.id and a.reason = 'card_release' and a.amount_usd > 0
        and a.from_card_id is distinct from c.id and money.payment_counts(a.payment_id)
    ), 0)::numeric(12,4) as from_cards_usd
  from public.cards c
  left join (
    select card_id, sum(usd)::numeric(12,4) as spent_usd from public.ledger
    where billed_to = 'studio' and card_id is not null
    group by card_id
  ) s on s.card_id = c.id
  left join public.public_card_funding f on f.card_id = c.id
  where c.horizon = 'now' and c.stage in ('rejected', 'paused') and public.card_is_public(c.id);

-- The grants each view had: the totals to anon and authenticated (money-fixes), the books and the
-- stopped cards to those and service_role (money-logic).
revoke all on table public.public_ledger_totals from anon, authenticated;
grant select on public.public_ledger_totals to anon, authenticated;
revoke all on table public.public_money, public.public_stopped_cards from anon, authenticated, service_role;
grant select on public.public_money, public.public_stopped_cards to anon, authenticated, service_role;

notify pgrst, 'reload schema';
