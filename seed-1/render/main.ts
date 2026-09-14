import Phaser from 'phaser';
import { loadGameData } from './load';
import { DustScene, SCREEN_HEIGHT, SCREEN_WIDTH } from './scene';

const LOAD_FAILED = 'The game data did not load. Reload the page to try again.';

function statusElement(): HTMLElement | null {
  return document.getElementById('status');
}

function start(): void {
  loadGameData()
    .then((data) => {
      document.title = data.strings.title;
      statusElement()?.remove();
      // The play seed is the wall-clock second the page opened, so strikes
      // roll differently per visit while the bot keeps its fixed seed.
      const seed = Math.floor(Date.now() / 1000) >>> 0;
      new Phaser.Game({
        type: Phaser.AUTO,
        parent: 'game',
        width: SCREEN_WIDTH,
        height: SCREEN_HEIGHT,
        backgroundColor: '#12161c',
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [new DustScene(data, seed)],
      });
    })
    .catch((error: unknown) => {
      const status = statusElement();
      if (status !== null) status.textContent = LOAD_FAILED;
      console.error(error);
    });
}

start();
