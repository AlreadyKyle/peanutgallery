-- Community admin and the Scout's path (docs/specs/community-core.md).
--
-- a. The board's community admin: every function needs a board member at the second factor, as
--    the board's other panel functions do, and writes one append-only community.admin_log row
--    with the reason it was given. Users (list, suspend, rename), Suggestions (the queue, decline
--    with a reason from the fixed list, release a held item, merge clusters, link a cluster to the
--    card drafted from it, queue a draft from a cluster), Seeds (list, unpublish, feature), Cards
--    (suit and rarity override), Goals (list, save, delete), Studio eras (list, set), Flags (list,
--    set) and the moderation log.
-- b. The Scout's path, service_role only: scout_take_batch hands the dispatcher's scout_triage job
--    a batch of received suggestions (the one read of player text outside the board), and
--    scout_record_triage writes the Scout's validated structured output and nothing else. A
--    suggestion flagged as an instruction to agents, or as asking to change money or secrets, is
--    declined as instruction_to_agents with no summary; one flagged not all-ages is declined as
--    not_all_ages; any other flag holds it for the board; the rest join a cluster.
-- c. The roles and the job: Scout (no tools) and Art Director rows if the seed has not written them
--    yet, and the scout_triage job (calls a model, billed as studio overhead, PLAN.md §10
--    decision 66). enqueue_scout_triage queues a run when the scout_triage flag is on and a
--    suggestion waits; pg_cron calls it every 15 minutes where pg_cron exists.
--
-- Every statement runs twice without error.

set lock_timeout = '5s';

-- a. Admin ------------------------------------------------------------------------------------

create or replace function community.require_board() returns text
language plpgsql
stable
security definer
set search_path = community, public
as $$
begin
  if public.board_role() is distinct from 'board'::public.board_role then
    raise exception 'Board membership is required';
  end if;
  if not public.board_aal2() then
    raise exception 'A second factor is required';
  end if;
  return lower(auth.email());
end;
$$;

create or replace function community.log_admin(p_action text, p_target text, p_reason text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_email text := community.require_board();
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
    raise exception 'Give a reason of 1 to 500 characters';
  end if;
  insert into community.admin_log (actor_email, action, target, reason, details)
  values (v_email, p_action, p_target, v_reason, coalesce(p_details, '{}'::jsonb));
end;
$$;

-- Users: newest first, 50 a page, searched by handle or name. The cursor is the last user's
-- "<created micros>|<user id>".
create or replace function public.board_community_users(p_query text default null, p_cursor text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_at bigint;
  v_id uuid;
  v_items jsonb;
  v_n integer;
  v_last record;
begin
  perform community.require_board();
  if p_cursor is not null then
    if p_cursor !~ '^[0-9]{1,20}\|[0-9a-f-]{36}$' then raise exception 'Bad cursor'; end if;
    v_at := split_part(p_cursor, '|', 1)::bigint;
    v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  with page as (
    select p.* from community.profiles p
    where (v_q is null or p.handle ilike '%' || v_q || '%' or p.display_name ilike '%' || v_q || '%')
      and (v_at is null or (trunc(extract(epoch from p.created_at) * 1000000)::bigint, p.user_id) < (v_at, v_id))
    order by p.created_at desc, p.user_id desc
    limit 50
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'userId', page.user_id, 'handle', page.handle, 'displayName', page.display_name,
      'xp', community.total_xp(page.user_id), 'level', community.level_for(community.total_xp(page.user_id)),
      'suspended', page.suspended, 'createdAt', page.created_at,
      'cursor', trunc(extract(epoch from page.created_at) * 1000000)::bigint::text || '|' || page.user_id
    ) order by page.created_at desc, page.user_id desc), '[]'::jsonb), count(*)
  into v_items, v_n from page;
  return jsonb_build_object('items', v_items, 'next', case when v_n = 50 then v_items->49->>'cursor' else null end);
end;
$$;

create or replace function public.board_suspend_user(p_handle text, p_suspended boolean, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
begin
  perform community.log_admin(case when p_suspended then 'suspend_user' else 'restore_user' end, p_handle, p_reason);
  update community.profiles set suspended = coalesce(p_suspended, false), updated_at = now() where handle = p_handle;
  if not found then raise exception 'No user has the handle %', p_handle; end if;
  return jsonb_build_object('handle', p_handle, 'suspended', coalesce(p_suspended, false));
end;
$$;

create or replace function public.board_rename_user(p_handle text, p_display_name text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_name text := community.clean_text(p_display_name, 32);
  v_old text;
begin
  if char_length(v_name) < 2 then raise exception 'A display name needs 2 to 32 characters'; end if;
  if not community.text_allowed(v_name) then raise exception 'That name did not pass the content filter'; end if;
  select display_name into v_old from community.profiles where handle = p_handle;
  if not found then raise exception 'No user has the handle %', p_handle; end if;
  perform community.log_admin('rename_user', p_handle, p_reason, jsonb_build_object('from', v_old, 'to', v_name));
  update community.profiles set display_name = v_name, updated_at = now() where handle = p_handle;
  return jsonb_build_object('handle', p_handle, 'displayName', v_name);
end;
$$;

-- The suggestion queue: the board reads the player's own words here (a person, not an agent).
-- state is one SuggestionState, 'held', or null for every one; newest first, 50 a page.
create or replace function public.board_suggestions(p_state text default null, p_cursor text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
declare
  v_at bigint;
  v_id uuid;
  v_items jsonb;
  v_n integer;
begin
  perform community.require_board();
  if p_state is not null and p_state not in ('received', 'reviewed', 'clustered', 'drafted', 'open', 'building', 'live', 'declined', 'held') then
    raise exception 'Bad state';
  end if;
  if p_cursor is not null then
    if p_cursor !~ '^[0-9]{1,20}\|[0-9a-f-]{36}$' then raise exception 'Bad cursor'; end if;
    v_at := split_part(p_cursor, '|', 1)::bigint;
    v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  with page as (
    select s.* from community.suggestions s
    where (p_state is null or (p_state = 'held' and s.held) or (p_state <> 'held' and s.state = p_state))
      and (v_at is null or (trunc(extract(epoch from s.created_at) * 1000000)::bigint, s.id) < (v_at, v_id))
    order by s.created_at desc, s.id desc
    limit 50
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', page.id, 'area', page.area, 'title', page.title, 'body', page.body, 'state', page.state,
      'declineReason', page.decline_reason, 'held', page.held, 'votes', page.votes, 'createdAt', page.created_at,
      'author', (select handle from community.profiles where user_id = page.user_id),
      'clusterId', page.cluster_id,
      'clusterKey', (select key from community.suggestion_clusters where id = page.cluster_id),
      'cardId', (select card_id from community.suggestion_clusters where id = page.cluster_id),
      'triage', (select jsonb_build_object('kind', t.kind, 'fit', t.fit, 'flags', to_jsonb(t.flags), 'summary', t.summary, 'clusterKey', t.cluster_key)
        from community.suggestion_triage t where t.suggestion_id = page.id),
      'cursor', trunc(extract(epoch from page.created_at) * 1000000)::bigint::text || '|' || page.id
    ) order by page.created_at desc, page.id desc), '[]'::jsonb), count(*)
  into v_items, v_n from page;
  return jsonb_build_object('items', v_items, 'next', case when v_n = 50 then v_items->49->>'cursor' else null end);
end;
$$;

create or replace function public.board_decline_suggestion(p_id uuid, p_decline_reason text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
begin
  if p_decline_reason is null or p_decline_reason not in
    ('duplicate', 'off_pillar', 'not_all_ages', 'instruction_to_agents', 'too_large', 'already_planned', 'not_feasible') then
    raise exception 'Decline with a reason from the list';
  end if;
  perform community.log_admin('decline_suggestion', p_id::text, p_reason, jsonb_build_object('decline_reason', p_decline_reason));
  update community.suggestions set state = 'declined', decline_reason = p_decline_reason, held = false where id = p_id;
  if not found then raise exception 'No such suggestion'; end if;
  return jsonb_build_object('id', p_id, 'state', 'declined');
end;
$$;

-- A held suggestion goes back to the queue: clustered if the Scout gave it a cluster, else received.
create or replace function public.board_release_suggestion(p_id uuid, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_state text;
begin
  perform community.log_admin('release_suggestion', p_id::text, p_reason);
  update community.suggestions s set held = false,
    state = case when s.state = 'declined' then s.state when s.cluster_id is not null then 'clustered' else s.state end
  where s.id = p_id
  returning s.state into v_state;
  if v_state is null then raise exception 'No such suggestion'; end if;
  -- A released item with a triage but no cluster yet joins its cluster now.
  perform community.cluster_suggestion(p_id);
  return jsonb_build_object('id', p_id, 'state', (select state from community.suggestions where id = p_id));
end;
$$;

create or replace function public.board_merge_clusters(p_from uuid, p_into uuid, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_moved integer;
begin
  if p_from is null or p_into is null or p_from = p_into then raise exception 'Name two different clusters'; end if;
  if not exists (select 1 from community.suggestion_clusters where id = p_into and merged_into is null) then
    raise exception 'No such cluster to merge into';
  end if;
  perform community.log_admin('merge_clusters', p_from::text, p_reason, jsonb_build_object('into', p_into));
  update community.suggestion_clusters set merged_into = p_into where id = p_from;
  if not found then raise exception 'No such cluster'; end if;
  update community.suggestions set cluster_id = p_into where cluster_id = p_from;
  get diagnostics v_moved = row_count;
  return jsonb_build_object('into', p_into, 'moved', v_moved);
end;
$$;

-- The structured brief a draft from a cluster takes: the Scout's fields and summary and the
-- cluster's votes, never a player's words.
create or replace function community.cluster_brief(p_cluster uuid) returns jsonb
language sql
stable
security definer
set search_path = community, public
as $$
  select jsonb_build_object(
    'id', c.id, 'key', c.key, 'area', c.area, 'kind', c.kind, 'fit', c.fit, 'summary', c.summary,
    'votes', coalesce((select sum(s.votes) from community.suggestions s where s.cluster_id = c.id and s.state <> 'declined'), 0),
    'suggestions', (select count(*) from community.suggestions s where s.cluster_id = c.id and s.state <> 'declined')
  )
  from community.suggestion_clusters c where c.id = p_cluster
$$;

-- Queues the Game Designer's draft_card with the cluster's brief as its input. Its suggestions
-- become drafted, and each player earns the accepted-suggestion XP.
create or replace function public.board_draft_from_cluster(p_cluster uuid, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_brief jsonb := community.cluster_brief(p_cluster);
  v_run jsonb;
  s record;
begin
  if v_brief is null then raise exception 'No such cluster'; end if;
  if (select merged_into from community.suggestion_clusters where id = p_cluster) is not null then
    raise exception 'That cluster was merged into another';
  end if;
  perform community.log_admin('draft_from_cluster', p_cluster::text, p_reason);
  v_run := public.enqueue_job_run('draft_card', 'board', 'draft_card:cluster:' || p_cluster, null, jsonb_build_object('cluster', v_brief), null);
  for s in update community.suggestions set state = 'drafted'
    where cluster_id = p_cluster and state in ('reviewed', 'clustered') and not held returning id, user_id loop
    perform community.award_xp(s.user_id, 'suggestion_accepted', 50, 1, 'suggestion:' || s.id);
  end loop;
  return jsonb_build_object('run', v_run, 'cluster', v_brief);
end;
$$;

-- The card a cluster became: its suggestions then follow the card's stage, and the card's page
-- credits the players in the cluster.
create or replace function public.board_link_cluster_card(p_cluster uuid, p_card uuid, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_stage text;
begin
  select stage::text into v_stage from public.cards where id = p_card;
  if v_stage is null then raise exception 'No such card'; end if;
  perform community.log_admin('link_cluster_card', p_cluster::text, p_reason, jsonb_build_object('card', p_card));
  update community.suggestion_clusters set card_id = p_card where id = p_cluster;
  if not found then raise exception 'No such cluster'; end if;
  update community.suggestions set state = coalesce(community.suggestion_state_for(v_stage), state)
  where cluster_id = p_cluster and state <> 'declined';
  return jsonb_build_object('cluster', p_cluster, 'card', p_card);
end;
$$;

create or replace function public.board_seeds(p_cursor text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
declare
  v_at bigint;
  v_id uuid;
  v_items jsonb;
  v_n integer;
begin
  perform community.require_board();
  if p_cursor is not null then
    if p_cursor !~ '^[0-9]{1,20}\|[0-9a-f-]{36}$' then raise exception 'Bad cursor'; end if;
    v_at := split_part(p_cursor, '|', 1)::bigint;
    v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  with page as (
    select s.* from community.seeds s
    where s.published and (v_at is null or (trunc(extract(epoch from s.created_at) * 1000000)::bigint, s.id) < (v_at, v_id))
    order by s.created_at desc, s.id desc
    limit 50
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', page.id, 'game', page.game, 'code', page.code, 'title', page.title, 'up', page.up, 'down', page.down,
      'featured', page.featured, 'unpublished', page.unpublished, 'createdAt', page.created_at,
      'author', (select handle from community.profiles where user_id = page.user_id),
      'cursor', trunc(extract(epoch from page.created_at) * 1000000)::bigint::text || '|' || page.id
    ) order by page.created_at desc, page.id desc), '[]'::jsonb), count(*)
  into v_items, v_n from page;
  return jsonb_build_object('items', v_items, 'next', case when v_n = 50 then v_items->49->>'cursor' else null end);
end;
$$;

create or replace function public.board_unpublish_seed(p_id uuid, p_unpublished boolean, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
begin
  perform community.log_admin(case when p_unpublished then 'unpublish_seed' else 'republish_seed' end, p_id::text, p_reason);
  update community.seeds set unpublished = coalesce(p_unpublished, true),
    featured = case when coalesce(p_unpublished, true) then false else featured end
  where id = p_id;
  if not found then raise exception 'No such seed'; end if;
  return jsonb_build_object('id', p_id, 'unpublished', coalesce(p_unpublished, true));
end;
$$;

create or replace function public.board_feature_seed(p_id uuid, p_featured boolean, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_seed community.seeds;
begin
  select * into v_seed from community.seeds where id = p_id;
  if not found or not v_seed.published or v_seed.unpublished then raise exception 'That seed is not in the gallery'; end if;
  perform community.log_admin(case when p_featured then 'feature_seed' else 'unfeature_seed' end, p_id::text, p_reason);
  update community.seeds set featured = coalesce(p_featured, true) where id = p_id;
  if coalesce(p_featured, true) then
    perform community.award_xp(v_seed.user_id, 'seed_featured', 50, 1, 'seed:' || p_id);
    perform community.award_badges(v_seed.user_id);
    perform community.add_event('seed_featured', '{actor}''s seed ' || v_seed.title || ' was featured', 'featured:' || p_id,
      null, v_seed.user_id);
  end if;
  return jsonb_build_object('id', p_id, 'featured', coalesce(p_featured, true));
end;
$$;

create or replace function public.board_community_cards(p_cursor text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
declare
  v_at bigint;
  v_id uuid;
  v_items jsonb;
  v_n integer;
begin
  perform community.require_board();
  if p_cursor is not null then
    if p_cursor !~ '^[0-9]{1,20}\|[0-9a-f-]{36}$' then raise exception 'Bad cursor'; end if;
    v_at := split_part(p_cursor, '|', 1)::bigint;
    v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  with page as (
    select c.id, c.title, c.stage, c.suit, c.rarity, c.folder, c.created_at from public.cards c
    where v_at is null or (trunc(extract(epoch from c.created_at) * 1000000)::bigint, c.id) < (v_at, v_id)
    order by c.created_at desc, c.id desc
    limit 50
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', page.id, 'title', page.title, 'stage', page.stage, 'suit', page.suit, 'rarity', page.rarity,
      'computedRarity', community.card_rarity(page.id::text), 'folder', page.folder, 'createdAt', page.created_at,
      'cursor', trunc(extract(epoch from page.created_at) * 1000000)::bigint::text || '|' || page.id
    ) order by page.created_at desc, page.id desc), '[]'::jsonb), count(*)
  into v_items, v_n from page;
  return jsonb_build_object('items', v_items, 'next', case when v_n = 50 then v_items->49->>'cursor' else null end);
end;
$$;

-- A card's suit or rarity, overridden with a logged reason. Rarity never changes the card's price,
-- bar, build or order; it changes the XP of payments claimed after it and the card's face.
create or replace function public.board_set_card_face(p_card uuid, p_suit text, p_rarity text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_old record;
begin
  if p_suit is not null and p_suit not in ('game', 'new_game', 'studio', 'platform', 'machine') then raise exception 'Bad suit'; end if;
  if p_rarity is not null and p_rarity not in ('common', 'uncommon', 'rare', 'legendary') then raise exception 'Bad rarity'; end if;
  select suit, rarity into v_old from public.cards where id = p_card;
  if not found then raise exception 'No such card'; end if;
  perform community.log_admin('set_card_face', p_card::text, p_reason, jsonb_build_object(
    'suit', jsonb_build_object('from', v_old.suit, 'to', coalesce(p_suit, v_old.suit)),
    'rarity', jsonb_build_object('from', v_old.rarity, 'to', coalesce(p_rarity, v_old.rarity))));
  perform set_config('community.quiet', 'on', true);
  update public.cards set suit = coalesce(p_suit, suit), rarity = coalesce(p_rarity, rarity) where id = p_card;
  perform set_config('community.quiet', '', true);
  return jsonb_build_object('id', p_card, 'suit', coalesce(p_suit, v_old.suit), 'rarity', coalesce(p_rarity, v_old.rarity));
end;
$$;

create or replace function public.board_goals() returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
begin
  perform community.require_board();
  return public.community_goals();
end;
$$;

-- Creates (p_id null) or edits a milestone. A reached milestone keeps its amount.
create or replace function public.board_save_goal(p_id uuid, p_amount_cents bigint, p_title text, p_outcome text, p_link text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_id uuid := p_id;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'A milestone needs an amount above zero'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 80 then raise exception 'A milestone title has 1 to 80 characters'; end if;
  if char_length(btrim(coalesce(p_outcome, ''))) not between 1 and 280 then raise exception 'An outcome has 1 to 280 characters'; end if;
  if p_link is not null and p_link <> '' and p_link !~ '^(/|https://)[^[:space:]]{0,255}$' then raise exception 'A link starts with / or https://'; end if;
  perform community.log_admin(case when p_id is null then 'create_goal' else 'edit_goal' end, coalesce(p_id::text, 'new'), p_reason,
    jsonb_build_object('amount_cents', p_amount_cents, 'title', btrim(p_title)));
  if p_id is null then
    insert into community.goals (amount_cents, title, outcome, link)
    values (p_amount_cents, btrim(p_title), btrim(p_outcome), nullif(p_link, '')) returning id into v_id;
  else
    update community.goals set
      amount_cents = case when reached_at is null then p_amount_cents else amount_cents end,
      title = btrim(p_title), outcome = btrim(p_outcome), link = nullif(p_link, '')
    where id = p_id;
    if not found then raise exception 'No such milestone'; end if;
  end if;
  perform community.check_milestones();
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.board_delete_goal(p_id uuid, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
begin
  if exists (select 1 from community.goals where id = p_id and reached_at is not null) then
    raise exception 'A reached milestone stays on the track';
  end if;
  perform community.log_admin('delete_goal', p_id::text, p_reason);
  update community.studio_eras set goal_id = null where goal_id = p_id;
  delete from community.goals where id = p_id;
  if not found then raise exception 'No such milestone'; end if;
  return jsonb_build_object('id', p_id, 'deleted', true);
end;
$$;

create or replace function public.board_eras() returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
begin
  perform community.require_board();
  return public.community_studio();
end;
$$;

-- Sets the studio's era: it and every earlier era are reached (an era reached now is posted), and
-- every later one is not.
create or replace function public.board_set_era(p_era text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_idx integer;
  e record;
begin
  select idx into v_idx from community.studio_eras where id = p_era;
  if v_idx is null then raise exception 'No such era'; end if;
  perform community.log_admin('set_era', p_era, p_reason);
  for e in update community.studio_eras set reached_at = now() where idx <= v_idx and reached_at is null returning id, name loop
    perform community.add_event('era', 'The studio grew into the ' || e.name, 'era:' || e.id || ':' || now());
  end loop;
  update community.studio_eras set reached_at = null where idx > v_idx;
  return public.community_studio();
end;
$$;

create or replace function public.board_flags() returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
begin
  perform community.require_board();
  return coalesce((select jsonb_object_agg(key, value) from community.flags), '{}'::jsonb);
end;
$$;

create or replace function public.board_set_flag(p_key text, p_value jsonb, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
begin
  if p_key is null or p_key !~ '^[a-z0-9_]{2,40}$' then raise exception 'A flag key is 2 to 40 lowercase letters, digits or _'; end if;
  if p_value is null or octet_length(p_value::text) > 2048 then raise exception 'A flag value is JSON of at most 2 KB'; end if;
  perform community.log_admin('set_flag', p_key, p_reason, jsonb_build_object('value', p_value,
    'from', (select value from community.flags where key = p_key)));
  insert into community.flags (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return public.board_flags();
end;
$$;

create or replace function public.board_moderation_log(p_cursor text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
declare
  v_before bigint := case when p_cursor ~ '^[0-9]{1,18}$' then p_cursor::bigint else null end;
  v_items jsonb;
  v_n integer;
  v_min bigint;
begin
  perform community.require_board();
  if p_cursor is not null and v_before is null then raise exception 'Bad cursor'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'at', l.at, 'actor', l.actor_email, 'action', l.action,
      'target', l.target, 'reason', l.reason, 'details', l.details) order by l.id desc), '[]'::jsonb), count(*), min(l.id)
  into v_items, v_n, v_min
  from (select * from community.admin_log x where v_before is null or x.id < v_before order by x.id desc limit 50) l;
  return jsonb_build_object('items', v_items, 'next', case when v_n = 50 then v_min::text else null end);
end;
$$;

-- b. The Scout's path ------------------------------------------------------------------------

-- A suggestion with a triage joins the cluster its key names (made from this triage when new),
-- unless it is held or declined.
create or replace function community.cluster_suggestion(p_id uuid) returns void
language plpgsql
security definer
set search_path = community, public
as $$
declare
  t community.suggestion_triage;
  s community.suggestions;
  v_cluster uuid;
begin
  select * into s from community.suggestions where id = p_id;
  select * into t from community.suggestion_triage where suggestion_id = p_id;
  if s.id is null or t.suggestion_id is null or s.held or s.state = 'declined' or s.cluster_id is not null or t.summary is null then
    return;
  end if;
  insert into community.suggestion_clusters (key, area, kind, summary, fit)
  values (t.cluster_key, t.area, t.kind, t.summary, t.fit)
  on conflict (key) do nothing;
  select coalesce(c.merged_into, c.id) into v_cluster from community.suggestion_clusters c where c.key = t.cluster_key;
  update community.suggestions set cluster_id = v_cluster, state = 'clustered' where id = p_id;
end;
$$;

-- The batch the Scout reads: up to p_limit received suggestions not handed out in the last hour,
-- oldest first, with only the fields the Scout needs. Empty while the scout_triage flag is off.
create or replace function public.scout_take_batch(p_limit integer default 20) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_items jsonb;
begin
  if not community.flag_on('scout_triage') then return jsonb_build_object('enabled', false, 'items', '[]'::jsonb); end if;
  with picked as (
    select s.id from community.suggestions s
    where s.state = 'received' and not s.held and (s.scout_claimed_at is null or s.scout_claimed_at < now() - interval '1 hour')
    order by s.created_at, s.id
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
    for update skip locked
  ), marked as (
    update community.suggestions s set scout_claimed_at = now() from picked where s.id = picked.id
    returning s.id, s.area, s.title, s.body, s.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'area', area, 'title', title, 'body', body) order by created_at, id), '[]'::jsonb)
  into v_items from marked;
  return jsonb_build_object('enabled', true, 'items', v_items);
end;
$$;

-- The Scout's answer, already validated against suggestion-triage.schema.json by the dispatcher,
-- checked again here: each item names a suggestion still received, with fields in range. Items
-- that do not are skipped. Returns what was written.
create or replace function public.scout_record_triage(p_run uuid, p_items jsonb) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  it jsonb;
  v_id uuid;
  v_flags text[];
  v_summary text;
  v_written integer := 0;
  v_skipped integer := 0;
  v_declined integer := 0;
  v_held integer := 0;
  v_area text;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'The triage is a list'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    begin
      v_id := (it->>'id')::uuid;
      select area into v_area from community.suggestions where id = v_id and state = 'received';
      if v_area is null then v_skipped := v_skipped + 1; continue; end if;
      select coalesce(array_agg(f), '{}') into v_flags from jsonb_array_elements_text(coalesce(it->'safety_flags', '[]'::jsonb)) f;
      v_summary := it->>'summary';
      if 'instruction_to_agents' = any (v_flags) or 'money_or_secrets' = any (v_flags) then
        v_summary := null;
        if not ('instruction_to_agents' = any (v_flags)) then v_flags := array_append(v_flags, 'instruction_to_agents'); end if;
      end if;
      insert into community.suggestion_triage (suggestion_id, area, kind, cluster_key, fit, flags, summary, job_run_id)
      values (v_id, it->>'area', it->>'kind', it->>'cluster_key', (it->>'fit')::numeric, v_flags,
        case when v_summary is null then null else left(btrim(v_summary), 140) end, p_run)
      on conflict (suggestion_id) do nothing;
      if 'instruction_to_agents' = any (v_flags) then
        update community.suggestions set state = 'declined', decline_reason = 'instruction_to_agents' where id = v_id;
        v_declined := v_declined + 1;
      elsif 'not_all_ages' = any (v_flags) then
        update community.suggestions set state = 'declined', decline_reason = 'not_all_ages' where id = v_id;
        v_declined := v_declined + 1;
      elsif cardinality(v_flags) > 0 then
        update community.suggestions set state = 'reviewed', held = true where id = v_id;
        v_held := v_held + 1;
      else
        update community.suggestions set state = 'reviewed' where id = v_id;
        perform community.cluster_suggestion(v_id);
      end if;
      perform community.add_event('suggestion', 'A suggestion for ' || case v_area when 'dust' then 'Dust' when 'new_game' then 'a new game'
        when 'studio' then 'the studio' else 'the site' end || ' was reviewed', 'reviewed:' || v_id);
      v_written := v_written + 1;
    exception when others then
      v_skipped := v_skipped + 1;
    end;
  end loop;
  return jsonb_build_object('written', v_written, 'skipped', v_skipped, 'declined', v_declined, 'held', v_held);
end;
$$;

-- c. Roles and the job -------------------------------------------------------------------------

insert into public.roles (name, title, description, species_note, model, budget_share, voice, prompt_path,
  tools_json, metrics_json, write_access, status, trigger, agent_class)
values
  ('Scout', 'Scout', 'Reads queued player suggestions as quoted data and sorts them into structured fields; it has no tools and writes nothing.',
    'A small sand-coloured creature with one tall antenna and wide, watchful eyes.',
    coalesce((select model from public.roles where name = 'Janitor'), 'MODEL_BUILDER'), 0, 'level', 'platform/agents/prompts/scout.md',
    '[]'::jsonb, '["first_pass_rate","cost_per_ship"]'::jsonb, false, 'starts', 'Starts when the board turns on suggestion triage.', 'web_only'),
  ('Art Director', 'Art Director', 'Reviews the look of every game: its box art and visual quality, against the studio''s quality bar.',
    'A tall violet creature with a paintbrush-tipped tail and round spectacles.',
    coalesce((select model from public.roles where name = 'Game Director'), 'MODEL_DIRECTOR'), 0, 'keen', 'platform/agents/prompts/art-director.md',
    '["Read","Glob","Grep"]'::jsonb, '["first_pass_rate","reopen_rate"]'::jsonb, false, 'starts', 'Starts at the first box-art card.', 'reviewer')
on conflict (name) do nothing;

insert into public.jobs (name, role_id, calls_model, runs_when_paused, description)
values ('scout_triage', (select id from public.roles where name = 'Scout'), true, false,
  'Triage suggestions: the Scout, with no tools, sorts a batch of queued player suggestions into structured fields; nothing else is written.')
on conflict (name) do update set role_id = excluded.role_id, calls_model = excluded.calls_model,
  runs_when_paused = excluded.runs_when_paused, description = excluded.description;

create or replace function public.enqueue_scout_triage() returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
begin
  if not community.flag_on('scout_triage') then return jsonb_build_object('queued', false, 'reason', 'flag_off'); end if;
  if not exists (select 1 from community.suggestions where state = 'received' and not held) then
    return jsonb_build_object('queued', false, 'reason', 'nothing_waiting');
  end if;
  if exists (select 1 from public.job_runs where job_name = 'scout_triage' and status in ('queued', 'running')) then
    return jsonb_build_object('queued', false, 'reason', 'already_queued');
  end if;
  return jsonb_build_object('queued', true, 'run', public.enqueue_job_run('scout_triage', 'schedule', null, null, '{}'::jsonb, null));
end;
$$;

-- Grants --------------------------------------------------------------------------------------

do $$
declare
  f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'community' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('board_community_users', 'board_suspend_user', 'board_rename_user', 'board_suggestions',
      'board_decline_suggestion', 'board_release_suggestion', 'board_merge_clusters', 'board_draft_from_cluster', 'board_link_cluster_card',
      'board_seeds', 'board_unpublish_seed', 'board_feature_seed', 'board_community_cards', 'board_set_card_face', 'board_goals',
      'board_save_goal', 'board_delete_goal', 'board_eras', 'board_set_era', 'board_flags', 'board_set_flag', 'board_moderation_log') loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;

revoke all on function public.scout_take_batch(integer) from public, anon, authenticated;
revoke all on function public.scout_record_triage(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.enqueue_scout_triage() from public, anon, authenticated;
grant execute on function public.scout_take_batch(integer) to service_role;
grant execute on function public.scout_record_triage(uuid, jsonb) to service_role;
grant execute on function public.enqueue_scout_triage() to service_role;

-- A database that does not ship pg_cron (PGlite in the tests) skips the schedule.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; enqueue_scout_triage is not scheduled';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('scout-triage', '*/15 * * * *', $c$select public.enqueue_scout_triage()$c$);
end $$;

notify pgrst, 'reload schema';
