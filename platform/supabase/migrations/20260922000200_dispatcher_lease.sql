-- Dispatcher lease and stored patches (docs/specs/launch-db.md).
-- Applies after 20260922000100_money_fixes.sql and can run twice.
--
-- One dispatcher ticks at a time. Each claims the lease before a tick and
-- renews it while it runs; a second dispatcher, the Mac left running after the
-- VPS cutover for example, is refused until the lease is released or expires.
-- The lease functions are for the service role only.
--
-- card_patches keeps each patch an unattended session submitted, with the sha
-- it was made against, so a card re-queued after main moves, or resumed after
-- the dispatcher stopped, is re-applied and re-gated without a new session.
-- sha256 is the lowercase hex SHA-256 of the patch's UTF-8 bytes and bytes is
-- their count, both checked on insert.
--
-- Both tables have row level security and no policy, and anon and
-- authenticated hold nothing on them.

set lock_timeout = '5s';

-- dispatcher_lease ----------------------------------------------------------

create table if not exists public.dispatcher_lease (
  id integer primary key check (id = 1),
  holder text,
  expires_at timestamptz,
  claimed_at timestamptz,
  constraint dispatcher_lease_holder_check check ((holder is null) = (expires_at is null))
);
insert into public.dispatcher_lease (id) values (1) on conflict (id) do nothing;
alter table public.dispatcher_lease enable row level security;
revoke all on table public.dispatcher_lease from anon, authenticated;
grant all on table public.dispatcher_lease to service_role;

-- claim_dispatcher_lease takes the lease when it is free, expired or already
-- held by p_holder, and holds it for p_ttl_seconds from now. It returns false,
-- and changes nothing, while another holder's lease is live. The update is one
-- statement on row 1, so two claims racing for a free lease cannot both win.
-- claimed_at is when the current holder's unbroken hold began.

create or replace function public.claim_dispatcher_lease(p_holder text, p_ttl_seconds integer) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_holder is null or btrim(p_holder) = '' then
    raise exception 'p_holder is required';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 3600 then
    raise exception 'p_ttl_seconds must be between 1 and 3600';
  end if;
  update public.dispatcher_lease
  set holder = p_holder,
      expires_at = now() + make_interval(secs => p_ttl_seconds),
      claimed_at = case when holder = p_holder and expires_at > now() then claimed_at else now() end
  where id = 1
    and (holder is null or holder = p_holder or expires_at <= now());
  if found then
    return true;
  end if;
  if not exists (select 1 from public.dispatcher_lease where id = 1) then
    raise exception 'dispatcher_lease row 1 is missing';
  end if;
  return false;
end;
$$;

-- release_dispatcher_lease frees the lease when p_holder holds it, and returns
-- whether it did.

create or replace function public.release_dispatcher_lease(p_holder text) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_holder is null or btrim(p_holder) = '' then
    raise exception 'p_holder is required';
  end if;
  update public.dispatcher_lease
  set holder = null, expires_at = null, claimed_at = null
  where id = 1 and holder = p_holder;
  return found;
end;
$$;

-- card_patches --------------------------------------------------------------

create table if not exists public.card_patches (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id),
  base_sha text not null constraint card_patches_base_sha_check check (base_sha ~ '^[0-9a-f]{40}$'),
  patch text not null,
  sha256 text not null constraint card_patches_sha256_check check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer not null,
  summary text,
  session_id text,
  created_at timestamptz not null default now(),
  constraint card_patches_digest_check check (
    sha256 = encode(sha256(convert_to(patch, 'UTF8')), 'hex')
    and bytes = octet_length(convert_to(patch, 'UTF8'))
  )
);
create index if not exists card_patches_card_created_idx on public.card_patches (card_id, created_at desc);
alter table public.card_patches enable row level security;
revoke all on table public.card_patches from anon, authenticated;
grant all on table public.card_patches to service_role;

-- Function privileges -------------------------------------------------------

revoke all on function public.claim_dispatcher_lease(text, integer) from public, anon, authenticated;
grant execute on function public.claim_dispatcher_lease(text, integer) to service_role;
revoke all on function public.release_dispatcher_lease(text) from public, anon, authenticated;
grant execute on function public.release_dispatcher_lease(text) to service_role;

notify pgrst, 'reload schema';
