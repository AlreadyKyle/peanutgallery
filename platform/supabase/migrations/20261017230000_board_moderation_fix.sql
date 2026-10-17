-- Moderation fixes for the community admin (docs/specs/board-moderation-fixes.md, a kernel change
-- to docs/specs/community-core.md). No money function changes: lifetime_cents, the goals, the
-- claims and every ledger path are untouched.
--
-- a. A suspended player's content leaves the public lists. community_seeds and
--    community_suggestions, re-created here exactly as 20261017100000_community_core.sql wrote them
--    plus one filter (no profile of the author is suspended; in both of community_seeds' page
--    queries), list nothing a suspended player wrote. Restoring the player lists it again; nothing
--    is deleted. Their grants are restated as community_core set them.
-- b. A merged cluster resolves to the end of its merge chain. community.cluster_root(cluster) follows
--    merged_into to the cluster that was never merged, at most 64 hops (null for a missing cluster
--    or a loop, so a bad chain never clusters a suggestion anywhere). cluster_suggestion joins a
--    suggestion to that root rather than one hop along. board_merge_clusters checks the board first,
--    then refuses to merge a cluster that was already merged (from) or into one that was (into),
--    and repoints every cluster merged into the one it merges, so each chain stays one hop.
-- c. Existing data: every merged cluster is repointed at its root, and every suggestion that sits
--    on a merged cluster moves to the root.
--
-- No table, column, index or cron job is added. Every statement runs twice without error.

set lock_timeout = '5s';

-- community_seeds and community_suggestions as 20261017100000_community_core.sql wrote them, each
-- with the suspended-author filter added.
create or replace function public.community_seeds(p_sort text default 'trending', p_cursor text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
declare
  v_sort text := coalesce(p_sort, 'trending');
  v_key float8;
  v_id uuid;
  v_items jsonb;
  v_n integer;
  v_last_key float8;
  v_last_id uuid;
begin
  if v_sort not in ('trending', 'top_week', 'top_all', 'new') then raise exception 'Bad sort'; end if;
  if p_cursor is not null then
    if p_cursor !~ '^-?[0-9][0-9.e+-]{0,29}\|[0-9a-f-]{36}$' then raise exception 'Bad cursor'; end if;
    v_key := split_part(p_cursor, '|', 1)::float8;
    v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  with page as (
    select s.id, community.seed_key(v_sort, s) as k
    from community.seeds s
    where s.published and not s.unpublished
      and not exists (select 1 from community.profiles p where p.user_id = s.user_id and p.suspended)
      and (v_sort <> 'top_week' or s.created_at > now() - interval '7 days')
      and (v_key is null or (community.seed_key(v_sort, s), s.id) < (v_key, v_id))
    order by 2 desc, 1 desc
    limit 24
  )
  select coalesce(jsonb_agg(community.seed_json(s) order by page.k desc, page.id desc), '[]'::jsonb), count(*)
  into v_items, v_n
  from page join community.seeds s on s.id = page.id;
  if v_n = 24 then
    select k, id into v_last_key, v_last_id from (
      select s.id, community.seed_key(v_sort, s) as k
      from community.seeds s
      where s.published and not s.unpublished
        and not exists (select 1 from community.profiles p where p.user_id = s.user_id and p.suspended)
        and (v_sort <> 'top_week' or s.created_at > now() - interval '7 days')
        and (v_key is null or (community.seed_key(v_sort, s), s.id) < (v_key, v_id))
      order by 2 desc, 1 desc
      limit 24
    ) z order by k asc, id asc limit 1;
  end if;
  return jsonb_build_object('items', v_items,
    'next', case when v_n = 24 then v_last_key::text || '|' || v_last_id else null end);
end;
$$;

create or replace function public.community_suggestions(p_sort text default 'top', p_area text default null, p_cursor text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
declare
  v_sort text := coalesce(p_sort, 'top');
  v_votes integer := 0;
  v_at bigint;
  v_id uuid;
  v_ids uuid[];
  v_last community.suggestions;
  v_items jsonb;
begin
  if v_sort not in ('top', 'new') then raise exception 'Bad sort'; end if;
  if p_area is not null and p_area not in ('dust', 'new_game', 'studio', 'site') then raise exception 'Bad area'; end if;
  if p_cursor is not null then
    if p_cursor !~ '^[0-9]{1,9}\|[0-9]{1,20}\|[0-9a-f-]{36}$' then raise exception 'Bad cursor'; end if;
    v_votes := case when v_sort = 'top' then split_part(p_cursor, '|', 1)::integer else 0 end;
    v_at := split_part(p_cursor, '|', 2)::bigint;
    v_id := split_part(p_cursor, '|', 3)::uuid;
  end if;
  select array_agg(z.id order by z.ord) into v_ids from (
    select s.id, row_number() over (order by case when v_sort = 'top' then s.votes else 0 end desc,
      trunc(extract(epoch from s.created_at) * 1000000) desc, s.id desc) as ord
    from community.suggestions s
    where not s.held and coalesce(s.decline_reason, '') not in ('instruction_to_agents', 'not_all_ages')
      and not exists (select 1 from community.profiles p where p.user_id = s.user_id and p.suspended)
      and (p_area is null or s.area = p_area)
      and (p_cursor is null or
        (case when v_sort = 'top' then s.votes else 0 end, trunc(extract(epoch from s.created_at) * 1000000)::bigint, s.id)
          < (v_votes, v_at, v_id))
    order by ord
    limit 30
  ) z;
  select coalesce(jsonb_agg(community.suggestion_json(s) order by array_position(v_ids, s.id)), '[]'::jsonb) into v_items
  from community.suggestions s where s.id = any (coalesce(v_ids, '{}'));
  if coalesce(array_length(v_ids, 1), 0) = 30 then select * into v_last from community.suggestions where id = v_ids[30]; end if;
  return jsonb_build_object(
    'items', v_items,
    'next', case when v_last.id is null then null
      else (case when v_sort = 'top' then v_last.votes else 0 end)::text || '|'
        || trunc(extract(epoch from v_last.created_at) * 1000000)::bigint::text || '|' || v_last.id end
  );
end;
$$;

-- b. Merge chains ---------------------------------------------------------------------------------

create or replace function community.cluster_root(p_cluster uuid) returns uuid
language plpgsql
stable
security definer
set search_path = community, public
as $$
declare
  v_id uuid := p_cluster;
  v_next uuid;
  v_hops integer := 0;
begin
  if p_cluster is null then return null; end if;
  loop
    select c.merged_into into v_next from community.suggestion_clusters c where c.id = v_id;
    if not found then return null; end if;
    if v_next is null then return v_id; end if;
    v_hops := v_hops + 1;
    -- A loop, or a chain no merge could make: no root.
    if v_hops > 64 or v_next = p_cluster then return null; end if;
    v_id := v_next;
  end loop;
end;
$$;

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
  select community.cluster_root(c.id) into v_cluster from community.suggestion_clusters c where c.key = t.cluster_key;
  if v_cluster is null then return; end if;
  update community.suggestions set cluster_id = v_cluster, state = 'clustered' where id = p_id;
end;
$$;

create or replace function public.board_merge_clusters(p_from uuid, p_into uuid, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = community, public
as $$
declare
  v_from community.suggestion_clusters;
  v_into community.suggestion_clusters;
  v_moved integer;
begin
  perform community.require_board();
  if p_from is null or p_into is null or p_from = p_into then raise exception 'Name two different clusters'; end if;
  select * into v_from from community.suggestion_clusters where id = p_from;
  if v_from.id is null then raise exception 'No such cluster'; end if;
  if v_from.merged_into is not null then raise exception 'That cluster was already merged into another'; end if;
  select * into v_into from community.suggestion_clusters where id = p_into;
  if v_into.id is null then raise exception 'No such cluster to merge into'; end if;
  if v_into.merged_into is not null then raise exception 'The cluster to merge into was itself merged into another; merge into that one'; end if;
  perform community.log_admin('merge_clusters', p_from::text, p_reason, jsonb_build_object('into', p_into));
  update community.suggestion_clusters set merged_into = p_into where id = p_from;
  -- Clusters merged into this one before now point at the new root, so every chain stays one hop.
  update community.suggestion_clusters set merged_into = p_into where merged_into = p_from;
  update community.suggestions set cluster_id = p_into where cluster_id = p_from;
  get diagnostics v_moved = row_count;
  return jsonb_build_object('into', p_into, 'moved', v_moved);
end;
$$;

-- c. Existing chains --------------------------------------------------------------------------------

update community.suggestion_clusters c set merged_into = community.cluster_root(c.id)
where c.merged_into is not null
  and community.cluster_root(c.id) is not null
  and community.cluster_root(c.id) is distinct from c.merged_into;

update community.suggestions s set cluster_id = community.cluster_root(s.cluster_id)
where s.cluster_id in (select c.id from community.suggestion_clusters c where c.merged_into is not null)
  and community.cluster_root(s.cluster_id) is not null;

-- Grants ------------------------------------------------------------------------------------------

revoke all on function community.cluster_root(uuid) from public, anon, authenticated, service_role;
revoke all on function community.cluster_suggestion(uuid) from public, anon, authenticated, service_role;

revoke all on function public.community_seeds(text, text) from public;
revoke all on function public.community_suggestions(text, text, text) from public;
grant execute on function public.community_seeds(text, text) to anon, authenticated;
grant execute on function public.community_suggestions(text, text, text) to anon, authenticated;
revoke all on function public.community_seeds(text, text) from service_role;
revoke all on function public.community_suggestions(text, text, text) from service_role;

revoke all on function public.board_merge_clusters(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.board_merge_clusters(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
