import { moneyRow, type StudioFixture } from './fixtures';
import { LIVE_STUDIO } from './live-studio';

/**
 * The studio as production had it on 10 Oct 2026 (docs/specs/home-flow.md): the machine had just
 * drafted, funded, built and shipped three agent cards and used its four drafts for the day, so no
 * card was open, funded or building. Every launch card has shipped, and the roadmap holds only board
 * work. Home must still show cards in its flow: Next up and Shipped, and a tile in each empty lane.
 * Test data only: no public page ever draws a fixture.
 */
const cards = LIVE_STUDIO.cards.map((card) =>
  card.horizon === 'now' && card.stage !== 'live'
    ? { ...card, stage: 'live', shape: 'oneoff', live_at: '2026-10-08T12:59:00Z', updated_at: '2026-10-08T13:00:00Z' }
    : card.horizon === 'now'
      ? card
      : { ...card, board_work: true },
);

const drafted = [
  { title: 'Cheaper first Gatherer', live_at: '2026-10-10T21:32:39Z' },
  { title: "Lower the Mill's starting price from 2600 to 2200 dust", live_at: '2026-10-10T20:48:33Z' },
  { title: 'Make the Gatherer collect dust faster, from 0.2 to 0.25 dust per second', live_at: '2026-10-10T20:28:54Z' },
].map((card, i) => ({
  ...LIVE_STUDIO.cards.find((row) => row.stage === 'live')!,
  id: `20000000-0000-4000-8000-00000000000${i + 1}`,
  title: card.title,
  summary: null,
  source: 'agent',
  stage: 'live',
  shape: 'goal',
  funding_target_usd: '0.7500',
  funded_usd: '0.3600',
  created_at: card.live_at.replace(/T\d\d/, 'T19'),
  updated_at: card.live_at,
  live_at: card.live_at,
}));

export const PROD_STUDIO: StudioFixture = {
  ...LIVE_STUDIO,
  paused: false,
  pauseReason: null,
  cards: [...drafted, ...cards],
  money: moneyRow({ ...(LIVE_STUDIO.money ?? {}), funding_order: [] }),
  supply: { drafting: false, short: true, reason: 'daily_limit', runs_today: 4, run_limit: 4, next_check_at: '2026-10-10T23:40:00+00:00' },
};

/** The same studio a moment later, while the Game Designer drafts a card. */
export const DRAFTING_STUDIO: StudioFixture = {
  ...PROD_STUDIO,
  supply: { drafting: true, short: true, reason: 'already_queued', runs_today: 1, run_limit: 4, next_check_at: '2026-10-11T04:20:00+00:00' },
};

/** No card at all, anywhere: every lane says what happens next. */
export const EMPTY_STUDIO: StudioFixture = {
  ...PROD_STUDIO,
  cards: [],
  stopped: [],
  supply: { drafting: false, short: true, reason: null, runs_today: 0, run_limit: 4, next_check_at: '2026-10-11T04:20:00+00:00' },
};
