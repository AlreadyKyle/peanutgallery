// The controls: the shop panel over the diorama, and the game's accessible DOM layer. The canvas is
// aria-hidden (index.html), so these real buttons are the game for a keyboard or screen reader user and
// for pointer play alike: Strike, one button per available unit (aria-disabled when unaffordable, so a
// button that goes unaffordable after a purchase keeps focus), the unlock list, and a polite live
// region. Each unit button's accessible name is its full label from render/a11y.ts ("Buy Gatherer:
// costs 10 dust, 0 owned"); what it draws (icon, name, cost, owned, how close it is to affordable) is
// decoration. Buttons drive the same sim `apply` actions as a tap on the pile, through render/game.ts.
import { costOf, findRow, ownedCount } from '../sim/sim';
import type { SimAction, SimConfig, SimState } from '../sim/types';
import { Announcer, controlsView, describeEffect } from './a11y';
import { fill, formatDust, formatRate } from './format';
import { unlockSummary } from './goals';
import { unitIcon } from './icons';
import type { Strings } from './strings';

export interface ControlTarget {
  act(action: SimAction): SimState;
}

interface UnitButton {
  button: HTMLButtonElement;
  fill: HTMLElement;
  owned: HTMLElement;
  cost: HTMLElement;
  badge: HTMLElement;
  progress: number;
  bumpUntil: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class AccessibleControls {
  private readonly announcer: Announcer;
  private readonly status: HTMLElement;
  private readonly live: HTMLElement;
  private readonly strike: HTMLButtonElement;
  private readonly unitButtons = new Map<string, UnitButton>();
  private readonly unlockCount: HTMLElement;
  private readonly unlockList: HTMLElement;
  private drawnUnlocks = -1;
  private target: ControlTarget | null = null;

  constructor(
    root: HTMLElement,
    private readonly config: SimConfig,
    private readonly strings: Strings,
    initial: SimState,
  ) {
    this.announcer = new Announcer(config, strings, initial, Date.now());
    root.replaceChildren();
    root.setAttribute('aria-label', strings.a11y.controls);

    // The dust total as one sentence for assistive technology; the HUD draws it big for the eye.
    this.status = el('p', 'controls-status visually-hidden');
    root.append(this.status);

    this.strike = el('button', 'strike');
    this.strike.type = 'button';
    this.strike.append(document.createTextNode(strings.labels.strike));
    const hint = el('span', 'strike-hint', strings.labels.tapHint);
    hint.setAttribute('aria-hidden', 'true');
    this.strike.append(hint);
    this.strike.setAttribute('aria-describedby', 'controls-strike-description');
    this.strike.addEventListener('click', () => this.target?.act({ type: 'strike' }));
    const strikeDescription = el('span', 'visually-hidden', strings.strikeDescription);
    strikeDescription.id = 'controls-strike-description';
    root.append(this.strike, strikeDescription);

    const grid = el('div', 'units');
    for (const row of config.spawnTable.rows) {
      const button = el('button', 'unit');
      button.type = 'button';
      button.dataset['unit'] = row.id;
      const fillBar = el('span', 'unit-fill');
      fillBar.setAttribute('aria-hidden', 'true');
      const face = el('span', 'unit-face');
      face.setAttribute('aria-hidden', 'true');
      face.innerHTML = unitIcon(row.id);
      const words = el('span', 'unit-words');
      const name = el('span', 'unit-name', row.name);
      const rate = el('span', 'unit-rate', `+${formatRate(row.rate)}/s`);
      const description = el('span', 'unit-description', strings.unitDescriptions[row.id] ?? '');
      words.append(name, description, rate);
      const owned = el('span', 'unit-owned');
      const cost = el('span', 'unit-cost');
      const badge = el('span', 'unit-new', strings.labels.newUnit);
      face.append(words, owned, cost, badge);
      button.append(fillBar, face);
      // aria-disabled, not disabled: a button that goes unaffordable after a purchase keeps focus.
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-disabled') === 'true' || this.target === null) return;
        const after = this.target.act({ type: 'buy', unit: row.id });
        this.announce(this.announcer.bought(after, row.id, Date.now()));
      });
      grid.append(button);
      this.unitButtons.set(row.id, { button, fill: fillBar, owned, cost, badge, progress: -1, bumpUntil: 0 });
    }
    root.append(grid);

    // The unlock list: earned unlocks as one count, the next few by name.
    const unlocks = el('section', 'unlocks');
    const heading = el('h2', 'unlocks-heading', strings.labels.unlocks);
    this.unlockCount = el('span', 'unlocks-count');
    heading.append(' ', this.unlockCount);
    this.unlockList = el('ul', 'unlocks-list');
    unlocks.append(heading, this.unlockList);
    root.append(unlocks);

    this.live = el('p', 'visually-hidden');
    this.live.setAttribute('aria-live', 'polite');
    this.live.setAttribute('role', 'status');
    root.append(this.live);
    this.update(initial, false);
  }

  attach(target: ControlTarget): void {
    this.target = target;
  }

  /** A short wobble on a unit's button after a purchase, drawn by update() from `now`. */
  bump(unit: string, now: number): void {
    const entry = this.unitButtons.get(unit);
    if (entry !== undefined) entry.bumpUntil = now + 240;
  }

  // Called every frame with the state drawn, so it writes only what changed.
  update(state: SimState, speak = true, now = 0): void {
    const view = controlsView(state, this.config, this.strings);
    if (this.status.textContent !== view.status) this.status.textContent = view.status;
    for (const unit of view.units) {
      const entry = this.unitButtons.get(unit.unit);
      if (entry === undefined) continue;
      const { button } = entry;
      if (button.hidden === unit.available) button.hidden = !unit.available;
      if (!unit.available) continue;
      if (button.getAttribute('aria-label') !== unit.label) button.setAttribute('aria-label', unit.label);
      const disabled = String(!unit.affordable);
      if (button.getAttribute('aria-disabled') !== disabled) button.setAttribute('aria-disabled', disabled);
      const cost = costOf(state, this.config, unit.unit);
      const owned = ownedCount(state, unit.unit);
      setText(entry.cost, formatDust(cost));
      setText(entry.owned, `×${owned}`);
      const fresh = owned === 0 && findRow(this.config, unit.unit) !== null && unit.unit !== this.config.spawnTable.rows[0]?.id;
      if (entry.badge.hidden === fresh) entry.badge.hidden = !fresh;
      // How close the player is to affording it, as a fill behind the button, in 1% steps.
      const progress = Math.round(Math.min(1, cost > 0 ? state.dust / cost : 1) * 100) / 100;
      if (progress !== entry.progress) {
        entry.progress = progress;
        entry.fill.style.transform = `scaleX(${progress})`;
      }
      const bumping = now < entry.bumpUntil;
      if (button.classList.contains('bump') !== bumping) button.classList.toggle('bump', bumping);
    }
    if (this.drawnUnlocks !== state.unlocked.length) this.drawUnlocks(state);
    if (!speak) return;
    const message = this.announcer.tick(state, Date.now());
    if (message !== null) this.announce(message);
  }

  private drawUnlocks(state: SimState): void {
    this.drawnUnlocks = state.unlocked.length;
    const summary = unlockSummary(this.config.unlocks.unlocks, new Set(state.unlocked.map((event) => event.id)));
    this.unlockCount.textContent = fill(this.strings.labels.unlockedCount, { unlocked: String(summary.earned), total: String(summary.total) });
    const items: HTMLElement[] = [];
    if (summary.upcoming.length === 0) items.push(el('li', 'unlock done', this.strings.labels.allUnlocked));
    for (const row of summary.upcoming) {
      const item = el('li', 'unlock');
      const name = el('span', 'unlock-name', row.name);
      const effect = el('span', 'unlock-effect', describeEffect(row, this.config, this.strings));
      const at = el('span', 'unlock-at', `${formatDust(row.atTotalDust)} ${this.strings.labels.dust.toLowerCase()}`);
      item.append(name, effect, at);
      items.push(item);
    }
    this.unlockList.replaceChildren(...items);
  }

  /** Says a message in the live region now, such as the welcome back. */
  say(message: string): void {
    this.announce(message);
  }

  private announce(message: string): void {
    this.live.textContent = message;
  }
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}
