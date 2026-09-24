import type { StudioFixture } from './fixtures';
import { LIVE_STUDIO } from './live-studio';

/**
 * The launch-shaped studio with what the supporter pages read (docs/specs/supporter-pages.md): a live
 * card with a commit, config checks, 30 supporters and a run of agent lines; a card being built and
 * one being checked; an approved card waiting to be dealt and one the board vetoed; role stats; and
 * a /thanks answer for each state. The paused and rejected cards are LIVE_STUDIO's Stopped rows.
 * Test data only: no public page ever draws a fixture.
 */
const roleId = (title: string): string => String(LIVE_STUDIO.roles.find((role) => role.title === title)?.id ?? '');
export const BUILDER_A = roleId('Builder A');
export const BUILDER_B = roleId('Builder B');
export const QA = roleId('QA');

export const LIVE_CARD_ID = '20000000-0000-4000-8000-000000000001';
export const BUILDING_CARD_ID = '20000000-0000-4000-8000-000000000002';
export const CHECKS_CARD_ID = '20000000-0000-4000-8000-000000000003';
export const OPENS_SOON_ID = '20000000-0000-4000-8000-000000000004';
export const VETOED_ID = '20000000-0000-4000-8000-000000000005';
export const REJECTED_CARD_ID = String(LIVE_STUDIO.stopped![1]!.card_id);
export const PAUSED_CARD_ID = String(LIVE_STUDIO.stopped![0]!.card_id);
/** An open card with no supporters. */
export const OPEN_CARD_ID = String(LIVE_STUDIO.cards[1]!.id);
export const LIVE_TITLE = 'The Gatherer is now the Sweeper';
export const COMMIT = '4f2a9c1e7b3d5a8c0e6f1b2d4a7c9e0f3b5d8a1c';
export const VETO_REASON = 'It overlaps the card being built now.';

function card(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    summary: null,
    intent: 'Fixture intent for the agents.',
    source: 'board',
    stage: 'proposed',
    shape: 'oneoff',
    bucket: 'game',
    folder: 'seed-1',
    horizon: 'now',
    rank: null,
    executor_role_id: null,
    funding_target_usd: '0.0000',
    funded_usd: '0.0000',
    created_at: '2026-09-20T12:00:00Z',
    updated_at: '2026-09-20T12:00:00Z',
    live_at: null,
    ...fields,
  };
}

const at = (minutes: number) => new Date(Date.parse('2026-09-21T14:00:00Z') + minutes * 60_000).toISOString();

const LIVE_CARD = card({
  id: LIVE_CARD_ID,
  title: LIVE_TITLE,
  summary: 'The first building gets a clearer name.',
  stage: 'live',
  executor_role_id: BUILDER_A,
  funding_target_usd: '2.0000',
  funded_usd: '2.0000',
  created_at: '2026-09-20T12:00:00Z',
  updated_at: at(40),
  live_at: at(40),
  commit_sha: COMMIT,
  acceptance_test: [
    'The first building reads Sweeper everywhere.',
    'check: config seed-1/config/game.json buildings[id=gatherer].name == "Sweeper"',
    'check: config seed-1/config/game.json buildings[id=gatherer].baseCost == 12',
    'check: config seed-1/config/game.json unlocks[0].labels == ["a", "b"]',
  ].join('\n'),
});

const BUILDING_CARD = card({
  id: BUILDING_CARD_ID,
  title: 'A cheaper Cart',
  summary: 'The Cart costs less to build.',
  stage: 'building',
  executor_role_id: BUILDER_B,
  funding_target_usd: '3.0000',
  funded_usd: '3.0000',
  created_at: '2026-09-21T09:00:00Z',
  updated_at: at(10),
});

const CHECKS_CARD = card({
  id: CHECKS_CARD_ID,
  title: 'Quiet rooms: one more unlock',
  summary: 'Add a fourteenth unlock at 300M dust.',
  stage: 'gated',
  executor_role_id: QA,
  funding_target_usd: '1.5000',
  funded_usd: '1.5000',
  created_at: '2026-09-21T09:30:00Z',
  updated_at: at(12),
});

const OPENS_SOON = card({
  id: OPENS_SOON_ID,
  title: 'Dust settles slower at night',
  summary: 'A drafted card the board approved, waiting for its cooling window.',
  source: 'agent',
  horizon: 'next',
  rank: 4,
  opens_at: '2026-09-24T18:00:00Z',
});

const VETOED = card({
  id: VETOED_ID,
  title: 'A second Cart',
  summary: 'A drafted card the board held back.',
  source: 'agent',
  horizon: 'next',
  rank: 5,
  board_vetoed: true,
  board_veto_reason: VETO_REASON,
});

/** One agent event; tool calls carry the tool name as Claude Code writes it. */
function event(id: string, cardId: string, role: string, type: string, minute: number, payload?: Record<string, unknown>): Record<string, unknown> {
  return { id, card_id: cardId, role_id: role, type, created_at: at(minute), ...(payload === undefined ? {} : { payload }) };
}

// The live card: started, read twelve files in a row (their results are key none), edited two,
// ran a command, handed in, passed the checks and shipped.
const LIVE_EVENTS = [
  event('sp-01', LIVE_CARD_ID, BUILDER_A, 'start', 0),
  ...Array.from({ length: 12 }, (_, i) => [
    event(`sp-r${String(i).padStart(2, '0')}`, LIVE_CARD_ID, BUILDER_A, 'tool_call', 1 + i, { name: 'Read' }),
    event(`sp-t${String(i).padStart(2, '0')}`, LIVE_CARD_ID, BUILDER_A, 'tool_result', 1 + i),
  ]).flat(),
  event('sp-e1', LIVE_CARD_ID, BUILDER_A, 'tool_call', 20, { name: 'Edit' }),
  event('sp-e2', LIVE_CARD_ID, BUILDER_A, 'tool_call', 21, { name: 'write' }),
  event('sp-b1', LIVE_CARD_ID, BUILDER_A, 'tool_call', 22, { name: 'Bash' }),
  event('sp-s1', LIVE_CARD_ID, BUILDER_A, 'tool_call', 23, { name: 'submit_patch' }),
  event('sp-m1', LIVE_CARD_ID, BUILDER_A, 'message', 24, { step: 'thinking out loud' }),
  event('sp-g1', LIVE_CARD_ID, BUILDER_A, 'gate_pass', 30),
  event('sp-z1', LIVE_CARD_ID, BUILDER_A, 'ship', 40),
];

const BUILDING_EVENTS = [
  event('sb-01', BUILDING_CARD_ID, BUILDER_B, 'start', 2),
  event('sb-02', BUILDING_CARD_ID, BUILDER_B, 'tool_call', 3, { name: 'read' }),
  event('sb-03', BUILDING_CARD_ID, BUILDER_B, 'tool_call', 4, { name: 'grep' }),
];

const CHECKS_EVENTS = [
  event('sc-01', CHECKS_CARD_ID, QA, 'start', 5),
  event('sc-02', CHECKS_CARD_ID, QA, 'tool_call', 6, { name: 'Edit' }),
  event('sc-03', CHECKS_CARD_ID, QA, 'tool_call', 7, { name: 'submit_patch' }),
];

/** Supporters 1 to 30 on the live card, the first five founding, listed out of order. */
const LIVE_SUPPORTERS = Array.from({ length: 30 }, (_, i) => ({ number: 30 - i, founding: 30 - i <= 5 }));

/** /thanks sessions, one per state the page draws. */
export const SESSIONS = {
  recorded: 'cs_test_recordedSession0001',
  founding: 'cs_test_foundingSession0001',
  held: 'cs_test_heldSession000001',
  waiting: 'cs_test_waitingSession0001',
  reversed: 'cs_test_reversedSession0001',
  notCounted: 'cs_test_boardTestSession01',
  unstamped: 'cs_test_unstampedSession01',
  pending: 'cs_test_pendingSession00001',
} as const;

const recorded = (fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  status: 'recorded',
  supporter: { number: 12, founding: false },
  named_card_id: BUILDING_CARD_ID,
  reached: [BUILDING_CARD_ID, OPEN_CARD_ID, LIVE_CARD_ID],
  waiting: false,
  credit: 'credited',
  held_until: null,
  terms_version: 2,
  ...fields,
});

export const SUPPORTER_STUDIO: StudioFixture = {
  ...LIVE_STUDIO,
  cards: [...LIVE_STUDIO.cards, LIVE_CARD, BUILDING_CARD, CHECKS_CARD, OPENS_SOON, VETOED],
  funding: [
    ...LIVE_STUDIO.funding,
    { card_id: LIVE_CARD_ID, contributors: '30', credited_usd: '2.0000' },
    { card_id: BUILDING_CARD_ID, contributors: '2', credited_usd: '3.0000' },
    { card_id: CHECKS_CARD_ID, contributors: '1', credited_usd: '1.5000' },
  ],
  spend: [...LIVE_STUDIO.spend, { card_id: LIVE_CARD_ID, spent_usd: '1.2400' }],
  events: [...LIVE_STUDIO.events, ...LIVE_EVENTS, ...BUILDING_EVENTS, ...CHECKS_EVENTS],
  supporters: {
    [LIVE_CARD_ID]: LIVE_SUPPORTERS,
    [BUILDING_CARD_ID]: [
      { number: 12, founding: false },
      { number: 3, founding: true },
    ],
    [CHECKS_CARD_ID]: [{ number: 7, founding: true }],
    [REJECTED_CARD_ID]: [{ number: 4, founding: true }],
  },
  roleStats: {
    [BUILDER_A]: { spent_usd: '1.2400', spent_7d_usd: '0.3100', shipped_cards: 7 },
    [QA]: { spent_usd: '0.0000', spent_7d_usd: '0.0000', shipped_cards: 1 },
  },
  thanks: {
    [SESSIONS.recorded]: recorded(),
    [SESSIONS.founding]: recorded({ supporter: { number: 3, founding: true } }),
    [SESSIONS.held]: recorded({ credit: 'held', held_until: '2026-09-26' }),
    [SESSIONS.waiting]: recorded({ reached: [BUILDING_CARD_ID], waiting: true }),
    [SESSIONS.reversed]: recorded({ credit: 'reversed', reached: [] }),
    [SESSIONS.notCounted]: { status: 'not_counted' },
    [SESSIONS.unstamped]: recorded({ terms_version: null }),
  },
};

/** The supporter pages, each with the fixture state it draws, for the design, layout and screenshot runs. */
export const SUPPORTER_ROUTES: [string, string][] = [
  ['card-live', `/card/${LIVE_CARD_ID}`],
  ['card-building', `/card/${BUILDING_CARD_ID}`],
  ['card-rejected', `/card/${REJECTED_CARD_ID}`],
  ['thanks-recorded', `/thanks?session=${SESSIONS.recorded}`],
  ['thanks-pending', `/thanks?session=${SESSIONS.pending}`],
  ['thanks-not-counted', `/thanks?session=${SESSIONS.notCounted}`],
  ['team-paused', '/team'],
  ['roadmap-opens-soon', '/roadmap'],
];
