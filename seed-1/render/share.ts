// Share your run: a button under the canvas that hands the player's numbers to the phone's share
// sheet, or copies them where there is none. The text states the run's facts and the game's address,
// nothing else; the player chooses where it goes.
import type { SimConfig, SimState } from '../sim/types';
import { fill, formatDust } from './format';
import { runCardFile, runFacts } from './share-image';
import type { Strings } from './strings';

export const GAME_URL = 'https://play.mobmachine.games/';

export function shareText(state: SimState, config: SimConfig, strings: Strings): string {
  return fill(strings.share.text, {
    dust: formatDust(state.totalDust),
    unlocked: String(state.unlocked.length),
    total: String(config.unlocks.unlocks.length),
  });
}

interface ShareData {
  title?: string;
  text?: string;
  url?: string;
  files?: File[];
}

interface ShareNavigator {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
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
  makeImage: (facts: ReturnType<typeof runFacts>) => File | null = (facts) => runCardFile(facts),
): void {
  button.textContent = strings.share.button;
  // Its space is reserved from first paint (visibility, not hidden), so showing it never resizes the canvas.
  button.style.visibility = 'visible';
  button.addEventListener('click', () => {
    const state = current();
    const text = shareText(state, config, strings);
    const done = (message: string): void => {
      status.textContent = message;
    };
    const copy = (): void => {
      if (nav.clipboard === undefined) {
        done(strings.share.failed);
        return;
      }
      nav.clipboard.writeText(`${text} ${GAME_URL}`).then(
        () => done(strings.share.copied),
        () => done(strings.share.failed),
      );
    };
    // A dismissed share sheet rejects with AbortError; that is the player's choice, so it says nothing.
    // Any other rejection (no permission, data refused) falls back to the clipboard.
    const sheet = (data: ShareData): Promise<void> =>
      nav.share!(data).catch((error: unknown) => {
        if ((error as { name?: unknown } | null)?.name !== 'AbortError') copy();
      });
    if (typeof nav.share !== 'function') {
      copy();
      return;
    }
    const data: ShareData = { title: strings.title, text, url: GAME_URL };
    if (typeof nav.canShare !== 'function') {
      void sheet(data);
      return;
    }
    // The picture of the run goes with the text where the share sheet takes files.
    let file: File | null = null;
    try {
      file = makeImage(runFacts(state, config, strings, GAME_URL));
    } catch {
      file = null;
    }
    void sheet(file !== null && nav.canShare({ files: [file] }) ? { ...data, files: [file] } : data);
  });
}
