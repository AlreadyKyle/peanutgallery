import Phaser from 'phaser';
import { parseSavedState } from '../sim/save';
import type { SimState } from '../sim/types';
import { loadGameData } from './load';
import { DustScene, RENDER_SCALE, SAVE_KEY, SCREEN_HEIGHT, SCREEN_WIDTH } from './scene';

const LOAD_FAILED = 'The game data did not load. Reload the page to try again.';

function statusElement(): HTMLElement | null {
  return document.getElementById('status');
}

// Storage errors (a disabled or unavailable store) leave the save unread, so
// the game starts fresh rather than throwing before it can render.
function readSavedState(): SimState | null {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw === null ? null : parseSavedState(raw);
  } catch {
    return null;
  }
}

function start(): void {
  loadGameData()
    .then((data) => {
      document.title = data.strings.tabTitle;
      statusElement()?.remove();
      // The play seed is the wall-clock second the page opened, so strikes
      // roll differently per visit while the bot keeps its fixed seed.
      const seed = Math.floor(Date.now() / 1000) >>> 0;
      const savedState = readSavedState();
      new Phaser.Game({
        type: Phaser.AUTO,
        parent: 'game',
        width: SCREEN_WIDTH * RENDER_SCALE,
        height: SCREEN_HEIGHT * RENDER_SCALE,
        backgroundColor: '#12161c',
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [new DustScene(data, seed, savedState)],
      });
    })
    .catch((error: unknown) => {
      const status = statusElement();
      if (status !== null) status.textContent = LOAD_FAILED;
      console.error(error);
    });
}

start();
