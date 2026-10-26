// Makes a shipped card's replay (docs/specs/replays.md): Dust before and after the card, from two
// folders seed-1's capture tool wrote (`pnpm --filter @backseat/seed-1 capture`), and the card's
// timeline from its public document, into a 24 second mp4 with no sound, plus a poster and a manifest.
//
//   node scripts/replay.mjs --before <capture dir> --after <capture dir> --card <card.json> --out <dir> [--width 1280]
//
// <card.json> is the card's /api/card/<id> document, saved as it came. The plan is src/replay/plan.ts
// (Node strips its types). Slides are drawn by the headless Chromium playwright-core finds, or
// PW_CHROMIUM_PATH, and joined by ffmpeg. Load and look only: nothing here reaches the network.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { chooseStates, concatList, factsFrom, ffmpegArgs, shotName, slideHtml, slides, totalSeconds } from '../src/replay/plan.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONT = join(root, '..', 'site', 'public', 'fonts', 'atkinson-hyperlegible-next-400-700.woff2');
const USAGE = 'usage: node scripts/replay.mjs --before <capture dir> --after <capture dir> --card <card.json> --out <dir> [--width 1280]';

const args = process.argv.slice(2);
const value = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const base = process.env.INIT_CWD ?? process.cwd();
const need = (name) => {
  const v = value(name);
  if (v === undefined) {
    console.error(`${name} is required\n${USAGE}`);
    process.exit(2);
  }
  return resolve(base, v);
};
const beforeDir = need('--before');
const afterDir = need('--after');
const cardFile = need('--card');
const out = need('--out');
const width = Number(value('--width') ?? 1280);

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const dataUrl = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;

const facts = factsFrom(readJson(cardFile));
const before = readJson(join(beforeDir, 'capture.json'));
const after = readJson(join(afterDir, 'capture.json'));
const states = chooseStates(before, after, width, (s) => !readFileSync(join(beforeDir, shotName(s, width))).equals(readFileSync(join(afterDir, shotName(s, width)))));
const plan = slides(states);
const size = after.sizes.find((s) => s.width === width);
const font = dataUrl(FONT, 'font/woff2');

const frames = join(out, '.slides');
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const files = [];
try {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  for (const [i, slide] of plan.entries()) {
    const picture = slide.kind === 'before' || slide.kind === 'after' ? dataUrl(join(slide.kind === 'before' ? beforeDir : afterDir, shotName(slide.state, width)), 'image/png') : undefined;
    await page.setContent(slideHtml(slide, facts, size, font, picture), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const path = join(frames, `${String(i).padStart(2, '0')}-${slide.kind}.png`);
    await page.screenshot({ path });
    files.push({ path, seconds: slide.seconds, kind: slide.kind });
  }
} finally {
  await browser.close();
}

const short = facts.cardId.slice(0, 8);
const video = join(out, `replay-${short}.mp4`);
const poster = join(out, `replay-${short}.png`);
writeFileSync(join(frames, 'list.txt'), concatList(files));
execFileSync('ffmpeg', ffmpegArgs(join(frames, 'list.txt'), video));
copyFileSync(files.find((f) => f.kind === 'timeline').path, poster);
rmSync(frames, { recursive: true, force: true });
writeFileSync(
  join(out, `replay-${short}.json`),
  `${JSON.stringify({ card_id: facts.cardId, before: before.commit, after: after.commit, width, states, seconds: totalSeconds(plan), video: `replay-${short}.mp4`, poster: `replay-${short}.png` }, null, 2)}\n`,
);
console.log(`replay: ${video}, ${totalSeconds(plan)} s, states ${states.join(', ')}, ${before.commit} to ${after.commit}`);
