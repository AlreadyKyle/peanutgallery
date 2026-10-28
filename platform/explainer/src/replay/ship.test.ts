import { describe, expect, it } from 'vitest';
import { factsFrom } from './plan';
import { DUST_PATHS, liveDocument, shipOf } from './ship';

// Step 2 of Replays (docs/specs/replays.md): a dispatcher ship of a Dust card makes its clip with no
// hand step, and nothing else on main does.

const ID = 'e1ee4792-abc0-4dc3-95fa-159b82ac38db';
// The squash commit the dispatcher merges (platform/dispatcher/src/worktree.ts, commitMessage).
const message = (id = ID) => `card e1ee4792: Gatherers dig faster\n\nCard-Id: ${id}\nLane: game\nExecutor: claude\nAcceptance: the rate reads 0.4\n`;

describe('shipOf', () => {
  it('names the card of a dispatcher ship that changes what Dust draws', () => {
    expect(shipOf(message(), ['seed-1/config/balance.json'])).toEqual({ ok: true, cardId: ID });
    for (const dir of DUST_PATHS) expect(shipOf(message(), ['docs/x.md', `${dir}a.ts`]).ok).toBe(true);
  });

  it('makes no clip for a card that changes nothing Dust draws', () => {
    expect(shipOf(message(), ['seed-1/e2e/x.ts', 'seed-1/README.md', 'platform/site/src/x.tsx'])).toEqual({ ok: false, reason: `card ${ID} changes nothing Dust draws` });
  });

  it('makes no clip for a commit that is not a card, or a revert', () => {
    expect(shipOf('Dust: a fix (#250)\n\nCo-Authored-By: someone', ['seed-1/sim/a.ts'])).toMatchObject({ ok: false, reason: /no Card-Id/ });
    // A Card-Id in the subject is not a trailer.
    expect(shipOf(`Card-Id: ${ID}`, ['seed-1/sim/a.ts'])).toMatchObject({ ok: false, reason: /no Card-Id/ });
    expect(shipOf(`Revert card e1ee4792: Gatherers dig faster\n\nCard-Id: ${ID}\nReason: smoke failed\n`, ['seed-1/sim/a.ts'])).toMatchObject({ ok: false, reason: /revert/ });
  });

  it('refuses a Card-Id that is not a card id', () => {
    expect(shipOf(message('e1ee4792; rm -rf /'), ['seed-1/sim/a.ts'])).toMatchObject({ ok: false, reason: /is not a card id/ });
    expect(shipOf(message(ID.toUpperCase()), ['seed-1/sim/a.ts'])).toEqual({ ok: true, cardId: ID });
  });
});

describe('liveDocument', () => {
  const doc = (stage: string, liveAt: string | null) => ({ card: { id: ID, title: 'Gatherers dig faster', stage, funded_usd: '0.78' }, milestones: { live_at: liveAt } });
  const waits: number[] = [];
  const opts = { attempts: 4, intervalMs: 30_000, sleep: async (ms: number) => void waits.push(ms) };
  const answers = (...docs: unknown[]) => {
    let i = 0;
    return async () => {
      const next = docs[Math.min(i++, docs.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    };
  };

  it('asks again until the card is live, and counts a failed fetch as a try', async () => {
    waits.length = 0;
    const live = doc('live', '2026-10-25T12:20:00Z');
    expect(await liveDocument(answers(doc('gated', null), new Error('HTTP 503'), live), factsFrom, opts)).toBe(live);
    expect(waits).toEqual([30_000, 30_000]);
  });

  it('gives up after the last try with the last reason', async () => {
    await expect(liveDocument(answers(doc('gated', null)), factsFrom, opts)).rejects.toThrow(/not live after 4 tries: card .* is not live/);
  });

  it('gives null at once for a card the dispatcher took back out', async () => {
    waits.length = 0;
    expect(await liveDocument(answers(doc('gated', null), doc('rejected', null)), factsFrom, opts)).toBeNull();
    expect(await liveDocument(answers(doc('paused', null)), factsFrom, opts)).toBeNull();
    expect(waits).toEqual([30_000]);
  });
});
