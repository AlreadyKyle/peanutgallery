// The public contract between the site and the community data layer (docs/specs/final-state.md).
// The documents are served by platform/site/netlify/functions/community.mts at /api/community/*,
// cached at the edge; writes go through Supabase RPCs under the signed-in player's session.
// Every string in these documents is public-safe: event text is composed server-side from fixed
// templates, and player text (titles, display names) has passed the content filter.

export type Suit = 'game' | 'new_game' | 'studio' | 'platform' | 'machine';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface AvatarSpec {
  readonly body: string;
  readonly eyes: string;
  readonly antennae: string;
  readonly pattern: string;
  readonly fill: string;
}

export interface PublicPerson {
  readonly handle: string;
  readonly displayName: string;
  readonly level: number;
  readonly avatar: AvatarSpec;
  readonly frame: string | null;
  readonly flair: string | null;
}

export type FeedKind =
  | 'contribution'
  | 'card_opened'
  | 'stage'
  | 'shipped'
  | 'suggestion'
  | 'badge'
  | 'milestone'
  | 'seed_featured'
  | 'era';

export interface FeedEvent {
  readonly id: string;
  readonly at: string;
  readonly kind: FeedKind;
  readonly text: string;
  readonly cardId?: string;
  readonly role?: string;
  readonly actor?: PublicPerson | null;
  readonly rarity?: Rarity;
  readonly suit?: Suit;
  readonly amountCents?: number;
}

export interface FeedDoc {
  readonly events: readonly FeedEvent[];
  readonly next: string | null;
}

export interface Badge {
  readonly id: string;
  readonly name: string;
  readonly rule: string;
  readonly glyph: string;
}

export interface BadgeAward extends Badge {
  readonly awardedAt: string;
}

export interface CollectedCard {
  readonly cardId: string;
  readonly title: string;
  readonly suit: Suit;
  readonly rarity: Rarity;
  readonly cents: number;
}

export interface SeedSummary {
  readonly id: string;
  readonly code: string;
  readonly game: string;
  readonly title: string;
  readonly author: PublicPerson | null;
  readonly up: number;
  readonly down: number;
  readonly score: number;
  readonly createdAt: string;
  readonly featured: boolean;
}

export type SuggestionState =
  | 'received'
  | 'reviewed'
  | 'clustered'
  | 'drafted'
  | 'open'
  | 'building'
  | 'live'
  | 'declined';

export type DeclineReason =
  | 'duplicate'
  | 'off_pillar'
  | 'not_all_ages'
  | 'instruction_to_agents'
  | 'too_large'
  | 'already_planned'
  | 'not_feasible';

export interface SuggestionSummary {
  readonly id: string;
  readonly area: string;
  readonly title: string;
  readonly summary: string | null;
  readonly state: SuggestionState;
  readonly declineReason: DeclineReason | null;
  readonly upvotes: number;
  readonly clusterId: string | null;
  readonly cardId: string | null;
  readonly author: PublicPerson | null;
  readonly createdAt: string;
}

export interface Profile extends PublicPerson {
  readonly xp: number;
  readonly tier: string;
  readonly nextLevelXp: number;
  readonly badges: readonly BadgeAward[];
  readonly collection: readonly CollectedCard[];
  readonly seeds: readonly SeedSummary[];
  readonly suggestions: readonly SuggestionSummary[];
  readonly joinedAt: string;
}

export interface Goal {
  readonly id: string;
  readonly amountCents: number;
  readonly title: string;
  readonly outcome: string;
  readonly state: 'reached' | 'next' | 'later';
  readonly reachedAt: string | null;
  readonly link: string | null;
}

export interface GoalsDoc {
  readonly lifetimeCents: number;
  readonly goals: readonly Goal[];
}

export interface StudioEra {
  readonly id: string;
  readonly index: number;
  readonly name: string;
  readonly reachedAt: string | null;
  readonly unlockedBy: string;
  readonly stations: readonly string[];
  readonly decor: readonly string[];
}

export interface StudioDoc {
  readonly era: StudioEra;
  readonly eras: readonly StudioEra[];
}

export interface PageDoc<T> {
  readonly items: readonly T[];
  readonly next: string | null;
}

/**
 * The endpoints. GET documents are public and edge-cached; `cursor` is an opaque keyset cursor.
 *   /api/community/feed?cursor=            FeedDoc (newest first)
 *   /api/community/goals                   GoalsDoc
 *   /api/community/studio                  StudioDoc
 *   /api/community/seeds?sort=&cursor=     PageDoc<SeedSummary>; sort is trending | top_week | top_all | new
 *   /api/community/suggestions?sort=&area=&cursor=  PageDoc<SuggestionSummary>; sort is top | new
 *   /api/community/profile/<handle>        Profile, or 404
 * RPCs (supabase-js `rpc`, signed in by magic link), each in the `community` schema's public wrappers:
 *   my_profile() -> Profile
 *   update_profile(display_name, avatar jsonb, frame, flair, public_by_default boolean)
 *   claim_contributions() -> { claimed: number }   (matches the session email to receipt emails server-side)
 *   submit_suggestion(area, title, body) -> { id }
 *   vote_suggestion(id, value smallint)             (1 or 0 to clear)
 *   save_seed(game, code, title, publish boolean) -> { id }
 *   vote_seed(id, value smallint)                   (1, -1 or 0 to clear)
 * The cards document gains `suit: Suit` and `rarity: Rarity` on every card.
 */
export const COMMUNITY_API = '/api/community';
