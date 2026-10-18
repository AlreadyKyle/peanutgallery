-- The benchmark review and the Discord announcements (docs/specs/operations.md,
-- docs/strategy/operating-system.md §1 and §2).
--
-- a. findings take a new kind, benchmark: a benchmark row below its floor, with the review's likely
--    cause and one proposed adjustment. The board's panel lists findings already.
-- b. benchmark_reviews: one row per review (the scoreboard, the findings, the proposed adjustments,
--    the trigger and the cost), written by record_benchmark_review and read by the board.
-- c. The job: benchmark_review, run by the Studio Head (the reader of the report in
--    operating-system.md). It reads daily_metrics and counts of the studio's state through
--    benchmark_review_inputs, never a player's text. enqueue_benchmark_review queues a run, while the
--    benchmark_review flag is on, on the events operating-system.md names: the first review, 50 cards
--    live since the last one, a milestone or an era reached, 30 days with no review, and a watch for
--    a floor crossing once the day's counts have moved (the watch calls no model unless a row is newly
--    below its floor). pg_cron calls it every hour.
-- d. Discord announcements: outbound_posts takes the kind announce, one row per feed event, so an
--    event is posted at most once. announcements_pending hands the dispatcher the structured fields
--    of the notable feed events (a card funded, a card shipped, a rare or legendary card opened, a
--    milestone, an era) that have no row yet: kinds, ids, card titles, rarities, suits, goal titles
--    and amounts, era names. Never the feed's text, never a supporter's name.
--
-- Every statement runs twice without error.

set lock_timeout = '5s';

-- a. Findings ---------------------------------------------------------------------------------

alter table public.findings drop constraint if exists findings_kind_check;
alter table public.findings add constraint findings_kind_check
  check (kind in ('schema', 'model', 'cli', 'scan', 'producer', 'benchmark'));

create or replace function public.record_finding(p_fingerprint text, p_kind text, p_subject text, p_detail jsonb default '{}'::jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
  v_closed timestamptz;
begin
  if p_fingerprint is null or btrim(p_fingerprint) = '' then
    raise exception 'A finding needs a fingerprint';
  end if;
  if p_kind is null or p_kind not in ('schema', 'model', 'cli', 'scan', 'producer', 'benchmark') then
    raise exception 'The kind must be schema, model, cli, scan, producer or benchmark';
  end if;
  if p_subject is null or btrim(p_subject) = '' then
    raise exception 'A finding needs a subject';
  end if;
  if jsonb_typeof(v_detail) <> 'object' then
    raise exception 'The detail must be a JSON object';
  end if;
  insert into public.findings (fingerprint, kind, subject, detail)
  values (p_fingerprint, p_kind, p_subject, v_detail)
  on conflict (fingerprint) do nothing;
  if found then
    return true;
  end if;
  select closed_at into v_closed from public.findings where fingerprint = p_fingerprint for update;
  if v_closed is not null then
    update public.findings
      set kind = p_kind, subject = p_subject, detail = v_detail, opened_at = now(), last_seen_at = now(), closed_at = null
      where fingerprint = p_fingerprint;
    return true;
  end if;
  -- A benchmark finding's subject carries the current value, so it follows the latest review.
  update public.findings set subject = case when p_kind = 'benchmark' then p_subject else subject end, detail = v_detail, last_seen_at = now()
    where fingerprint = p_fingerprint;
  return false;
end;
$$;

-- b. benchmark_reviews ------------------------------------------------------------------------

create table if not exists public.benchmark_reviews (
  id uuid primary key default gen_random_uuid(),
  job_run_id uuid,
  trigger text not null check (trigger in ('first', 'fifty_live', 'milestone', 'era', 'backstop', 'watch', 'board')),
  scoreboard jsonb not null check (jsonb_typeof(scoreboard) = 'array'),
  findings jsonb not null default '[]'::jsonb check (jsonb_typeof(findings) = 'array'),
  summary text check (summary is null or char_length(summary) <= 600),
  reviewed boolean not null default false,
  usd numeric(12,4) not null default 0 check (usd >= 0),
  created_at timestamptz not null default now()
);
create index if not exists benchmark_reviews_created_idx on public.benchmark_reviews (created_at desc);

alter table public.benchmark_reviews enable row level security;
revoke all on public.benchmark_reviews from public, anon, authenticated, service_role;
grant select on public.benchmark_reviews to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'peanutgallery_backup') then
    grant select on public.benchmark_reviews to peanutgallery_backup;
  end if;
end
$$;

-- The review's record. The scoreboard and findings were checked by the dispatcher; here only their
-- shape and size. Returns the review's id.
create or replace function public.record_benchmark_review(
  p_run uuid, p_trigger text, p_scoreboard jsonb, p_findings jsonb, p_summary text, p_reviewed boolean, p_usd numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if jsonb_typeof(p_scoreboard) is distinct from 'array' or jsonb_typeof(coalesce(p_findings, '[]'::jsonb)) <> 'array' then
    raise exception 'The scoreboard and the findings are lists';
  end if;
  if octet_length(p_scoreboard::text) + octet_length(coalesce(p_findings, '[]'::jsonb)::text) > 65536 then
    raise exception 'A review is at most 64 KB';
  end if;
  insert into public.benchmark_reviews (job_run_id, trigger, scoreboard, findings, summary, reviewed, usd)
  values (p_run, p_trigger, p_scoreboard, coalesce(p_findings, '[]'::jsonb), left(nullif(btrim(coalesce(p_summary, '')), ''), 600),
    coalesce(p_reviewed, false), greatest(coalesce(p_usd, 0), 0))
  returning id into v_id;
  return v_id;
end;
$$;

-- The board's read: the newest reviews, at most 20.
create or replace function public.board_benchmark_reviews(p_limit integer default 5) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Board membership is required';
  end if;
  if not public.board_aal2() then
    raise exception 'A second factor is required';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.created_at desc)
    from (
      select id, trigger, scoreboard, findings, summary, reviewed, usd, created_at
      from public.benchmark_reviews order by created_at desc limit least(greatest(coalesce(p_limit, 5), 1), 20)
    ) r
  ), '[]'::jsonb);
end;
$$;

-- c. The job ---------------------------------------------------------------------------------

insert into community.flags (key, value) values ('benchmark_review', 'false'::jsonb) on conflict (key) do nothing;

insert into public.jobs (name, role_id, calls_model, runs_when_paused, description)
values ('benchmark_review', (select id from public.roles where name = 'Studio Head'), true, false,
  'Benchmark review: the scoreboard of docs/strategy/benchmarks.md from the daily counts, and, for each row newly below its floor, the Studio Head''s likely cause and one proposed adjustment, written as findings. It spends nothing and opens no card.')
on conflict (name) do update set role_id = coalesce(excluded.role_id, public.jobs.role_id), calls_model = excluded.calls_model,
  runs_when_paused = excluded.runs_when_paused, description = excluded.description;

-- What the review reads: the daily counts and counts of the studio's state. No text a player wrote.
create or replace function public.benchmark_review_inputs() returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_last timestamptz := (select max(created_at) from public.benchmark_reviews);
begin
  return jsonb_build_object(
    'metrics', public.daily_metrics_window(60),
    'last_review_at', v_last,
    'paused', (select paused from public.studio_state where id = 1),
    'cards_by_stage', coalesce((select jsonb_object_agg(stage, n) from (select stage::text as stage, count(*) as n from public.cards group by stage) s), '{}'::jsonb),
    'live_since_last_review', (select count(*) from public.cards where live_at is not null and (v_last is null or live_at > v_last)),
    'goals_reached', (select count(*) from community.goals where reached_at is not null),
    'eras_reached', (select count(*) from community.studio_eras where reached_at is not null),
    'open_findings', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) as n from public.findings where closed_at is null group by kind) f), '{}'::jsonb)
  );
end;
$$;

-- Queues a review on the events operating-system.md §1 names, at most one queued or running at a
-- time, while the benchmark_review flag is on. The trigger rides in the run's input.
create or replace function public.enqueue_benchmark_review() returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last timestamptz := (select max(created_at) from public.benchmark_reviews);
  v_trigger text;
begin
  if not community.flag_on('benchmark_review') then return jsonb_build_object('queued', false, 'reason', 'flag_off'); end if;
  if exists (select 1 from public.job_runs where job_name = 'benchmark_review' and status in ('queued', 'running')) then
    return jsonb_build_object('queued', false, 'reason', 'already_queued');
  end if;
  if not exists (select 1 from public.daily_metrics) then
    return jsonb_build_object('queued', false, 'reason', 'no_counts');
  end if;
  if v_last is null then
    v_trigger := 'first';
  elsif (select count(*) from public.cards where live_at > v_last) >= 50 then
    v_trigger := 'fifty_live';
  elsif exists (select 1 from community.goals where reached_at > v_last) then
    v_trigger := 'milestone';
  elsif exists (select 1 from community.studio_eras where reached_at > v_last) then
    v_trigger := 'era';
  elsif v_last < now() - interval '30 days' then
    v_trigger := 'backstop';
  elsif v_last < now() - interval '6 hours' and exists (select 1 from public.daily_metrics where computed_at > v_last) then
    v_trigger := 'watch';
  else
    return jsonb_build_object('queued', false, 'reason', 'nothing_new');
  end if;
  return jsonb_build_object('queued', true, 'trigger', v_trigger,
    'run', public.enqueue_job_run('benchmark_review', 'schedule', null, null, jsonb_build_object('trigger', v_trigger), null));
end;
$$;

-- d. Discord announcements --------------------------------------------------------------------

alter table public.outbound_posts drop constraint if exists outbound_posts_kind_check;
alter table public.outbound_posts add constraint outbound_posts_kind_check check (kind in ('ship', 'weekly', 'announce'));

-- The notable feed events since p_since with no announce row, oldest first, at most p_limit (1 to
-- 20), and how many announcements were claimed in the last hour (the dispatcher's rate limit). Each
-- item carries structured fields only.
create or replace function public.announcements_pending(p_since timestamptz, p_limit integer default 5) returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
declare
  v_items jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'ref', x.id::text,
      'kind', x.what,
      'at', x.at,
      'card_id', x.card_id,
      'card_title', x.card_title,
      'rarity', x.rarity,
      'suit', x.suit,
      'goal_title', x.goal_title,
      'goal_amount_cents', x.goal_amount_cents,
      'era_name', x.era_name
    ) order by x.id), '[]'::jsonb)
  into v_items
  from (
    select e.id, e.at, e.card_id, e.rarity, e.suit,
      case
        when e.kind = 'stage' and e.dedupe like 'stage:%:funded' then 'funded'
        when e.kind = 'shipped' then 'shipped'
        when e.kind = 'card_opened' and e.rarity in ('rare', 'legendary') then 'rare_card'
        when e.kind = 'milestone' then 'milestone'
        when e.kind = 'era' then 'era'
      end as what,
      c.title as card_title,
      g.title as goal_title,
      g.amount_cents as goal_amount_cents,
      s.name as era_name
    from community.events e
    left join public.cards c on c.id = e.card_id
    left join community.goals g on e.kind = 'milestone' and e.dedupe = 'goal:' || g.id
    left join community.studio_eras s on e.kind = 'era' and e.dedupe = 'era:' || s.id
    where e.at >= p_since
      and ((e.kind = 'stage' and e.dedupe like 'stage:%:funded') or e.kind in ('shipped', 'milestone', 'era')
        or (e.kind = 'card_opened' and e.rarity in ('rare', 'legendary')))
      and not exists (select 1 from public.outbound_posts o where o.kind = 'announce' and o.ref = e.id::text)
    order by e.id
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
  ) x;
  return jsonb_build_object(
    'items', v_items,
    'sent_last_hour', (select count(*) from public.outbound_posts where kind = 'announce' and state <> 'skipped' and created_at > now() - interval '1 hour')
  );
end;
$$;

-- Grants --------------------------------------------------------------------------------------

revoke all on function public.record_benchmark_review(uuid, text, jsonb, jsonb, text, boolean, numeric) from public, anon, authenticated;
revoke all on function public.board_benchmark_reviews(integer) from public, anon;
revoke all on function public.benchmark_review_inputs() from public, anon, authenticated;
revoke all on function public.enqueue_benchmark_review() from public, anon, authenticated;
revoke all on function public.announcements_pending(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.record_benchmark_review(uuid, text, jsonb, jsonb, text, boolean, numeric) to service_role;
grant execute on function public.board_benchmark_reviews(integer) to authenticated, service_role;
grant execute on function public.benchmark_review_inputs() to service_role;
grant execute on function public.enqueue_benchmark_review() to service_role;
grant execute on function public.announcements_pending(timestamptz, integer) to service_role;

-- A database that does not ship pg_cron (PGlite in the tests) skips the schedule.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; enqueue_benchmark_review is not scheduled';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('benchmark-review', '41 * * * *', $c$select public.enqueue_benchmark_review()$c$);
end $$;

notify pgrst, 'reload schema';
