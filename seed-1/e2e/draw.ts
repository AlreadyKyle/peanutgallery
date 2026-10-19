import type { Browser } from '@playwright/test';

// One deterministic draw of the game, shared by e2e/frames.spec.ts (the gate's frames) and
// scripts/capture.ts (before and after pictures for posts). It is not a spec, so Playwright does not
// run it on its own; it imports nothing but Playwright's types.
export const START = Date.parse('2026-01-01T12:00:00Z');
const RUN_MS = 3_000;
// The page clock's tick (its performance.now()) the game's first frame runs at in every draw.
const FIRST_FRAME_TICK = 1_000;
// One frame of the page clock's animation-frame grid: the clock must have paused at least this far
// before the first frame's tick, so the jump to it lands on the grid.
const STEP_MS = 17;

export interface Drawn {
  canvas: Buffer;
  page: Buffer;
  frames: number;
  refused: string[];
}

// One draw in a fresh browser context: the save in local storage, a paused page clock, the page
// loaded, the canvas awaited, the game loop awaited, the font awaited, then 3 seconds of game time.
// The Three.js scene (render/scene.ts) and the HUD (render/hud.ts) move only by the frame clock the
// page clock drives and by a fixed hash, never Math.random or a CSS animation, so the same frames
// draw the same pixels. The game starts its loop once its data has loaded, which takes real time, so
// the clock runs only after the page has asked for its first animation frame: otherwise a slow load
// would start the loop partway through the 3 seconds and the game would draw a frame's worth less.
// The bundled font loads in real time too, and it changes the HUD's size, which reframes the scene,
// so the clock waits for it. The frame count is read by a wrapper around the page clock's own
// requestAnimationFrame; the game sees no change.
export async function draw(browser: Browser, baseURL: string, saveKey: string, save: string, viewport: { width: number; height: number }): Promise<Drawn> {
  const context = await browser.newContext({ baseURL, viewport });
  const page = await context.newPage();
  const origin = new URL(baseURL).origin;
  const refused: string[] = [];
  await page.route(
    (url) => url.origin !== origin,
    async (route) => {
      refused.push(route.request().url());
      await route.abort('blockedbyclient');
    },
  );
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [saveKey, save] as const);
  await page.clock.install({ time: START });
  await page.clock.pauseAt(START + 1_000);
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    const counted = window as unknown as { framesRequested: number };
    counted.framesRequested = 0;
    window.requestAnimationFrame = (callback) => {
      counted.framesRequested += 1;
      return request(callback);
    };
  });
  await page.goto('/');
  const canvas = page.locator('#game canvas');
  await canvas.waitFor();
  await page.waitForFunction(() => (window as unknown as { framesRequested: number }).framesRequested > 0);
  await page.evaluate(async () => {
    await document.fonts.load('700 16px "Atkinson Hyperlegible Next"');
    await document.fonts.ready;
  });
  // The page clock paused with its tick count (its performance.now(), which the game's loop and the
  // clock's animation frames run on) at the real milliseconds between the two clock calls above, a
  // different few each draw. The clock runs animation frames on a 16 ms
  // grid of ticks, so a jump of a fixed time put each draw at a different place on the grid: a draw
  // ran a frame more or fewer, with different gaps, and the game drew a different amount of dust
  // (docs/specs/frames-determinism.md). The jump goes to a fixed tick instead, so every draw runs the
  // same frames at the same ticks.
  const paused = await page.evaluate(() => ({ ticks: performance.now(), now: Date.now() }));
  if (paused.ticks > FIRST_FRAME_TICK - STEP_MS) {
    throw new Error(`the page clock paused at tick ${paused.ticks}, past ${FIRST_FRAME_TICK - STEP_MS}`);
  }
  await page.clock.pauseAt(paused.now + FIRST_FRAME_TICK - paused.ticks);
  await page.clock.runFor(RUN_MS);
  const frames = await page.evaluate(() => (window as unknown as { framesRequested: number }).framesRequested);
  const drawn = { canvas: await canvas.screenshot(), page: await page.screenshot({ fullPage: true }), frames, refused };
  await context.close();
  return drawn;
}
