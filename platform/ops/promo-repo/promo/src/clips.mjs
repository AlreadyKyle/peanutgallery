// Vertical clips for the video channels (YouTube Shorts, TikTok). A ship or an open card becomes the
// props of the `moment` composition in promo/clips (Remotion, 1080x1920, 15 seconds). The draft
// carries the props, not the video: publish renders the clip just before it sends, so no video is
// committed and every clip shows the card as it was drafted.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { money, ROOT } from './lib.mjs';

// The agents the composition can draw (promo/clips/src/site/*.json).
export const CLIP_ROLES = ['Builder A', 'Builder B', 'Game Designer', 'Game Director', 'Janitor', 'Platform Builder', 'Platform Director', 'QA', 'Studio Head'];
const SUMMARY_MAX = 150;

function firstSentences(text, max) {
  if (!text || text.length <= max) return text ?? '';
  let out = '';
  for (const s of text.match(/[^.?]+[.?]/g) ?? []) {
    if ((out + s).length > max) break;
    out += s;
  }
  return out.trim() || text.slice(0, max - 1).replace(/\s+\S*$/, '') + '.';
}

/** The composition's props for a moment, or null when the moment has no clip. */
export function clipProps(moment) {
  const f = moment.facts ?? {};
  const cta = f.game ? { ctaTop: `Play ${f.game} free in your browser`, ctaUrl: 'mobmachine.games' } : { ctaTop: 'Watch the studio work', ctaUrl: 'mobmachine.games' };
  const suit = f.suit === 'game' ? 'game' : 'studio';
  if (moment.kind === 'ship' && CLIP_ROLES.includes(f.role)) {
    const rows = [];
    if (f.spentUsd > 0) rows.push({ label: 'Agent work', value: money(f.spentUsd), money: true });
    if (f.supporters > 0) rows.push({ label: 'Supporters', value: String(f.supporters) });
    return { kicker: f.game ? `Shipped in ${f.game}` : 'Shipped at the studio', title: f.title, summary: firstSentences(f.summary ?? f.title, SUMMARY_MAX), role: f.role, suit, rows, state: 'live', ...cta };
  }
  if (moment.kind === 'spotlight' && f.targetUsd > 0) {
    return {
      kicker: f.game ? `Open for funding in ${f.game}` : 'Open for funding',
      title: f.title,
      summary: firstSentences(f.summary ?? '', SUMMARY_MAX),
      role: CLIP_ROLES.includes(f.role) ? f.role : f.suit === 'game' ? 'Builder A' : 'Platform Builder',
      suit,
      rows: [{ label: 'Funded so far', value: `${money(f.fundedUsd)} of ${money(f.targetUsd)}`, money: true }],
      state: 'open',
      funded: Math.min(1, f.fundedUsd / f.targetUsd),
      ctaTop: 'Fund the next change, or just play',
      ctaUrl: 'mobmachine.games',
    };
  }
  return null;
}

/** A video channel's title for a clip draft (YouTube shows it; TikTok ignores it). */
export function clipTitle(moment) {
  const f = moment.facts ?? {};
  if (moment.kind === 'ship') return `${f.title}: an AI agent shipped this${f.game ? ` in ${f.game}` : ''}`.slice(0, 95);
  return `${f.title}: open for funding`.slice(0, 95);
}

/**
 * Renders a draft's clip to promo/clips/out/<hash of its props>.mp4 (so the YouTube and TikTok
 * drafts of one moment share a render) and returns that path relative to the promo root, where the
 * Postiz adapter resolves draft.video. Needs `npm ci` in promo/clips first.
 */
export function renderClip(draft, root = ROOT) {
  const dir = join(root, 'clips');
  const out = join(dir, 'out');
  mkdirSync(out, { recursive: true });
  const name = createHash('sha1').update(JSON.stringify(draft.clip)).digest('hex').slice(0, 12);
  const props = join(out, `${name}.json`);
  const video = join(out, `${name}.mp4`);
  if (!existsSync(video)) {
    writeFileSync(props, JSON.stringify(draft.clip));
    const run = spawnSync(process.execPath, [join(dir, 'scripts', 'render.mjs'), props, video], { cwd: dir, encoding: 'utf8', timeout: 10 * 60_000 });
    if (run.status !== 0 || !existsSync(video)) throw new Error(`clip render failed: ${(run.stderr || run.stdout || '').slice(-400)}`);
  }
  return `clips/out/${name}.mp4`;
}
