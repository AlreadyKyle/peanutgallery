// Renders the explainer video (docs/specs/explainer-video.md).
//
//   node scripts/render.mjs                  both cuts: MP4 (H.264, AAC), WebM (AV1, Opus) and a poster
//   node scripts/render.mjs --only wide      one cut
//   node scripts/render.mjs --still 600,1800 stills of those frames from both cuts, for review
//   node scripts/render.mjs --publish        copy the finished files into platform/site/public/video
//   node scripts/render.mjs --no-social      skip the social cuts
//
// A full render also makes the social cuts in dist/social/: the same video with the site's address on
// the closing plate, H.264 High with AAC at 48 kHz and the index at the front, at a higher quality
// than the site's files, for posting to X and LinkedIn (16:9, and 4:5 for phone feeds).
//
// Everything is written under dist/ (gitignored, and skipped by the gate's scanners by name). The
// soundtrack comes from `pnpm music` (scripts/music.mjs), which must run first. Rendering uses the
// headless Chromium Playwright already installed, or REMOTION_CHROME; nothing is downloaded.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const publicDir = join(dist, 'public');
const site = join(root, '..', 'site');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const CUTS = ['wide', 'tall'];
/** The poster: the closing plate, the mark over the wordmark and the closing line, a second before the end. */
const posterFrame = (composition) => composition.durationInFrames - 60;

function chrome() {
  if (process.env.REMOTION_CHROME) return process.env.REMOTION_CHROME;
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort() : [];
  for (const shell of shells.reverse()) {
    for (const sub of readdirSync(join(cache, shell))) {
      const bin = join(cache, shell, sub, 'chrome-headless-shell');
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error('No headless Chromium found: run `pnpm exec playwright install chromium` in platform/site, or set REMOTION_CHROME');
}

function prepare() {
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(join(site, 'public', 'fonts', 'atkinson-hyperlegible-next-400-700.woff2'), join(publicDir, 'atkinson-hyperlegible-next-400-700.woff2'));
  copyFileSync(join(root, 'assets', 'dust-3600.png'), join(publicDir, 'dust-3600.png'));
  if (!existsSync(join(publicDir, 'soundtrack.wav'))) throw new Error('dist/public/soundtrack.wav is missing: run `pnpm music` first');
}

function ffmpeg(...rest) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...rest], { stdio: 'inherit' });
}

function size(path) {
  return `${(statSync(path).size / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
  if (flag('--publish')) {
    const out = join(site, 'public', 'video');
    mkdirSync(out, { recursive: true });
    for (const cut of CUTS) {
      for (const ext of ['mp4', 'webm', 'jpg']) {
        const name = ext === 'jpg' ? `explainer-${cut}-poster.jpg` : `explainer-${cut}.${ext}`;
        copyFileSync(join(dist, name), join(out, name));
        console.log(`published ${name} (${size(join(out, name))})`);
      }
    }
    return;
  }

  prepare();
  const serveUrl = await bundle({ entryPoint: join(root, 'src', 'index.ts'), publicDir });
  const browserExecutable = chrome();
  const only = value('--only');
  const cuts = only === undefined ? CUTS : [only];
  const still = value('--still');

  for (const cut of cuts) {
    const composition = await selectComposition({ serveUrl, id: `explainer-${cut}`, browserExecutable });
    if (still !== undefined) {
      mkdirSync(join(dist, 'stills'), { recursive: true });
      for (const frame of still.split(',').map(Number)) {
        const output = join(dist, 'stills', `${cut}-${frame}.png`);
        await renderStill({ serveUrl, composition, frame, output, browserExecutable, imageFormat: 'png' });
        console.log(output);
      }
      continue;
    }
    // A near-lossless master first; the two web files are both encoded from it, so neither is a copy
    // of a copy.
    const master = join(dist, `explainer-${cut}.master.mp4`);
    let last = -1;
    await renderMedia({
      serveUrl,
      composition,
      codec: 'h264',
      crf: 10,
      pixelFormat: 'yuv420p',
      audioCodec: 'aac',
      audioBitrate: '256k',
      outputLocation: master,
      browserExecutable,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 10) * 10;
        if (pct !== last) {
          last = pct;
          console.log(`${cut}: ${pct}%`);
        }
      },
    });
    // H.264 for every browser, the index at the front so playback starts before the file has arrived;
    // AV1 in WebM for the browsers that take it, at about half the size.
    const mp4 = join(dist, `explainer-${cut}.mp4`);
    ffmpeg('-i', master, '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-crf', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', mp4);
    const webm = join(dist, `explainer-${cut}.webm`);
    ffmpeg('-i', master, '-c:v', 'libsvtav1', '-preset', '5', '-crf', '44', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '128k', webm);
    rmSync(master);
    const poster = join(dist, `explainer-${cut}-poster.jpg`);
    await renderStill({ serveUrl, composition, frame: posterFrame(composition), output: poster, browserExecutable, imageFormat: 'jpeg', jpegQuality: 90 });

    if (!flag('--no-social')) {
      const inputProps = { format: cut, social: true };
      const socialComposition = await selectComposition({ serveUrl, id: `explainer-${cut}`, inputProps, browserExecutable });
      const socialMaster = join(dist, `explainer-${cut}.social.master.mp4`);
      await renderMedia({
        serveUrl,
        composition: socialComposition,
        inputProps,
        codec: 'h264',
        crf: 10,
        pixelFormat: 'yuv420p',
        audioCodec: 'aac',
        audioBitrate: '256k',
        outputLocation: socialMaster,
        browserExecutable,
      });
      mkdirSync(join(dist, 'social'), { recursive: true });
      const social = join(dist, 'social', `mob-machine-explainer-${cut === 'wide' ? '16x9' : '4x5'}.mp4`);
      ffmpeg('-i', socialMaster, '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-crf', '18', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', social);
      rmSync(socialMaster);
      console.log(`${cut}: ${social} (${size(social)})`);
    }
    console.log(`${cut}: ${mp4} (${size(mp4)}), ${webm} (${size(webm)}), ${poster} (${size(poster)})`);
  }
}

await main();
