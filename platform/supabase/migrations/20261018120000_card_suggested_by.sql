-- Suggested by: a card names the players whose ideas it came from (docs/specs/place.md, Suggested
-- by; docs/specs/final-state.md, step 5 of the ideas loop).
--
-- A card comes from ideas when the board links the cluster it was drafted from to the card
-- (board_link_cluster_card sets suggestion_clusters.card_id, and its comment promises this credit).
-- community_card_ideas(card) is the card page's public read: the ideas in the clusters linked to
-- that card, most backed first, at most 30, each as suggestion_json shapes it for the ideas board.
-- A cluster merged after it was linked still counts: its ideas moved to the root cluster, so the
-- read takes the ideas in the root of every linked cluster. It keeps the public lists' rules:
-- nothing for a card the public may not read (card_is_public), and no held idea, no declined one,
-- none declined for a reason the lists hide, and none from a suspended player.
--
-- It reads only rows the public ideas board already shows, adds no table and writes nothing; no
-- agent reads it. anon and authenticated may call it, as the site's /api/community/card/<id>/ideas
-- does with the publishable key.
--
-- Every statement runs twice without error, as the migration test applies it.

set lock_timeout = '5s';

create or replace function public.community_card_ideas(p_card uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = community, public
as $$
declare
  v_items jsonb;
begin
  if p_card is null or not public.card_is_public(p_card) then
    return jsonb_build_object('items', '[]'::jsonb);
  end if;
  with roots as (
    select distinct community.cluster_root(c.id) as id
    from community.suggestion_clusters c
    where c.card_id = p_card
  ), picked as (
    select s.id, s.votes, s.created_at from community.suggestions s
    where s.cluster_id is not null
      and community.cluster_root(s.cluster_id) in (select id from roots where id is not null)
      and not s.held and s.state <> 'declined'
      and coalesce(s.decline_reason, '') not in ('instruction_to_agents', 'not_all_ages')
      and not exists (select 1 from community.profiles p where p.user_id = s.user_id and p.suspended)
    order by s.votes desc, s.created_at, s.id
    limit 30
  )
  select coalesce(jsonb_agg(community.suggestion_json(s) order by picked.votes desc, picked.created_at, picked.id), '[]'::jsonb)
  into v_items from picked join community.suggestions s on s.id = picked.id;
  return jsonb_build_object('items', v_items);
end;
$$;

revoke all on function public.community_card_ideas(uuid) from public;
grant execute on function public.community_card_ideas(uuid) to anon, authenticated;
revoke all on function public.community_card_ideas(uuid) from service_role;
