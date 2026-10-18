// The controls: the shop panel over the diorama, and the game's accessible DOM layer. The canvas is
// aria-hidden (index.html), so these real buttons are the game for a keyboard or screen reader user and
// for pointer play alike: Strike, one button per available unit (aria-disabled when unaffordable, so a
// button that goes unaffordable after a purchase keeps focus), the unlock list, and a polite live
// region. Each unit button's accessible name is its full label from render/a11y.ts ("Buy Gatherer:
// costs 10 dust, 0 owned"); what it draws (icon, name, cost, owned, how close it is to affordable) is
// decoration. Buttons drive the same sim `apply` actions as a tap on the pile, through render/game.ts.
// The layers add three more: the dust devil's catch button (over the island on a phone, under Strike
// on a wide screen) while there is one, a fork's options at the top of the shop while one waits, and
// the order on the board. On a phone everything below Strike scrolls inside a bounded sheet, so the
// island always keeps a slice of the stage and nothing is pushed off the top of the screen.
import { canBuyPerk, canPress, costOf, findRow, gemsOpen, hasPerk, ownedCount, unitRate } from '../sim/sim';
import type { SimAction, SimConfig, SimState } from '../sim/types';
import { Announcer, controlsView, describeEffect } from './a11y';
import { describePerk, devilView, forkView, gemsLine, milestoneHint, notEnough, orderView, pressView } from './depth';
import { fill, formatDust, formatRate, groupThousands } from './format';
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
  private readonly devil: HTMLButtonElement;
  private readonly shop: HTMLElement;
  private readonly fork: HTMLElement;
  private readonly forkTitle: HTMLElement;
  private readonly forkMore: HTMLElement;
  private readonly forkOptions: HTMLElement;
  private drawnFork: string | null = null;
  private readonly order: HTMLElement;
  private readonly orderText: HTMLElement;
  private readonly orderCount: HTMLElement;
  private readonly orderFill: HTMLElement;
  private readonly orderFilled: HTMLElement;
  private readonly orderButton: HTMLButtonElement;
  private orderProgress = -1;
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

    // While there is one: the dust devil's catch button. On a phone it hangs over the island just above
    // the shop, outside its height, so the island never reframes as a devil comes and goes
    // (render/style.css).
    const pops = el('div', 'pops');
    this.devil = el('button', 'devil');
    this.devil.type = 'button';
    this.devil.hidden = true;
    this.devil.addEventListener('click', () => this.target?.act({ type: 'catch' }));
    this.fork = el('section', 'fork');
    this.fork.hidden = true;
    const forkHead = el('div', 'fork-head');
    const forkKicker = el('span', 'fork-kicker', strings.depth.forkKicker);
    this.forkTitle = el('h2', 'fork-title');
    this.forkTitle.id = 'fork-title';
    this.fork.setAttribute('aria-labelledby', this.forkTitle.id);
    const forkNote = el('span', 'fork-note', strings.depth.forkNote);
    forkHead.append(forkKicker, this.forkTitle, forkNote);
    this.forkOptions = el('div', 'fork-options');
    this.forkMore = el('p', 'fork-more');
    this.fork.append(forkHead, this.forkOptions, this.forkMore);
    pops.append(this.devil);
    root.append(pops);

    // The shop below Strike: the fork waiting for a choice first, then the units, the order, the gems
    // and the unlock list. On a phone it scrolls inside the sheet, which never grows past its share of
    // the stage; on a wide screen it lays out in the side panel as if it were not there.
    this.shop = el('div', 'shop');
    this.shop.append(this.fork);
    root.append(this.shop);

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
    this.shop.append(grid);

    // The order on the board, from its unlock: what it asks for, how far along it is, and one button
    // that fills it once it is met (after its rest) or swaps it for another until then. One button, so
    // focus stays put as it changes.
    this.order = el('section', 'order');
    this.order.hidden = true;
    const orderHeading = el('h2', 'order-heading', strings.depth.orderKicker);
    orderHeading.id = 'order-heading';
    this.order.setAttribute('aria-labelledby', orderHeading.id);
    this.orderFilled = el('span', 'order-filled');
    orderHeading.append(' ', this.orderFilled);
    const orderBody = el('div', 'order-body');
    this.orderText = el('p', 'order-text');
    const track = el('span', 'order-track');
    track.setAttribute('aria-hidden', 'true');
    this.orderFill = el('span', 'order-fill');
    track.append(this.orderFill);
    this.orderCount = el('span', 'order-count');
    orderBody.append(this.orderText, track, this.orderCount);
    this.orderButton = el('button', 'order-act');
    this.orderButton.type = 'button';
    this.orderButton.addEventListener('click', () => {
      const mode = this.orderButton.dataset['mode'];
      if (mode === 'fill') this.target?.act({ type: 'fill' });
      else if (mode === 'swap') this.target?.act({ type: 'swap' });
    });
    this.order.append(orderHeading, orderBody, this.orderButton);
    this.shop.append(this.order);

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
    this.shop.append(this.gems);

    // The unlock list: earned unlocks as one count, the next few by name.
    const unlocks = el('section', 'unlocks');
    const heading = el('h2', 'unlocks-heading', strings.labels.unlocks);
    this.unlockCount = el('span', 'unlocks-count');
    heading.append(' ', this.unlockCount);
    this.unlockList = el('ul', 'unlocks-list');
    unlocks.append(heading, this.unlockList);
    this.shop.append(unlocks);

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
    // On a phone, whether the shop has more below what the sheet shows (a wide screen's shop has no box).
    const more = this.shop.scrollHeight - this.shop.scrollTop - this.shop.clientHeight > 2;
    if (this.shop.classList.contains('more') !== more) this.shop.classList.toggle('more', more);
    this.updateDevil(state);
    this.updateFork(state);
    this.updateOrder(state);
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
    setText(this.confirmText, fill(this.strings.depth.pressConfirm, { season: String(season + 2), gems: groupThousands(press.gems) }));
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

  private updateDevil(state: SimState): void {
    const view = devilView(state, this.config, this.strings);
    if (this.devil.hidden === (view !== null)) {
      // A caught (or departed) devil takes its button with it: focus goes back to Strike.
      if (view === null && document.activeElement === this.devil) this.strike.focus();
      this.devil.hidden = view === null;
    }
    if (view === null) return;
    setText(this.devil, view.text);
    setAttr(this.devil, 'aria-label', view.label);
  }

  private updateFork(state: SimState): void {
    const view = forkView(state, this.config, this.strings);
    if (this.fork.hidden === (view !== null)) {
      if (view === null && this.fork.contains(document.activeElement)) this.strike.focus();
      this.fork.hidden = view === null;
    }
    const id = view?.row.id ?? null;
    if (view === null || id === this.drawnFork) {
      this.drawnFork = id;
      return;
    }
    // A new fork: its options as buttons, drawn once.
    const hadFocus = this.fork.contains(document.activeElement);
    this.drawnFork = id;
    setText(this.forkTitle, view.row.name);
    setText(this.forkMore, view.more > 0 ? fill(this.strings.depth.forkMore, { count: String(view.more) }) : '');
    const buttons = view.options.map((entry, index) => {
      const button = el('button', 'fork-option');
      button.type = 'button';
      button.dataset['side'] = String(index);
      button.setAttribute('aria-label', entry.label);
      const name = el('span', 'fork-option-name', entry.option.name);
      const effect = el('span', 'fork-option-effect', entry.effect);
      for (const node of [name, effect]) node.setAttribute('aria-hidden', 'true');
      button.append(name, effect);
      button.addEventListener('click', () => this.target?.act({ type: 'choose', unlock: view.row.id, option: entry.option.id }));
      return button;
    });
    this.forkOptions.replaceChildren(...buttons);
    // A new fork sits at the top of the shop: scroll the sheet back to it so its options are in view.
    this.shop.scrollTop = 0;
    if (hadFocus) buttons[0]?.focus();
  }

  private updateOrder(state: SimState): void {
    const view = orderView(state, this.config, this.strings);
    if (this.order.hidden === (view !== null)) this.order.hidden = view === null;
    if (view === null) return;
    setText(this.orderText, view.text);
    setText(this.orderCount, view.count);
    setText(this.orderFilled, (state.ordersFilled ?? 0) > 0 ? view.filled : '');
    const progress = Math.round(view.progress * 100) / 100;
    if (progress !== this.orderProgress) {
      this.orderProgress = progress;
      this.orderFill.style.transform = `scaleX(${progress})`;
    }
    const met = view.progress >= 1;
    const mode = view.ready ? 'fill' : met ? 'rest' : 'swap';
    if (this.orderButton.dataset['mode'] !== mode) this.orderButton.dataset['mode'] = mode;
    const text = mode === 'fill' ? view.fillText : mode === 'rest' ? fill(this.strings.depth.orderRest, { seconds: String(view.rest) }) : this.strings.depth.orderSwap;
    setText(this.orderButton, text);
    setAttr(this.orderButton, 'aria-label', mode === 'fill' ? view.fillLabel : mode === 'rest' ? text : this.strings.depth.orderSwapLabel);
    setAttr(this.orderButton, 'aria-disabled', String(mode === 'rest'));
    if (this.order.classList.contains('ready') !== view.ready) this.order.classList.toggle('ready', view.ready);
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
