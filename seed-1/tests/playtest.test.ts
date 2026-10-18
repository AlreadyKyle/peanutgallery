import { describe, expect, it } from 'vitest';
import { loadConfigFromDir } from '../bots/config';
import { ACTIVE, CASUAL, pacing, play, returnSession } from './playtest';
import { LIVE_CONFIG_DIR } from './paths';

// The scripted playtest (tests/playtest.ts) against the game quality bar (docs/strategy/game-quality.md):
// the first minute, a satisfying two-minute session, and new things across the first hour. Two players:
// an active one (two strikes a second, two seconds to react) and a casual one (a strike every two
// seconds, eight seconds to react). Run `npx tsx tests/playtest.ts <config dir>` in seed-1 for the table.

const live = loadConfigFromDir(LIVE_CONFIG_DIR);

describe.each([
  { player: ACTIVE, firstLayers: 120, firstFork: 240 },
  { player: CASUAL, firstLayers: 180, firstFork: 480 },
])('the $player.name player', ({ player, firstLayers, firstFork }) => {
  const run = play(live, player, 3600);
  const p = pacing(run);

  it('buys within 30 seconds and sees an unlock within the minute', () => {
    expect(p.firstBuy).not.toBeNull();
    expect(p.firstBuy!).toBeLessThanOrEqual(30);
    expect(p.firstUnlock!).toBeLessThanOrEqual(60);
  });

  it('meets an order and a dust devil within minutes, and a fork soon after', () => {
    expect(p.firstOrderFilled!).toBeLessThanOrEqual(firstLayers);
    expect(p.firstDevil!).toBeLessThanOrEqual(firstLayers);
    expect(p.firstFork!).toBeLessThanOrEqual(firstFork);
  });

  it('sees something new in every two minutes of the first hour, of at least six kinds', () => {
    expect(p.momentsPer2Min.min).toBeGreaterThanOrEqual(1);
    expect(p.longestQuiet).toBeLessThanOrEqual(120);
    expect(p.kindsFirstHour).toBeGreaterThanOrEqual(6);
  });

  it('makes choices that are not purchases all through the hour', () => {
    expect(p.choicesPerMinute.first10).toBeGreaterThanOrEqual(1);
    expect(p.choicesPerMinute.tenTo60).toBeGreaterThanOrEqual(1);
  });

  it('comes back after eight hours to a payoff and a choice', () => {
    const back = returnSession(live, player);
    expect(back.payoffs).toBeGreaterThanOrEqual(1);
    expect(back.choices).toBeGreaterThanOrEqual(1);
  });
});
