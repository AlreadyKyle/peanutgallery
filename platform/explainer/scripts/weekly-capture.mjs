// Captures the weekly video's footage from the live site (docs/specs/weekly-video.md), headless, at a
// desktop width: 1280 by 720 CSS pixels at 1.5x, so every frame is 1920 by 1080. Load and look only:
// nothing is submitted, no account is made, no checkout opens, and the site's counters skip an
// automated browser (navigator.webdriver), so these visits count nowhere.
//
//   node scripts/weekly-capture.mjs weekly-captures/2026-10-20 [shot,shot,...]
//
// Videos are DevTools screencast frames re-timed to a 30 fps H.264 file by ffmpeg; stills are PNGs.
// Change CARD, CURATOR and TODAY for the week's own card, agent and date.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const OUT = resolve(process.argv[2]);
const ONLY = process.argv[3]?.split(',');
const SITE = 'https://mobmachine.games';
const DUST = 'https://play.mobmachine.games';
const CARD = 'e1ee4792-abc0-4dc3-95fa-159b82ac38db'; // "Gatherers dig faster", open for funding
const CURATOR = 'ad14d605-43f5-404d-b2dd-a49a1a58abd6';
const TODAY = '2026-10-20';
mkdirSync(OUT, { recursive: true });

const FORMS = {
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 },
};

/** Records the viewport with the DevTools screencast while `act` runs, then writes a 30 fps mp4. */
async function record(page, name, act) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push({ data: f.data, t: f.metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  const vp = page.viewportSize();
  const dpr = await page.evaluate(() => devicePixelRatio);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: vp.width * dpr, maxHeight: vp.height * dpr, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  await act();
  const t1 = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  const dir = join(OUT, `.frames-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const list = [];
  frames.forEach((f, i) => {
    const file = join(dir, `${String(i).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    const next = i + 1 < frames.length ? frames[i + 1].t : Math.max(t1, f.t + 0.04);
    list.push(`file '${file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  list.push(`file '${join(dir, `${String(frames.length - 1).padStart(5, '0')}.jpg`)}'`);
  writeFileSync(join(dir, 'list.txt'), list.join('\n'));
  const out = join(OUT, `${name}.mp4`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  rmSync(dir, { recursive: true, force: true });
  console.log('video', name, frames.length, 'frames', (t1 - t0).toFixed(1) + 's');
}

// Where the UI a beat points at sits in each capture, as fractions of the frame: rects.json, read by
// the video's highlight rings (`ring: "<capture>.<name>"` in a beat).
const RECTS_FILE = join(OUT, 'rects.json');
const RECTS = existsSync(RECTS_FILE) ? JSON.parse(readFileSync(RECTS_FILE, 'utf8')) : {};
async function mark(page, key, locator) {
  const box = await locator.first().boundingBox().catch(() => null);
  if (box === null) {
    console.log('NO rect for', key);
    return;
  }
  const vp = page.viewportSize();
  RECTS[key] = [box.x / vp.width, box.y / vp.height, box.width / vp.width, box.height / vp.height].map((n) => Math.round(n * 10000) / 10000);
}

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('still', name);
}

async function settle(page, ms = 1800) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

/** Scrolls an element to the middle of the viewport, instantly. */
async function centre(page, locator, offset = 0) {
  await locator.first().evaluate((el, off) => {
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + r.top + r.height / 2 - innerHeight / 2 + off, behavior: 'instant' });
  }, offset);
  await page.waitForTimeout(400);
}

async function smoothScroll(page, to, ms) {
  await page.evaluate(
    ([to, ms]) =>
      new Promise((done) => {
        const from = window.scrollY;
        const start = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - start) / ms);
          const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          window.scrollTo(0, from + (to - from) * e);
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      }),
    [to, ms],
  );
}

const SHOTS = {
  async studio(page) {
    await page.goto(`${SITE}/`);
    await settle(page, 2500);
    await mark(page, 'studio.room', page.locator('svg.room[data-variant="live"]'));
    await record(page, 'studio', async () => {
      await page.waitForTimeout(9000);
      // Click the Curator where it stands now, to open its role card.
      const box = await page.locator(`.studio-agent[data-role="${CURATOR}"]`).first().boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
        await page.mouse.down();
        await page.mouse.up();
      } else console.log('NO Curator in the room');
      await page.waitForTimeout(4500);
    });
    await mark(page, 'studio.roleCard', page.locator('.role-card'));
    await shot(page, 'studio-card');
  },

  async team(page) {
    await page.goto(`${SITE}/team`);
    await settle(page, 2000);
    await record(page, 'team', async () => {
      await page.waitForTimeout(1200);
      const to = await page.locator(`#agent-${CURATOR}`).evaluate((el) => window.scrollY + el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 - innerHeight / 2);
      await smoothScroll(page, to, 2500);
      await page.waitForTimeout(2500);
    });
    await mark(page, 'team.curator', page.locator(`#agent-${CURATOR}`));
  },

  async suggest(page) {
    await page.goto(`${SITE}/suggest`);
    await settle(page, 2000);
    await mark(page, 'suggest-top.pitch', page.getByRole('heading', { name: 'Pitch an idea' }).locator('xpath=ancestor::section[1]'));
    await shot(page, 'suggest-top');
    const list = page.getByRole('heading', { name: /All ideas/i });
    const target = (await list.count()) > 0 ? await list.first().evaluate((el) => window.scrollY + el.getBoundingClientRect().top - 100) : 700;
    await record(page, 'suggest', async () => {
      await page.waitForTimeout(1500);
      await smoothScroll(page, target, 3000);
      await page.waitForTimeout(2000);
    });
    await mark(page, 'suggest-list.how', page.getByRole('heading', { name: /What happens to an idea/i }).locator('xpath=following::ol[1]'));
    await shot(page, 'suggest-list');
  },

  async accounts(page) {
    await page.goto(`${SITE}/sign-up`);
    await settle(page);
    await centre(page, page.locator('main form'), 0);
    await mark(page, 'sign-up.form', page.locator('main form').first());
    await shot(page, 'sign-up');
    await page.goto(`${SITE}/sign-in`);
    await settle(page);
    await shot(page, 'sign-in');
    // A placeholder address typed for the shot, never submitted; the password field stays empty.
    const email = page.getByLabel(/email/i).first();
    await record(page, 'sign-in-type', async () => {
      await page.waitForTimeout(800);
      await email.click();
      await page.keyboard.type('you@example.com', { delay: 90 });
      await page.waitForTimeout(1500);
    });
    await shot(page, 'sign-in-typed');
    await page.goto(`${SITE}/forgot-password`);
    await settle(page);
    await mark(page, 'forgot.form', page.locator('main form').first());
    await shot(page, 'forgot');
    await page.goto(`${SITE}/me`);
    await settle(page);
    await centre(page, page.locator('main form'), 0);
    await mark(page, 'me.form', page.locator('main form').first());
    await shot(page, 'me');
  },

  async card(page) {
    await page.goto(`${SITE}/card/${CARD}`);
    await settle(page, 2000);
    await shot(page, 'card-top');
    const follow = page.getByRole('button', { name: /Tell me when this ships/i });
    if ((await follow.count()) === 0) {
      console.log('NO follow button on the card page');
      return;
    }
    await centre(page, follow, -80);
    await mark(page, 'card-follow.button', follow);
    await shot(page, 'card-follow');
  },

  async machine(page) {
    // The Machine card's presets: pressing one only changes the button and its link; nothing opens.
    await page.goto(`${SITE}/contribute`);
    await settle(page, 2000);
    const preset = page.getByRole('radio', { name: '$10', exact: true }).or(page.getByRole('button', { name: '$10', exact: true }));
    if ((await preset.count()) === 0) {
      console.log('NO $10 preset on /contribute');
      return;
    }
    await centre(page, preset, 0);
    await preset.first().click();
    await page.waitForTimeout(600);
    await mark(page, 'machine.presets', preset.first().locator('xpath=..'));
    await shot(page, 'machine');
  },

  async dust(page) {
    await page.goto(`${DUST}/`);
    await settle(page, 2500);
    const strike = page.getByRole('button', { name: /^Strike/i }).first();
    const gatherer = page.getByRole('button', { name: /Gatherer/i }).first();
    await record(page, 'dust', async () => {
      await page.waitForTimeout(600);
      for (let round = 0; round < 3; round += 1) {
        for (let i = 0; i < 9; i += 1) {
          await strike.click().catch(() => {});
          await page.waitForTimeout(170);
        }
        if (await gatherer.isEnabled().catch(() => false)) await gatherer.click().catch(() => {});
        await page.waitForTimeout(500);
      }
      await page.waitForTimeout(1500);
    });
    await mark(page, 'dust-after.seed', page.getByRole('button', { name: /Save as seed/i }));
    await mark(page, 'dust-after.gatherer', gatherer);
    await shot(page, 'dust-after');
  },

  async daily(page) {
    await page.goto(`${DUST}/?daily=${TODAY}`);
    await settle(page, 2500);
    await mark(page, 'daily-start.line', page.getByText(/^Daily Dust,/).first());
    await shot(page, 'daily-start');
    const strike = page.getByRole('button', { name: /^Strike/i }).first();
    await record(page, 'daily', async () => {
      await page.waitForTimeout(800);
      for (let i = 0; i < 10; i += 1) {
        await strike.click().catch(() => {});
        await page.waitForTimeout(220);
      }
      await page.waitForTimeout(2500);
    });
    await shot(page, 'daily-run');
  },

  async ledger(page) {
    await page.goto(`${SITE}/ledger`);
    await settle(page, 2500);
    await mark(page, 'ledger.funding', page.getByRole('heading', { name: 'Funding' }).locator('xpath=ancestor::section[1]'));
    await shot(page, 'ledger');
    await page.goto(`${SITE}/terms`);
    await settle(page, 1500);
    await mark(page, 'terms.version', page.getByText(/^Version \d+, in force/).first());
    await shot(page, 'terms');
  },
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const opts of Object.values(FORMS)) {
  for (const [name, fn] of Object.entries(SHOTS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    // A fresh context per shot, so no save, session or cookie carries between them.
    const ctx = await browser.newContext({ ...opts, colorScheme: 'light', reducedMotion: 'no-preference', locale: 'en-US', timezoneId: 'America/New_York' });
    const page = await ctx.newPage();
    try {
      await fn(page);
    } catch (e) {
      console.log('FAILED', name, e.message.split('\n')[0]);
    }
    await ctx.close();
  }
}
await browser.close();
writeFileSync(RECTS_FILE, `${JSON.stringify(RECTS, null, 2)}\n`);
console.log('rects', Object.keys(RECTS).length);
