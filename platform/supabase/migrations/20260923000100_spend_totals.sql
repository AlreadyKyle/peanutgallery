-- Spend totals in SQL and the usage tier cap (docs/specs/scale-launch.md).
-- Applies after 20260922000500_roles_revoke.sql and can run twice.
--
-- The dispatcher used to download every studio and overhead ledger row and
-- every credit purchase on each unattended tick to add them up. It now calls
-- studio_spend_totals, which returns the four sums the throttle needs, and
-- card_ledger_usd, which sums one card's rows (a select of the rows stops at
-- PostgREST's row cap). Both only read, and only the service role may call
-- them; like every other function here they are security definer with a fixed
-- search path. An index on ledger (billed_to, created_at) carrying usd serves
-- the totals.
--
-- studio_state.anthropic_tier_cap_usd is the monthly cap of the studio
-- organisation's Anthropic usage tier, as the board reads it on the Console's
-- Limits page. Null, the default, adds no bound. The dispatcher's throttle
-- keeps the studio key's spend below it; it can only stop cards, never let
-- more spend through than the other caps allow.

set lock_timeout = '5s';

-- The tier cap ----------------------------------------------------------------

alter table public.studio_state add column if not exists anthropic_tier_cap_usd numeric(12,4);
alter table public.studio_state drop constraint if exists studio_state_anthropic_tier_cap_check;
alter table public.studio_state add constraint studio_state_anthropic_tier_cap_check
  check (anthropic_tier_cap_usd is null or anthropic_tier_cap_usd > 0);

-- The index -----------------------------------------------------------------

create index if not exists ledger_billed_created_idx on public.ledger (billed_to, created_at) include (usd);

-- studio_spend_totals -------------------------------------------------------
-- The Console credit bought, every studio and overhead ledger row, and those
-- rows since each of the two month starts the throttle counts from: the New
-- York month (the monthly cap) and the usage tier's month. Strict: a null
-- start returns null, which the dispatcher refuses, never a zero.

create or replace function public.studio_spend_totals(p_month_start timestamptz, p_tier_start timestamptz) returns jsonb
language sql
stable
strict
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'credit_purchased_usd', (select coalesce(sum(p.amount_usd), 0) from public.credit_purchases p),
    'spent_usd', coalesce(sum(l.usd), 0),
    'month_usd', coalesce(sum(l.usd) filter (where l.created_at >= p_month_start), 0),
    'tier_usd', coalesce(sum(l.usd) filter (where l.created_at >= p_tier_start), 0)
  )
  from public.ledger l
  where l.billed_to in ('studio', 'overhead');
$$;

revoke all on function public.studio_spend_totals(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.studio_spend_totals(timestamptz, timestamptz) to service_role;

-- card_ledger_usd -----------------------------------------------------------
-- Every ledger row of one card, whoever it was billed to: the actual_usd the
-- dispatcher writes at each stage.

create or replace function public.card_ledger_usd(p_card_id uuid) returns numeric
language sql
stable
strict
security definer
set search_path = public
as $$
  select coalesce(sum(l.usd), 0)::numeric(12,4) from public.ledger l where l.card_id = p_card_id;
$$;

revoke all on function public.card_ledger_usd(uuid) from public, anon, authenticated;
grant execute on function public.card_ledger_usd(uuid) to service_role;

notify pgrst, 'reload schema';
