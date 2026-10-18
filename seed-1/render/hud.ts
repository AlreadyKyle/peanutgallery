// The HUD over the diorama, for the eye only (aria-hidden: render/controls.ts says the same in words):
// the dust total big, the rate, the bar to the next unlock, "+N" floaters off the pile, the strike
// streak, and the banner for an unlock or a welcome back. Every movement is set from the frame clock
// passed to frame(), never a CSS animation, so the gate's frames draw the same pixels twice
// (e2e/frames.spec.ts). Under prefers-reduced-motion floaters fade in place and banners appear still.
import { ratePerSecond } from '../sim/sim';
import type { SimConfig, SimState, UnlockRow } from '../sim/types';
import { describeEffect } from './a11y';
import { firstStep, gemGoal, weatherView, whirlView } from './depth';
import { fill, formatDust, formatDuration, formatRate } from './format';
import { nextGoal } from './goals';
import type { Strings } from './strings';
import { easeOutBack } from './world';

const FLOATERS = 14;
const FLOAT_SECONDS = 0.95;
// Strikes closer together than this keep a streak going.
const STREAK_GAP = 0.75;
const BANNER_SECONDS = 3.4;
const WELCOME_SECONDS = 5.5;

interface Floater {
  node: HTMLElement;
  born: number;
  x: number;
  y: number;
  drift: number;
  big: boolean;
}

interface Banner {
  born: number;
  until: number;
  kicker: string;
  title: string;
  body: string;
  /** The banner's look: an unlock (magenta), a welcome back, a milestone or a new season. */
  tone: 'unlock' | 'welcome' | 'milestone' | 'season' | 'fork' | 'devil';
}

// How long a refusal's reason stays under the totals.
const FLASH_SECONDS = 2.2;

// Small line-style glyphs for the weather chip, drawn in code (never an image asset). The chip also
// names the weather in words, so the glyph never carries the meaning alone.
const WEATHER_GLYPHS: Record<string, string> = {
  breeze:
    '<path d="M3 8h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 18h7" fill="none" stroke="#151515" stroke-width="2.4" stroke-linecap="round"/>',
  rain:
    '<path d="M6 13a4 4 0 0 1 1-7.9A5 5 0 0 1 16.5 6 3.5 3.5 0 0 1 17 13z" fill="#8db9e8" stroke="#151515" stroke-width="2.2" stroke-linejoin="round"/><path d="M8 16l-1 3M12 16l-1 3M16 16l-1 3" stroke="#151515" stroke-width="2.2" stroke-linecap="round"/>',
  heatwave:
    '<circle cx="12" cy="12" r="4.5" fill="#f5b97a" stroke="#151515" stroke-width="2.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" stroke="#151515" stroke-width="2.2" stroke-linecap="round"/>',
  'shooting-star':
    '<path d="M14 3l2 4.5 4.8.5-3.6 3.2 1 4.8-4.2-2.5-4.2 2.5 1-4.8L7.2 8l4.8-.5z" fill="#f5dc7a" stroke="#151515" stroke-width="2" stroke-linejoin="round"/><path d="M3 21l5-5M2 16l3-3" stroke="#151515" stroke-width="2.2" stroke-linecap="round"/>',
};
const WEATHER_GLYPH_DEFAULT =
  '<path d="M6 16a4 4 0 0 1 1-7.9A5 5 0 0 1 16.5 9 3.5 3.5 0 0 1 17 16z" fill="#fdfcf8" stroke="#151515" stroke-width="2.2" stroke-linejoin="round"/>';

function div(className: string, parent: HTMLElement): HTMLElement {
  const node = document.createElement('div');
  node.className = className;
  parent.append(node);
  return node;
}

export class Hud {
  private readonly total: HTMLElement;
  private readonly rate: HTMLElement;
  private readonly goal: HTMLElement;
  private readonly goalName: HTMLElement;
  private readonly goalLabel: HTMLElement;
  private readonly goalLeft: HTMLElement;
  private readonly goalFill: HTMLElement;
  private readonly floaterNodes: Floater[] = [];
  private readonly streakNode: HTMLElement;
  private readonly bannerNode: HTMLElement;
  private readonly bannerKicker: HTMLElement;
  private readonly bannerTitle: HTMLElement;
  private readonly bannerBody: HTMLElement;
  private readonly queue: Banner[] = [];
  private banner: Banner | null = null;
  private readonly hint: HTMLElement;
  private readonly weatherChip: HTMLElement;
  private readonly weatherIcon: HTMLElement;
  private readonly weatherName: HTMLElement;
  private readonly weatherEffect: HTMLElement;
  private readonly weatherLeft: HTMLElement;
  private readonly whirlChip: HTMLElement;
  private whirlAt = -10;
  private shownWhirl = false;
  private shownWeather: string | null = null;
  private weatherAt = -10;
  private flashText = '';
  private flashAt = -10;
  // The dust total as drawn: it rises toward the real total over a few frames instead of jumping.
  private shownDust: number | null = null;
  private lastFrame: number | null = null;
  private time = 0;
  private lastStrike = -10;
  private streak = 0;
  private pulseAt = -10;
  private shownTotal = '';
  private goalProgress = -1;
  private anchor = { x: 0, y: 0 };

  constructor(
    stage: HTMLElement,
    private readonly config: SimConfig,
    private readonly strings: Strings,
    private readonly calm: boolean,
  ) {
    const hud = div('hud', stage);
    hud.id = 'hud';
    hud.setAttribute('aria-hidden', 'true');
    const totals = div('hud-totals', hud);
    this.total = div('hud-total', totals);
    div('hud-unit', totals).textContent = strings.labels.dust;
    this.rate = div('hud-rate', totals);
    this.goal = div('hud-goal', hud);
    const goalRow = div('hud-goal-row', this.goal);
    const goalLabel = div('hud-goal-label', goalRow);
    this.goalLabel = goalLabel;
    goalLabel.textContent = strings.labels.nextGoal;
    this.goalName = div('hud-goal-name', goalRow);
    const track = div('hud-goal-track', this.goal);
    this.goalFill = div('hud-goal-fill', track);
    this.goalLeft = div('hud-goal-left', this.goal);
    // Under the HUD, outside its height so nothing here reframes the island: the first steps (or a
    // refused purchase's reason) at the left, the weather at the right.
    const below = div('hud-below', hud);
    this.hint = div('hud-hint', below);
    this.hint.style.opacity = '0';
    this.weatherChip = div('hud-weather', below);
    this.weatherIcon = div('hud-weather-icon', this.weatherChip);
    const weatherWords = div('hud-weather-words', this.weatherChip);
    this.weatherName = div('hud-weather-name', weatherWords);
    this.weatherEffect = div('hud-weather-effect', weatherWords);
    this.weatherLeft = div('hud-weather-left', this.weatherChip);
    this.weatherChip.style.opacity = '0';

    const fx = div('fx', stage);
    fx.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < FLOATERS; i += 1) {
      const node = div('floater', fx);
      node.style.opacity = '0';
      this.floaterNodes.push({ node, born: -10, x: 0, y: 0, drift: 0, big: false });
    }
    this.streakNode = div('streak', fx);
    this.streakNode.style.opacity = '0';
    // The whirl a caught dust devil leaves (strikes multiplied for a few seconds), left of the pile
    // as the streak is right of it.
    this.whirlChip = div('hud-whirl', fx);
    this.whirlChip.style.opacity = '0';
    this.bannerNode = div('banner', fx);
    this.bannerKicker = div('banner-kicker', this.bannerNode);
    this.bannerTitle = div('banner-title', this.bannerNode);
    this.bannerBody = div('banner-body', this.bannerNode);
    this.bannerNode.style.opacity = '0';
  }

  /** Where the banner hangs: the centre of the open part of the stage, just under the HUD. */
  placeBanner(x: number, y: number): void {
    this.bannerNode.style.setProperty('--banner-x', `${Math.round(x)}px`);
    this.bannerNode.style.setProperty('--banner-y', `${Math.round(y)}px`);
  }

  /** Where floaters rise from: the top of the pile on screen, from render/scene.ts. */
  setAnchor(x: number, y: number): void {
    this.anchor = { x, y };
  }

  /** A strike landed; returns the streak it makes, which the scene uses to throw more dust. */
  strike(gain: number): number {
    this.streak = this.time - this.lastStrike < STREAK_GAP ? this.streak + 1 : 1;
    this.lastStrike = this.time;
    if (!(gain > 0)) return this.streak;
    const slot = this.floaterNodes.reduce((oldest, f) => (f.born < oldest.born ? f : oldest));
    slot.born = this.time;
    slot.x = this.anchor.x;
    slot.y = this.anchor.y;
    // Alternate sides so a fast streak fans out instead of stacking.
    slot.drift = ((this.streak % 5) - 2) * 14;
    slot.big = this.streak >= 5;
    slot.node.textContent = `+${formatDust(gain)}`;
    slot.node.classList.toggle('big', slot.big);
    return this.streak;
  }

  bought(): void {
    this.pulseAt = this.time;
  }

  unlocked(rows: readonly UnlockRow[]): void {
    for (const row of rows) {
      this.queue.push({
        born: 0,
        until: 0,
        // A fork asks for a choice rather than announcing a gain.
        kicker: row.effect.type === 'fork' ? this.strings.depth.forkKicker : this.strings.labels.unlockedTitle,
        title: row.name,
        body: describeEffect(row, this.config, this.strings),
        tone: row.effect.type === 'fork' ? 'fork' : 'unlock',
      });
    }
  }

  /** A dust devil was caught: the rare event's beat, first in the queue. */
  caught(title: string, body: string): void {
    this.pulseAt = this.time;
    this.queue.unshift({ born: 0, until: 0, kicker: this.strings.depth.devilKicker, title, body, tone: 'devil' });
    if (this.banner !== null && this.banner.tone !== 'devil') this.banner.until = Math.min(this.banner.until, this.time);
  }

  /** An order was filled: the total pulses and a short line says what it paid. */
  filled(text: string): void {
    this.pulseAt = this.time;
    this.flash(text);
  }

  welcome(gain: number, seconds: number): void {
    this.queue.unshift({
      born: 0,
      until: 0,
      kicker: this.strings.labels.welcomeTitle,
      title: fill(this.strings.labels.dustGain, { amount: formatDust(gain) }),
      body: fill(this.strings.labels.awayFor, { time: formatDuration(seconds) }),
      tone: 'welcome',
    });
  }

  /** A unit passed a milestone. */
  milestone(title: string, body: string): void {
    this.pulseAt = this.time;
    this.queue.push({ born: 0, until: 0, kicker: this.strings.depth.milestoneKicker, title, body, tone: 'milestone' });
  }

  /** The pile was pressed: a new season's banner goes first, and the count snaps to the new total. */
  pressed(title: string, body: string): void {
    this.queue.length = 0;
    this.banner = null;
    this.shownDust = null;
    this.queue.push({ born: 0, until: 0, kicker: this.strings.depth.pressedKicker, title, body, tone: 'season' });
  }

  /** A short line under the totals, such as why a purchase was refused. */
  flash(text: string): void {
    this.flashText = text;
    this.flashAt = this.time;
  }

  frame(ms: number, state: SimState): void {
    this.time = ms / 1000;
    const t = this.time;
    const dt = this.lastFrame === null ? 0 : Math.max(0, t - this.lastFrame);
    this.lastFrame = t;

    // Gains count up toward the total; spending (or a new season) drops it at once.
    const target = state.dust;
    if (this.shownDust === null || this.calm || target <= this.shownDust) this.shownDust = target;
    else {
      this.shownDust += (target - this.shownDust) * Math.min(1, dt * 12);
      if (target - this.shownDust < Math.max(0.5, target * 1e-6)) this.shownDust = target;
    }
    const total = formatDust(this.shownDust);
    if (total !== this.shownTotal) {
      this.shownTotal = total;
      this.total.textContent = total;
    }
    const pulseK = (t - this.pulseAt) / 0.3;
    const pulse = !this.calm && pulseK >= 0 && pulseK < 1 ? 1 + Math.sin(pulseK * Math.PI) * 0.08 : 1;
    this.total.style.transform = pulse === 1 ? '' : `scale(${pulse.toFixed(3)})`;
    setText(this.rate, `${formatRate(ratePerSecond(state, this.config))} ${this.strings.labels.perSecond}`);

    const goal = nextGoal(state, this.config);
    const gem = goal === null ? gemGoal(state, this.config) : null;
    if (gem !== null) {
      // Every unlock is open: the bar runs to the next gem instead, so there is always a goal.
      setText(this.goalLabel, this.strings.depth.gemsHeading);
      setText(this.goalName, this.strings.depth.nextGem);
      setText(this.goalLeft, fill(this.strings.labels.toGo, { amount: formatDust(Math.ceil(gem.remaining)) }));
      this.setGoal(gem.progress);
    } else if (goal === null) {
      setText(this.goalLabel, this.strings.labels.nextGoal);
      setText(this.goalName, this.strings.labels.allUnlocked);
      setText(this.goalLeft, '');
      this.setGoal(1);
    } else {
      setText(this.goalLabel, this.strings.labels.nextGoal);
      setText(this.goalName, goal.row.name);
      setText(this.goalLeft, fill(this.strings.labels.toGo, { amount: formatDust(Math.ceil(goal.remaining)) }));
      this.setGoal(goal.progress);
    }

    for (const f of this.floaterNodes) {
      const k = (t - f.born) / FLOAT_SECONDS;
      if (k < 0 || k >= 1) {
        if (f.node.style.opacity !== '0') f.node.style.opacity = '0';
        continue;
      }
      const rise = this.calm ? 0 : -70 * (1 - (1 - k) * (1 - k));
      const pop = this.calm ? 1 : k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15) * 0.5);
      const x = f.x + (this.calm ? 0 : f.drift * k);
      f.node.style.transform = `translate(${x.toFixed(1)}px, ${(f.y + rise).toFixed(1)}px) translate(-50%, -100%) scale(${pop.toFixed(3)})`;
      f.node.style.opacity = (k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1).toFixed(3);
    }

    // The streak shows from three strikes in a row and fades once they stop.
    const idle = t - this.lastStrike;
    const showStreak = this.streak >= 3 && idle < 1.1;
    if (showStreak) {
      setText(this.streakNode, `${this.strings.labels.streak} ×${this.streak}`);
      const k = Math.min(1, idle / 0.18);
      const s = this.calm ? 1 : 1.25 - 0.25 * k;
      this.streakNode.style.transform = `translate(${(this.anchor.x + 44).toFixed(1)}px, ${(this.anchor.y - 24).toFixed(1)}px) rotate(-6deg) scale(${s.toFixed(3)})`;
      this.streakNode.style.opacity = idle > 0.8 ? (1 - (idle - 0.8) / 0.3).toFixed(3) : '1';
    } else if (this.streakNode.style.opacity !== '0') {
      this.streakNode.style.opacity = '0';
    }

    this.drawHint(t, state);
    this.drawWeather(t, state);
    this.drawWhirl(t, state);
    this.drawBanner(t);
  }

  private drawHint(t: number, state: SimState): void {
    const flashing = t - this.flashAt < FLASH_SECONDS && this.flashText !== '';
    const text = flashing ? this.flashText : firstStep(state, this.config, this.strings);
    if (text === null) {
      if (this.hint.style.opacity !== '0') this.hint.style.opacity = '0';
      return;
    }
    setText(this.hint, text);
    this.hint.classList.toggle('flash', flashing);
    const fade = flashing ? Math.min(1, (FLASH_SECONDS - (t - this.flashAt)) / 0.3) : 1;
    // The first step breathes gently so the eye finds it; under reduced motion it stays still.
    const breathe = this.calm || flashing ? 1 : 1 + Math.sin(t * 3.2) * 0.03;
    this.hint.style.opacity = fade.toFixed(3);
    this.hint.style.transform = `scale(${breathe.toFixed(3)})`;
  }

  private drawWeather(t: number, state: SimState): void {
    const view = weatherView(state, this.config, this.strings);
    const id = view?.kind.id ?? null;
    if (id !== this.shownWeather) {
      this.shownWeather = id;
      this.weatherAt = t;
      if (view !== null) {
        this.weatherIcon.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">${WEATHER_GLYPHS[view.kind.id] ?? WEATHER_GLYPH_DEFAULT}</svg>`;
        setText(this.weatherName, view.kind.name);
        setText(this.weatherEffect, view.effect);
        this.weatherChip.dataset['kind'] = view.kind.id;
      }
    }
    if (view === null) {
      if (this.weatherChip.style.opacity !== '0') this.weatherChip.style.opacity = '0';
      return;
    }
    setText(this.weatherLeft, fill(this.strings.depth.weatherLeft, { seconds: String(view.secondsLeft) }));
    const k = Math.min(1, (t - this.weatherAt) / 0.45);
    const s = this.calm ? 1 : 0.6 + 0.4 * easeOutBack(k);
    this.weatherChip.style.opacity = this.calm ? '1' : Math.min(1, k * 3).toFixed(3);
    this.weatherChip.style.transform = `scale(${s.toFixed(3)})`;
  }

  private drawWhirl(t: number, state: SimState): void {
    const view = whirlView(state, this.config, this.strings);
    const on = view !== null;
    if (on !== this.shownWhirl) {
      this.shownWhirl = on;
      this.whirlAt = t;
    }
    if (view === null) {
      if (this.whirlChip.style.opacity !== '0') this.whirlChip.style.opacity = '0';
      return;
    }
    setText(this.whirlChip, `${this.strings.depth.whirl}: ${view.effect} · ${fill(this.strings.depth.weatherLeft, { seconds: String(view.secondsLeft) })}`);
    const k = Math.min(1, (t - this.whirlAt) / 0.4);
    const wobble = this.calm ? 0 : Math.sin(t * 9) * 3 * (1 - k * 0.6);
    this.whirlChip.style.opacity = this.calm ? '1' : Math.min(1, k * 3).toFixed(3);
    const s = this.calm ? 1 : 0.6 + 0.4 * easeOutBack(k);
    this.whirlChip.style.transform = `translate(${(this.anchor.x - 30).toFixed(1)}px, ${(this.anchor.y - 24).toFixed(1)}px) translate(-100%, 0) rotate(${(6 + wobble).toFixed(2)}deg) scale(${s.toFixed(3)})`;
  }

  private setGoal(progress: number): void {
    const p = Math.round(progress * 1000) / 1000;
    if (p === this.goalProgress) return;
    this.goalProgress = p;
    this.goalFill.style.transform = `scaleX(${p})`;
  }

  private drawBanner(t: number): void {
    if ((this.banner === null || t >= this.banner.until) && this.queue.length > 0) {
      const next = this.queue.shift()!;
      const long = next.tone === 'welcome' || next.tone === 'season';
      next.born = t;
      next.until = t + (long ? WELCOME_SECONDS : BANNER_SECONDS);
      this.banner = next;
      this.bannerKicker.textContent = next.kicker;
      this.bannerTitle.textContent = next.title;
      this.bannerBody.textContent = next.body;
      for (const tone of ['welcome', 'milestone', 'season', 'fork', 'devil'] as const) this.bannerNode.classList.toggle(tone, next.tone === tone);
    }
    const banner = this.banner;
    if (banner === null) return;
    const age = t - banner.born;
    const left = banner.until - t;
    if (left <= 0) {
      this.banner = null;
      this.bannerNode.style.opacity = '0';
      return;
    }
    const enter = this.calm ? 1 : easeOutBack(Math.min(1, age / 0.45));
    const exit = Math.min(1, left / 0.35);
    this.bannerNode.style.opacity = (Math.min(1, age / 0.12) * exit).toFixed(3);
    this.bannerNode.style.transform = `translate(-50%, 0) scale(${(0.6 + 0.4 * enter).toFixed(3)}) rotate(${this.calm ? 0 : ((1 - enter) * -4).toFixed(2)}deg)`;
  }
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}
