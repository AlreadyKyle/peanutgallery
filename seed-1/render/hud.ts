// The HUD over the diorama, for the eye only (aria-hidden: render/controls.ts says the same in words):
// the dust total big, the rate, the bar to the next unlock, "+N" floaters off the pile, the strike
// streak, and the banner for an unlock or a welcome back. Every movement is set from the frame clock
// passed to frame(), never a CSS animation, so the gate's frames draw the same pixels twice
// (e2e/frames.spec.ts). Under prefers-reduced-motion floaters fade in place and banners appear still.
import { ratePerSecond } from '../sim/sim';
import type { SimConfig, SimState, UnlockRow } from '../sim/types';
import { describeEffect } from './a11y';
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
}

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
    goalLabel.textContent = strings.labels.nextGoal;
    this.goalName = div('hud-goal-name', goalRow);
    const track = div('hud-goal-track', this.goal);
    this.goalFill = div('hud-goal-fill', track);
    this.goalLeft = div('hud-goal-left', this.goal);

    const fx = div('fx', stage);
    fx.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < FLOATERS; i += 1) {
      const node = div('floater', fx);
      node.style.opacity = '0';
      this.floaterNodes.push({ node, born: -10, x: 0, y: 0, drift: 0, big: false });
    }
    this.streakNode = div('streak', fx);
    this.streakNode.style.opacity = '0';
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
        kicker: this.strings.labels.unlockedTitle,
        title: row.name,
        body: describeEffect(row, this.config, this.strings),
      });
    }
  }

  welcome(gain: number, seconds: number): void {
    this.queue.unshift({
      born: 0,
      until: 0,
      kicker: this.strings.labels.welcomeTitle,
      title: fill(this.strings.labels.dustGain, { amount: formatDust(gain) }),
      body: fill(this.strings.labels.awayFor, { time: formatDuration(seconds) }),
    });
  }

  frame(ms: number, state: SimState): void {
    this.time = ms / 1000;
    const t = this.time;

    const total = formatDust(state.dust);
    if (total !== this.shownTotal) {
      this.shownTotal = total;
      this.total.textContent = total;
    }
    const pulseK = (t - this.pulseAt) / 0.3;
    const pulse = !this.calm && pulseK >= 0 && pulseK < 1 ? 1 + Math.sin(pulseK * Math.PI) * 0.08 : 1;
    this.total.style.transform = pulse === 1 ? '' : `scale(${pulse.toFixed(3)})`;
    setText(this.rate, `${formatRate(ratePerSecond(state, this.config))} ${this.strings.labels.perSecond}`);

    const goal = nextGoal(state, this.config);
    if (goal === null) {
      setText(this.goalName, this.strings.labels.allUnlocked);
      setText(this.goalLeft, '');
      this.setGoal(1);
    } else {
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

    this.drawBanner(t);
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
      const welcome = next.kicker === this.strings.labels.welcomeTitle;
      next.born = t;
      next.until = t + (welcome ? WELCOME_SECONDS : BANNER_SECONDS);
      this.banner = next;
      this.bannerKicker.textContent = next.kicker;
      this.bannerTitle.textContent = next.title;
      this.bannerBody.textContent = next.body;
      this.bannerNode.classList.toggle('welcome', welcome);
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
