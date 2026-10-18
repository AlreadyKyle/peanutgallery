// Share your run: a button under the canvas that hands the player's numbers to the phone's share
// sheet, or copies them where there is none. The text states the run's facts and the game's address,
// nothing else; the player chooses where it goes.
import type { SimConfig, SimState } from '../sim/types';
import { fill, formatDust } from './format';
import { countEvent } from './count';
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

export interface ShareNavigator {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText(text: string): Promise<void> };
}

/** What one press shares: the sheet's title, text and link, the clipboard's text, the picture and the two answers. */
export interface ShareRequest {
  title: string;
  text: string;
  url: string;
  /** What the clipboard gets where there is no share sheet: the text with its link. */
  copyText: string;
  /** The picture, made only where the sheet takes files; null or a throw sends the text alone. */
  image: () => File | null;
  copied: string;
  failed: string;
}

/**
 * The share sheet first, the clipboard second, a plain message when neither works. Called inside the
 * click, and synchronous up to the sheet, since Safari opens it only there. A dismissed share sheet
 * rejects with AbortError; that is the player's choice, so it says nothing. Any other rejection (no
 * permission, data refused) falls back to the clipboard. Share your run and Daily Dust both use it.
 */
export function shareOrCopy(request: ShareRequest, status: HTMLElement, nav: ShareNavigator): void {
  const done = (message: string): void => {
    status.textContent = message;
  };
  const copy = (): void => {
    if (nav.clipboard === undefined) {
      done(request.failed);
      return;
    }
    nav.clipboard.writeText(request.copyText).then(
      () => done(request.copied),
      () => done(request.failed),
    );
  };
  const sheet = (data: ShareData): Promise<void> =>
    nav.share!(data).catch((error: unknown) => {
      if ((error as { name?: unknown } | null)?.name !== 'AbortError') copy();
    });
  if (typeof nav.share !== 'function') {
    copy();
    return;
  }
  const data: ShareData = { title: request.title, text: request.text, url: request.url };
  if (typeof nav.canShare !== 'function') {
    void sheet(data);
    return;
  }
  // The picture goes with the text where the share sheet takes files.
  let file: File | null = null;
  try {
    file = request.image();
  } catch {
    file = null;
  }
  void sheet(file !== null && nav.canShare({ files: [file] }) ? { ...data, files: [file] } : data);
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
    // One press counted, with nothing that names the player (docs/specs/play-counts.md).
    countEvent('dust_share');
    const state = current();
    const text = shareText(state, config, strings);
    shareOrCopy(
      {
        title: strings.title,
        text,
        url: GAME_URL,
        copyText: `${text} ${GAME_URL}`,
        image: () => makeImage(runFacts(state, config, strings, GAME_URL)),
        copied: strings.share.copied,
        failed: strings.share.failed,
      },
      status,
      nav,
    );
  });
}
