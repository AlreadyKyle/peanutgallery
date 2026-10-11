// Share your run: a button under the canvas that hands the player's numbers to the phone's share
// sheet, or copies them where there is none. The text states the run's facts and the game's address,
// nothing else; the player chooses where it goes.
import type { SimConfig, SimState } from '../sim/types';
import { fill, formatDust } from './format';
import type { Strings } from './strings';

export const GAME_URL = 'https://play.mobmachine.games/';

export function shareText(state: SimState, config: SimConfig, strings: Strings): string {
  return fill(strings.share.text, {
    dust: formatDust(state.totalDust),
    unlocked: String(state.unlocked.length),
    total: String(config.unlocks.unlocks.length),
  });
}

interface ShareNavigator {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  clipboard?: { writeText(text: string): Promise<void> };
}

/** Wires the button: the share sheet first, the clipboard second, a plain message when neither works. */
export function attachShare(
  button: HTMLButtonElement,
  status: HTMLElement,
  current: () => SimState,
  config: SimConfig,
  strings: Strings,
  nav: ShareNavigator = navigator as ShareNavigator,
): void {
  button.textContent = strings.share.button;
  button.hidden = false;
  button.addEventListener('click', () => {
    const text = shareText(current(), config, strings);
    const done = (message: string): void => {
      status.textContent = message;
    };
    if (typeof nav.share === 'function') {
      // A dismissed share sheet rejects; that is the player's choice, so it says nothing.
      nav.share({ title: strings.title, text, url: GAME_URL }).catch(() => undefined);
      return;
    }
    if (nav.clipboard !== undefined) {
      nav.clipboard.writeText(`${text} ${GAME_URL}`).then(
        () => done(strings.share.copied),
        () => done(strings.share.failed),
      );
      return;
    }
    done(strings.share.failed);
  });
}
