import type { SupabaseClient } from '@supabase/supabase-js';

// The board's community admin (docs/specs/community-core.md): one call per board_* RPC. Each RPC
// checks the board and the second factor itself and writes one moderation-log row with the reason
// it is given. Nothing here imports from the public site: the shapes are the RPCs' own.

export type Row = Record<string, unknown>;
export interface Page {
  items: Row[];
  next: string | null;
}

export const COMMUNITY_TABS = ['Users', 'Suggestions', 'Seeds', 'Card faces', 'Goals', 'Studio eras', 'Flags', 'Moderation log'] as const;
export type CommunityTab = (typeof COMMUNITY_TABS)[number];

export const SUGGESTION_STATES = ['received', 'held', 'reviewed', 'clustered', 'drafted', 'open', 'building', 'live', 'declined'] as const;
export const DECLINE_REASONS = ['duplicate', 'off_pillar', 'not_all_ages', 'instruction_to_agents', 'too_large', 'already_planned', 'not_feasible'] as const;
export const SUITS = ['game', 'new_game', 'studio', 'platform', 'machine'] as const;
export const RARITIES = ['common', 'uncommon', 'rare', 'legendary'] as const;

async function call<T = unknown>(client: SupabaseClient, name: string, args: Row = {}): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export function pageFrom(data: unknown): Page {
  const value = typeof data === 'object' && data !== null ? (data as Row) : {};
  const items = Array.isArray(value.items) ? (value.items as unknown[]).filter((item): item is Row => typeof item === 'object' && item !== null) : [];
  return { items, next: typeof value.next === 'string' ? value.next : null };
}

const page = async (client: SupabaseClient, name: string, args: Row) => pageFrom(await call(client, name, args));

export const fetchUsers = (client: SupabaseClient, query: string | null, cursor: string | null) =>
  page(client, 'board_community_users', { p_query: query === '' ? null : query, p_cursor: cursor });
export const suspendUser = (client: SupabaseClient, handle: string, suspended: boolean, reason: string) =>
  call(client, 'board_suspend_user', { p_handle: handle, p_suspended: suspended, p_reason: reason });
export const renameUser = (client: SupabaseClient, handle: string, displayName: string, reason: string) =>
  call(client, 'board_rename_user', { p_handle: handle, p_display_name: displayName, p_reason: reason });

export const fetchSuggestions = (client: SupabaseClient, state: string | null, cursor: string | null) =>
  page(client, 'board_suggestions', { p_state: state === '' ? null : state, p_cursor: cursor });
export const declineSuggestion = (client: SupabaseClient, id: string, declineReason: string, reason: string) =>
  call(client, 'board_decline_suggestion', { p_id: id, p_decline_reason: declineReason, p_reason: reason });
export const releaseSuggestion = (client: SupabaseClient, id: string, reason: string) => call(client, 'board_release_suggestion', { p_id: id, p_reason: reason });
export const mergeClusters = (client: SupabaseClient, from: string, into: string, reason: string) =>
  call(client, 'board_merge_clusters', { p_from: from, p_into: into, p_reason: reason });
export const draftFromCluster = (client: SupabaseClient, cluster: string, reason: string) => call(client, 'board_draft_from_cluster', { p_cluster: cluster, p_reason: reason });
export const linkClusterCard = (client: SupabaseClient, cluster: string, card: string, reason: string) =>
  call(client, 'board_link_cluster_card', { p_cluster: cluster, p_card: card, p_reason: reason });

export const fetchSeeds = (client: SupabaseClient, cursor: string | null) => page(client, 'board_seeds', { p_cursor: cursor });
export const unpublishSeed = (client: SupabaseClient, id: string, unpublished: boolean, reason: string) =>
  call(client, 'board_unpublish_seed', { p_id: id, p_unpublished: unpublished, p_reason: reason });
export const featureSeed = (client: SupabaseClient, id: string, featured: boolean, reason: string) =>
  call(client, 'board_feature_seed', { p_id: id, p_featured: featured, p_reason: reason });

export const fetchCardFaces = (client: SupabaseClient, cursor: string | null) => page(client, 'board_community_cards', { p_cursor: cursor });
export const setCardFace = (client: SupabaseClient, card: string, suit: string, rarity: string, reason: string) =>
  call(client, 'board_set_card_face', { p_card: card, p_suit: suit, p_rarity: rarity, p_reason: reason });

export async function fetchGoals(client: SupabaseClient): Promise<Page> {
  const doc = (await call<Row | null>(client, 'board_goals')) ?? {};
  return { items: Array.isArray(doc.goals) ? (doc.goals as Row[]) : [], next: null };
}
export const saveGoal = (client: SupabaseClient, goal: { id: string | null; amountCents: number; title: string; outcome: string; link: string }, reason: string) =>
  call(client, 'board_save_goal', { p_id: goal.id, p_amount_cents: goal.amountCents, p_title: goal.title, p_outcome: goal.outcome, p_link: goal.link, p_reason: reason });
export const deleteGoal = (client: SupabaseClient, id: string, reason: string) => call(client, 'board_delete_goal', { p_id: id, p_reason: reason });

export async function fetchEras(client: SupabaseClient): Promise<Page> {
  const doc = (await call<Row | null>(client, 'board_eras')) ?? {};
  return { items: Array.isArray(doc.eras) ? (doc.eras as Row[]) : [], next: null };
}
export const setEra = (client: SupabaseClient, era: string, reason: string) => call(client, 'board_set_era', { p_era: era, p_reason: reason });

export async function fetchFlags(client: SupabaseClient): Promise<Page> {
  const flags = (await call<Row | null>(client, 'board_flags')) ?? {};
  return { items: Object.keys(flags).sort().map((key) => ({ key, value: flags[key] })), next: null };
}
export const setFlag = (client: SupabaseClient, key: string, value: unknown, reason: string) => call(client, 'board_set_flag', { p_key: key, p_value: value, p_reason: reason });

export const fetchModerationLog = (client: SupabaseClient, cursor: string | null) => page(client, 'board_moderation_log', { p_cursor: cursor });

/** Dollars typed into the goal form, as whole cents, or null. */
export function centsFrom(dollars: string): number | null {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(dollars.trim())) return null;
  const cents = Math.round(Number(dollars.trim()) * 100);
  return cents > 0 ? cents : null;
}

export function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
