// Seeds in the page (docs/specs/final-state.md, Seeds and instances): the "Save as seed" button beside
// Share your run, and the offer a ?seed= link opens with. Opening a seed never overwrites the player's
// own save on its own: the offer asks, and starting from the seed first copies the player's save to
// BACKUP_KEY. The codes themselves are render/seed-code.ts.
import type { SimConfig, SimState } from '../sim/types';
import { fill, formatDust } from './format';
import { BACKUP_KEY, SAVE_KEY } from './game';
import { encodeSeed, seedLink } from './seed-code';
import type { Strings } from './strings';
import { serializeState } from '../sim/save';

interface SeedNavigator {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  clipboard?: { writeText(text: string): Promise<void> };
}

export function seedShareText(state: SimState, config: SimConfig, strings: Strings): string {
  return fill(strings.seed.text, {
    dust: formatDust(state.totalDust),
    unlocked: String(state.unlocked.length),
    total: String(config.unlocks.unlocks.length),
  });
}

/** Wires Save as seed: the share sheet with the seed link, else the clipboard, else a plain message. */
export function attachSeedButton(
  button: HTMLButtonElement,
  status: HTMLElement,
  current: () => SimState,
  config: SimConfig,
  strings: Strings,
  nav: SeedNavigator = navigator as SeedNavigator,
): void {
  button.textContent = strings.seed.button;
  button.style.visibility = 'visible';
  button.addEventListener('click', () => {
    const state = current();
    const url = seedLink(encodeSeed(state));
    const text = seedShareText(state, config, strings);
    const copy = (): void => {
      if (nav.clipboard === undefined) {
        status.textContent = strings.seed.failed;
        return;
      }
      nav.clipboard.writeText(`${text} ${url}`).then(
        () => (status.textContent = strings.seed.copied),
        () => (status.textContent = strings.seed.failed),
      );
    };
    if (typeof nav.share !== 'function') {
      copy();
      return;
    }
    nav.share({ title: strings.title, text, url }).catch((error: unknown) => {
      if ((error as { name?: unknown } | null)?.name !== 'AbortError') copy();
    });
  });
}

export interface SeedOfferElements {
  dialog: HTMLDialogElement;
  title: HTMLElement;
  body: HTMLElement;
  replace: HTMLElement;
  start: HTMLButtonElement;
  keep: HTMLButtonElement;
}

/**
 * Offers to start from a seed. `own` is the player's saved state, if any. Choosing the seed writes it
 * as the save (the old one kept under BACKUP_KEY) and calls `restart`; keeping calls `dismiss`.
 */
export function offerSeed(
  elements: SeedOfferElements,
  seed: SimState,
  own: SimState | null,
  config: SimConfig,
  strings: Strings,
  store: Pick<Storage, 'getItem' | 'setItem'>,
  restart: () => void,
  dismiss: () => void,
): void {
  const { dialog, title, body, replace, start, keep } = elements;
  title.textContent = strings.seed.offerTitle;
  body.textContent = fill(strings.seed.offerBody, {
    dust: formatDust(seed.totalDust),
    unlocked: String(seed.unlocked.length),
    total: String(config.unlocks.unlocks.length),
  });
  replace.hidden = own === null;
  replace.textContent = own === null ? '' : fill(strings.seed.offerReplace, { dust: formatDust(own.totalDust) });
  start.textContent = strings.seed.start;
  keep.textContent = strings.seed.keep;
  const close = (): void => {
    if (dialog.open) dialog.close();
  };
  start.addEventListener(
    'click',
    () => {
      try {
        const previous = store.getItem(SAVE_KEY);
        if (previous !== null) store.setItem(BACKUP_KEY, previous);
        store.setItem(SAVE_KEY, serializeState(seed));
      } catch {
        // A store that refuses leaves the player's game as it was.
      }
      close();
      restart();
    },
    { once: true },
  );
  keep.addEventListener(
    'click',
    () => {
      close();
      dismiss();
    },
    { once: true },
  );
  dialog.addEventListener('cancel', () => dismiss(), { once: true });
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}
