-- Week 1 schema. Appendix A of docs/PLAN.md plus the recorded additions
-- (board_members, roles.name unique, the views and the RPCs).
-- Money is numeric(12,4). Single-row tables are pinned to id = 1.

create extension if not exists pgcrypto;

-- Enums ---------------------------------------------------------------------

create type public.card_bucket as enum ('game', 'platform', 'qa', 'studio', 'budget', 'agents');
create type public.card_source as enum ('board', 'community', 'agent', 'decision');
create type public.card_shape as enum ('oneoff', 'goal', 'standing');
create type public.card_lane as enum ('config', 'code');
create type public.card_folder as enum ('seed-1', 'platform');
create type public.card_confidence as enum ('low', 'med', 'high');
create type public.director_stance as enum ('neutral', 'endorsed', 'vetoed');
create type public.card_stage as enum ('proposed', 'designing', 'voted', 'funded', 'building', 'gated', 'live', 'rejected', 'paused');
create type public.card_severity as enum ('s1', 's2', 's3', 's4');
create type public.contribution_rail as enum ('stripe', 'twitch', 'founder');
create type public.contribution_kind as enum ('cash', 'hours', 'tokens');
create type public.agent_event_type as enum ('start', 'tool_call', 'tool_result', 'message', 'gate_pass', 'gate_fail', 'ship', 'revert', 'error');
create type public.role_state as enum ('active', 'retired');
create type public.scene as enum ('devcam', 'director', 'replay', 'idle');
create type public.note_state as enum ('new', 'triaged');
create type public.note_outcome as enum ('card', 'scheduled', 'discarded');
create type public.decision_size as enum ('small', 'medium', 'large');
create type public.decision_state as enum ('open', 'assigned', 'executed', 'expired');
create type public.board_role as enum ('board', 'moderator');

-- Tables --------------------------------------------------------------------

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  title text not null,
  species_note text not null,
  avatar_url text,
  model text not null,
  budget_share numeric(6,4) not null,
  voice text not null,
  prompt_path text not null,
  tools_json jsonb not null default '[]'::jsonb,
  metrics_json jsonb not null default '[]'::jsonb,
  write_access boolean not null default false,
  state public.role_state not null default 'active',
  hired_at timestamptz not null default now(),
  retired_at timestamptz
);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  bucket public.card_bucket not null,
  source public.card_source not null,
  shape public.card_shape not null,
  lane public.card_lane not null,
  priority integer not null default 100,
  board_reason text,
  folder public.card_folder not null,
  executor_role_id uuid references public.roles (id),
  title text not null,
  intent text,
  acceptance_test text,
  design_spec_url text,
  funding_target_usd numeric(12,4) not null default 0,
  funded_usd numeric(12,4) not null default 0,
  estimate_usd numeric(12,4) not null default 0,
  confidence public.card_confidence not null default 'low',
  proposer_role_id uuid references public.roles (id),
  director_stance public.director_stance not null default 'neutral',
  veto_reason text,
  stage public.card_stage not null default 'proposed',
  severity public.card_severity,
  actual_usd numeric(12,4) not null default 0,
  branch text,
  commit_sha text,
  failing_check text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ledger (
  id uuid primary key default gen_random_uuid(),
  card_id uuid references public.cards (id),
  role_id uuid references public.roles (id),
  model text not null,
  input_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  output_tokens integer not null default 0,
  usd numeric(12,4) not null default 0,
  created_at timestamptz not null default now()
);

create table public.pool (
  id integer primary key check (id = 1),
  balance_usd numeric(12,4) not null default 0,
  reserve_usd numeric(12,4) not null default 0,
  incident_reserve_usd numeric(12,4) not null default 0,
  daily_spent_usd numeric(12,4) not null default 0,
  day date not null default ((now() at time zone 'America/New_York')::date)
);

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  rail public.contribution_rail not null,
  contributor_id text not null,
  display_name text,
  amount_usd numeric(12,4) not null default 0,
  net_usd numeric(12,4) not null default 0,
  reserve_usd numeric(12,4) not null default 0,
  agents_usd numeric(12,4) not null default 0,
  studio_usd numeric(12,4) not null default 0,
  incident_usd numeric(12,4) not null default 0,
  studio_pct_chosen integer not null default 20 check (studio_pct_chosen between 0 and 100),
  kind public.contribution_kind not null default 'cash',
  public boolean not null default true,
  goal_card_id uuid references public.cards (id),
  decision_id uuid,
  stripe_event_id text unique,
  created_at timestamptz not null default now(),
  credited_at timestamptz
);

create table public.standing_costs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role_id uuid references public.roles (id),
  monthly_usd numeric(12,4) not null default 0,
  funded_this_month_usd numeric(12,4) not null default 0,
  month date not null
);

create table public.agent_events (
  id uuid primary key default gen_random_uuid(),
  card_id uuid references public.cards (id),
  role_id uuid references public.roles (id),
  type public.agent_event_type not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles (id),
  week date not null,
  first_pass_rate numeric(12,4),
  cost_per_ship numeric(12,4),
  estimate_accuracy numeric(12,4),
  reopen_rate numeric(12,4),
  composite numeric(12,4)
);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id),
  voter_id text not null,
  weight numeric(12,4) not null default 1,
  regime text not null,
  created_at timestamptz not null default now(),
  unique (card_id, voter_id)
);

create table public.stream_state (
  id integer primary key check (id = 1),
  scene public.scene not null default 'idle',
  updated_at timestamptz not null default now()
);

create table public.board_notes (
  id uuid primary key default gen_random_uuid(),
  author_email text not null,
  text text not null,
  state public.note_state not null default 'new',
  outcome public.note_outcome,
  outcome_reason text,
  card_id uuid references public.cards (id),
  created_at timestamptz not null default now(),
  triaged_at timestamptz
);

create table public.studio_state (
  id integer primary key check (id = 1),
  paused boolean not null default false,
  paused_by text,
  paused_at timestamptz,
  kill_switch_fired_at timestamptz,
  daily_cap_usd numeric(12,4) not null default 0,
  card_max_usd numeric(12,4) not null default 0,
  agent_hourly_rate_usd numeric(12,4) not null default 0,
  reserve_pct integer not null default 10 check (reserve_pct between 0 and 100),
  incident_pct integer not null default 5 check (incident_pct between 0 and 100),
  incident_cap_usd numeric(12,4) not null default 500,
  studio_reserve_usd numeric(12,4) not null default 0,
  image_providers_json jsonb not null default '[]'::jsonb,
  agent_mode text
);

create table public.images (
  id uuid primary key default gen_random_uuid(),
  card_id uuid references public.cards (id),
  provider text not null,
  prompt text not null,
  url text,
  cost_usd numeric(12,4) not null default 0,
  safety_passed boolean not null default false,
  board_approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  size public.decision_size not null,
  title text not null,
  options_json jsonb not null default '[]'::jsonb,
  config_key text,
  cost_usd numeric(12,4) not null default 0,
  state public.decision_state not null default 'open',
  assigned_to text,
  contribution_id uuid references public.contributions (id),
  chosen_option text,
  card_id uuid references public.cards (id),
  created_at timestamptz not null default now(),
  assigned_at timestamptz,
  executed_at timestamptz
);

alter table public.contributions
  add constraint contributions_decision_id_fkey foreign key (decision_id) references public.decisions (id);

create table public.deploys (
  id uuid primary key default gen_random_uuid(),
  folder public.card_folder not null,
  sha text not null,
  netlify_deploy_id text,
  is_green boolean not null default false,
  smoke_result text,
  created_at timestamptz not null default now()
);

create table public.board_members (
  email text primary key,
  role public.board_role not null default 'board',
  last_seen_at timestamptz
);

-- Indexes -------------------------------------------------------------------

create index cards_stage_priority_created_idx on public.cards (stage, priority, created_at);
create index cards_shape_created_idx on public.cards (shape, created_at);
create index ledger_card_id_idx on public.ledger (card_id);
create index ledger_created_at_idx on public.ledger (created_at);
create index contributions_created_at_idx on public.contributions (created_at);
create index agent_events_created_at_idx on public.agent_events (created_at);
create index agent_events_card_id_idx on public.agent_events (card_id);
create index board_notes_state_created_idx on public.board_notes (state, created_at);
create index deploys_folder_created_idx on public.deploys (folder, created_at desc);
create index decisions_state_size_created_idx on public.decisions (state, size, created_at);
create unique index decisions_open_config_key_idx on public.decisions (config_key) where state = 'open';

-- updated_at trigger --------------------------------------------------------

create or replace function public.set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger cards_set_updated_at
  before update on public.cards
  for each row execute function public.set_updated_at();

create trigger stream_state_set_updated_at
  before update on public.stream_state
  for each row execute function public.set_updated_at();

-- Views ---------------------------------------------------------------------

-- last_green: the newest green deploy per folder. Runs with the caller's rights;
-- deploys is readable by anon and authenticated.
create view public.last_green with (security_invoker = true) as
  select distinct on (folder) id, folder, sha, netlify_deploy_id, is_green, smoke_result, created_at
  from public.deploys
  where is_green
  order by folder, created_at desc;

-- public_agent_events: the event stream without payloads. Runs with the view
-- owner's rights on purpose: agent_events itself is closed to anon and
-- authenticated, and this view is the only public window onto it.
create view public.public_agent_events with (security_invoker = false) as
  select id, card_id, role_id, type, created_at
  from public.agent_events;

create view public.public_ledger_totals with (security_invoker = true) as
  select
    coalesce(sum(usd), 0)::numeric(12,4) as usd_total,
    coalesce(sum(input_tokens), 0)::bigint as input_tokens,
    coalesce(sum(cached_tokens), 0)::bigint as cached_tokens,
    coalesce(sum(output_tokens), 0)::bigint as output_tokens,
    count(*)::bigint as row_count
  from public.ledger;

-- Auth restriction ----------------------------------------------------------

create or replace function public.restrict_auth_users_to_board() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.board_members where lower(email) = lower(new.email)
  ) then
    raise exception 'Sign-in is limited to board accounts';
  end if;
  return new;
end;
$$;

create trigger restrict_auth_users_to_board
  before insert on auth.users
  for each row execute function public.restrict_auth_users_to_board();

-- Board RPCs ----------------------------------------------------------------

create or replace function public.is_board_member() returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return exists (
    select 1 from public.board_members
    where lower(email) = lower(coalesce(auth.email(), ''))
  );
end;
$$;

create or replace function public.board_role() returns public.board_role
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role public.board_role;
begin
  select role into v_role
  from public.board_members
  where lower(email) = lower(coalesce(auth.email(), ''));
  return v_role;
end;
$$;

create or replace function public.board_heartbeat() returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seen timestamptz;
begin
  update public.board_members
  set last_seen_at = now()
  where lower(email) = lower(coalesce(auth.email(), ''))
  returning last_seen_at into v_seen;
  if v_seen is null then
    raise exception 'Board membership is required';
  end if;
  return v_seen;
end;
$$;

create or replace function public.set_paused(p_paused boolean) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.board_role() is null then
    raise exception 'Board or moderator membership is required';
  end if;
  if p_paused is null then
    raise exception 'p_paused is required';
  end if;
  update public.studio_state
  set paused = p_paused,
      paused_by = case when p_paused then auth.email() else null end,
      paused_at = case when p_paused then now() else null end
  where id = 1;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;
end;
$$;

create or replace function public.file_directive(
  p_bucket public.card_bucket,
  p_lane public.card_lane,
  p_folder public.card_folder,
  p_title text,
  p_intent text,
  p_acceptance_test text,
  p_estimate_usd numeric,
  p_board_reason text,
  p_executor_role_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Board membership is required';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'A title is required';
  end if;
  if p_estimate_usd is null or p_estimate_usd < 0 then
    raise exception 'The estimate must be zero or more';
  end if;
  if p_executor_role_id is null then
    raise exception 'An executor role is required';
  end if;
  if not exists (
    select 1 from public.roles where id = p_executor_role_id and state = 'active'
  ) then
    raise exception 'The executor must be an active role';
  end if;
  insert into public.cards (
    bucket, source, shape, lane, priority, board_reason, folder, executor_role_id,
    title, intent, acceptance_test, estimate_usd, confidence, proposer_role_id, stage
  ) values (
    p_bucket, 'board', 'oneoff', p_lane, 0, p_board_reason, p_folder, p_executor_role_id,
    btrim(p_title), p_intent, p_acceptance_test, round(p_estimate_usd, 4), 'low', null, 'funded'
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.file_note(p_text text) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Board membership is required';
  end if;
  if p_text is null or btrim(p_text) = '' then
    raise exception 'Note text is required';
  end if;
  insert into public.board_notes (author_email, text, state)
  values (auth.email(), p_text, 'new')
  returning id into v_id;
  return v_id;
end;
$$;

-- Service-role RPCs ---------------------------------------------------------

create or replace function public.apply_contribution(
  p_stripe_event_id text,
  p_contributor_id text,
  p_display_name text,
  p_amount_usd numeric,
  p_net_usd numeric,
  p_studio_pct integer,
  p_goal_card_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(12,4);
  v_net numeric(12,4);
  v_reserve_pct integer;
  v_incident_pct integer;
  v_incident_cap numeric(12,4);
  v_incident_held numeric(12,4);
  v_reserve numeric(12,4);
  v_remainder numeric(12,4);
  v_studio numeric(12,4);
  v_agents numeric(12,4);
  v_incident numeric(12,4);
  v_room numeric(12,4);
  v_goal uuid;
  v_id uuid;
  v_size public.decision_size;
  v_decision uuid;
begin
  if p_stripe_event_id is null or p_stripe_event_id = '' then
    raise exception 'p_stripe_event_id is required';
  end if;
  if p_contributor_id is null or p_contributor_id = '' then
    raise exception 'p_contributor_id is required';
  end if;
  if p_amount_usd is null or p_amount_usd <= 0 then
    raise exception 'p_amount_usd must be above zero';
  end if;
  if p_net_usd is null or p_net_usd < 0 or p_net_usd > p_amount_usd then
    raise exception 'p_net_usd must be between zero and p_amount_usd';
  end if;
  if p_studio_pct is null or p_studio_pct < 0 or p_studio_pct > 100 then
    raise exception 'p_studio_pct must be between 0 and 100';
  end if;

  v_amount := round(p_amount_usd, 4);
  v_net := round(p_net_usd, 4);

  select reserve_pct, incident_pct, incident_cap_usd
  into v_reserve_pct, v_incident_pct, v_incident_cap
  from public.studio_state where id = 1;
  if not found then
    raise exception 'studio_state row 1 is missing';
  end if;

  select incident_reserve_usd into v_incident_held
  from public.pool where id = 1 for update;
  if not found then
    raise exception 'pool row 1 is missing';
  end if;

  v_reserve := round(v_net * v_reserve_pct / 100.0, 4);
  v_remainder := v_net - v_reserve;
  v_studio := round(v_remainder * p_studio_pct / 100.0, 4);
  v_agents := v_remainder - v_studio;
  v_room := greatest(0, v_incident_cap - v_incident_held);
  v_incident := least(round(v_agents * v_incident_pct / 100.0, 4), v_room);

  v_goal := null;
  if p_goal_card_id is not null then
    select id into v_goal from public.cards where id = p_goal_card_id and shape = 'goal';
  end if;

  insert into public.contributions (
    rail, contributor_id, display_name, amount_usd, net_usd, reserve_usd, agents_usd,
    studio_usd, incident_usd, studio_pct_chosen, kind, public, goal_card_id,
    stripe_event_id, credited_at
  ) values (
    'stripe', p_contributor_id, p_display_name, v_amount, v_net, v_reserve, v_agents,
    v_studio, v_incident, p_studio_pct, 'cash', true, v_goal,
    p_stripe_event_id, now()
  )
  on conflict (stripe_event_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.contributions where stripe_event_id = p_stripe_event_id;
    return jsonb_build_object(
      'inserted', false,
      'contribution_id', v_id,
      'reserve_usd', v_reserve,
      'studio_usd', v_studio,
      'agents_usd', v_agents,
      'incident_usd', v_incident,
      'pool_credit_usd', v_agents - v_incident
    );
  end if;

  update public.pool
  set balance_usd = balance_usd + (v_agents - v_incident),
      incident_reserve_usd = incident_reserve_usd + v_incident,
      reserve_usd = reserve_usd + v_reserve
  where id = 1;

  if v_goal is not null then
    update public.cards set funded_usd = funded_usd + v_amount where id = v_goal;
  end if;

  v_size := case
    when v_amount < 5 then 'small'::public.decision_size
    when v_amount < 50 then 'medium'::public.decision_size
    else 'large'::public.decision_size
  end;

  select id into v_decision
  from public.decisions
  where state = 'open' and size = v_size
  order by created_at asc
  limit 1
  for update skip locked;

  if v_decision is not null then
    update public.decisions
    set state = 'assigned',
        assigned_to = p_contributor_id,
        contribution_id = v_id,
        assigned_at = now()
    where id = v_decision;
    update public.contributions set decision_id = v_decision where id = v_id;
  end if;

  return jsonb_build_object(
    'inserted', true,
    'contribution_id', v_id,
    'reserve_usd', v_reserve,
    'studio_usd', v_studio,
    'agents_usd', v_agents,
    'incident_usd', v_incident,
    'pool_credit_usd', v_agents - v_incident
  );
end;
$$;

create or replace function public.founder_credit(
  p_amount_usd numeric,
  p_kind public.contribution_kind,
  p_display_name text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(12,4);
  v_id uuid;
begin
  if p_amount_usd is null or p_amount_usd <= 0 then
    raise exception 'p_amount_usd must be above zero';
  end if;
  if p_kind is null then
    raise exception 'p_kind is required';
  end if;
  v_amount := round(p_amount_usd, 4);

  insert into public.contributions (
    rail, contributor_id, display_name, amount_usd, net_usd, reserve_usd, agents_usd,
    studio_usd, incident_usd, studio_pct_chosen, kind, public, credited_at
  ) values (
    'founder', 'founder', p_display_name, v_amount, v_amount, 0, v_amount,
    0, 0, 0, p_kind, false, now()
  )
  returning id into v_id;

  update public.pool set balance_usd = balance_usd + v_amount where id = 1;
  if not found then
    raise exception 'pool row 1 is missing';
  end if;
  return v_id;
end;
$$;

create or replace function public.record_usage(
  p_card_id uuid,
  p_role_id uuid,
  p_model text,
  p_input_tokens integer,
  p_cached_tokens integer,
  p_output_tokens integer,
  p_usd numeric
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
  v_usd := round(p_usd, 4);

  if p_card_id is not null then
    select severity into v_severity from public.cards where id = p_card_id for update;
    if not found then
      raise exception 'card % does not exist', p_card_id;
    end if;
  end if;

  insert into public.ledger (card_id, role_id, model, input_tokens, cached_tokens, output_tokens, usd)
  values (p_card_id, p_role_id, p_model, coalesce(p_input_tokens, 0), coalesce(p_cached_tokens, 0), coalesce(p_output_tokens, 0), v_usd)
  returning id into v_ledger_id;

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

-- Row level security --------------------------------------------------------

alter table public.roles enable row level security;
alter table public.cards enable row level security;
alter table public.ledger enable row level security;
alter table public.pool enable row level security;
alter table public.contributions enable row level security;
alter table public.standing_costs enable row level security;
alter table public.agent_events enable row level security;
alter table public.scores enable row level security;
alter table public.votes enable row level security;
alter table public.stream_state enable row level security;
alter table public.board_notes enable row level security;
alter table public.studio_state enable row level security;
alter table public.images enable row level security;
alter table public.decisions enable row level security;
alter table public.deploys enable row level security;
alter table public.board_members enable row level security;

create policy pool_public_read on public.pool for select to anon, authenticated using (true);
create policy cards_public_read on public.cards for select to anon, authenticated using (true);
create policy ledger_public_read on public.ledger for select to anon, authenticated using (true);
create policy deploys_public_read on public.deploys for select to anon, authenticated using (true);
create policy roles_public_read on public.roles for select to anon, authenticated using (true);

-- Board writes go through the security-definer RPCs above, so anon and
-- authenticated hold no direct privileges on the private tables.
revoke all on table public.contributions from anon, authenticated;
revoke all on table public.standing_costs from anon, authenticated;
revoke all on table public.agent_events from anon, authenticated;
revoke all on table public.scores from anon, authenticated;
revoke all on table public.votes from anon, authenticated;
revoke all on table public.stream_state from anon, authenticated;
revoke all on table public.board_notes from anon, authenticated;
revoke all on table public.studio_state from anon, authenticated;
revoke all on table public.images from anon, authenticated;
revoke all on table public.decisions from anon, authenticated;
revoke all on table public.board_members from anon, authenticated;

revoke insert, update, delete, truncate, references, trigger on table public.pool from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.cards from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.ledger from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.deploys from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.roles from anon, authenticated;

grant select on table public.pool, public.cards, public.ledger, public.deploys, public.roles to anon, authenticated;
grant all on all tables in schema public to service_role;

-- The project's default privileges grant every new relation, views included,
-- to anon and authenticated; public_agent_events is a simple view that runs
-- with its owner's rights, so anything beyond select is revoked here.
revoke all on table public.last_green, public.public_agent_events, public.public_ledger_totals from anon, authenticated;
grant select on public.last_green to anon, authenticated;
grant select on public.public_agent_events to anon, authenticated;
grant select on public.public_ledger_totals to anon, authenticated;

-- Function privileges -------------------------------------------------------

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.restrict_auth_users_to_board() from public, anon, authenticated;
grant execute on function public.restrict_auth_users_to_board() to supabase_auth_admin;

revoke all on function public.is_board_member() from public, anon;
revoke all on function public.board_role() from public, anon;
revoke all on function public.board_heartbeat() from public, anon;
revoke all on function public.set_paused(boolean) from public, anon;
revoke all on function public.file_directive(public.card_bucket, public.card_lane, public.card_folder, text, text, text, numeric, text, uuid) from public, anon;
revoke all on function public.file_note(text) from public, anon;
grant execute on function public.is_board_member() to authenticated, service_role;
grant execute on function public.board_role() to authenticated, service_role;
grant execute on function public.board_heartbeat() to authenticated, service_role;
grant execute on function public.set_paused(boolean) to authenticated, service_role;
grant execute on function public.file_directive(public.card_bucket, public.card_lane, public.card_folder, text, text, text, numeric, text, uuid) to authenticated, service_role;
grant execute on function public.file_note(text) to authenticated, service_role;

revoke all on function public.apply_contribution(text, text, text, numeric, numeric, integer, uuid) from public, anon, authenticated;
revoke all on function public.founder_credit(numeric, public.contribution_kind, text) from public, anon, authenticated;
revoke all on function public.record_usage(uuid, uuid, text, integer, integer, integer, numeric) from public, anon, authenticated;
grant execute on function public.apply_contribution(text, text, text, numeric, numeric, integer, uuid) to service_role;
grant execute on function public.founder_credit(numeric, public.contribution_kind, text) to service_role;
grant execute on function public.record_usage(uuid, uuid, text, integer, integer, integer, numeric) to service_role;

-- Realtime ------------------------------------------------------------------

alter publication supabase_realtime add table public.pool, public.cards, public.deploys;
