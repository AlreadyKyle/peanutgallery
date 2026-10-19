// The accessible DOM layer's Three-free half: what the controls say and when the live region speaks.
// The canvas is hidden from assistive technology (index.html), so these strings are the game's text
// alternative. render/controls.ts puts them in the DOM; tests/a11y.test.ts checks them here.
import { costOf, findUnlock, isUnitAvailable, ownedCount, ratePerSecond } from '../sim/sim';
import type { SimConfig, SimState, UnlockRow } from '../sim/types';
import { fill, formatDust, formatPercent, formatRate } from './format';
import type { Strings } from './strings';

// How often the live region repeats the dust total on its own, at most.
export const DUST_ANNOUNCE_INTERVAL_MS = 10_000;

export interface UnitControl {
  unit: string;
  available: boolean;
  affordable: boolean;
  label: string;
}

export interface ControlsView {
  status: string;
  units: UnitControl[];
}

export function describeEffect(row: UnlockRow, config: SimConfig, strings: Strings): string {
  const effect = row.effect;
  if (effect.type === 'unit') {
    const unitRow = config.spawnTable.rows.find((candidate) => candidate.id === effect.unit) ?? null;
    return fill(strings.effects.unit, { unit: unitRow === null ? effect.unit : unitRow.name });
  }
  if (effect.type === 'multiplier') return fill(strings.effects.multiplier, { percent: formatPercent(effect.value) });
  if (effect.type === 'strike') return fill(strings.effects.strike, { times: formatTimes(effect.value) });
  if (effect.type === 'fork') return fill(strings.effects.fork, { options: effect.options.map((option) => option.name).join(strings.depth.forkOr) });
  return effect.type === 'weather' ? strings.effects.weather : strings.effects.gems;
}

/** A multiplier as "×2" or "×1.5". */
export function formatTimes(value: number): string {
  return `×${Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`;
}

export function dustStatus(state: SimState, config: SimConfig, strings: Strings): string {
  return fill(strings.a11y.dustStatus, {
    amount: formatDust(state.dust),
    rate: formatRate(ratePerSecond(state, config)),
  });
}

export function controlsView(state: SimState, config: SimConfig, strings: Strings): ControlsView {
  return {
    status: dustStatus(state, config, strings),
    units: config.spawnTable.rows.map((row) => {
      const cost = costOf(state, config, row.id);
      return {
        unit: row.id,
        available: isUnitAvailable(state, config, row.id),
        affordable: state.dust >= cost,
        label: fill(strings.a11y.buyUnit, {
          name: row.name,
          cost: formatDust(cost),
          owned: String(ownedCount(state, row.id)),
        }),
      };
    }),
  };
}

// Decides what the polite live region says. Purchases and unlocks speak at once; otherwise the dust
// total speaks at most once every DUST_ANNOUNCE_INTERVAL_MS. The clock is passed in, so the sim and
// the tests stay free of wall-clock reads.
export class Announcer {
  private lastDustAt: number;
  private seenUnlocks: number;

  constructor(
    private readonly config: SimConfig,
    private readonly strings: Strings,
    initial: SimState,
    now: number,
  ) {
    this.lastDustAt = now;
    this.seenUnlocks = initial.unlocked.length;
  }

  // The message for this tick, or null to leave the region as it is.
  tick(state: SimState, now: number): string | null {
    const messages: string[] = [];
    // A new season (the pile pressed) starts the unlock list over.
    if (state.unlocked.length < this.seenUnlocks) this.seenUnlocks = 0;
    for (const event of state.unlocked.slice(this.seenUnlocks)) {
      const row = findUnlock(this.config, event.id);
      if (row === null) continue;
      messages.push(fill(this.strings.a11y.unlocked, { name: row.name, effect: describeEffect(row, this.config, this.strings) }));
    }
    this.seenUnlocks = state.unlocked.length;
    if (messages.length === 0 && now - this.lastDustAt < DUST_ANNOUNCE_INTERVAL_MS) return null;
    messages.push(dustStatus(state, this.config, this.strings));
    this.lastDustAt = now;
    return messages.join(' ');
  }

  // A purchase speaks at once and restarts the dust interval.
  bought(state: SimState, unit: string, now: number): string {
    const row = this.config.spawnTable.rows.find((candidate) => candidate.id === unit);
    this.lastDustAt = now;
    return `${fill(this.strings.a11y.bought, { name: row?.name ?? unit, owned: String(ownedCount(state, unit)) })} ${dustStatus(state, this.config, this.strings)}`;
  }
}
