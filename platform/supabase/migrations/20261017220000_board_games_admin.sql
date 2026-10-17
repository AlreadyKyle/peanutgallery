-- The board's games and agents admin (docs/specs/board-games-admin.md; docs/specs/final-state.md, Admin).
--
-- a. public.games: one row per game folder (every card_folder but platform, the site), holding what
--    the database did not know about a game: its name, its status word (live, paused, in development),
--    whether it accepts new cards, whether it is the featured game (at most one is), its public blurb,
--    its play address and box art, and the play_counts events that count its loads and shares. Row
--    level security is on with no policy: anon and authenticated read it only through public_games and
--    the board's reads, and it changes only through the board's functions below. The seed row is Dust.
-- b. public.public_games: the public's window onto games (no write column, no audit), for the site.
-- c. The board's writes, each for a board member at the second factor (a moderator, an outsider and
--    anon are refused) and each with a reason of 1 to 500 characters written first to the append-only
--    moderation log (community.log_admin, target 'game:<folder>'): board_set_game_status,
--    board_set_game_accepting, board_set_game_featured (featuring one game unfeatures the other) and
--    board_set_game_blurb (one line of at most 280 characters, cleaned and passed through the content
--    filter, as every public community text is).
-- d. board_games(): board_roster's read gains each game's row from games, its loads and shares over
--    the last day, 7 days, 30 days and in all from play_counts, and its five newest moderation-log
--    entries. A folder with no games row still lists, as in development.
-- e. board_agent_roster(): gains each role's public profile (description, species note, avatar), its
--    status and trigger (running, starts later, planned), its budget share, its spend against the
--    studio's caps (its studio-billed spend this New York day and month beside the studio's and the
--    daily and monthly caps, read-only), its runs over 7 days and its last run, and its five newest
--    pauses and resumes from board_actions. Nothing reads a run's input or output.
-- f. enqueue_supply_draft(): queues no draft_card run while Dust (seed-1, the folder every supply
--    draft opens a card in) does not accept new cards, answering reason game_paused. supply_draft_check
--    is unchanged.
--
-- No money table, cap, split or reserve changes; the ledger and board_actions are only read. Every
-- statement runs twice without error.

set lock_timeout = '5s';

-- a. Games ----------------------------------------------------------------------------------------

create table if not exists public.games (
  folder public.card_folder primary key constraint games_folder_check check (folder <> 'platform'::public.card_folder),
  name text not null constraint games_name_check check (btrim(name) <> '' and char_length(name) <= 60 and strpos(name, E'\n') = 0),
  status text not null default 'in_development' constraint games_status_check check (status in ('live', 'paused', 'in_development')),
  accepting_cards boolean not null default true,
  featured boolean not null default false,
  blurb text constraint games_blurb_check
    check (blurb is null or (btrim(blurb) = blurb and blurb <> '' and char_length(blurb) <= 280 and strpos(blurb, E'\n') = 0)),
  play_url text constraint games_play_url_check check (play_url is null or play_url ~ '^https://[a-z0-9.-]+(/[A-Za-z0-9._~/-]*)?$'),
  box_art text constraint games_box_art_check check (box_art is null or box_art ~ '^/games/[a-z0-9-]+\.(svg|png)$'),
  load_event text constraint games_load_event_check check (load_event is null or load_event in ('dust_load', 'dust_share', 'card_share', 'dust_next_card')),
  share_event text constraint games_share_event_check check (share_event is null or share_event in ('dust_load', 'dust_share', 'card_share', 'dust_next_card')),
  updated_at timestamptz not null default now()
);

create unique index if not exists games_one_featured on public.games (featured) where featured;

alter table public.games enable row level security;
revoke all on table public.games from public, anon, authenticated, service_role;
grant select on table public.games to service_role;

insert into public.games (folder, name, status, accepting_cards, featured, blurb, play_url, box_art, load_event, share_event)
values (
  'seed-1', 'Dust', 'live', true, true,
  'An idle game you play in a browser, on a phone or a computer. The agents built it and keep changing it, one funded card at a time.',
  'https://play.mobmachine.games', '/games/dust-box-art.svg', 'dust_load', 'dust_share'
)
on conflict (folder) do nothing;

-- b. The public view ------------------------------------------------------------------------------

create or replace view public.public_games with (security_invoker = false) as
  select folder, name, status, accepting_cards, featured, blurb, play_url, box_art
  from public.games;

revoke all on table public.public_games from public, anon, authenticated;
grant select on public.public_games to anon, authenticated, service_role;

-- c. The board's writes ---------------------------------------------------------------------------

-- The games row a board write changes, locked; a folder that is a game but has no row yet gets one.
create or replace function public.board_game_row(p_folder text) returns public.games
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.card_folder;
  v_game public.games%rowtype;
begin
  if p_folder is null or p_folder = 'platform' or not (p_folder = any(enum_range(null::public.card_folder)::text[])) then
    raise exception 'No game has the folder %', coalesce(p_folder, 'null');
  end if;
  v_folder := p_folder::public.card_folder;
  insert into public.games (folder, name) values (v_folder, p_folder) on conflict (folder) do nothing;
  select * into v_game from public.games where folder = v_folder for update;
  return v_game;
end;
$$;

create or replace function public.board_set_game_status(p_folder text, p_status text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
begin
  perform community.require_board();
  if p_status is null or p_status not in ('live', 'paused', 'in_development') then
    raise exception 'A status is live, paused or in_development';
  end if;
  v_game := public.board_game_row(p_folder);
  perform community.log_admin('set_game_status', 'game:' || p_folder, p_reason, jsonb_build_object('from', v_game.status, 'to', p_status));
  update public.games set status = p_status, updated_at = now() where folder = v_game.folder;
  return jsonb_build_object('folder', p_folder, 'status', p_status);
end;
$$;

create or replace function public.board_set_game_accepting(p_folder text, p_accepting boolean, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
begin
  perform community.require_board();
  if p_accepting is null then
    raise exception 'p_accepting is required';
  end if;
  v_game := public.board_game_row(p_folder);
  perform community.log_admin(case when p_accepting then 'open_game_cards' else 'close_game_cards' end, 'game:' || p_folder, p_reason,
    jsonb_build_object('from', v_game.accepting_cards, 'to', p_accepting));
  update public.games set accepting_cards = p_accepting, updated_at = now() where folder = v_game.folder;
  return jsonb_build_object('folder', p_folder, 'accepting_cards', p_accepting);
end;
$$;

-- Featuring a game unfeatures any other, in the same transaction, and the log names it.
create or replace function public.board_set_game_featured(p_folder text, p_featured boolean, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_was text;
begin
  perform community.require_board();
  if p_featured is null then
    raise exception 'p_featured is required';
  end if;
  v_game := public.board_game_row(p_folder);
  select folder::text into v_was from public.games where featured and folder <> v_game.folder;
  perform community.log_admin(case when p_featured then 'feature_game' else 'unfeature_game' end, 'game:' || p_folder, p_reason,
    jsonb_build_object('from', v_game.featured, 'to', p_featured, 'unfeatured', case when p_featured then v_was end));
  if p_featured then
    update public.games set featured = false, updated_at = now() where featured and folder <> v_game.folder;
  end if;
  update public.games set featured = p_featured, updated_at = now() where folder = v_game.folder;
  return jsonb_build_object('folder', p_folder, 'featured', p_featured, 'unfeatured', case when p_featured then v_was end);
end;
$$;

-- The blurb is public text: one line, cleaned of links and markup, 1 to 280 characters after cleaning,
-- and it must pass the content filter. An empty blurb clears it.
create or replace function public.board_set_game_blurb(p_folder text, p_blurb text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_blurb text := nullif(btrim(community.clean_text(p_blurb, 280)), '');
begin
  perform community.require_board();
  if char_length(btrim(coalesce(p_blurb, ''))) > 280 then
    raise exception 'A blurb is one line of at most 280 characters';
  end if;
  if v_blurb is not null and not community.text_allowed(v_blurb) then
    raise exception 'That blurb did not pass the content filter';
  end if;
  v_game := public.board_game_row(p_folder);
  perform community.log_admin('set_game_blurb', 'game:' || p_folder, p_reason, jsonb_build_object('from', v_game.blurb, 'to', v_blurb));
  update public.games set blurb = v_blurb, updated_at = now() where folder = v_game.folder;
  return jsonb_build_object('folder', p_folder, 'blurb', v_blurb);
end;
$$;

-- d. The board's games read -----------------------------------------------------------------------

create or replace function public.board_games() returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
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
      'name', coalesce(g.name, f.folder::text),
      'status', coalesce(g.status, 'in_development'),
      'accepting_cards', coalesce(g.accepting_cards, true),
      'featured', coalesce(g.featured, false),
      'blurb', g.blurb,
      'play_url', g.play_url,
      'box_art', g.box_art,
      'updated_at', g.updated_at,
      'plays', jsonb_build_object(
        'load_event', g.load_event,
        'share_event', g.share_event,
        'loads', (
          select jsonb_build_object(
            'day', coalesce(sum(p.count) filter (where p.day = v_today), 0),
            'week', coalesce(sum(p.count) filter (where p.day > v_today - 7), 0),
            'month', coalesce(sum(p.count) filter (where p.day > v_today - 30), 0),
            'total', coalesce(sum(p.count), 0)
          ) from public.play_counts p where p.event = g.load_event
        ),
        'shares', (
          select jsonb_build_object(
            'day', coalesce(sum(p.count) filter (where p.day = v_today), 0),
            'week', coalesce(sum(p.count) filter (where p.day > v_today - 7), 0),
            'month', coalesce(sum(p.count) filter (where p.day > v_today - 30), 0),
            'total', coalesce(sum(p.count), 0)
          ) from public.play_counts p where p.event = g.share_event
        )
      ),
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
      ),
      'admin_log', coalesce((
        select jsonb_agg(jsonb_build_object('at', a.at, 'actor', a.actor_email, 'action', a.action, 'reason', a.reason, 'details', a.details)
          order by a.at desc, a.id desc)
        from (
          select x.* from community.admin_log x
          where x.target = 'game:' || f.folder::text
          order by x.at desc, x.id desc limit 5
        ) a
      ), '[]'::jsonb)
    ) order by f.folder)
    from (
      select e.folder from unnest(enum_range(null::public.card_folder)) as e(folder)
      where e.folder <> 'platform'::public.card_folder
    ) f
    left join public.games g on g.folder = f.folder
  ), '[]'::jsonb);
end;
$$;

-- e. The board's agent roster ---------------------------------------------------------------------

create or replace function public.board_agent_roster() returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_studio public.studio_state%rowtype;
  v_day timestamptz := ((now() at time zone 'America/New_York')::date)::timestamp at time zone 'America/New_York';
  v_month timestamptz := (date_trunc('month', now() at time zone 'America/New_York'))::timestamp at time zone 'America/New_York';
  v_studio_day numeric;
  v_studio_month numeric;
begin
  if public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Board membership is required';
  end if;
  if not public.board_aal2() then
    raise exception 'A second factor is required';
  end if;
  select * into v_studio from public.studio_state where id = 1;
  select coalesce(sum(l.usd) filter (where l.created_at >= v_day), 0), coalesce(sum(l.usd) filter (where l.created_at >= v_month), 0)
  into v_studio_day, v_studio_month
  from public.ledger l where l.billed_to in ('studio', 'overhead') and l.created_at >= least(v_day, v_month);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'title', r.title,
      'description', r.description,
      'species_note', r.species_note,
      'avatar_url', r.avatar_url,
      'model', r.model,
      'tools', r.tools_json,
      'write_access', r.write_access,
      'agent_class', r.agent_class,
      'state', r.state,
      'status', r.status,
      'trigger', r.trigger,
      'budget_share', r.budget_share,
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
      'caps', (
        select jsonb_build_object(
          'role_day_usd', coalesce(sum(g.usd) filter (where g.created_at >= v_day), 0),
          'role_month_usd', coalesce(sum(g.usd) filter (where g.created_at >= v_month), 0),
          'studio_day_usd', v_studio_day,
          'studio_month_usd', v_studio_month,
          'daily_cap_usd', v_studio.daily_cap_usd,
          'monthly_cap_usd', v_studio.monthly_cap_usd
        )
        from public.ledger g where g.role_id = r.id and g.billed_to in ('studio', 'overhead') and g.created_at >= least(v_day, v_month)
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
      'runs_week', (
        select jsonb_build_object(
          'succeeded', count(*) filter (where x.status = 'succeeded'),
          'failed', count(*) filter (where x.status = 'failed'),
          'skipped', count(*) filter (where x.status = 'skipped'),
          'last_at', max(x.created_at)
        )
        from public.job_runs x join public.jobs j on j.name = x.job_name
        where j.role_id = r.id and x.created_at > now() - interval '7 days'
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
      ), '[]'::jsonb),
      'pause_history', coalesce((
        select jsonb_agg(jsonb_build_object('at', b.created_at, 'actor', b.actor_email, 'paused', (b.details ->> 'to_paused')::boolean, 'reason', b.reason)
          order by b.created_at desc, b.id desc)
        from (
          select a.* from public.board_actions a
          where a.action = 'set_role_pause' and a.details ->> 'role_id' = r.id::text
          order by a.created_at desc, a.id desc limit 5
        ) b
      ), '[]'::jsonb)
    ) order by r.name)
    from public.roles r
  ), '[]'::jsonb);
end;
$$;

-- f. The card supply skips a game that does not accept new cards ----------------------------------

create or replace function public.enqueue_supply_draft() returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check jsonb;
  v_run jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('public.enqueue_supply_draft'));
  v_check := public.supply_draft_check();
  if v_check ->> 'reason' is not null then
    return v_check || jsonb_build_object('queued', false);
  end if;
  -- Every supply draft opens a card in seed-1 (open_draft_card); the board can stop that game taking
  -- new cards (board_set_game_accepting), and then no supply draft is queued.
  if exists (select 1 from public.games g where g.folder = 'seed-1'::public.card_folder and not g.accepting_cards) then
    return v_check || jsonb_build_object('reason', 'game_paused', 'queued', false);
  end if;
  -- Its own key: the check keeps it to one at a time, and a run that ended in the same minute (the
  -- default schedule key) must not stand in for the new one.
  v_run := public.enqueue_job_run('draft_card', 'schedule', 'draft_card:supply:' || gen_random_uuid(), null, jsonb_build_object('floor', v_check -> 'floor'), null);
  return v_check || jsonb_build_object('queued', coalesce((v_run ->> 'created')::boolean, false), 'run_id', v_run ->> 'id');
end;
$$;

-- Function privileges -----------------------------------------------------------------------------

revoke all on function public.board_game_row(text) from public, anon, authenticated, service_role;
revoke all on function public.board_set_game_status(text, text, text) from public, anon, service_role;
revoke all on function public.board_set_game_accepting(text, boolean, text) from public, anon, service_role;
revoke all on function public.board_set_game_featured(text, boolean, text) from public, anon, service_role;
revoke all on function public.board_set_game_blurb(text, text, text) from public, anon, service_role;
grant execute on function public.board_set_game_status(text, text, text) to authenticated;
grant execute on function public.board_set_game_accepting(text, boolean, text) to authenticated;
grant execute on function public.board_set_game_featured(text, boolean, text) to authenticated;
grant execute on function public.board_set_game_blurb(text, text, text) to authenticated;
revoke all on function public.board_games() from public, anon;
revoke all on function public.board_agent_roster() from public, anon;
grant execute on function public.board_games() to authenticated, service_role;
grant execute on function public.board_agent_roster() to authenticated, service_role;
revoke all on function public.enqueue_supply_draft() from public, anon, authenticated;
grant execute on function public.enqueue_supply_draft() to service_role;

notify pgrst, 'reload schema';
