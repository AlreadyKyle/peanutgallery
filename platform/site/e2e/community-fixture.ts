import type { Page, Route } from '@playwright/test';
import { BUILDING_CARD_ID, LIVE_CARD_ID, OPEN_CARD_ID } from './supporter-studio';

// The community function's answers for the place pages (docs/specs/place.md): the ideas board's top
// ideas, a card's Suggested by (the ideas naming it), a signed-in player's profile with cards, ideas and badges, their follows, and the claim. Every
// request stays on the site's own origin, as community.mts answers it.

const json = 'application/json; charset=utf-8';
export type Post = { path: string; body: unknown; auth: string | null };

/** A session the page reads from storage as signed in, expiring far in the future. */
export const PLAYER_SESSION = JSON.stringify({ accessToken: 'e2e-access', refreshToken: 'e2e-refresh', expiresAt: 4_102_444_800_000 });

const person = (handle: string, displayName: string, level: number, fill: string) => ({
  handle,
  displayName,
  level,
  avatar: { body: 'round', eyes: 'two', antennae: level > 2 ? 'two' : 'none', pattern: 'plain', fill },
  frame: null,
  flair: null,
});

const idea = (id: number, title: string, state: string, upvotes: number, cardId: string | null = null) => ({
  id: `30000000-0000-4000-8000-00000000000${id}`,
  area: 'dust',
  title,
  summary: null,
  state,
  declineReason: null,
  upvotes,
  clusterId: null,
  cardId,
  author: person(`player-${id}`, `Player ${id}`, id, 'green'),
  createdAt: '2026-09-21T10:00:00Z',
});

export const IDEAS = [
  idea(1, 'A night cycle for Dust', 'drafted', 14, OPEN_CARD_ID),
  idea(2, 'Let me rename my Cart', 'reviewed', 9),
  idea(3, 'Sound for the dust storms', 'received', 4),
  idea(4, 'Faster loading on phones', 'live', 21, LIVE_CARD_ID),
];

export const PLAYER = {
  ...person('wren', 'Wren', 4, 'lavender'),
  flair: 'Dust regular',
  xp: 640,
  tier: 'Spectator',
  nextLevelXp: 800,
  badges: [
    { id: 'first_card', name: 'First card', rule: 'Funded a first card.', glyph: 'badge', awardedAt: '2026-09-20T10:00:00Z' },
    { id: 'it_shipped', name: 'It shipped', rule: 'A card you funded went live.', glyph: 'badge', awardedAt: '2026-09-21T10:00:00Z' },
  ],
  collection: [
    { cardId: LIVE_CARD_ID, title: 'The live card', suit: 'game', rarity: 'rare', cents: 1500 },
    { cardId: BUILDING_CARD_ID, title: 'The card being built', suit: 'game', rarity: 'common', cents: 500 },
    { cardId: OPEN_CARD_ID, title: 'The open card', suit: 'game', rarity: 'uncommon', cents: 1000 },
  ],
  seeds: [],
  suggestions: [IDEAS[0], IDEAS[2]],
  joinedAt: '2026-09-19T00:00:00Z',
  publicByDefault: true,
};

export type CommunityOptions = { profile?: unknown; ideas?: readonly unknown[]; posts?: Post[]; signInOpen?: boolean };

/** Answers /api/community: the ideas board, and the player's RPCs under any session. */
export async function answerCommunity(page: Page, options: CommunityOptions = {}): Promise<Post[]> {
  const posts = options.posts ?? [];
  const ideas = options.ideas ?? IDEAS;
  await page.route(/\/api\/community\//, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (status: number, value: unknown) => route.fulfill({ status, contentType: json, body: JSON.stringify(value) });
    if (request.method() === 'GET') {
      if (url.pathname === '/api/community/suggestions') return reply(200, { items: ideas, next: null });
      if (url.pathname === '/api/community/auth/settings') return reply(200, { signIn: options.signInOpen ?? true });
      const card = /^\/api\/community\/card\/([^/]+)\/ideas$/.exec(url.pathname);
      if (card) return reply(200, { items: ideas.filter((item) => (item as { cardId?: string | null }).cardId === card[1]) });
      return reply(503, { error: 'not in the e2e fixtures' });
    }
    const body = request.postData() ? (JSON.parse(request.postData()!) as Record<string, unknown>) : {};
    posts.push({ path: url.pathname, body, auth: (await request.allHeaders()).authorization ?? null });
    switch (url.pathname) {
      case '/api/community/auth/otp':
        return reply(200, { sent: true });
      case '/api/community/rpc/my_profile':
        return options.profile === undefined ? reply(200, PLAYER) : reply(200, options.profile);
      case '/api/community/rpc/my_follows':
        return reply(200, { follows: [], open: 0, cap: 100 });
      case '/api/community/rpc/claim_contributions':
        return reply(200, { claimed: 1 });
      default:
        return reply(503, { error: 'not in the e2e fixtures' });
    }
  });
  return posts;
}

/** Signs the page's player in before any script runs. */
export async function signIn(page: Page): Promise<void> {
  await page.addInitScript((session) => window.localStorage.setItem('mm:player-session', session), PLAYER_SESSION);
}
