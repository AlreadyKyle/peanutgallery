import Phaser from 'phaser';
import { awaySeconds, parseSavedAt, parseSavedState } from '../sim/save';
import { createSim, step } from '../sim/sim';
import type { SimState } from '../sim/types';
import { AccessibleControls } from './controls';
import { loadGameData } from './load';
import { DustScene, RENDER_SCALE, SAVE_KEY, SCREEN_HEIGHT, SCREEN_WIDTH } from './scene';

const LOAD_FAILED = 'The game data did not load. Reload the page to try again.';

function statusElement(): HTMLElement | null {
  return document.getElementById('status');
}

// Storage errors (a disabled or unavailable store) leave the save unread, so
// the game starts fresh rather than throwing before it can render.
function readSave(): { state: SimState; savedAt: number | null } | null {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (raw === null) return null;
    const state = parseSavedState(raw);
    return state === null ? null : { state, savedAt: parseSavedAt(raw) };
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
      // A save credits the time since it was written, so dust keeps accruing while the page is closed.
      const save = readSave();
      const savedState =
        save === null
          ? null
          : save.savedAt === null
            ? save.state
            : step(save.state, data.config, awaySeconds(save.savedAt, Date.now()));
      const initial = savedState ?? createSim(data.config, seed);
      const controlsRoot = document.getElementById('controls');
      const controls = controlsRoot === null ? null : new AccessibleControls(controlsRoot, data.config, data.strings, initial);
      const scene = new DustScene(data, seed, initial, (state) => controls?.update(state));
      controls?.attach(scene);
      new Phaser.Game({
        type: Phaser.AUTO,
        parent: 'game',
        width: SCREEN_WIDTH * RENDER_SCALE,
        height: SCREEN_HEIGHT * RENDER_SCALE,
        backgroundColor: '#12161c',
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [scene],
      });
    })
    .catch((error: unknown) => {
      const status = statusElement();
      if (status !== null) status.textContent = LOAD_FAILED;
      console.error(error);
    });
}

start();
