// Daily Dust in the page (docs/specs/daily-dust.md): the "Today's run" link in the share row, and the
// run a ?daily= link opens. A daily run keeps its record under DAILY_KEY and nothing else: the Game it
// drives has no store, so it can never write the main save (render/main.ts builds it), and the link
// back to the player's own game is a plain link. The footer line says how much of the run is played
// (time played, never a countdown); at the end the result opens in a dialog, with the card drawn in
// code and the text to share. The Three-free half is render/daily.ts.
import { DAILY_SECONDS, dailyScore, utcDate } from '../sim/daily';
import type { SimConfig } from '../sim/types';
import { countEvent } from './count';
import { drawDailyCard, dailyCardFile, dailyFacts } from './daily-card';
import {
  DAILY_KEY,
  DAILY_PARAM,
  dailyCopyText,
  dailyFinished,
  dailyHighlights,
  dailyLink,
  dailyResult,
  dailyRowWords,
  dailyScoreLine,
  dailyText,
  formatClock,
  formatDailyDate,
  saveDaily,
  type DailyRecord,
} from './daily';
import { fill } from './format';
import type { Game } from './game';
import { shareOrCopy, type ShareNavigator } from './share';
import type { Strings } from './strings';

type DailyStore = Pick<Storage, 'setItem' | 'removeItem'>;

/**
 * Adds "Today's run" after `after` in the share row: a link to ?daily=<today, UTC>. The date is read
 * when the link is about to be followed, so a page left open past midnight opens the new day's run.
 */
export function attachDailyEntry(after: HTMLElement, strings: Strings, now: () => number = Date.now): HTMLAnchorElement {
  const link = document.createElement('a');
  link.id = 'daily-entry';
  link.className = 'daily-link';
  link.textContent = strings.daily.entry;
  link.setAttribute('aria-label', strings.daily.entryLabel);
  const refresh = (): void => {
    link.href = `?${DAILY_PARAM}=${utcDate(now())}`;
  };
  refresh();
  for (const event of ['pointerenter', 'pointerdown', 'focus', 'click', 'contextmenu']) link.addEventListener(event, refresh);
  after.insertAdjacentElement('afterend', link);
  return link;
}

export interface DailyElements {
  footer: HTMLElement;
  shareRow: HTMLElement;
}

export interface DailyRunOptions {
  /** The record as it stood when the page opened (fresh for a day not started). */
  record: DailyRecord;
  game: Game;
  config: SimConfig;
  strings: Strings;
  store: DailyStore | null;
  /** Play the same day again: called after the record is cleared. */
  restart: () => void;
  /** The run reached its end: its score. */
  onEnd?: (score: number) => void;
  nav?: ShareNavigator;
}

const SAVE_EVERY_MS = 5000;

/** The page during a daily run: the footer line, the record kept, the counts, and the result at the end. */
export class DailyRun {
  private record: DailyRecord;
  private readonly line: HTMLElement;
  private readonly words: HTMLElement;
  private readonly fillBar: HTMLElement;
  private readonly resultButton: HTMLButtonElement;
  private dialog: HTMLDialogElement | null = null;
  private shownWords = '';
  private stopped = false;

  constructor(
    elements: DailyElements,
    private readonly options: DailyRunOptions,
  ) {
    const { strings, game } = options;
    this.record = options.record;
    const { footer, shareRow } = elements;
    // The share row carries the run's own links instead of Share your run and Save as seed, which
    // belong to the player's own game.
    for (const child of Array.from(shareRow.children)) (child as HTMLElement).hidden = true;
    this.resultButton = document.createElement('button');
    this.resultButton.type = 'button';
    this.resultButton.id = 'daily-see';
    this.resultButton.textContent = strings.daily.seeResult;
    this.resultButton.hidden = true;
    this.resultButton.addEventListener('click', () => this.showResult());
    const back = document.createElement('a');
    back.id = 'daily-back';
    back.className = 'daily-link';
    back.href = './';
    back.textContent = strings.daily.back;
    shareRow.append(this.resultButton, back);

    this.line = document.createElement('p');
    this.line.id = 'daily-line';
    this.words = document.createElement('span');
    this.words.id = 'daily-words';
    const track = document.createElement('span');
    track.className = 'daily-track';
    track.setAttribute('aria-hidden', 'true');
    this.fillBar = document.createElement('span');
    this.fillBar.id = 'daily-fill';
    track.append(this.fillBar);
    this.line.append(this.words, track);
    footer.insertBefore(this.line, footer.firstChild);

    game.listen({
      began: () => {
        // A run counts as started at its first action from the very beginning, not on a resume.
        if (this.record.marks.length === 0 && this.record.state.elapsedSeconds === 0) countEvent('dust_daily_start');
      },
      mark: (index, state) => {
        // The lifetime dust at each half minute; a mark missed (none should be) takes this one's.
        const score = dailyScore(state);
        const marks = this.record.marks.slice(0, index - 1);
        while (marks.length < index - 1) marks.push(score);
        marks.push(score);
        this.record = { ...this.record, marks, state };
      },
      caught: (_gain, state) => {
        this.record = { ...this.record, caught: this.record.caught + 1, state };
        this.save();
      },
      ended: (state) => {
        this.record = { ...this.record, state };
        this.save();
        countEvent('dust_daily_finish');
        this.ended();
        options.onEnd?.(dailyScore(state));
        // A short beat on the island before the result opens over it.
        window.setTimeout(() => this.showResult(), 900);
      },
    });
    window.setInterval(() => this.save(), SAVE_EVERY_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save();
    });
    window.addEventListener('pagehide', () => this.save());
    this.update();
    if (dailyFinished(this.record)) {
      this.ended();
      this.showResult();
    }
  }

  /** Writes the record under DAILY_KEY. Storage errors are swallowed so the run goes on without one. */
  save(): void {
    if (this.stopped) return;
    saveDaily(this.options.store, { ...this.record, state: this.options.game.state });
  }

  /** The footer line, from the game's state: called each frame, it touches the DOM only on a change. */
  update(): void {
    const { game, strings } = this.options;
    const state = game.state;
    const date = formatDailyDate(this.record.date);
    let words: string;
    if (game.over) words = fill(strings.daily.over, { date });
    else if (game.idle && state.elapsedSeconds === 0) words = fill(strings.daily.waiting, { date });
    else words = fill(strings.daily.playing, { date, played: formatClock(state.elapsedSeconds), length: formatClock(DAILY_SECONDS) });
    if (words === this.shownWords) return;
    this.shownWords = words;
    this.words.textContent = words;
    this.fillBar.style.width = `${Math.min(100, (state.elapsedSeconds / DAILY_SECONDS) * 100).toFixed(1)}%`;
  }

  private ended(): void {
    this.resultButton.hidden = false;
    this.update();
  }

  /** Opens the result dialog, building it the first time. */
  showResult(): void {
    const dialog = this.dialog ?? this.buildResult();
    this.dialog = dialog;
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  private buildResult(): HTMLDialogElement {
    const { config, strings, nav } = this.options;
    const result = dailyResult({ ...this.record, state: this.options.game.state }, config);
    const dialog = document.createElement('dialog');
    dialog.id = 'daily-result';
    dialog.setAttribute('aria-labelledby', 'daily-result-title');
    dialog.setAttribute('aria-describedby', 'daily-result-summary');

    const kicker = document.createElement('p');
    kicker.className = 'daily-kicker';
    kicker.setAttribute('aria-hidden', 'true');
    kicker.textContent = strings.daily.kicker;
    const title = document.createElement('h2');
    title.id = 'daily-result-title';
    title.textContent = fill(strings.daily.textTitle, { date: formatDailyDate(result.date) });

    // The card, drawn in code on a canvas the size of the shared picture and scaled to the dialog.
    const card = document.createElement('canvas');
    card.className = 'daily-card';
    card.width = 1200;
    card.height = 630;
    card.setAttribute('aria-hidden', 'true');
    const ctx = card.getContext('2d');
    const facts = dailyFacts(result, strings);
    if (ctx !== null && typeof ctx.roundRect === 'function') drawDailyCard(ctx, facts);

    const summary = document.createElement('p');
    summary.id = 'daily-result-summary';
    summary.className = 'visually-hidden';
    summary.textContent = `${dailyScoreLine(result, strings)}. ${dailyHighlights(result, strings).join(', ')}. ${dailyRowWords(result, strings)}`;

    // The text exactly as it is shared, so the player sees what goes out.
    const text = document.createElement('pre');
    text.className = 'daily-text';
    text.setAttribute('aria-hidden', 'true');
    text.textContent = dailyCopyText(result, strings);

    const status = document.createElement('p');
    status.className = 'daily-result-status';
    status.setAttribute('role', 'status');

    const button = (label: string, id: string, primary = false): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = id;
      b.textContent = label;
      if (primary) b.className = 'primary';
      return b;
    };
    const share = button(strings.daily.share, 'daily-share', true);
    const copy = button(strings.daily.copy, 'daily-copy');
    const again = button(strings.daily.again, 'daily-again');
    const close = button(strings.daily.close, 'daily-close');
    const back = document.createElement('a');
    back.href = './';
    back.textContent = strings.daily.back;
    const navigator_ = nav ?? (navigator as ShareNavigator);
    const request = {
      title: strings.daily.kicker,
      text: dailyText(result, strings),
      url: dailyLink(result.date),
      copyText: dailyCopyText(result, strings),
      image: () => dailyCardFile(facts),
      copied: strings.daily.copied,
      failed: strings.daily.failed,
    };
    share.addEventListener('click', () => {
      countEvent('dust_daily_share');
      shareOrCopy(request, status, navigator_);
    });
    copy.addEventListener('click', () => {
      countEvent('dust_daily_share');
      // The clipboard alone: the share sheet is the other button.
      shareOrCopy(request, status, { clipboard: navigator_.clipboard });
    });
    again.addEventListener('click', () => {
      // Nothing writes the record back on the way out (pagehide), so the day starts over.
      this.stopped = true;
      try {
        this.options.store?.removeItem(DAILY_KEY);
      } catch {
        // A store that refuses keeps the result; the restart replays from the day's seed either way.
      }
      this.options.restart();
    });
    close.addEventListener('click', () => dialog.close());

    const actions = document.createElement('div');
    actions.className = 'daily-actions';
    actions.append(share, copy, again, close, back);
    dialog.append(kicker, title, card, summary, text, actions, status);
    document.body.append(dialog);
    return dialog;
  }
}
