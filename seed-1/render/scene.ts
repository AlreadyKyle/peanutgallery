import Phaser from 'phaser';
import {
  apply,
  costOf,
  createSim,
  isUnitAvailable,
  nextLockedUnlock,
  ownedCount,
  ratePerSecond,
  step,
} from '../sim/sim';
import { awaySeconds, serializeState } from '../sim/save';
import type { SimAction, SimState } from '../sim/types';
import { describeEffect } from './a11y';
import { fill, formatDust, formatDuration, formatRate } from './format';
import { layoutUnlockList, MAX_UNEARNED_UNLOCK_LINES, RENDER_SCALE, SCREEN_HEIGHT, SCREEN_WIDTH } from './layout';
import type { GameData } from './load';

export { RENDER_SCALE, SCREEN_WIDTH, SCREEN_HEIGHT } from './layout';

export const SAVE_KEY = 'dust.save';
const SAVE_INTERVAL_MS = 5000;

const MARGIN = 16;
const CONTENT_WIDTH = SCREEN_WIDTH - MARGIN * 2;
// Tall enough that the Buy button is a 44px touch target on a 375px phone (the canvas scales 375/420).
const UNIT_ROW_HEIGHT = 64;
const BUY_BUTTON_HEIGHT = 50;
const MAX_UNLOCK_LINES = 1 + MAX_UNEARNED_UNLOCK_LINES;

const COLORS = {
  background: 0x12161c,
  panel: 0x1c222b,
  panelEdge: 0x2b3440,
  accent: 0xd9a441,
  accentDown: 0xb8862f,
  buttonOff: 0x3a4352,
  bar: 0x6fa8dc,
  text: '#e8e6df',
  muted: '#9aa3ad',
  dark: '#12161c',
};

const FONT = 'sans-serif';

// The welcome-back note shows only for an absence long enough to feel like one.
const MIN_WELCOME_SECONDS = 60;
const TOAST_MS = 3500;

/** What the save credited on load: the dust earned and the seconds away. */
export interface WelcomeBack {
  gain: number;
  seconds: number;
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface UnitRow {
  unit: string;
  container: Phaser.GameObjects.Container;
  owned: Phaser.GameObjects.Text;
  cost: Phaser.GameObjects.Text;
  button: Phaser.GameObjects.Rectangle;
  buttonLabel: Phaser.GameObjects.Text;
}

interface UnlockSlot {
  dot: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
}

function textStyle(size: number, color = COLORS.text, weight = 'normal'): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${size}px`, color, fontStyle: weight, resolution: RENDER_SCALE };
}

export class DustScene extends Phaser.Scene {
  private readonly data_: GameData;
  private state: SimState;
  private dustText!: Phaser.GameObjects.Text;
  private rateText!: Phaser.GameObjects.Text;
  private unlockCountText!: Phaser.GameObjects.Text;
  private nextUnlockText!: Phaser.GameObjects.Text;
  private progressBar!: Phaser.GameObjects.Graphics;
  private progressTop = 0;
  private unitsTop = 0;
  private unitRows: UnitRow[] = [];
  private unlockListTop = 0;
  private unlockSection!: Phaser.GameObjects.Container;
  private unlockSlots: UnlockSlot[] = [];
  private drawnUnlockCount = -1;
  // The wall-clock millisecond of the last step. The sim advances by wall-clock time rather than
  // Phaser's frame delta, which a browser stops or clamps while the tab is in the background, so time
  // spent in another tab still counts (up to MAX_AWAY_SECONDS at once). It starts at the first frame,
  // not at construction: the time Phaser takes to boot is not play, and counting it made two draws of
  // the same save credit different dust (the gate's frames job, e2e/frames.spec.ts).
  private lastStepAt: number | null = null;

  // Whether create() has built the objects refresh() draws; a DOM control can act before it has.
  private created = false;
  // Called after every refresh with the state drawn, so the accessible DOM layer (render/controls.ts) tracks it.
  private readonly onRefresh: ((state: SimState) => void) | null;
  private readonly welcome: WelcomeBack | null;
  // Feedback: the toast over the title row, the strike button's centre for the +N floats, and the
  // unlock count last seen, so a new unlock gets its own moment.
  private toast!: Phaser.GameObjects.Container;
  private toastText!: Phaser.GameObjects.Text;
  private toastTimer: Phaser.Time.TimerEvent | null = null;
  private strikeCentreY = 0;
  private seenUnlocks: number;
  private readonly calm = reducedMotion();

  constructor(
    data: GameData,
    seed: number,
    savedState: SimState | null = null,
    onRefresh: ((state: SimState) => void) | null = null,
    welcome: WelcomeBack | null = null,
  ) {
    super({ key: 'dust' });
    this.data_ = data;
    this.state = savedState ?? createSim(data.config, seed);
    this.onRefresh = onRefresh;
    this.welcome = welcome;
    this.seenUnlocks = this.state.unlocked.length;
  }

  // One action from the canvas or the DOM controls: the same sim `apply`, then a redraw.
  act(action: SimAction): SimState {
    const before = this.state;
    this.state = apply(this.state, this.data_.config, action);
    if (this.created) {
      if (action.type === 'strike') this.floatGain(this.state.dust - before.dust);
      else if (this.state !== before && ownedCount(this.state, action.unit) > ownedCount(before, action.unit)) this.pulse(this.dustText);
      this.refresh();
    }
    return this.state;
  }

  // A "+N" that rises off the Strike button and fades: the strike's yield, made visible.
  private floatGain(gain: number): void {
    if (!(gain > 0)) return;
    const x = SCREEN_WIDTH / 2 + Phaser.Math.Between(-60, 60);
    const label = this.add.text(x, this.strikeCentreY - 30, `+${formatDust(gain)}`, textStyle(18, COLORS.text, 'bold')).setOrigin(0.5);
    this.tweens.add({
      targets: label,
      y: this.calm ? label.y : label.y - 36,
      alpha: 0,
      duration: 800,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  private pulse(target: Phaser.GameObjects.Text): void {
    if (this.calm) return;
    this.tweens.add({ targets: target, scale: 1.06, duration: 90, yoyo: true, ease: 'Quad.easeOut' });
  }

  private createToast(): void {
    const height = 34;
    const panel = this.add.rectangle(SCREEN_WIDTH / 2, height / 2, CONTENT_WIDTH, height, COLORS.accent);
    this.toastText = this.add.text(SCREEN_WIDTH / 2, height / 2, '', textStyle(13, COLORS.dark, 'bold')).setOrigin(0.5);
    this.toast = this.add.container(0, MARGIN - 4, [panel, this.toastText]).setAlpha(0).setDepth(10);
  }

  // `slide` animates the entrance. The unlock toast appears without it: an unlock can land inside the
  // gate's frame draws, and a tween's timing is not frame-exact, so it would make two draws differ.
  private showToast(message: string, slide = true): void {
    this.toastText.setText(message);
    this.tweens.killTweensOf(this.toast);
    const animate = slide && !this.calm;
    this.toast.setAlpha(1).setY(animate ? MARGIN - 14 : MARGIN - 4);
    if (animate) this.tweens.add({ targets: this.toast, y: MARGIN - 4, duration: 220, ease: 'Back.easeOut' });
    this.toastTimer?.remove();
    this.toastTimer = this.time.delayedCall(TOAST_MS, () => {
      this.tweens.add({ targets: this.toast, alpha: 0, duration: this.calm ? 1 : 400 });
    });
  }

  create(): void {
    const { strings } = this.data_;
    this.cameras.main.setBackgroundColor(COLORS.background).setZoom(RENDER_SCALE).centerOn(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2);
    this.setUpSaving();

    let y = MARGIN;
    this.add.text(MARGIN, y, strings.title, textStyle(26, COLORS.text, 'bold'));
    y += 40;
    this.dustText = this.add.text(MARGIN, y, '', textStyle(34, COLORS.text, 'bold'));
    y += 44;
    this.rateText = this.add.text(MARGIN, y, '', textStyle(15, COLORS.muted));
    y += 30;

    y = this.createStrikeButton(y);
    y = this.createUnitRows(y + 12);
    this.createUnlockList(y + 12);
    this.createToast();
    this.created = true;
    this.refresh();
    if (this.welcome !== null && this.welcome.seconds >= MIN_WELCOME_SECONDS && this.welcome.gain >= 1) {
      this.showToast(fill(strings.labels.welcomeBack, { amount: formatDust(this.welcome.gain), time: formatDuration(this.welcome.seconds) }));
    }
  }

  override update(): void {
    const now = Date.now();
    if (this.lastStepAt !== null) this.state = step(this.state, this.data_.config, awaySeconds(this.lastStepAt, now));
    this.lastStepAt = now;
    this.refresh();
  }

  private createStrikeButton(top: number): number {
    const { strings } = this.data_;
    const height = 56;
    this.strikeCentreY = top + height / 2;
    const button = this.add
      .rectangle(SCREEN_WIDTH / 2, top + height / 2, CONTENT_WIDTH, height, COLORS.accent)
      .setInteractive({ useHandCursor: true });
    this.add.text(SCREEN_WIDTH / 2, top + 20, strings.labels.strike, textStyle(20, COLORS.dark, 'bold')).setOrigin(0.5);
    this.add.text(SCREEN_WIDTH / 2, top + 41, strings.strikeDescription, textStyle(12, COLORS.dark)).setOrigin(0.5);
    button.on('pointerdown', () => {
      button.setFillStyle(COLORS.accentDown);
      this.act({ type: 'strike' });
    });
    button.on('pointerup', () => button.setFillStyle(COLORS.accent));
    button.on('pointerout', () => button.setFillStyle(COLORS.accent));
    return top + height;
  }

  private createUnitRows(top: number): number {
    const { config, strings } = this.data_;
    this.add.text(MARGIN, top, strings.labels.units, textStyle(14, COLORS.muted));
    this.unitsTop = top + 22;
    let y = this.unitsTop;
    for (const row of config.spawnTable.rows) {
      const container = this.add.container(0, y);
      const panel = this.add.rectangle(SCREEN_WIDTH / 2, UNIT_ROW_HEIGHT / 2 - 3, CONTENT_WIDTH, UNIT_ROW_HEIGHT - 6, COLORS.panel);
      panel.setStrokeStyle(1, COLORS.panelEdge);
      const name = this.add.text(MARGIN + 10, 9, row.name, textStyle(16, COLORS.text, 'bold'));
      const description = this.add.text(MARGIN + 10, 32, strings.unitDescriptions[row.id] ?? '', textStyle(11, COLORS.muted));
      const owned = this.add.text(MARGIN + 10 + name.width + 8, 12, '', textStyle(12, COLORS.muted));
      const buttonWidth = 96;
      const buttonX = SCREEN_WIDTH - MARGIN - buttonWidth / 2 - 8;
      const button = this.add
        .rectangle(buttonX, UNIT_ROW_HEIGHT / 2 - 3, buttonWidth, BUY_BUTTON_HEIGHT, COLORS.accent)
        .setInteractive({ useHandCursor: true });
      const buttonLabel = this.add.text(buttonX, UNIT_ROW_HEIGHT / 2 - 12, strings.labels.buy, textStyle(14, COLORS.dark, 'bold')).setOrigin(0.5);
      const cost = this.add.text(buttonX, UNIT_ROW_HEIGHT / 2 + 6, '', textStyle(11, COLORS.dark)).setOrigin(0.5);
      button.on('pointerdown', () => {
        this.act({ type: 'buy', unit: row.id });
      });
      container.add([panel, name, description, owned, button, buttonLabel, cost]);
      this.unitRows.push({ unit: row.id, container, owned, cost, button, buttonLabel });
      y += UNIT_ROW_HEIGHT;
    }
    return y;
  }

  private createUnlockList(top: number): void {
    const { strings } = this.data_;
    // One container, moved up in refresh() so the section sits right under the units shown, with no
    // gap left for units still locked.
    this.unlockSection = this.add.container(0, 0);
    const heading = this.add.text(MARGIN, top, strings.labels.unlocks, textStyle(14, COLORS.muted));
    this.unlockCountText = this.add.text(SCREEN_WIDTH - MARGIN, top, '', textStyle(12, COLORS.muted)).setOrigin(1, 0);
    let y = top + 22;
    this.nextUnlockText = this.add.text(MARGIN, y, '', textStyle(13, COLORS.text));
    y += 20;
    this.progressTop = y;
    this.progressBar = this.add.graphics();
    y += 14;
    this.unlockListTop = y;
    this.unlockSection.add([heading, this.unlockCountText, this.nextUnlockText, this.progressBar]);
    for (let i = 0; i < MAX_UNLOCK_LINES; i += 1) {
      const dot = this.add.circle(MARGIN + 6, y + 9, 5, COLORS.bar).setStrokeStyle(1, COLORS.bar);
      const label = this.add.text(MARGIN + 18, y, '', textStyle(12, COLORS.muted));
      this.unlockSection.add([dot, label]);
      this.unlockSlots.push({ dot, label });
    }
  }

  private refresh(): void {
    const { config, strings } = this.data_;
    const state = this.state;
    this.setText(this.dustText, `${formatDust(state.dust)} ${strings.labels.dust.toLowerCase()}`);
    this.setText(this.rateText, `${formatRate(ratePerSecond(state, config))} ${strings.labels.perSecond}`);

    // Available units pack upward so a locked unit leaves no gap on screen.
    let shown = 0;
    for (const row of this.unitRows) {
      const available = isUnitAvailable(state, config, row.unit);
      row.container.setVisible(available);
      if (!available) continue;
      row.container.setY(this.unitsTop + shown * UNIT_ROW_HEIGHT);
      shown += 1;
      const cost = costOf(state, config, row.unit);
      const affordable = state.dust >= cost;
      this.setText(row.owned, `${ownedCount(state, row.unit)} ${strings.labels.owned}`);
      this.setText(row.cost, formatDust(cost));
      row.button.setFillStyle(affordable ? COLORS.accent : COLORS.buttonOff);
      row.buttonLabel.setColor(affordable ? COLORS.dark : COLORS.muted);
      row.cost.setColor(affordable ? COLORS.dark : COLORS.muted);
    }
    this.unlockSection.setY((shown - this.unitRows.length) * UNIT_ROW_HEIGHT);

    const total = config.unlocks.unlocks.length;
    this.setText(this.unlockCountText, fill(strings.labels.unlockedCount, { unlocked: String(state.unlocked.length), total: String(total) }));
    const next = nextLockedUnlock(state, config);
    this.progressBar.clear();
    if (next === null) {
      this.setText(this.nextUnlockText, strings.labels.allUnlocked);
    } else {
      this.setText(this.nextUnlockText, fill(strings.labels.nextUnlock, { name: next.name, amount: formatDust(next.atTotalDust) }));
      const share = Math.min(1, state.totalDust / next.atTotalDust);
      this.progressBar.fillStyle(COLORS.panel, 1);
      this.progressBar.fillRect(MARGIN, this.progressTop, CONTENT_WIDTH, 8);
      this.progressBar.fillStyle(COLORS.bar, 1);
      this.progressBar.fillRect(MARGIN, this.progressTop, CONTENT_WIDTH * share, 8);
    }

    if (state.unlocked.length > this.seenUnlocks) {
      const latest = state.unlocked[state.unlocked.length - 1];
      const row = config.unlocks.unlocks.find((unlock) => unlock.id === latest?.id);
      if (row !== undefined) this.showToast(fill(strings.labels.unlockBanner, { name: row.name }), false);
      this.seenUnlocks = state.unlocked.length;
    }

    if (this.drawnUnlockCount !== state.unlocked.length) {
      this.drawnUnlockCount = state.unlocked.length;
      const earnedIds = new Set(state.unlocked.map((event) => event.id));
      const lines = layoutUnlockList(this.unlockListTop, config.unlocks.unlocks, earnedIds);
      for (let i = 0; i < this.unlockSlots.length; i += 1) {
        const slot = this.unlockSlots[i];
        const line = lines[i];
        if (slot === undefined) continue;
        if (line === undefined) {
          slot.dot.setVisible(false);
          slot.label.setVisible(false);
          continue;
        }
        slot.dot.setY(line.y + 9);
        slot.label.setY(line.y);
        slot.label.setVisible(true);
        if (line.kind === 'earned') {
          slot.dot.setVisible(false);
          slot.label.setText(fill(strings.labels.unlocksEarned, { count: String(line.count) }));
          slot.label.setColor(COLORS.text);
        } else {
          slot.dot.setVisible(true);
          slot.dot.setFillStyle(COLORS.bar, 0);
          slot.label.setText(`${line.row.name}: ${describeEffect(line.row, config, strings)} (${formatDust(line.row.atTotalDust)})`);
          slot.label.setColor(COLORS.muted);
        }
      }
    }
    this.onRefresh?.(state);
  }

  private setText(target: Phaser.GameObjects.Text, value: string): void {
    if (target.text !== value) target.setText(value);
  }

  // Storage errors (a full or disabled store) are swallowed here so the game
  // keeps playing without a save rather than throwing on every tick.
  private save(): void {
    try {
      window.localStorage.setItem(SAVE_KEY, serializeState(this.state, Date.now()));
    } catch {
      // ignored
    }
  }

  private setUpSaving(): void {
    this.time.addEvent({ delay: SAVE_INTERVAL_MS, loop: true, callback: () => this.save() });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save();
    });
    window.addEventListener('pagehide', () => this.save());
  }
}
