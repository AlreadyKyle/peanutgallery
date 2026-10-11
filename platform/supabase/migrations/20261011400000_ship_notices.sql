-- Ship notices to supporters (docs/specs/ship-notices.md).
--
-- When a card a supporter's payment reached ships, the notices job (platform/ops/jobs/notices.mjs)
-- sends one email per payment and shipped card to the address Stripe holds for that payment's
-- Checkout Session. The studio never stores the address: the job reads it from Stripe at send time
-- with the restricted read key and forgets it. These tables hold only ids, a status and Resend's
-- message id, and no role but service_role reads them; no public view or function exposes them.
--
-- a. ship_notice_settings: one row. starts_at: only cards that went live at or after it are noticed,
--    so the first run does not email every supporter of every card shipped before the feature.
--    unsubscribe_secret: 32 random bytes made here (two gen_random_uuid() values and the clock through
--    sha256, as PGlite has no pgcrypto), which never leave the database: an unsubscribe link carries
--    sha256(secret || the payment id's 16 bytes) in hex, and only the database computes or checks it.
-- b. ship_notices: one row per (payment, card), claimed before the send. The primary key is the
--    idempotency: a second claim of the same pair finds the row and sends nothing. A claim left at
--    'sending' (the job died between the send and the settle) is never sent again; the board reads it.
-- c. notice_unsubscribes: one row per contributor_id (the one-way hash of the receipt email), written
--    by ship_notice_unsubscribe; every payment of that contributor is left out from then on.
-- d. ship_notices_due(), ship_notice_claim() and ship_notice_settle(): service_role only.
--    ship_notice_unsubscribe(payment, token): anon may call it, as the site's /api/unsubscribe does
--    with the publishable key. It writes only when the token matches the payment, and only a
--    contributor hash into notice_unsubscribes; it reads no free text and returns only true or false.
--
-- Every statement runs twice without error, as the migration test applies it.

-- a. Settings -------------------------------------------------------------------

create table if not exists public.ship_notice_settings (
  id smallint primary key default 1 check (id = 1),
  starts_at timestamptz not null default now(),
  unsubscribe_secret bytea not null default sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8'))
    check (length(unsubscribe_secret) = 32)
);
insert into public.ship_notice_settings (id) values (1) on conflict (id) do nothing;

-- b. Notices --------------------------------------------------------------------

create table if not exists public.ship_notices (
  payment_id uuid not null references public.contributions (id),
  card_id uuid not null references public.cards (id),
  status text not null constraint ship_notices_status_check
    check (status in ('sending', 'sent', 'failed', 'no_address')),
  provider_id text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  primary key (payment_id, card_id)
);

-- c. Unsubscribes ---------------------------------------------------------------

create table if not exists public.notice_unsubscribes (
  contributor_id text primary key,
  created_at timestamptz not null default now()
);

alter table public.ship_notice_settings enable row level security;
alter table public.ship_notices enable row level security;
alter table public.notice_unsubscribes enable row level security;
revoke all on public.ship_notice_settings, public.ship_notices, public.notice_unsubscribes from public, anon, authenticated, service_role;
-- The board reads the notices and the unsubscribes with the service key; the settings row, which holds
-- the secret, is read only by the functions below.
grant select on public.ship_notices, public.notice_unsubscribes to service_role;

-- d. Functions ------------------------------------------------------------------

-- The unsubscribe token for a payment: no role may call it; the functions below do.
create or replace function public.ship_notice_token(p_payment uuid) returns text
language sql
stable
security definer
set search_path = public
as $$
  select encode(sha256(s.unsubscribe_secret || uuid_send(p_payment)), 'hex') from public.ship_notice_settings s where s.id = 1
$$;

-- Each Stripe payment that still counts (money.payment_counts: not the board's test payment, not
-- refunded or disputed in full) and reached a public card that went live at or after starts_at,
-- with no notice row yet and no unsubscribe for its contributor. "Reached" is the rule
-- public_card_supporters uses: the payment's money on the card, less a card release, above zero.
create or replace function public.ship_notices_due(p_limit integer default 50)
returns table (
  payment_id uuid,
  card_id uuid,
  stripe_session_id text,
  card_title text,
  card_folder text,
  live_at timestamptz,
  cost_usd numeric,
  unsubscribe_token text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, c.id, p.stripe_session_id, c.title, c.folder::text, c.live_at, money.card_studio_spend(c.id), public.ship_notice_token(p.id)
  from (
    select x.card_id, x.payment_id
    from public.contribution_allocations x
    where x.destination = 'card'
    group by x.card_id, x.payment_id
    having coalesce(sum(x.amount_usd) filter (where not (x.reason = 'card_release' and x.amount_usd < 0)), 0) > 0
  ) a
  join public.contributions p on p.id = a.payment_id
  join public.cards c on c.id = a.card_id
  cross join public.ship_notice_settings s
  where p.rail = 'stripe'
    and p.entry = 'payment'
    and p.stripe_session_id is not null
    and money.payment_counts(p.id)
    and c.stage = 'live'
    and c.live_at is not null
    and c.live_at >= s.starts_at
    and public.card_is_public(c.id)
    and not exists (select 1 from public.ship_notices n where n.payment_id = p.id and n.card_id = c.id)
    and not exists (select 1 from public.notice_unsubscribes u where u.contributor_id = p.contributor_id)
  order by c.live_at, c.id, p.created_at, p.id
  limit greatest(coalesce(p_limit, 50), 0)
$$;

-- Claims one (payment, card) before the send: true when this call made the row, false when a row was
-- already there (sent, failed, or claimed by another run), so the caller sends only on true.
create or replace function public.ship_notice_claim(p_payment uuid, p_card uuid) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  insert into public.ship_notices (payment_id, card_id, status)
  values (p_payment, p_card, 'sending')
  on conflict (payment_id, card_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Settles a claimed notice: sent (with Resend's id), failed, or no_address. Only a row still at
-- 'sending' moves, so a settle never rewrites a finished notice.
create or replace function public.ship_notice_settle(p_payment uuid, p_card uuid, p_status text, p_provider_id text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_status not in ('sent', 'failed', 'no_address') then
    raise exception 'ship_notice_settle: status % is not sent, failed or no_address', p_status;
  end if;
  update public.ship_notices
  set status = p_status, provider_id = nullif(p_provider_id, ''), settled_at = now()
  where payment_id = p_payment and card_id = p_card and status = 'sending';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- The unsubscribe link names a payment and carries its token; with a matching token this records the
-- payment's contributor, so every payment made with the same receipt email is left out from then on.
-- True when the token matches a Stripe payment (a second call is a no-op that still answers true);
-- false for anything else, with nothing written.
create or replace function public.ship_notice_unsubscribe(p_payment uuid, p_token text) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contributor text;
begin
  if p_payment is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  if p_token <> public.ship_notice_token(p_payment) then
    return false;
  end if;
  select contributor_id into v_contributor
  from public.contributions
  where id = p_payment and rail = 'stripe' and entry = 'payment';
  if v_contributor is null then
    return false;
  end if;
  insert into public.notice_unsubscribes (contributor_id) values (v_contributor)
  on conflict (contributor_id) do nothing;
  return true;
end;
$$;

revoke all on function public.ship_notices_due(integer) from public, anon, authenticated;
revoke all on function public.ship_notice_claim(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ship_notice_settle(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.ship_notice_unsubscribe(uuid, text) from public;
revoke all on function public.ship_notice_token(uuid) from public, anon, authenticated, service_role;
grant execute on function public.ship_notices_due(integer) to service_role;
grant execute on function public.ship_notice_claim(uuid, uuid) to service_role;
grant execute on function public.ship_notice_settle(uuid, uuid, text, text) to service_role;
grant execute on function public.ship_notice_unsubscribe(uuid, text) to anon, authenticated, service_role;
