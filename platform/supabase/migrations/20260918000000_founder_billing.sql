-- Founder billing (docs/specs/launch-hardening.md).
-- Applies on top of 20260917000000_contribution_session.sql and can run twice.
-- An attended session runs on the founder's subscription, so its usage is
-- priced onto the ledger and the card but never taken from the pool, which
-- holds customer money only. The public sees studio-billed rows only.

do $$
begin
  create type public.ledger_billing as enum ('studio', 'founder');
exception
  when duplicate_object then null;
end
$$;

alter table public.ledger add column if not exists billed_to public.ledger_billing not null default 'studio';

-- record_usage --------------------------------------------------------------
-- Same as the week-1 version with p_billed_to added last, defaulting to
-- studio so the old call shape keeps its meaning. A founder row locks the card
-- and charges it, and leaves the pool, the day's spend and the incident
-- reserve alone. The old seven-argument signature is dropped so only this one
-- exists.

drop function if exists public.record_usage(uuid, uuid, text, integer, integer, integer, numeric);

create or replace function public.record_usage(
  p_card_id uuid,
  p_role_id uuid,
  p_model text,
  p_input_tokens integer,
  p_cached_tokens integer,
  p_output_tokens integer,
  p_usd numeric,
  p_billed_to public.ledger_billing default 'studio'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usd numeric(12,4);
  v_today date := (now() at time zone 'America/New_York')::date;
  v_ledger_id uuid;
  v_day date;
  v_incident_held numeric(12,4);
  v_severity public.card_severity;
  v_draw numeric(12,4) := 0;
  v_balance numeric(12,4);
  v_daily numeric(12,4);
  v_actual numeric(12,4);
begin
  if p_model is null or p_model = '' then
    raise exception 'p_model is required';
  end if;
  if p_usd is null or p_usd < 0 then
    raise exception 'p_usd must be zero or more';
  end if;
  if p_billed_to is null then
    raise exception 'p_billed_to is required';
  end if;
  v_usd := round(p_usd, 4);

  if p_card_id is not null then
    select severity into v_severity from public.cards where id = p_card_id for update;
    if not found then
      raise exception 'card % does not exist', p_card_id;
    end if;
  end if;

  insert into public.ledger (card_id, role_id, model, input_tokens, cached_tokens, output_tokens, usd, billed_to)
  values (p_card_id, p_role_id, p_model, coalesce(p_input_tokens, 0), coalesce(p_cached_tokens, 0), coalesce(p_output_tokens, 0), v_usd, p_billed_to)
  returning id into v_ledger_id;

  if p_billed_to = 'founder'::public.ledger_billing then
    select balance_usd, daily_spent_usd into v_balance, v_daily from public.pool where id = 1;
    if not found then
      raise exception 'pool row 1 is missing';
    end if;
  else
    select day, incident_reserve_usd into v_day, v_incident_held
    from public.pool where id = 1 for update;
    if not found then
      raise exception 'pool row 1 is missing';
    end if;

    if v_day is distinct from v_today then
      update public.pool set daily_spent_usd = 0, day = v_today where id = 1;
    end if;

    if v_severity = 's1'::public.card_severity then
      v_draw := least(v_usd, greatest(v_incident_held, 0));
    end if;

    update public.pool
    set incident_reserve_usd = incident_reserve_usd - v_draw,
        balance_usd = balance_usd - (v_usd - v_draw),
        daily_spent_usd = daily_spent_usd + v_usd
    where id = 1
    returning balance_usd, daily_spent_usd into v_balance, v_daily;
  end if;

  if p_card_id is not null then
    update public.cards set actual_usd = actual_usd + v_usd where id = p_card_id
    returning actual_usd into v_actual;
  end if;

  return jsonb_build_object(
    'ledger_id', v_ledger_id,
    'balance_usd', v_balance,
    'daily_spent_usd', v_daily,
    'actual_usd', v_actual
  );
end;
$$;

-- Public window -------------------------------------------------------------
-- The founder's tokens are tracked and never published (PLAN.md §4 The Board).

drop policy if exists ledger_public_read on public.ledger;
create policy ledger_public_read on public.ledger for select to anon, authenticated using (billed_to = 'studio');

create or replace view public.public_ledger_totals with (security_invoker = true) as
  select
    coalesce(sum(usd), 0)::numeric(12,4) as usd_total,
    coalesce(sum(input_tokens), 0)::bigint as input_tokens,
    coalesce(sum(cached_tokens), 0)::bigint as cached_tokens,
    coalesce(sum(output_tokens), 0)::bigint as output_tokens,
    count(*)::bigint as row_count
  from public.ledger
  where billed_to = 'studio';

-- Function privileges -------------------------------------------------------

revoke all on function public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing) from public, anon, authenticated;
grant execute on function public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing) to service_role;
