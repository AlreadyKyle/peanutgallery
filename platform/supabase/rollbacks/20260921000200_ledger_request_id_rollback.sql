-- Rollback of 20260921000200_ledger_request_id.sql (docs/specs/metering-reconciliation.md,
-- Production steps). It lives outside migrations/ so it is never applied on its own. Run it only
-- with the dispatcher stopped and redeployed from a build before the request id: a later build
-- calls the nine-argument record_usage. It can run twice. Every ledger row and amount stays; only
-- the request ids are dropped.

set lock_timeout = '5s';

drop function if exists public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing, text);

-- The founder-billing record_usage, exactly as 20260918000000_founder_billing.sql defines it.
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

revoke all on function public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing) from public, anon, authenticated;
grant execute on function public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing) to service_role;

drop index if exists public.ledger_request_id_key;
alter table public.ledger drop column if exists request_id;

notify pgrst, 'reload schema';
