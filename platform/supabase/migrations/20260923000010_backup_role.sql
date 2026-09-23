-- The backup login, the ledger identity in SQL and the Controller's tables
-- (docs/specs/money-safety.md).
-- Applies after 20260923000000_contribution_entries.sql and can run twice.
--
-- peanutgallery_backup is the login the nightly `supabase db dump` uses
-- through the Session pooler, on the VPS and in the separate backups
-- repository. It reads every table and changes none. It is created with no
-- password, so nobody can sign in as it until the board's production step
-- sets one through the Management API; the password is never committed, and a
-- second run of this file leaves it as it is. Postgres refuses some of these
-- grants to a project owner that lacks the privilege itself (BYPASSRLS, the
-- auth schema, pg_read_all_data); each such grant is tried on its own and a
-- refusal is a notice, not a failure. The production step reads back what the
-- role can do before the first dump.
--
-- ledger_identity() is the three-line ledger identity of
-- scripts/ledger-identity.ts as one statement, so it reads one consistent
-- snapshot and runs on a restored dump in plain Postgres as well:
--   I1  pool.reserve_usd                                   = sum(contributions.reserve_usd)
--   I2  pool.balance_usd + incident_reserve_usd + held_usd = sum(contributions.agents_usd) - studio ledger usd
--   I3  pool.held_usd                                      = sum(contributions.held_usd)
-- Overhead and founder ledger rows touch no pool figure and stay out.
--
-- controller_runs records each run of the Controller and the quota check,
-- service role only; the board reads it through a later board RPC.
-- controller_figures() and ops_database_size() give those jobs their database
-- figures in one call each.

set lock_timeout = '5s';

-- The backup login ----------------------------------------------------------

do $$
begin
  create role peanutgallery_backup with login nosuperuser nocreatedb nocreaterole noreplication inherit connection limit 4;
exception
  when duplicate_object then null;
end
$$;

-- Everything here except the password, which a second run must not touch.
-- inherit lets it use pg_read_all_data when that grant is allowed below;
-- default_transaction_read_only keeps a mistyped write from landing even if a
-- grant were ever widened.
alter role peanutgallery_backup with login nosuperuser nocreatedb nocreaterole noreplication inherit connection limit 4;
alter role peanutgallery_backup set default_transaction_read_only = on;

do $$
begin
  alter role peanutgallery_backup with bypassrls;
exception
  when insufficient_privilege then
    raise notice 'peanutgallery_backup: BYPASSRLS refused (%); pg_dump cannot read tables with row level security as this role', sqlerrm;
end
$$;

do $$
begin
  grant pg_read_all_data to peanutgallery_backup;
exception
  when insufficient_privilege or undefined_object then
    raise notice 'peanutgallery_backup: pg_read_all_data refused (%); it reads through the schema grants below', sqlerrm;
end
$$;

grant usage on schema public to peanutgallery_backup;
grant select on all tables in schema public to peanutgallery_backup;
grant select on all sequences in schema public to peanutgallery_backup;
alter default privileges in schema public grant select on tables to peanutgallery_backup;
alter default privileges in schema public grant select on sequences to peanutgallery_backup;

do $$
begin
  grant usage on schema auth to peanutgallery_backup;
  grant select on all tables in schema auth to peanutgallery_backup;
exception
  when insufficient_privilege or invalid_schema_name then
    raise notice 'peanutgallery_backup: the auth schema grant was refused (%); the auth dump needs the database password instead', sqlerrm;
end
$$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'supabase_migrations') then
    grant usage on schema supabase_migrations to peanutgallery_backup;
    grant select on all tables in schema supabase_migrations to peanutgallery_backup;
  end if;
exception
  when insufficient_privilege then
    raise notice 'peanutgallery_backup: the supabase_migrations grant was refused (%)', sqlerrm;
end
$$;

-- ledger_identity -----------------------------------------------------------

create or replace function public.ledger_identity() returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pool public.pool%rowtype;
  v_reserve numeric;
  v_agents numeric;
  v_held numeric;
  v_rows bigint;
  v_studio numeric;
  v_overhead numeric;
  v_studio_rows bigint;
  v_overhead_rows bigint;
  v_i1 numeric;
  v_i2 numeric;
  v_i3 numeric;
begin
  select * into v_pool from public.pool where id = 1;
  if not found then
    return jsonb_build_object('holds', false, 'error', 'pool row 1 is missing');
  end if;
  select coalesce(sum(reserve_usd), 0), coalesce(sum(agents_usd), 0), coalesce(sum(held_usd), 0), count(*)
  into v_reserve, v_agents, v_held, v_rows
  from public.contributions;
  select
    coalesce(sum(usd) filter (where billed_to = 'studio'), 0),
    coalesce(sum(usd) filter (where billed_to = 'overhead'), 0),
    count(*) filter (where billed_to = 'studio'),
    count(*) filter (where billed_to = 'overhead')
  into v_studio, v_overhead, v_studio_rows, v_overhead_rows
  from public.ledger;

  v_i1 := v_pool.reserve_usd - v_reserve;
  v_i2 := (v_pool.balance_usd + v_pool.incident_reserve_usd + v_pool.held_usd) - (v_agents - v_studio);
  v_i3 := v_pool.held_usd - v_held;

  return jsonb_build_object(
    'holds', v_i1 = 0 and v_i2 = 0 and v_i3 = 0,
    'lines', jsonb_build_array(
      jsonb_build_object('name', 'I1', 'left', v_pool.reserve_usd, 'right', v_reserve, 'drift', v_i1, 'holds', v_i1 = 0),
      jsonb_build_object('name', 'I2', 'left', v_pool.balance_usd + v_pool.incident_reserve_usd + v_pool.held_usd, 'right', v_agents - v_studio, 'drift', v_i2, 'holds', v_i2 = 0),
      jsonb_build_object('name', 'I3', 'left', v_pool.held_usd, 'right', v_held, 'drift', v_i3, 'holds', v_i3 = 0)
    ),
    'contribution_rows', v_rows,
    'studio_rows', v_studio_rows,
    'overhead_rows', v_overhead_rows,
    'studio_usd', v_studio,
    'overhead_usd', v_overhead,
    'checked_at', now()
  );
end;
$$;

-- controller_runs -----------------------------------------------------------
-- One row per run of the Controller (job reconcile) or the quota check (job
-- quota): whether every check passed, the checks themselves and the figures
-- the board acts on. 20260923000020_append_only.sql makes it append-only.

create table if not exists public.controller_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null constraint controller_runs_job_check check (job in ('reconcile', 'quota')),
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  ok boolean not null,
  mismatches integer not null default 0 constraint controller_runs_mismatches_check check (mismatches >= 0),
  checks jsonb not null default '[]'::jsonb constraint controller_runs_checks_check check (jsonb_typeof(checks) = 'array'),
  figures jsonb not null default '{}'::jsonb constraint controller_runs_figures_check check (jsonb_typeof(figures) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists controller_runs_job_created_idx on public.controller_runs (job, created_at desc);
alter table public.controller_runs enable row level security;
revoke all on table public.controller_runs from anon, authenticated;
grant select, insert on table public.controller_runs to service_role;

-- controller_figures --------------------------------------------------------
-- The database side of the Controller's run in one snapshot: the pool, the
-- Console credit bought and spent, the remaining ceilings of funded cards
-- (150% of the estimate, capped by the per-card maximum, less the card's studio
-- spend, as the dispatcher's throttle computes it), and every Stripe payment
-- with its refunds, disputes, reinstatements, adjustments and the agent money
-- it still holds: agents less the incident share less any hold.

create or replace function public.controller_figures() returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pool public.pool%rowtype;
  v_state public.studio_state%rowtype;
  v_last timestamptz;
  v_credit jsonb;
  v_cards jsonb;
  v_families jsonb;
begin
  select * into v_pool from public.pool where id = 1;
  if not found then
    raise exception 'pool row 1 is missing';
  end if;
  select * into v_state from public.studio_state where id = 1;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;
  select max(created_at) into v_last from public.credit_purchases;

  select jsonb_build_object(
    'bought_usd', coalesce((select sum(amount_usd) from public.credit_purchases), 0),
    'purchases', (select count(*) from public.credit_purchases),
    'last_purchase_at', v_last,
    'studio_spend_usd', coalesce(sum(usd) filter (where billed_to = 'studio'), 0),
    'overhead_usd', coalesce(sum(usd) filter (where billed_to = 'overhead'), 0),
    'overhead_since_last_purchase_usd', coalesce(sum(usd) filter (where billed_to = 'overhead' and (v_last is null or created_at > v_last)), 0)
  ) into v_credit
  from public.ledger;

  select jsonb_build_object(
    'count', count(*),
    'remaining_ceilings_usd', coalesce(sum(greatest(least(round(1.5 * c.estimate_usd, 4), v_state.card_max_usd) - coalesce(s.usd, 0), 0)), 0)
  ) into v_cards
  from public.cards c
  left join (
    select card_id, sum(usd) as usd from public.ledger
    where billed_to = 'studio' and card_id is not null
    group by card_id
  ) s on s.card_id = c.id
  where c.stage in ('funded', 'building');

  select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at, f.payment_id), '[]'::jsonb) into v_families
  from (
    select
      p.id as payment_id,
      p.stripe_session_id as session_id,
      p.rail::text as rail,
      p.created_at,
      p.amount_usd,
      p.net_usd,
      -coalesce(sum(c.amount_usd) filter (where c.entry = 'refund'), 0) as refunded_usd,
      -coalesce(sum(c.amount_usd) filter (where c.entry = 'dispute'), 0) as disputed_usd,
      coalesce(sum(c.amount_usd) filter (where c.entry = 'reinstated'), 0) as reinstated_usd,
      coalesce(sum(c.net_usd) filter (where c.entry = 'adjustment'), 0) as adjusted_net_usd,
      (p.agents_usd - p.incident_usd - p.held_usd) + coalesce(sum(c.agents_usd - c.incident_usd - c.held_usd), 0) as agent_money_usd,
      p.held_usd + coalesce(sum(c.held_usd), 0) as held_usd
    from public.contributions p
    left join public.contributions c on c.parent_id = p.id
    where p.entry = 'payment'
    group by p.id
  ) f;

  return jsonb_build_object(
    'pool', jsonb_build_object(
      'balance_usd', v_pool.balance_usd,
      'reserve_usd', v_pool.reserve_usd,
      'incident_reserve_usd', v_pool.incident_reserve_usd,
      'held_usd', v_pool.held_usd
    ),
    'studio_reserve_usd', v_state.studio_reserve_usd,
    'card_max_usd', v_state.card_max_usd,
    'credit', v_credit,
    'funded_cards', v_cards,
    'families', v_families
  );
end;
$$;

-- ops_database_size ---------------------------------------------------------
-- The database's size in bytes, for the quota check's 350 MB alert.

create or replace function public.ops_database_size() returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select pg_database_size(current_database());
$$;

-- Function privileges -------------------------------------------------------

revoke all on function public.ledger_identity() from public, anon, authenticated;
grant execute on function public.ledger_identity() to service_role, peanutgallery_backup;
revoke all on function public.controller_figures() from public, anon, authenticated;
grant execute on function public.controller_figures() to service_role;
revoke all on function public.ops_database_size() from public, anon, authenticated;
grant execute on function public.ops_database_size() to service_role;

notify pgrst, 'reload schema';
