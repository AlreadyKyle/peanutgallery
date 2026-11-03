// The copy checks every post passes before it can be approved: the tested rules of docs/COPY.md in
// the studio repository, plus the post-only rules (a tagged link back, a length that fits). The
// workflow also runs the studio's own deny-list scan (platform/gate/banned-phrases.sh) on each draft.
import { LIMITS } from './lib.mjs';

const INFLATED = ['seamless', 'powerful', 'unlock your', 'journey', 'reimagine', 'revolutionary', 'cutting-edge', 'testament', 'landscape', 'elevate', 'empower', 'game-changer', 'game changer'];
const CHANCE = ['luck', 'lucky', 'mystery', 'surprise', 'random', 'spin', 'jackpot', 'bet', 'odds', 'prize', 'loot', 'win', 'winner', 'gamble', 'chance'];
const URGENCY = ['hurry', 'last chance', 'only today', 'ends soon', 'running out', "don't miss", 'before it', 'countdown', 'act now', 'limited time'];
const MONEY = /\$\d|contribut|fund|pay|money|cost/i;

export function lintText(text, { channel, link } = {}) {
  const problems = [];
  const lower = text.toLowerCase();
  const words = new Set(lower.match(/[a-z']+/g) ?? []);
  if (/[—–]/.test(text)) problems.push('em or en dash');
  if (text.includes('!')) problems.push('exclamation mark');
  if (/donat/i.test(text)) problems.push('says donation; use contribution');
  for (const w of INFLATED) if (lower.includes(w)) problems.push(`inflated word: ${w}`);
  for (const w of URGENCY) if (lower.includes(w)) problems.push(`urgency: ${w}`);
  if (MONEY.test(text)) for (const w of CHANCE) if (words.has(w)) problems.push(`chance word beside money: ${w}`);
  if (/\bthis week\b/i.test(text)) problems.push('says "this week"; name the week');
  // A "first" claim invites a correction under the post; say what the studio does instead.
  if (/\b(first[- ]ever|world'?s first|the first (ai|game|studio))\b/i.test(text)) problems.push('claims a first');
  if (/#\w/.test(text)) problems.push('hashtag');
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)) problems.push('emoji');
  if (/\b(you (have|must|should) (to )?fund|please (fund|contribute|support))\b/i.test(text)) problems.push('begs or guilts');
  for (const s of text.split(/(?<=[.?])\s+/)) {
    const count = (s.match(/[A-Za-z0-9$']+/g) ?? []).length;
    if (count > 0 && count < 3) problems.push(`fragment sentence: "${s}"`);
  }
  if (channel && link) {
    const limit = LIMITS[channel] ?? 500;
    const linkLength = channel === 'x' ? 23 : link.length;
    if (text.length + 2 + linkLength > limit) problems.push(`too long for ${channel}: ${text.length + 2 + linkLength} > ${limit}`);
    if (!/[?&]from=[a-z]+/.test(link)) problems.push('link has no from= tag');
  }
  return problems;
}
