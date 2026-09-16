-- Idempotent ledger writes (docs/specs/metering-reconciliation.md).
-- Applies after 20260921000100_public_card_columns.sql and can run twice.
-- The dispatcher retries a ledger write it could not confirm. A write that
-- committed while the client saw an error would then be recorded, and taken
-- from the pool, twice. Each dispatcher row now carries a request id made when
-- the row is priced, and record_usage writes an id once. The same id with
-- other values is refused rather than taken as a retry.

set lock_timeout = '5s';

alter table public.ledger add column if not exists request_id text;
create unique index if not exists ledger_request_id_key on public.ledger (request_id) where request_id is not null;

-- record_usage --------------------------------------------------------------
-- Same as the founder-billing version with p_request_id added last, defaulting
-- to null so every existing call keeps its meaning. The eight-argument
-- signature is dropped so only this one exists.

drop function if exists public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing);

create or replace function public.record_usage(
  p_card_id uuid,
  p_role_id uuid,
  p_model text,
  p_input_tokens integer,
  p_cached_tokens integer,
  p_output_tokens integer,
  p_usd numeric,
  p_billed_to public.ledger_billing default 'studio',
  p_request_id text default null
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
  v_existing public.ledger%rowtype;
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

  -- A repeated request id is a retry of a write that already landed: return
  -- that row's result and change nothing. The same id with other values is a
  -- fault in the caller and is refused. The card lock above, or the pool lock
  -- when there is no card, makes a concurrent retry wait for the first.
  if p_request_id is not null then
    if p_card_id is null then
      perform 1 from public.pool where id = 1 for update;
    end if;
    select * into v_existing from public.ledger where request_id = p_request_id;
    if found then
      if v_existing.card_id is distinct from p_card_id
        or v_existing.model is distinct from p_model
        or v_existing.usd is distinct from v_usd
        or v_existing.billed_to is distinct from p_billed_to then
        raise exception 'request id % was written with different values', p_request_id;
      end if;
      select balance_usd, daily_spent_usd into v_balance, v_daily from public.pool where id = 1;
      if p_card_id is not null then
        select actual_usd into v_actual from public.cards where id = p_card_id;
      end if;
      return jsonb_build_object(
        'ledger_id', v_existing.id,
        'balance_usd', v_balance,
        'daily_spent_usd', v_daily,
        'actual_usd', v_actual
      );
    end if;
  end if;

  insert into public.ledger (card_id, role_id, model, input_tokens, cached_tokens, output_tokens, usd, billed_to, request_id)
  values (p_card_id, p_role_id, p_model, coalesce(p_input_tokens, 0), coalesce(p_cached_tokens, 0), coalesce(p_output_tokens, 0), v_usd, p_billed_to, p_request_id)
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

-- Function privileges -------------------------------------------------------

revoke all on function public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing, text) from public, anon, authenticated;
grant execute on function public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing, text) to service_role;

-- PostgREST caches function signatures; reload so rpc/record_usage takes p_request_id at once.
notify pgrst, 'reload schema';
