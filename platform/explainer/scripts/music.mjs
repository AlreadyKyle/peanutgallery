// Renders the soundtrack (docs/specs/explainer-video.md): bundles src/music/score.ts with Tone.js,
// plays it into an OfflineAudioContext in headless Chromium, and writes dist/public/soundtrack.wav,
// loudness-normalised for the web (-16 LUFS integrated, -1.5 dBTP) by ffmpeg's two-pass loudnorm.
// Math.random is seeded before Tone loads, so the noise voices are the same on every render.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'public');
mkdirSync(out, { recursive: true });

function chrome() {
  if (process.env.REMOTION_CHROME) return process.env.REMOTION_CHROME;
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse() : [];
  for (const shell of shells) {
    for (const sub of readdirSync(join(cache, shell))) {
      const bin = join(cache, shell, sub, 'chrome-headless-shell');
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error('No headless Chromium found: run `pnpm exec playwright install chromium` in platform/site, or set REMOTION_CHROME');
}

const bundled = await build({
  entryPoints: [join(root, 'src', 'music', 'score.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'Score',
  platform: 'browser',
  write: false,
  logLevel: 'error',
});
const seed = `(() => { let a = 0x9e3779b9; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const raw = join(root, 'dist', 'soundtrack.f32');
const reuse = process.argv.includes('--reuse-raw') && existsSync(raw);
let sampleRate = 48000;
let channels = 2;
if (!reuse) {
const browser = await chromium.launch({ executablePath: chrome(), args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (error) => console.error('page error:', error.message));
await page.setContent('<!doctype html><title>score</title>');
await page.addScriptTag({ content: seed + bundled.outputFiles[0].text });
const started = Date.now();
const rendered = await page.evaluate(async () => {
  const buffer = await globalThis.Score.render();
  const audio = buffer.get();
  const left = audio.getChannelData(0);
  const right = audio.getChannelData(1);
  const interleaved = new Float32Array(left.length * 2);
  for (let i = 0; i < left.length; i += 1) {
    interleaved[i * 2] = left[i];
    interleaved[i * 2 + 1] = right[i];
  }
  // Base64 in pieces, so no one string is too large to pass back.
  const bytes = new Uint8Array(interleaved.buffer);
  const parts = [];
  const size = 3 * 1024 * 1024;
  for (let i = 0; i < bytes.length; i += size) {
    let binary = '';
    const slice = bytes.subarray(i, i + size);
    for (let j = 0; j < slice.length; j += 0x8000) binary += String.fromCharCode(...slice.subarray(j, j + 0x8000));
    parts.push(btoa(binary));
  }
  return { sampleRate: audio.sampleRate, channels: 2, chunks: parts };
});
await browser.close();
console.log(`score rendered in ${((Date.now() - started) / 1000).toFixed(1)} s`);
sampleRate = rendered.sampleRate;
channels = rendered.channels;
writeFileSync(raw, Buffer.concat(rendered.chunks.map((c) => Buffer.from(c, 'base64'))));
}
const input = ['-f', 'f32le', '-ar', String(sampleRate), '-ac', String(channels), '-i', raw];
// A soft limiter first takes the few inter-sample peaks down, so loudnorm can reach its target with
// one fixed gain (linear) and the quiet opening stays quieter than the shipped section. loudnorm's
// first pass prints its measurement to stderr.
const PRE = 'alimiter=limit=0.5:attack=4:release=60:level=disabled';
const measured = spawnSync('ffmpeg', ['-hide_banner', ...input, '-af', `${PRE},loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
const m = JSON.parse(/\{[^{}]*"input_i"[^{}]*\}/.exec(measured)[0]);
const filter = `${PRE},loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...input, '-af', filter, '-ar', '48000', '-c:a', 'pcm_s16le', join(out, 'soundtrack.wav')]);
if (!process.argv.includes('--keep-raw')) rmSync(raw);
const check = spawnSync('ffmpeg', ['-hide_banner', '-i', join(out, 'soundtrack.wav'), '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
const final = JSON.parse(/\{[^{}]*"input_i"[^{}]*\}/.exec(check)[0]);
console.log(`soundtrack: ${join(out, 'soundtrack.wav')} (${final.input_i} LUFS integrated, ${final.input_tp} dBTP peak, ${final.input_lra} LU range)`);
