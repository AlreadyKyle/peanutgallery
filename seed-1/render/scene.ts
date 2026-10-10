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
import { serializeState } from '../sim/save';
import type { SimState, UnlockRow } from '../sim/types';
import { fill, formatDuration, formatDust, formatPercent, formatRate } from './format';
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
  private nextUnlockTimeText!: Phaser.GameObjects.Text;
  private progressBar!: Phaser.GameObjects.Graphics;
  private progressTop = 0;
  private unitsTop = 0;
  private unitRows: UnitRow[] = [];
  private unlockListTop = 0;
  private unlockSection!: Phaser.GameObjects.Container;
  private unlockSlots: UnlockSlot[] = [];
  private drawnUnlockCount = -1;

  constructor(data: GameData, seed: number, savedState: SimState | null = null) {
    super({ key: 'dust' });
    this.data_ = data;
    this.state = savedState ?? createSim(data.config, seed);
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
    this.refresh();
  }

  override update(_time: number, delta: number): void {
    this.state = step(this.state, this.data_.config, delta / 1000);
    this.refresh();
  }

  private createStrikeButton(top: number): number {
    const { strings } = this.data_;
    const height = 56;
    const button = this.add
      .rectangle(SCREEN_WIDTH / 2, top + height / 2, CONTENT_WIDTH, height, COLORS.accent)
      .setInteractive({ useHandCursor: true });
    this.add.text(SCREEN_WIDTH / 2, top + 20, strings.labels.strike, textStyle(20, COLORS.dark, 'bold')).setOrigin(0.5);
    this.add.text(SCREEN_WIDTH / 2, top + 41, strings.strikeDescription, textStyle(12, COLORS.dark)).setOrigin(0.5);
    button.on('pointerdown', () => {
      button.setFillStyle(COLORS.accentDown);
      this.state = apply(this.state, this.data_.config, { type: 'strike' });
      this.refresh();
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
        this.state = apply(this.state, config, { type: 'buy', unit: row.id });
        this.refresh();
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
    this.nextUnlockTimeText = this.add.text(SCREEN_WIDTH - MARGIN, y + 1, '', textStyle(12, COLORS.muted)).setOrigin(1, 0);
    y += 20;
    this.progressTop = y;
    this.progressBar = this.add.graphics();
    y += 14;
    this.unlockListTop = y;
    this.unlockSection.add([heading, this.unlockCountText, this.nextUnlockText, this.nextUnlockTimeText, this.progressBar]);
    for (let i = 0; i < MAX_UNLOCK_LINES; i += 1) {
      const dot = this.add.circle(MARGIN + 6, y + 9, 5, COLORS.bar).setStrokeStyle(1, COLORS.bar);
      const label = this.add.text(MARGIN + 18, y, '', textStyle(12, COLORS.muted));
      this.unlockSection.add([dot, label]);
      this.unlockSlots.push({ dot, label });
    }
  }

  private describeEffect(row: UnlockRow): string {
    const { config, strings } = this.data_;
    const effect = row.effect;
    if (effect.type === 'unit') {
      const unitRow = config.spawnTable.rows.find((candidate) => candidate.id === effect.unit) ?? null;
      return fill(strings.effects.unit, { unit: unitRow === null ? effect.unit : unitRow.name });
    }
    return fill(strings.effects.multiplier, { percent: formatPercent(effect.value) });
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
      this.nextUnlockTimeText.setVisible(false);
    } else {
      this.setText(this.nextUnlockText, fill(strings.labels.nextUnlock, { name: next.name, amount: formatDust(next.atTotalDust) }));
      const seconds = (next.atTotalDust - state.totalDust) / ratePerSecond(state, config);
      this.setText(this.nextUnlockTimeText, fill(strings.labels.nextUnlockTime, { time: formatDuration(seconds) }));
      // Never draw over the Next text: hide the time if the two would touch.
      const fits = this.nextUnlockText.x + this.nextUnlockText.width + 8 <= this.nextUnlockTimeText.x - this.nextUnlockTimeText.width;
      this.nextUnlockTimeText.setVisible(fits);
      const share = Math.min(1, state.totalDust / next.atTotalDust);
      this.progressBar.fillStyle(COLORS.panel, 1);
      this.progressBar.fillRect(MARGIN, this.progressTop, CONTENT_WIDTH, 8);
      this.progressBar.fillStyle(COLORS.bar, 1);
      this.progressBar.fillRect(MARGIN, this.progressTop, CONTENT_WIDTH * share, 8);
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
          slot.label.setText(`${line.row.name}: ${this.describeEffect(line.row)} (${formatDust(line.row.atTotalDust)})`);
          slot.label.setColor(COLORS.muted);
        }
      }
    }
  }

  private setText(target: Phaser.GameObjects.Text, value: string): void {
    if (target.text !== value) target.setText(value);
  }

  // Storage errors (a full or disabled store) are swallowed here so the game
  // keeps playing without a save rather than throwing on every tick.
  private save(): void {
    try {
      window.localStorage.setItem(SAVE_KEY, serializeState(this.state));
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
