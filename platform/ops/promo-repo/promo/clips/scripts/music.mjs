// Renders public/soundtrack.wav: bundles src/music/score.ts with Tone.js, plays it offline in
// headless Chromium, and loudness-normalises it with ffmpeg (-16 LUFS). Math.random is seeded.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.REMOTION_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const bundled = await build({ entryPoints: [join(root, 'src', 'music', 'score.ts')], bundle: true, format: 'iife', globalName: 'Score', platform: 'browser', write: false, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.tsx': 'tsx' } });
const seed = `(() => { let a = 0x9e3779b9; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;
const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.setContent('<!doctype html><title>score</title>');
await page.addScriptTag({ content: seed + bundled.outputFiles[0].text });
const b64 = await page.evaluate(async () => {
  const buffer = await globalThis.Score.render();
  const audio = buffer.get();
  const l = audio.getChannelData(0), r = audio.getChannelData(1);
  const out = new Float32Array(l.length * 2);
  for (let i = 0; i < l.length; i += 1) { out[i * 2] = l[i]; out[i * 2 + 1] = r[i]; }
  const bytes = new Uint8Array(out.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
});
await browser.close();
const raw = join(root, 'dist', 'soundtrack.f32');
execFileSync('mkdir', ['-p', join(root, 'dist')]);
writeFileSync(raw, Buffer.from(b64, 'base64'));
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', join(root, 'public', 'soundtrack.wav')]);
console.log('wrote public/soundtrack.wav');
