// Step 2 of Replays (docs/specs/replays.md): which push to main makes a clip, and waiting for the card
// to be live. A dispatcher ship is a squash commit whose message ends with the card's trailers
// (platform/dispatcher/src/worktree.ts, commitTrailers); it makes a clip only when it changes something
// Dust draws. Pure and imported by scripts/replay-ship.mjs under Node's type stripping, so it imports
// nothing.

/** The folders whose files change what Dust draws; the workflow's paths filter names the same four. */
export const DUST_PATHS = ['seed-1/config/', 'seed-1/content/', 'seed-1/render/', 'seed-1/sim/'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Ship = { ok: true; cardId: string } | { ok: false; reason: string };

/**
 * The card a commit on main ships, or why it makes no clip: a commit with no Card-Id trailer is not a
 * card, a revert takes a card out rather than shipping it, and a card that changes nothing Dust draws
 * has no before and after.
 */
export function shipOf(message: string, paths: string[]): Ship {
  if (/^Revert card /.test(message)) return { ok: false, reason: 'a revert, not a ship' };
  const paragraphs = message.trim().split(/\n\s*\n/);
  const trailers = paragraphs[paragraphs.length - 1]!.split('\n');
  const line = paragraphs.length < 2 ? undefined : trailers.find((l) => l.startsWith('Card-Id:'));
  if (line === undefined) return { ok: false, reason: 'no Card-Id trailer, so not a card' };
  const cardId = line.slice('Card-Id:'.length).trim().toLowerCase();
  if (!UUID.test(cardId)) return { ok: false, reason: `Card-Id "${cardId}" is not a card id` };
  if (!paths.some((p) => DUST_PATHS.some((dir) => p.startsWith(dir)))) return { ok: false, reason: `card ${cardId} changes nothing Dust draws` };
  return { ok: true, cardId };
}

const stageOf = (doc: unknown): unknown =>
  typeof doc === 'object' && doc !== null && typeof (doc as { card?: unknown }).card === 'object' && (doc as { card: object | null }).card !== null
    ? (doc as { card: { stage?: unknown } }).card.stage
    : undefined;

export type WaitOptions = { attempts: number; intervalMs: number; sleep: (ms: number) => Promise<void> };

/**
 * The card's public document once it says the card is live. The dispatcher marks a card live after its
 * deploy, a few minutes after the merge, so this asks again until it is, and throws after the last try
 * with the last reason. `check` throws unless the document is live (the plan's factsFrom). A fetch that
 * fails counts as a try. A card the dispatcher took back out (rejected or paused after a failed deploy
 * or smoke check) will not go live from this commit, so that gives null at once: no clip, and no
 * failure either.
 */
export async function liveDocument(fetchDoc: () => Promise<unknown>, check: (doc: unknown) => unknown, { attempts, intervalMs, sleep }: WaitOptions): Promise<unknown | null> {
  let reason = 'no try was made';
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await sleep(intervalMs);
    try {
      const doc = await fetchDoc();
      if (stageOf(doc) === 'rejected' || stageOf(doc) === 'paused') return null;
      check(doc);
      return doc;
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`the card was not live after ${attempts} tries: ${reason}`);
}
