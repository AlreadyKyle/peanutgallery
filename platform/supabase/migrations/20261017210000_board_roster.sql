-- The board's Games and Agents admin (docs/specs/final-state.md, Admin; docs/specs/board-site.md).
--
-- Two reads for the board's panel, each for a board member at the second factor only (a moderator,
-- an outsider and anon are refused), security definer, in the public schema like the board's other
-- reads. Neither writes, neither touches money controls, and neither returns player text: the board
-- reads the games and the agent roster from tables it already owns.
--
-- a. board_games(): one entry per game folder (every card_folder but platform, the site): its open
--    and shipped card counts, its ten newest open cards and ten newest shipped cards (id, title,
--    stage, dates), and its newest deploy and newest green deploy. The box art and the play address
--    are the board site's own constants (platform/board/src/lib/games.ts); no game toggle exists in
--    the database, so none is invented.
-- b. board_agent_roster(): every role with its model, its tools, whether it has write access, its
--    class, state and pause (the per-role on/off is the existing set_role_pause), its ledger spend
--    over the last day, 7 days, 30 days and in total, its job runs of the last day by status, and its
--    ten newest job runs (job, status, origin, card, reason, dates; never a run's input or output).
--
-- No schema, table, index or cron job is added. Every statement runs twice without error.

set lock_timeout = '5s';

create or replace function public.board_games() returns jsonb
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
    select jsonb_agg(jsonb_build_object(
      'folder', f.folder,
      'open_count', (select count(*) from public.cards c where c.folder = f.folder and c.stage not in ('live', 'rejected')),
      'shipped_count', (select count(*) from public.cards c where c.folder = f.folder and c.stage = 'live'),
      'open_cards', coalesce((
        select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'stage', o.stage, 'horizon', o.horizon, 'updated_at', o.updated_at)
          order by o.updated_at desc, o.id)
        from (
          select c.* from public.cards c
          where c.folder = f.folder and c.stage not in ('live', 'rejected')
          order by c.updated_at desc, c.id limit 10
        ) o
      ), '[]'::jsonb),
      'shipped_cards', coalesce((
        select jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'live_at', l.live_at, 'commit_sha', l.commit_sha)
          order by l.live_at desc nulls last, l.id)
        from (
          select c.* from public.cards c
          where c.folder = f.folder and c.stage = 'live'
          order by c.live_at desc nulls last, c.id limit 10
        ) l
      ), '[]'::jsonb),
      'latest_deploy', (
        select jsonb_build_object('sha', d.sha, 'is_green', d.is_green, 'smoke_result', d.smoke_result, 'created_at', d.created_at)
        from public.deploys d where d.folder = f.folder order by d.created_at desc, d.id limit 1
      ),
      'latest_green_deploy', (
        select jsonb_build_object('sha', d.sha, 'created_at', d.created_at)
        from public.deploys d where d.folder = f.folder and d.is_green order by d.created_at desc, d.id limit 1
      )
    ) order by f.folder)
    from (
      select e.folder from unnest(enum_range(null::public.card_folder)) as e(folder)
      where e.folder <> 'platform'::public.card_folder
    ) f
  ), '[]'::jsonb);
end;
$$;

create or replace function public.board_agent_roster() returns jsonb
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
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'title', r.title,
      'model', r.model,
      'tools', r.tools_json,
      'write_access', r.write_access,
      'agent_class', r.agent_class,
      'state', r.state,
      'status', r.status,
      'paused', r.paused,
      'paused_reason', r.paused_reason,
      'paused_at', r.paused_at,
      'jobs', coalesce((select jsonb_agg(j.name order by j.name) from public.jobs j where j.role_id = r.id), '[]'::jsonb),
      'spend', (
        select jsonb_build_object(
          'day_usd', coalesce(sum(g.usd) filter (where g.created_at > now() - interval '1 day'), 0),
          'week_usd', coalesce(sum(g.usd) filter (where g.created_at > now() - interval '7 days'), 0),
          'month_usd', coalesce(sum(g.usd) filter (where g.created_at > now() - interval '30 days'), 0),
          'total_usd', coalesce(sum(g.usd), 0)
        )
        from public.ledger g where g.role_id = r.id
      ),
      'runs_day', (
        select jsonb_build_object(
          'succeeded', count(*) filter (where x.status = 'succeeded'),
          'failed', count(*) filter (where x.status = 'failed'),
          'skipped', count(*) filter (where x.status = 'skipped'),
          'queued', count(*) filter (where x.status = 'queued'),
          'running', count(*) filter (where x.status = 'running')
        )
        from public.job_runs x join public.jobs j on j.name = x.job_name
        where j.role_id = r.id and x.created_at > now() - interval '1 day'
      ),
      'recent_runs', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', x.id, 'job', x.job_name, 'status', x.status, 'origin', x.origin, 'card_id', x.card_id, 'reason', x.reason,
          'created_at', x.created_at, 'started_at', x.started_at, 'finished_at', x.finished_at
        ) order by x.created_at desc, x.id)
        from (
          select jr.* from public.job_runs jr join public.jobs j on j.name = jr.job_name
          where j.role_id = r.id order by jr.created_at desc, jr.id limit 10
        ) x
      ), '[]'::jsonb)
    ) order by r.name)
    from public.roles r
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.board_games() from public, anon;
revoke all on function public.board_agent_roster() from public, anon;
grant execute on function public.board_games() to authenticated, service_role;
grant execute on function public.board_agent_roster() to authenticated, service_role;

notify pgrst, 'reload schema';
