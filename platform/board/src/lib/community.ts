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

/**
 * Dollars typed into the goal form, as whole cents, or null. A leading $ and thousands commas are
 * allowed ("$500", "1,000", "$1,250.50"); anything else, or nothing above zero, is null.
 */
export function centsFrom(dollars: string): number | null {
  const typed = dollars.trim().replace(/^\$\s*/, '');
  if (!/^(\d{1,9}|\d{1,3}(,\d{3}){1,2})(\.\d{1,2})?$/.test(typed)) return null;
  const cents = Math.round(Number(typed.replaceAll(',', '')) * 100);
  return cents > 0 ? cents : null;
}

/** What turning each known flag on or off does, for the confirm. */
const FLAG_EFFECTS: Record<string, { on: string; off: string }> = {
  profiles_open: { on: 'Players can sign in by magic link and make a profile again.', off: 'No new player can sign in or make a profile until it is turned back on.' },
  suggestions_open: { on: 'Signed-in players can send suggestions again.', off: 'No player can send a suggestion until it is turned back on.' },
  seeds_open: { on: 'Players can publish seeds again.', off: 'No player can publish a seed until it is turned back on.' },
  curator_triage: { on: 'The Curator starts reading the suggestion queue every 15 minutes, a model run billed as studio overhead.', off: 'The Curator stops triaging; new suggestions wait in the queue.' },
};

/** The confirm a destructive community action asks first, naming what it changes. */
export const confirmText = {
  suspend: (handle: string) => `Suspend ${handle}? Their profile, suggestions and seeds are hidden from the public and they cannot post until restored.`,
  decline: (title: string, why: string) => `Decline the suggestion "${title}" as ${why}? It leaves the queue, and Release does not bring a declined suggestion back.`,
  draft: (cluster: string) => `Draft a card from cluster ${cluster}? This queues a paid draft_card run for the Game Designer, and the cluster's suggestions become drafted.`,
  link: (cluster: string, card: string) => `Link cluster ${cluster} to the card "${card}"? Its suggestions then follow that card's stage.`,
  merge: (from: string, into: string) => `Merge cluster ${from} into ${into}? Its suggestions move to ${into}, and this cannot be undone.`,
  deleteGoal: (title: string, amount: string) => `Delete the milestone "${title}" (${amount})? It leaves the public goals track, and this cannot be undone.`,
  era: (name: string) => `Set the studio era to ${name}? The public site shows it as the current era; every later era is unset and every earlier one is marked reached.`,
  flag: (key: string, on: boolean) => {
    const effect = FLAG_EFFECTS[key]?.[on ? 'on' : 'off'] ?? 'The site reads it at once.';
    return `Turn ${key} ${on ? 'on' : 'off'}? ${effect}`;
  },
} as const;

export interface ClusterOption {
  id: string;
  key: string;
}

/** The distinct clusters among the loaded suggestions, by key, for the Merge into picker. */
export function clusterOptions(items: Row[]): ClusterOption[] {
  const seen = new Map<string, string>();
  for (const s of items) {
    if (typeof s.clusterId !== 'string' || seen.has(s.clusterId)) continue;
    seen.set(s.clusterId, typeof s.clusterKey === 'string' && s.clusterKey !== '' ? s.clusterKey : s.clusterId.slice(0, 8));
  }
  return [...seen].map(([id, key]) => ({ id, key })).sort((a, b) => a.key.localeCompare(b.key));
}

/** A milestone's amount in cents as dollars, for the table and the confirm. */
export function dollarsText(cents: unknown): string {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

export function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
