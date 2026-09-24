-- Supporter pages: event lines, supporter credits, role stats, a card's own
-- document and the /thanks answer (docs/specs/supporter-pages.md). Applies after
-- 20260924500000_site_snapshot.sql and can run twice.
--
-- event_line_key maps an agent event to a fixed line key from its type, its
-- tool name (compared without regard to case, so Claude Code's Read and
-- Managed Agents' read give the same key) and its message step, never from
-- free text. public_agent_events gains it as line_key, appended after the
-- columns agent-system-core left (step and usd last); a row whose key is none
-- (a tool result, an unlisted message) never reaches a public document. The
-- database's own steps get keys too: dealt, a top-up from Not on a card yet
-- (its amount is the view's usd), a resume by rule, and the Studio Head's
-- ranking, which the step column leaves out because a role wrote it.
--
-- public_card_supporters lists each supporter on every card their money
-- reached, with the same test public_card_funding counts contributors by: a
-- payment that counts (money.payment_counts: not the board's test payment, not
-- fully refunded or disputed net of reinstatements) whose allocations to the
-- card, less any card_release out of it, are above zero. So a card's count and
-- its list agree.
--
-- public_role_stats is each role's studio-billed spend (all time and the last
-- seven days) and how many live cards it executed. Founder-billed rows stay
-- private (PLAN.md §4 The Board), so they are in neither figure.
--
-- site_card(p_id) is a card's own document for /card/:id: security invoker,
-- reading only what anon may read. thanks_for_session(p_session) is the one
-- function here that reads private money rows, as security definer, and it
-- answers a fixed set of keys that carry no amount, email, name, contributor id
-- or payer key.
--
-- site_live() and site_cards() are recreated from site-snapshot's versions:
-- events keep step and usd, carry line_key and leave key none out, and the
-- live document gains role_stats. site_cards()'s roles already carry status, trigger, paused and
-- paused_reason through public_roles, so it is recreated unchanged in shape.

set lock_timeout = '5s';

-- a. event_line_key -------------------------------------------------------------

create or replace function public.event_line_key(p_type public.agent_event_type, p_payload jsonb) returns text
language sql
immutable
set search_path = public
as $$
  select case p_type::text
    when 'start' then 'started'
    when 'tool_call' then
      case lower(coalesce(p_payload ->> 'name', ''))
        when 'read' then 'read'
        when 'grep' then 'read'
        when 'glob' then 'read'
        when 'ls' then 'read'
        when 'edit' then 'edited'
        when 'write' then 'edited'
        when 'multiedit' then 'edited'
        when 'notebookedit' then 'edited'
        when 'bash' then 'ran'
        when 'submit_patch' then 'submitted'
        else 'used_tool'
      end
    when 'message' then
      case coalesce(p_payload ->> 'step', '')
        when 'smoke_pass' then 'smoke_passed'
        when 'requeue' then 'requeued'
        when 'infrastructure' then 'paused_infra'
        when 'patch_reused' then 'patch_reused'
        when 'dealt' then 'dealt'
        when 'ceiling_top_up' then 'topped_up'
        when 'resume_rule' then 'resumed'
        when 'ranked' then 'ranked'
        else 'none'
      end
    when 'tool_result' then 'none'
    when 'gate_pass' then 'gate_passed'
    when 'gate_fail' then 'gate_failed'
    when 'ship' then 'shipped'
    when 'revert' then 'reverted'
    when 'error' then 'stopped'
    else 'other'
  end
$$;

-- A view's function calls are checked against the role reading the view.
revoke all on function public.event_line_key(public.agent_event_type, jsonb) from public;
grant execute on function public.event_line_key(public.agent_event_type, jsonb) to anon, authenticated, service_role;

-- b. public_agent_events --------------------------------------------------------
-- agent-system-core's definition, its columns in order (step and usd included:
-- create or replace view cannot drop a column) and its filter kept, with
-- line_key appended after usd.

create or replace view public.public_agent_events with (security_invoker = false) as
  select id, card_id, role_id, type, created_at,
    case when role_id is null and type = 'message' and payload_json ->> 'step' in ('dealt', 'ceiling_top_up', 'resume_rule')
      then payload_json ->> 'step' end as step,
    case when role_id is null and type = 'message' and payload_json ->> 'step' = 'ceiling_top_up'
      then (payload_json ->> 'usd')::numeric(12,4) end as usd,
    public.event_line_key(type, payload_json) as line_key
  from public.agent_events
  where card_id is null or public.card_is_public(card_id);

revoke all on table public.public_agent_events from anon, authenticated;
grant select on public.public_agent_events to anon, authenticated;

-- c. public_card_supporters -----------------------------------------------------

create or replace view public.public_card_supporters with (security_invoker = false) as
  select r.card_id, s.number as supporter_number, s.founding
  from (
    select distinct a.card_id, p.contributor_id
    from (
      select
        x.card_id,
        x.payment_id,
        sum(x.amount_usd) filter (where not (x.reason = 'card_release' and x.amount_usd < 0)) as reached_usd
      from public.contribution_allocations x
      where x.destination = 'card'
      group by x.card_id, x.payment_id
    ) a
    join public.contributions p on p.id = a.payment_id
    where a.reached_usd > 0 and money.payment_counts(a.payment_id)
  ) r
  join public.supporters s on s.contributor_id = r.contributor_id
  where public.card_is_public(r.card_id);

revoke all on table public.public_card_supporters from anon, authenticated, service_role;
grant select on public.public_card_supporters to anon, authenticated, service_role;

-- d. public_role_stats ----------------------------------------------------------

create or replace view public.public_role_stats with (security_invoker = false) as
  select
    r.id as role_id,
    coalesce((
      select sum(l.usd) from public.ledger l
      where l.role_id = r.id and l.billed_to = 'studio'
    ), 0)::numeric(12,4) as spent_usd,
    coalesce((
      select sum(l.usd) from public.ledger l
      where l.role_id = r.id and l.billed_to = 'studio' and l.created_at >= now() - interval '7 days'
    ), 0)::numeric(12,4) as spent_7d_usd,
    (
      select count(*) from public.cards c
      where c.executor_role_id = r.id and c.stage = 'live' and public.card_is_public(c.id)
    )::integer as shipped_cards
  from public.roles r;

revoke all on table public.public_role_stats from anon, authenticated, service_role;
grant select on public.public_role_stats to anon, authenticated, service_role;

-- e. site_card ------------------------------------------------------------------
-- One card's document, or null when no public card has the id. As anon it
-- reads the cards columns anon may select (named one by one, as site_cards()
-- does) and the public views.

create or replace function public.site_card(p_id uuid) returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select case when c.id is null then null else jsonb_build_object(
    'card', jsonb_build_object(
      'id', c.id, 'bucket', c.bucket, 'source', c.source, 'shape', c.shape, 'lane', c.lane,
      'board_reason', c.board_reason, 'folder', c.folder, 'executor_role_id', c.executor_role_id,
      'title', c.title, 'summary', c.summary, 'intent', c.intent, 'acceptance_test', c.acceptance_test,
      'design_spec_url', c.design_spec_url, 'funding_target_usd', c.funding_target_usd,
      'funded_usd', c.funded_usd, 'estimate_usd', c.estimate_usd, 'confidence', c.confidence,
      'proposer_role_id', c.proposer_role_id, 'director_stance', c.director_stance,
      'veto_reason', c.veto_reason, 'stage', c.stage, 'branch', c.branch, 'commit_sha', c.commit_sha,
      'failing_check', c.failing_check, 'created_at', c.created_at, 'updated_at', c.updated_at,
      'live_at', c.live_at, 'horizon', c.horizon, 'rank', c.rank, 'drafter_role_id', c.drafter_role_id,
      'check_author_role_id', c.check_author_role_id, 'opens_at', c.opens_at,
      'board_vetoed', c.board_vetoed, 'board_veto_reason', c.board_veto_reason
    ),
    'funding', (
      select jsonb_build_object('contributors', f.contributors, 'credited_usd', f.credited_usd, 'on_card_usd', f.on_card_usd)
      from public.public_card_funding f where f.card_id = c.id
    ),
    'spent_usd', coalesce((select s.spent_usd from public.public_card_spend s where s.card_id = c.id), 0),
    'supporters', coalesce((
      select jsonb_agg(jsonb_build_object('number', x.supporter_number, 'founding', x.founding) order by x.supporter_number)
      from (
        select supporter_number, founding from public.public_card_supporters
        where card_id = c.id
        order by supporter_number
        limit 24
      ) x
    ), '[]'::jsonb),
    'supporter_count', (select count(*) from public.public_card_supporters where card_id = c.id)::integer,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('role_id', e.role_id, 'line_key', e.line_key, 'usd', e.usd, 'created_at', e.created_at) order by e.created_at, e.id)
      from (
        select id, role_id, line_key, usd, created_at from public.public_agent_events
        where card_id = c.id and line_key <> 'none'
        order by created_at desc, id desc
        limit 200
      ) e
    ), '[]'::jsonb),
    'line_count', (select count(*) from public.public_agent_events where card_id = c.id and line_key <> 'none')::integer,
    'milestones', jsonb_build_object(
      'created_at', c.created_at,
      'started_at', (select min(e.created_at) from public.public_agent_events e where e.card_id = c.id and e.type = 'start'),
      'gate_at', g.created_at,
      'gate', case g.type when 'gate_pass' then 'passed' when 'gate_fail' then 'failed' end,
      'live_at', c.live_at
    ),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'title', r.title) order by r.name, r.id)
      from public.public_roles r
      where r.id = c.executor_role_id
         or r.id in (select e.role_id from public.public_agent_events e where e.card_id = c.id and e.line_key <> 'none')
    ), '[]'::jsonb),
    'stopped', (select to_jsonb(x) from public.public_stopped_cards x where x.card_id = c.id)
  ) end
  from (select 1) one
  left join public.cards c on c.id = p_id and public.card_is_public(c.id)
  left join lateral (
    select e.type, e.created_at from public.public_agent_events e
    where e.card_id = c.id and e.type in ('gate_pass', 'gate_fail')
    order by e.created_at desc, e.id desc
    limit 1
  ) g on true
$$;

revoke all on function public.site_card(uuid) from public;
grant execute on function public.site_card(uuid) to anon, authenticated, service_role;

-- f. thanks_for_session ---------------------------------------------------------
-- The /thanks answer for a Checkout Session id. A malformed, unknown or not yet
-- recorded session is pending alike, so the answer reveals nothing without a
-- real session id. The board's test payment is not_counted. A recorded payment
-- answers its supporter number and founding, the card it named, up to five
-- cards its money reached (the named card first), whether some waits in Not on
-- a card yet, whether it counts, is held or was reversed, the New York date a
-- hold ends and the Terms version it was stamped with.

create or replace function public.thanks_for_session(p_session text) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pay public.contributions%rowtype;
  v_supporter jsonb;
  v_named uuid;
  v_counts boolean;
  v_held boolean;
  v_reached jsonb;
  v_waiting boolean;
begin
  if p_session is null or p_session !~ '^cs_(live|test)_[A-Za-z0-9]{10,250}$' then
    return jsonb_build_object('status', 'pending');
  end if;
  select * into v_pay from public.contributions
  where stripe_session_id = p_session and entry = 'payment'
  order by created_at, id
  limit 1;
  if not found then
    return jsonb_build_object('status', 'pending');
  end if;
  if exists (select 1 from public.board_test_payments b where b.stripe_session_id = p_session) then
    return jsonb_build_object('status', 'not_counted');
  end if;

  select jsonb_build_object('number', s.number, 'founding', s.founding) into v_supporter
  from public.supporters s where s.contributor_id = v_pay.contributor_id;

  v_named := coalesce(v_pay.goal_card_id, v_pay.requested_card_id);
  if v_named is not null and not public.card_is_public(v_named) then
    v_named := null;
  end if;

  v_counts := money.payment_counts(v_pay.id);
  v_held := v_pay.held_usd + coalesce((
    select sum(h.held_usd) from public.contributions h where h.parent_id = v_pay.id
  ), 0) > 0;

  if v_counts then
    select coalesce(jsonb_agg(x.card_id order by x.named desc, x.first_seq), '[]'::jsonb) into v_reached
    from (
      select a.card_id, (a.card_id = v_named) as named, min(a.seq) as first_seq
      from public.contribution_allocations a
      where a.payment_id = v_pay.id and a.destination = 'card' and public.card_is_public(a.card_id)
      group by a.card_id
      having sum(a.amount_usd) > 0
      order by (a.card_id = v_named) desc, min(a.seq)
      limit 5
    ) x;
    v_waiting := coalesce((
      select sum(a.amount_usd) from public.contribution_allocations a
      where a.payment_id = v_pay.id and a.destination = 'unassigned'
    ), 0) > 0;
  else
    v_reached := '[]'::jsonb;
    v_waiting := false;
  end if;

  return jsonb_build_object(
    'status', 'recorded',
    'supporter', v_supporter,
    'named_card_id', v_named,
    'reached', v_reached,
    'waiting', v_waiting,
    'credit', case when not v_counts then 'reversed' when v_held then 'held' else 'credited' end,
    'held_until', case when v_counts and v_held and v_pay.hold_until is not null then (v_pay.hold_until at time zone 'America/New_York')::date end,
    'terms_version', v_pay.terms_version
  );
end;
$$;

revoke all on function public.thanks_for_session(text) from public;
grant execute on function public.thanks_for_session(text) to anon, authenticated, service_role;

-- g. site_cards and site_live ---------------------------------------------------
-- site-snapshot's versions. site_cards() is unchanged in shape: public_roles
-- already carries each role's status, trigger, paused and paused_reason.
-- site_live()'s events keep step and usd, carry line_key and leave key none
-- out (the newest 20 with a key), and it gains role_stats.

create or replace function public.site_cards() returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with listed as (
    select c.id from public.cards c
    where c.stage in ('proposed', 'designing', 'voted', 'funded', 'building', 'gated', 'paused')
    union all
    (select c.id from public.cards c where c.stage = 'live' order by c.live_at desc nulls last, c.id desc limit 200)
    union all
    (select c.id from public.cards c where c.stage = 'rejected' order by c.updated_at desc, c.id desc limit 50)
  )
  select jsonb_build_object(
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'bucket', c.bucket, 'source', c.source, 'shape', c.shape, 'lane', c.lane,
        'board_reason', c.board_reason, 'folder', c.folder, 'executor_role_id', c.executor_role_id,
        'title', c.title, 'summary', c.summary, 'intent', c.intent, 'acceptance_test', c.acceptance_test,
        'design_spec_url', c.design_spec_url, 'funding_target_usd', c.funding_target_usd,
        'funded_usd', c.funded_usd, 'estimate_usd', c.estimate_usd, 'confidence', c.confidence,
        'proposer_role_id', c.proposer_role_id, 'director_stance', c.director_stance,
        'veto_reason', c.veto_reason, 'stage', c.stage, 'branch', c.branch, 'commit_sha', c.commit_sha,
        'failing_check', c.failing_check, 'created_at', c.created_at, 'updated_at', c.updated_at,
        'live_at', c.live_at, 'horizon', c.horizon, 'rank', c.rank, 'drafter_role_id', c.drafter_role_id,
        'check_author_role_id', c.check_author_role_id, 'opens_at', c.opens_at,
        'board_vetoed', c.board_vetoed, 'board_veto_reason', c.board_veto_reason
      ) order by c.created_at, c.id)
      from public.cards c
      where c.id in (select id from listed)
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.hired_at, r.title, r.id) from public.public_roles r
    ), '[]'::jsonb),
    'terms', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.version) from public.public_terms_versions t
    ), '[]'::jsonb)
  )
$$;

create or replace function public.site_live() returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with listed as (
    select c.id from public.cards c
    where c.stage in ('proposed', 'designing', 'voted', 'funded', 'building', 'gated', 'paused')
    union all
    (select c.id from public.cards c where c.stage = 'live' order by c.live_at desc nulls last, c.id desc limit 200)
    union all
    (select c.id from public.cards c where c.stage = 'rejected' order by c.updated_at desc, c.id desc limit 50)
  )
  select jsonb_build_object(
    'built_at', now(),
    'pool', (
      select jsonb_build_object(
        'balance_usd', p.balance_usd, 'reserve_usd', p.reserve_usd,
        'incident_reserve_usd', p.incident_reserve_usd, 'held_usd', p.held_usd,
        'daily_spent_usd', p.daily_spent_usd, 'day', p.day
      )
      from public.pool p where p.id = 1
    ),
    'studio', (select to_jsonb(s) from public.public_studio s limit 1),
    'totals', (select to_jsonb(t) from public.public_ledger_totals t),
    'money', (select to_jsonb(m) from public.public_money m limit 1),
    'stopped', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.stopped_at desc, x.card_id desc)
      from (
        select * from public.public_stopped_cards
        order by stopped_at desc, card_id desc
        limit 12
      ) x
    ), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_object_agg(c.id::text, jsonb_build_object(
        'stage', c.stage,
        'horizon', c.horizon,
        'rank', c.rank,
        'executor_role_id', c.executor_role_id,
        'funding_target_usd', c.funding_target_usd,
        'funded_usd', c.funded_usd,
        'spent_usd', coalesce(s.spent_usd, 0),
        'contributors', f.contributors,
        'credited_usd', f.credited_usd,
        'live_at', c.live_at,
        'updated_at', c.updated_at
      ))
      from public.cards c
      left join public.public_card_spend s on s.card_id = c.id
      left join public.public_card_funding f on f.card_id = c.id
      where c.id in (select id from listed)
    ), '{}'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'card_id', e.card_id, 'role_id', e.role_id, 'type', e.type,
        'created_at', e.created_at, 'step', e.step, 'usd', e.usd, 'card_title', c.title, 'line_key', e.line_key
      ) order by e.created_at desc, e.id desc)
      from (
        select id, card_id, role_id, type, created_at, step, usd, line_key from public.public_agent_events
        where line_key <> 'none'
        order by created_at desc, id desc
        limit 20
      ) e
      left join public.cards c on c.id = e.card_id
    ), '[]'::jsonb),
    'deploys', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'folder', d.folder, 'sha', d.sha, 'is_green', d.is_green, 'created_at', d.created_at
      ) order by d.created_at desc, d.id desc)
      from (
        select id, folder, sha, is_green, created_at from public.deploys
        order by created_at desc, id desc
        limit 10
      ) d
    ), '[]'::jsonb),
    'role_stats', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.role_id) from public.public_role_stats r
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.site_live() from public;
revoke all on function public.site_cards() from public;
grant execute on function public.site_live() to anon, authenticated, service_role;
grant execute on function public.site_cards() to anon, authenticated, service_role;

-- h. ----------------------------------------------------------------------------

notify pgrst, 'reload schema';
