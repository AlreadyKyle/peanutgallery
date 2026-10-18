// The running game, Three-free and DOM-free: one SimState, the actions that change it, the wall-clock
// step and the save. The scene (render/scene.ts), the HUD (render/hud.ts) and the accessible controls
// (render/controls.ts) all read this one state and listen for its moments, so a strike from the canvas
// and a strike from the keyboard are the same strike (tests/game.test.ts).
import { apply, currentWeather, devilHere, findUnlock, milestoneTier, ownedCount, step } from '../sim/sim';
import { awaySeconds, serializeState } from '../sim/save';
import type { OrderState, SimAction, SimConfig, SimState, UnlockRow, WeatherKind } from '../sim/types';

// The localStorage key the game saves under. e2e/frames.spec.ts reads this line as text to plant its states.
export const SAVE_KEY = 'dust.save';
// Where a save goes when the player starts from someone's seed instead, so nothing is ever lost.
export const BACKUP_KEY = 'dust.save.before-seed';
// Set when the save under SAVE_KEY was started from a seed, so a second seed never copies that run
// over the player's own game in BACKUP_KEY.
export const SEED_RUN_KEY = 'dust.save.from-seed';
export const SAVE_INTERVAL_MS = 5000;

export interface GameListener {
  /** A strike landed: the dust it added. */
  strike?(gain: number, state: SimState): void;
  /** A unit was bought: its id and how many are owned now. */
  bought?(unit: string, owned: number, state: SimState): void;
  /** One or more unlocks opened, in order. */
  unlocked?(rows: UnlockRow[], state: SimState): void;
  /** A purchase took a unit past a milestone: the unit and how many are owned. */
  milestone?(unit: string, owned: number, state: SimState): void;
  /** The weather changed: the kind now in force, or null when it cleared. */
  weather?(kind: WeatherKind | null, state: SimState): void;
  /** The pile was pressed: the gems it gave, and the new season's state. */
  pressed?(gems: number, state: SimState): void;
  /** A perk was bought. */
  perk?(id: string, state: SimState): void;
  /** A fork was chosen: the fork's unlock id and the option's id. */
  chose?(unlock: string, option: string, state: SimState): void;
  /** A new order went up on the board. */
  ordered?(order: OrderState, state: SimState): void;
  /** The order was filled: the dust it paid. */
  filled?(gain: number, state: SimState): void;
  /** A dust devil arrived (true) or spun away uncaught (false). */
  devil?(here: boolean, state: SimState): void;
  /** The dust devil was caught: the dust it paid. */
  caught?(gain: number, state: SimState): void;
}

function sameOrder(a: OrderState | undefined, b: OrderState | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.type === b.type && a.unit === b.unit && a.target === b.target && a.from === b.from;
}

type SaveStore = Pick<Storage, 'setItem'>;

export class Game {
  private current: SimState;
  // The wall-clock millisecond of the last step. The sim advances by wall-clock time rather than frame
  // time, which a browser stops while the tab is hidden, so time spent in another tab still counts (up
  // to MAX_AWAY_SECONDS at once). It starts at the first tick, not at construction: the time the page
  // takes to boot is not play, and counting it made two draws of the same save credit different dust
  // (the gate's frames job, e2e/frames.spec.ts).
  private lastStepAt: number | null = null;
  private readonly listeners: GameListener[] = [];
  private saving = true;

  constructor(
    private readonly config: SimConfig,
    initial: SimState,
    private readonly store: SaveStore | null = null,
  ) {
    this.current = initial;
  }

  get state(): SimState {
    return this.current;
  }

  listen(listener: GameListener): void {
    this.listeners.push(listener);
  }

  /** One action from the canvas or the DOM controls: the sim's `apply`, then its moments. */
  act(action: SimAction): SimState {
    const before = this.current;
    const after = apply(before, this.config, action);
    this.current = after;
    if (action.type === 'strike') {
      const gain = after.dust - before.dust;
      for (const listener of this.listeners) listener.strike?.(gain, after);
    } else if (action.type === 'buy' && ownedCount(after, action.unit) > ownedCount(before, action.unit)) {
      const owned = ownedCount(after, action.unit);
      for (const listener of this.listeners) listener.bought?.(action.unit, owned, after);
      if (milestoneTier(this.config, owned) > milestoneTier(this.config, owned - 1)) {
        for (const listener of this.listeners) listener.milestone?.(action.unit, owned, after);
      }
    } else if (action.type === 'press' && (after.season ?? 0) > (before.season ?? 0)) {
      const gems = (after.gems ?? 0) - (before.gems ?? 0);
      for (const listener of this.listeners) listener.pressed?.(gems, after);
    } else if (action.type === 'perk' && (after.perks?.length ?? 0) > (before.perks?.length ?? 0)) {
      for (const listener of this.listeners) listener.perk?.(action.perk, after);
    } else if (action.type === 'choose' && after !== before) {
      for (const listener of this.listeners) listener.chose?.(action.unlock, action.option, after);
    } else if (action.type === 'fill' && (after.ordersFilled ?? 0) > (before.ordersFilled ?? 0)) {
      for (const listener of this.listeners) listener.filled?.(after.totalDust - before.totalDust, after);
    } else if (action.type === 'catch' && after !== before) {
      for (const listener of this.listeners) listener.caught?.(after.totalDust - before.totalDust, after);
    }
    this.announceUnlocks(before, after);
    this.announceWeather(before, after);
    this.announceLayers(before, after, action.type === 'catch');
    return after;
  }

  /** Steps the sim by the wall-clock time since the last tick. `now` is Date.now(), read by the caller. */
  tick(now: number): SimState {
    const before = this.current;
    if (this.lastStepAt !== null) {
      const seconds = awaySeconds(this.lastStepAt, now);
      if (seconds > 0) this.current = step(before, this.config, seconds);
    }
    this.lastStepAt = now;
    this.announceUnlocks(before, this.current);
    this.announceWeather(before, this.current);
    this.announceLayers(before, this.current, false);
    return this.current;
  }

  // A new order on the board, and a dust devil arriving or leaving (a caught one is said by caught()).
  private announceLayers(before: SimState, after: SimState, caught: boolean): void {
    if (after.order !== undefined && !sameOrder(before.order, after.order)) {
      for (const listener of this.listeners) listener.ordered?.(after.order, after);
    }
    const was = devilHere(before);
    const now = devilHere(after);
    if (was !== now && !caught) {
      for (const listener of this.listeners) listener.devil?.(now, after);
    }
  }

  /** Writes the save. Storage errors (a full or disabled store) are swallowed so play goes on without one. */
  save(now: number): void {
    if (this.store === null || !this.saving) return;
    try {
      this.store.setItem(SAVE_KEY, serializeState(this.current, now));
    } catch {
      // ignored
    }
  }

  /** Stops saving for good: the page is about to reload into a save written elsewhere (a seed). */
  stopSaving(): void {
    this.saving = false;
  }

  private announceWeather(before: SimState, after: SimState): void {
    const was = before.weather?.kind ?? null;
    const now = after.weather?.kind ?? null;
    if (was === now) return;
    const kind = currentWeather(after, this.config);
    for (const listener of this.listeners) listener.weather?.(kind, after);
  }

  private announceUnlocks(before: SimState, after: SimState): void {
    if (after.unlocked.length <= before.unlocked.length) return;
    const rows: UnlockRow[] = [];
    for (const event of after.unlocked.slice(before.unlocked.length)) {
      const row = findUnlock(this.config, event.id);
      if (row !== null) rows.push(row);
    }
    if (rows.length === 0) return;
    for (const listener of this.listeners) listener.unlocked?.(rows, after);
  }
}
