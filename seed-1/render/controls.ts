// The accessible DOM layer: real buttons for Strike and each available unit, and a polite live region.
// The canvas is aria-hidden (index.html), so this is the game for a keyboard or screen reader user.
// The panel is visually hidden until focus enters it, then shows over the bottom of the canvas, so the
// 375px one-screen layout and the frames are unchanged. Buttons drive the same sim `apply` actions the
// canvas does, through the scene, so there is one state.
import type { SimAction, SimConfig, SimState } from '../sim/types';
import { Announcer, controlsView } from './a11y';
import type { Strings } from './strings';

export interface ControlTarget {
  act(action: SimAction): SimState;
}

export class AccessibleControls {
  private readonly announcer: Announcer;
  private readonly status: HTMLElement;
  private readonly live: HTMLElement;
  private readonly unitButtons = new Map<string, HTMLButtonElement>();
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

    this.status = document.createElement('p');
    this.status.className = 'controls-status';
    root.append(this.status);

    const strike = document.createElement('button');
    strike.type = 'button';
    strike.textContent = strings.labels.strike;
    strike.setAttribute('aria-describedby', 'controls-strike-description');
    strike.addEventListener('click', () => this.target?.act({ type: 'strike' }));
    const strikeDescription = document.createElement('span');
    strikeDescription.id = 'controls-strike-description';
    strikeDescription.className = 'visually-hidden';
    strikeDescription.textContent = strings.strikeDescription;
    root.append(strike, strikeDescription);

    for (const row of config.spawnTable.rows) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset['unit'] = row.id;
      // aria-disabled, not disabled: a button that goes unaffordable after a purchase keeps focus.
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-disabled') === 'true' || this.target === null) return;
        const after = this.target.act({ type: 'buy', unit: row.id });
        this.announce(this.announcer.bought(after, row.id, Date.now()));
      });
      root.append(button);
      this.unitButtons.set(row.id, button);
    }

    this.live = document.createElement('p');
    this.live.className = 'visually-hidden';
    this.live.setAttribute('aria-live', 'polite');
    this.live.setAttribute('role', 'status');
    root.append(this.live);
    this.update(initial, false);
  }

  attach(target: ControlTarget): void {
    this.target = target;
  }

  // Called by the scene after every refresh.
  update(state: SimState, speak = true): void {
    const view = controlsView(state, this.config, this.strings);
    if (this.status.textContent !== view.status) this.status.textContent = view.status;
    for (const unit of view.units) {
      const button = this.unitButtons.get(unit.unit);
      if (button === undefined) continue;
      if (button.hidden === unit.available) button.hidden = !unit.available;
      if (button.textContent !== unit.label) button.textContent = unit.label;
      const disabled = String(!unit.affordable);
      if (button.getAttribute('aria-disabled') !== disabled) button.setAttribute('aria-disabled', disabled);
    }
    if (!speak) return;
    const message = this.announcer.tick(state, Date.now());
    if (message !== null) this.announce(message);
  }

  private announce(message: string): void {
    this.live.textContent = message;
  }
}
