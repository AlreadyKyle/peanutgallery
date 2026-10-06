-- launch-stamp (docs/specs/no-pause-no-golive.md, docs/PLAN.md §10 decision 62): no
-- Go live button. studio_state.launched_at is stamped by the database when the
-- studio records its first agent credit purchase: the first row inserted into
-- public.credit_purchases while launched_at is null sets it to now(). A
-- supporter who paid before then is founding (money.assign_supporter compares
-- the payment with launched_at), so founding supporters are those who funded
-- the studio before it bought its first agent credit.
--
-- Additive: one trigger function and one trigger. set_launched stays in the
-- database, unchanged; the board site no longer calls it. A stamp already set
-- (by set_launched, or by this trigger) is never moved: the update matches only
-- while launched_at is null.
--
-- Backfill: if a credit purchase was recorded before this file and launched_at
-- is still null, launched_at becomes the first purchase's created_at, the time
-- the trigger would have stamped.
--
-- Re-runnable: the function is replaced, the trigger dropped and created, and
-- the backfill matches only a null launched_at.

set lock_timeout = '5s';

-- a. The stamp -------------------------------------------------------------------
-- A trigger function, never an RPC: it returns trigger, so PostgREST cannot call
-- it, and it is revoked from anon and authenticated like studio_pause_reason.
-- It runs with the caller's rights; only the service role and the security
-- definer record_credit_purchase insert credit purchases, and both may update
-- studio_state.

create or replace function public.stamp_launched_at() returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.studio_state
  set launched_at = now()
  where id = 1 and launched_at is null;
  return null;
end;
$$;

drop trigger if exists credit_purchases_stamp_launched_at on public.credit_purchases;
create trigger credit_purchases_stamp_launched_at after insert on public.credit_purchases
  for each row execute function public.stamp_launched_at();

revoke all on function public.stamp_launched_at() from public, anon, authenticated;

-- b. Backfill --------------------------------------------------------------------

update public.studio_state
set launched_at = (select min(created_at) from public.credit_purchases)
where id = 1
  and launched_at is null
  and exists (select 1 from public.credit_purchases);
