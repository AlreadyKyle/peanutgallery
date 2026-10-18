// The running game, Three-free and DOM-free: one SimState, the actions that change it, the wall-clock
// step and the save. The scene (render/scene.ts), the HUD (render/hud.ts) and the accessible controls
// (render/controls.ts) all read this one state and listen for its moments, so a strike from the canvas
// and a strike from the keyboard are the same strike (tests/game.test.ts).
import { apply, currentWeather, devilHere, findUnlock, milestoneTier, ownedCount, step } from '../sim/sim';
import { awaySeconds, MAX_AWAY_SECONDS, serializeState } from '../sim/save';
import type { OrderState, SimAction, SimConfig, SimState, UnlockRow, WeatherKind } from '../sim/types';

// The localStorage key the game saves under. e2e/frames.spec.ts reads this line as text to plant its states.
export const SAVE_KEY = 'dust.save';
// Where a save goes when the player starts from someone's seed instead, so nothing is ever lost.
export const BACKUP_KEY = 'dust.save.before-seed';
// Set when the save under SAVE_KEY was started from a seed, so a second seed never copies that run
// over the player's own game in BACKUP_KEY.
export const SEED_RUN_KEY = 'dust.save.from-seed';
// Where a save that does not read is kept (a corrupt one, or one a newer version wrote before a
// rollback), so the fresh game that starts in its place never writes over the player's progress.
export const UNREADABLE_KEY = 'dust.save.unreadable';
export const SAVE_INTERVAL_MS = 5000;

/**
 * Copies a save that did not parse to UNREADABLE_KEY before the fresh game's first save replaces it.
 * The first one kept stays: a later unreadable save never writes over it. Returns whether it kept this
 * one. Storage errors are swallowed, as every save is.
 */
export function keepUnreadable(store: Pick<Storage, 'getItem' | 'setItem'> | null, raw: string): boolean {
  if (store === null) return false;
  try {
    if (store.getItem(UNREADABLE_KEY) !== null) return false;
    store.setItem(UNREADABLE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

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
  /** Play began: the first action of a game that waits for one (a daily run). */
  began?(state: SimState): void;
  /** A tick reached a stop (a daily run's mark, every `stopsEvery` sim seconds): its index, from 1. */
  mark?(index: number, state: SimState): void;
  /** The game reached its end (a daily run's last second): nothing more steps or acts. */
  ended?(state: SimState): void;
}

/**
 * How a game runs. The main game takes the defaults: it credits time away up to MAX_AWAY_SECONDS, never
 * ends and starts stepping at its first tick. A daily run (render/daily.ts) steps at most a second a
 * tick, so a hidden tab earns nothing; it waits for the player's first action, lands exactly on each
 * of its marks and stops at its last second.
 */
export interface GameOptions {
  /** The most one tick steps the sim, in seconds. */
  maxStepSeconds?: number;
  /** The sim second the game ends at: ticks stop there and actions are refused. */
  endAtSeconds?: number;
  /** A tick never steps across a multiple of this many sim seconds; it lands on it and says mark(). */
  stopsEvery?: number;
  /** The game does not step until its first action. */
  waitForAction?: boolean;
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
  private waiting: boolean;
  private finished: boolean;

  constructor(
    private readonly config: SimConfig,
    initial: SimState,
    private readonly store: SaveStore | null = null,
    private readonly options: GameOptions = {},
  ) {
    this.current = initial;
    this.waiting = options.waitForAction === true;
    this.finished = options.endAtSeconds !== undefined && initial.elapsedSeconds >= options.endAtSeconds;
  }

  /** Whether the game has reached its end (only a game with endAtSeconds ever does). */
  get over(): boolean {
    return this.finished;
  }

  /** Whether the game is still waiting for its first action. */
  get idle(): boolean {
    return this.waiting;
  }

  get state(): SimState {
    return this.current;
  }

  listen(listener: GameListener): void {
    this.listeners.push(listener);
  }

  /** One action from the canvas or the DOM controls: the sim's `apply`, then its moments. */
  act(action: SimAction): SimState {
    if (this.finished) return this.current;
    const before = this.current;
    const after = apply(before, this.config, action);
    this.current = after;
    if (this.waiting && after !== before) {
      this.waiting = false;
      for (const listener of this.listeners) listener.began?.(after);
    }
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
    if (this.finished || this.waiting) {
      // Nothing steps: the time spent waiting for the first action, or after the end, is not play.
      this.lastStepAt = null;
      return before;
    }
    if (this.lastStepAt !== null) {
      const seconds = Math.min(awaySeconds(this.lastStepAt, now), this.options.maxStepSeconds ?? MAX_AWAY_SECONDS);
      if (seconds > 0) this.advance(seconds);
    }
    this.lastStepAt = now;
    this.announceUnlocks(before, this.current);
    this.announceWeather(before, this.current);
    this.announceLayers(before, this.current, false);
    if (this.finished) {
      for (const listener of this.listeners) listener.ended?.(this.current);
    }
    return this.current;
  }

  // Steps `seconds`, in parts that land on each stop and never past the end.
  private advance(seconds: number): void {
    const { endAtSeconds, stopsEvery } = this.options;
    let left = seconds;
    while (left > 1e-9 && !this.finished) {
      const at = this.current.elapsedSeconds;
      let part = left;
      if (endAtSeconds !== undefined) part = Math.min(part, endAtSeconds - at);
      const nextStop = stopsEvery === undefined ? Infinity : (Math.floor(at / stopsEvery + 1e-9) + 1) * stopsEvery;
      part = Math.min(part, nextStop - at);
      this.current = step(this.current, this.config, part);
      left -= part;
      // Land exactly on a stop or the end, so float error never leaves the clock a hair short of it.
      const landed = Math.min(nextStop, endAtSeconds ?? Infinity);
      if (Math.abs(this.current.elapsedSeconds - landed) < 1e-6) this.current = { ...this.current, elapsedSeconds: landed };
      if (stopsEvery !== undefined && this.current.elapsedSeconds === nextStop) {
        const index = Math.round(nextStop / stopsEvery);
        for (const listener of this.listeners) listener.mark?.(index, this.current);
      }
      if (endAtSeconds !== undefined && this.current.elapsedSeconds >= endAtSeconds) this.finished = true;
    }
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

  /**
   * Writes the save. Its savedAt is the wall-clock time the state was last stepped to, not `now`: a
   * hidden tab gets no frames, so its state stands still while the timer and pagehide keep saving, and
   * stamping that state with `now` would make the next load credit none of the time it spent hidden.
   * Storage errors (a full or disabled store) are swallowed so play goes on without one.
   */
  save(now: number): void {
    if (this.store === null || !this.saving) return;
    try {
      this.store.setItem(SAVE_KEY, serializeState(this.current, this.lastStepAt ?? now));
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
