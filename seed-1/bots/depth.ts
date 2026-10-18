import type { SimConfig, UnlockEvent, UnlockRow } from '../sim/types';

// Depth over time (docs/strategy/game-quality.md §1 criterion 6, §5 The session arc): when a run last
// met something new, and how many unlocks after that only made the numbers bigger. It is reported by
// the headless bot and the scripted playtest and never fails a run.
//
// Which unlocks count as a new mechanic, something a player can newly see or do:
// - `unit`: a new building on the island and a new button in the shop.
// - `weather`: the weather starts, a new thing on screen that changes what pays.
// - `gems`: pressing the pile and the perks, a new layer of choices.
// - `fork`: a choice between options the player has not had before.
// - Any unlock that opens orders or dust devils (`opensAt` in unlocks.json), whatever its effect.
// Which do not:
// - `multiplier`: production goes up, and nothing new is drawn or offered.
// - `strike`: strikes pay more, but striking is the first thing a player does; nothing is new.
export function isNewMechanic(row: UnlockRow, config: SimConfig): boolean {
  if (row.id === config.unlocks.orders?.opensAt || row.id === config.unlocks.devils?.opensAt) return true;
  return row.effect.type !== 'multiplier' && row.effect.type !== 'strike';
}

export interface DepthMark {
  /** The last unlock the run opened for the first time that brings a new mechanic, and when; null if none. */
  lastNewMechanic: UnlockEvent | null;
  /** Unlocks the run opened for the first time after it, each only a multiplier. */
  multipliersAfter: number;
  /** New-mechanic unlocks in the config the run never opened (the run was too short to see them). */
  newMechanicsNotReached: number;
}

/**
 * The depth mark of a run from its unlock events, in the order they happened. An unlock opened again
 * in a later season is not new, so only each id's first opening counts.
 */
export function depthMark(config: SimConfig, events: readonly UnlockEvent[]): DepthMark {
  const rows = new Map(config.unlocks.unlocks.map((row) => [row.id, row]));
  const first: UnlockEvent[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.id) || !rows.has(event.id)) continue;
    seen.add(event.id);
    first.push(event);
  }
  let last = -1;
  first.forEach((event, index) => {
    if (isNewMechanic(rows.get(event.id)!, config)) last = index;
  });
  const notReached = config.unlocks.unlocks.filter((row) => !seen.has(row.id) && isNewMechanic(row, config)).length;
  return {
    lastNewMechanic: last < 0 ? null : { id: first[last]!.id, atSeconds: first[last]!.atSeconds },
    multipliersAfter: last < 0 ? first.length : first.length - last - 1,
    newMechanicsNotReached: notReached,
  };
}

/** One line for a report: "golden-broom at 392.1 min (23527 s), then 3 multiplier-only unlocks". */
export function formatDepth(mark: DepthMark): string {
  const tail = `${mark.multipliersAfter} multiplier-only unlock${mark.multipliersAfter === 1 ? '' : 's'}`;
  const unreached = mark.newMechanicsNotReached > 0 ? `; ${mark.newMechanicsNotReached} new mechanic${mark.newMechanicsNotReached === 1 ? '' : 's'} not reached` : '';
  if (mark.lastNewMechanic === null) return `none, then ${tail}${unreached}`;
  const minutes = Math.round((mark.lastNewMechanic.atSeconds / 60) * 10) / 10;
  return `${mark.lastNewMechanic.id} at ${minutes} min (${mark.lastNewMechanic.atSeconds} s), then ${tail}${unreached}`;
}
