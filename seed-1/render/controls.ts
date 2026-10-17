// The controls: the shop panel over the diorama, and the game's accessible DOM layer. The canvas is
// aria-hidden (index.html), so these real buttons are the game for a keyboard or screen reader user and
// for pointer play alike: Strike, one button per available unit (aria-disabled when unaffordable, so a
// button that goes unaffordable after a purchase keeps focus), the unlock list, and a polite live
// region. Each unit button's accessible name is its full label from render/a11y.ts ("Buy Gatherer:
// costs 10 dust, 0 owned"); what it draws (icon, name, cost, owned, how close it is to affordable) is
// decoration. Buttons drive the same sim `apply` actions as a tap on the pile, through render/game.ts.
import { canBuyPerk, canPress, costOf, findRow, gemsOpen, hasPerk, ownedCount, unitRate } from '../sim/sim';
import type { SimAction, SimConfig, SimState } from '../sim/types';
import { Announcer, controlsView, describeEffect } from './a11y';
import { describePerk, gemsLine, milestoneHint, notEnough, pressView } from './depth';
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
  rate: HTMLElement;
  next: HTMLElement;
  progress: number;
  bumpUntil: number;
  shakeAt: number;
}

interface PerkButton {
  button: HTMLButtonElement;
  cost: HTMLElement;
}

// A refused purchase shakes its button for this long (drawn from the frame clock, never a CSS animation).
const SHAKE_MS = 360;
// Live-region messages this close together are joined rather than replaced.
const ANNOUNCE_JOIN_MS = 1500;

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
  private drawnSeason = -1;
  private target: ControlTarget | null = null;
  private readonly gems: HTMLElement;
  private readonly gemsHeld: HTMLElement;
  private readonly season: HTMLElement;
  private readonly press: HTMLButtonElement;
  private readonly confirm: HTMLElement;
  private readonly confirmText: HTMLElement;
  private readonly confirmYes: HTMLButtonElement;
  private readonly perkButtons = new Map<string, PerkButton>();
  private readonly perksToggle: HTMLButtonElement;
  private lastNow = 0;
  /** Called when a purchase is refused, with the reason in words, so the HUD can show it. */
  refused: ((unit: string, reason: string) => void) | null = null;

  constructor(
    root: HTMLElement,
    private readonly config: SimConfig,
    private readonly strings: Strings,
    initial: SimState,
    private readonly calm = false,
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
      // The rate and, beside it, the next milestone ("×2 at 25"), so owning more has a visible point.
      const next = el('span', 'unit-next');
      const rateRow = el('span', 'unit-rate-row');
      rateRow.append(rate, next);
      words.append(name, description, rateRow);
      const owned = el('span', 'unit-owned');
      const cost = el('span', 'unit-cost');
      const badge = el('span', 'unit-new', strings.labels.newUnit);
      face.append(words, owned, cost, badge);
      button.append(fillBar, face);
      // aria-disabled, not disabled: a button that goes unaffordable after a purchase keeps focus.
      button.addEventListener('click', () => {
        if (this.target === null) return;
        if (button.getAttribute('aria-disabled') === 'true') {
          // Not enough: a gentle shake and the reason in words, never a punishing flash or sound.
          const entry = this.unitButtons.get(row.id);
          if (entry !== undefined) entry.shakeAt = this.lastNow;
          const reason = notEnough(this.currentState ?? initial, this.config, this.strings, row.id);
          this.announce(reason);
          this.refused?.(row.id, reason);
          return;
        }
        const after = this.target.act({ type: 'buy', unit: row.id });
        this.announce(this.announcer.bought(after, row.id, Date.now()));
      });
      grid.append(button);
      this.unitButtons.set(row.id, { button, fill: fillBar, owned, cost, badge, rate, next, progress: -1, bumpUntil: 0, shakeAt: -10_000 });
    }
    root.append(grid);

    // Gems: press the pile for a new season, and spend gems on perks. Hidden until its unlock opens.
    this.gems = el('section', 'gems');
    this.gems.hidden = true;
    const gemsHeading = el('h2', 'gems-heading', strings.depth.gemsHeading);
    this.season = el('span', 'gems-season');
    gemsHeading.append(' ', this.season);
    this.gemsHeld = el('p', 'gems-held');
    this.press = el('button', 'press');
    this.press.type = 'button';
    this.press.addEventListener('click', () => {
      if (this.press.getAttribute('aria-disabled') === 'true') return;
      this.confirm.hidden = false;
      this.press.setAttribute('aria-expanded', 'true');
      this.confirmYes.focus();
    });
    this.confirm = el('div', 'press-confirm');
    this.confirm.hidden = true;
    this.confirm.setAttribute('role', 'group');
    this.confirmText = el('p', 'press-confirm-text');
    this.confirmText.id = 'press-confirm-text';
    this.confirm.setAttribute('aria-labelledby', this.confirmText.id);
    this.confirmYes = el('button', 'press-yes', strings.depth.pressYes);
    this.confirmYes.type = 'button';
    const confirmNo = el('button', 'press-no', strings.depth.pressNo);
    confirmNo.type = 'button';
    this.confirmYes.addEventListener('click', () => {
      this.closeConfirm();
      this.target?.act({ type: 'press' });
      this.press.focus();
    });
    confirmNo.addEventListener('click', () => {
      this.closeConfirm();
      this.press.focus();
    });
    const confirmActions = el('div', 'press-confirm-actions');
    confirmActions.append(this.confirmYes, confirmNo);
    this.confirm.append(this.confirmText, confirmActions);
    this.press.setAttribute('aria-expanded', 'false');
    this.press.setAttribute('aria-controls', 'press-confirm');
    this.confirm.id = 'press-confirm';
    const perksHeading = el('h3', 'perks-heading', strings.depth.perksHeading);
    const perks = el('div', 'perks');
    perks.id = 'perks';
    // On a phone the perks fold behind this toggle so the island keeps its room; a wide screen shows
    // them always and hides the toggle (render/style.css).
    this.perksToggle = el('button', 'perks-toggle');
    this.perksToggle.type = 'button';
    this.perksToggle.setAttribute('aria-expanded', 'false');
    this.perksToggle.setAttribute('aria-controls', perks.id);
    this.perksToggle.addEventListener('click', () => {
      const open = !this.gems.classList.contains('open');
      this.gems.classList.toggle('open', open);
      this.perksToggle.setAttribute('aria-expanded', String(open));
    });
    for (const perk of config.unlocks.gems?.perks ?? []) {
      const button = el('button', 'perk');
      button.type = 'button';
      button.dataset['perk'] = perk.id;
      const name = el('span', 'perk-name', perk.name);
      const effect = el('span', 'perk-effect', describePerk(perk, config, strings));
      const cost = el('span', 'perk-cost');
      for (const node of [name, effect, cost]) node.setAttribute('aria-hidden', 'true');
      button.append(name, effect, cost);
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-disabled') === 'true' || this.target === null) return;
        this.target.act({ type: 'perk', perk: perk.id });
      });
      perks.append(button);
      this.perkButtons.set(perk.id, { button, cost });
    }
    this.gems.append(gemsHeading, this.gemsHeld, this.press, this.confirm, this.perksToggle, perksHeading, perks);
    root.append(this.gems);

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

  private currentState: SimState | null = null;

  private closeConfirm(): void {
    this.confirm.hidden = true;
    this.press.setAttribute('aria-expanded', 'false');
  }

  // Called every frame with the state drawn, so it writes only what changed.
  update(state: SimState, speak = true, now = 0): void {
    this.currentState = state;
    this.lastNow = now;
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
      setText(entry.rate, `+${formatRate(unitRate(state, this.config, unit.unit))}/s`);
      setText(entry.next, milestoneHint(state, this.config, this.strings, unit.unit));
      const k = (now - entry.shakeAt) / SHAKE_MS;
      const shake = !this.calm && k >= 0 && k < 1 ? Math.sin(k * Math.PI * 5) * (1 - k) * 5 : 0;
      const transform = shake === 0 ? '' : `translateX(${shake.toFixed(2)}px)`;
      if (button.style.transform !== transform) button.style.transform = transform;
    }
    this.updateGems(state);
    if (this.drawnUnlocks !== state.unlocked.length || this.drawnSeason !== (state.season ?? 0)) this.drawUnlocks(state);
    if (!speak) return;
    const message = this.announcer.tick(state, Date.now());
    if (message !== null) this.announce(message);
  }

  private updateGems(state: SimState): void {
    const open = gemsOpen(state, this.config);
    if (this.gems.hidden === open) this.gems.hidden = !open;
    if (!open) return;
    const season = state.season ?? 0;
    setText(this.season, season > 0 ? fill(this.strings.depth.seasonLabel, { season: String(season + 1) }) : '');
    setText(this.gemsHeld, gemsLine(state, this.config, this.strings));
    const press = pressView(state, this.config, this.strings);
    setText(this.press, press.text);
    setAttr(this.press, 'aria-label', press.label);
    const ready = canPress(state, this.config);
    setAttr(this.press, 'aria-disabled', String(!ready));
    if (!ready && !this.confirm.hidden) this.closeConfirm();
    setText(this.confirmText, fill(this.strings.depth.pressConfirm, { season: String(season + 2), gems: String(press.gems) }));
    const perkRows = this.config.unlocks.gems?.perks ?? [];
    setText(this.perksToggle, fill(this.strings.depth.perksShow, { owned: String(state.perks?.length ?? 0), total: String(perkRows.length) }));
    for (const perk of perkRows) {
      const entry = this.perkButtons.get(perk.id);
      if (entry === undefined) continue;
      const owned = hasPerk(state, perk.id);
      const effect = describePerk(perk, this.config, this.strings);
      setText(entry.cost, owned ? this.strings.depth.perkOwned : fill(this.strings.depth.perkCost, { cost: String(perk.cost) }));
      setAttr(
        entry.button,
        'aria-label',
        fill(owned ? this.strings.depth.perkOwnedLabel : this.strings.depth.perkLabel, { name: perk.name, effect, cost: String(perk.cost) }),
      );
      setAttr(entry.button, 'aria-disabled', String(!canBuyPerk(state, this.config, perk.id)));
      if (entry.button.classList.contains('owned') !== owned) entry.button.classList.toggle('owned', owned);
    }
  }

  private drawUnlocks(state: SimState): void {
    this.drawnUnlocks = state.unlocked.length;
    this.drawnSeason = state.season ?? 0;
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

  private announcedAt = -Infinity;

  // Messages that land close together are said together, so an unlock right after a purchase does
  // not wipe the purchase out of the live region before it is read.
  private announce(message: string): void {
    const now = Date.now();
    const recent = now - this.announcedAt < ANNOUNCE_JOIN_MS;
    const previous = this.live.textContent ?? '';
    this.live.textContent = recent && previous !== '' && !previous.includes(message) ? `${previous} ${message}` : message;
    this.announcedAt = now;
  }
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setAttr(node: HTMLElement, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}
