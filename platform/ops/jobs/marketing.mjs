// The marketing engine (docs/specs/marketing-engine.md, docs/PLAN.md §10 decision 77): the studio's
// own news posted to Bluesky, Mastodon and Discord, run by .github/workflows/ops-jobs.yml every hour.
// It is outbound only: it posts and reads nothing back from any channel, no reply, mention, timeline
// or direct message (marketing-posters.mjs). What it posts is built from the structured fields
// marketing_posts_due() returns, all written by the studio or its agents: a card's id, folder, title,
// amounts and supporter count, and a weekly report's counts and titles. No player's text reaches it.
//
// Each run:
//   1. names each channel with credentials; a channel without them is skipped with a line naming the
//      missing keys, never a failure;
//   2. reads marketing_posts_due() for those channels: cards that shipped or opened for funding in the
//      last WINDOW_MS, the fresh weekly report, and the studio's stop. While the studio is paused or
//      the kill switch has fired nothing is posted, and what is due is recorded skipped, so it is never
//      posted after resuming;
//   3. builds each post (message builders below), then runs every text of an item through the gate's
//      own deny-list and secret scans (platform/gate/banned-phrases.sh and secret-scan.sh, the scans
//      the dispatcher's public-text.ts runs). A hit records the item skipped on each channel and the
//      board is told; a scan that cannot run stops the run before anything is posted;
//   4. claims each (channel, kind, ref) with marketing_post_claim(), which answers true once only,
//      posts, and settles it posted or failed. A post whose answer is lost is settled failed and not
//      retried: a rerun never posts twice.
// At most POSTS_PER_CHANNEL a run on each channel; the rest wait for the next run.
//
// --dry-run reads the due list and prints every post it would make, in full, and claims, posts and
// alerts nothing. The first output line is PASS: or FAIL:.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { alerter, JobEnvError, jobEnvProblems, round2, supabaseClient } from './lib.mjs';
import { missingKeys, POSTERS } from './marketing-posters.mjs';
import { playUrl, SITE_URL } from './notices.mjs';

const execFileAsync = promisify(execFile);

// The channels, by their link tag (docs/specs/channel-counters.md: bsky, mastodon, discord).
export const CHANNELS = ['bsky', 'mastodon', 'discord'];
// What each channel carries. The dispatcher already posts ships and the weekly report to Discord
// (platform/dispatcher/src/outbound.ts), so the engine adds only the openings there.
export const CHANNEL_KINDS = { bsky: ['ship', 'opened', 'weekly'], mastodon: ['ship', 'opened', 'weekly'], discord: ['opened'] };
// The longest post each channel takes: Bluesky 300 graphemes, Mastodon 500 characters (counted in
// full, though Mastodon counts a link as 23), Discord 2000.
export const LIMITS = { bsky: 300, mastodon: 500, discord: 2000 };
// A card first seen later than this after it shipped or opened is never posted, so switching a channel
// on does not post the studio's whole history.
export const WINDOW_MS = 12 * 60 * 60 * 1000;
export const DUE_LIMIT = 20;
export const POSTS_PER_CHANNEL = 3;
// At most this many titles are named in a weekly post; the rest are "and n more".
export const WEEKLY_TITLES_NAMED = 5;
export const SCAN_TIMEOUT_MS = 60_000;
const GATE_DIR = fileURLToPath(new URL('../../gate/', import.meta.url));

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const graphemes = (text) => [...segmenter.segment(text)].map((part) => part.segment);

// The length a channel counts: graphemes on Bluesky, code points on Mastodon, UTF-16 units on Discord.
export function measure(channel, text) {
  if (channel === 'bsky') return graphemes(text).length;
  if (channel === 'mastodon') return [...text].length;
  return text.length;
}

// One line, no control characters, white space runs made one space.
export function cleanTitle(text) {
  return String(text ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A title as it is written on a channel. Discord: its markdown and mention characters escaped, as the
// dispatcher escapes them. Mastodon: a zero-width space after @ and #, so a title can name no account
// and start no hashtag. Bluesky makes a mention or a tag only from a facet, and the engine adds none.
export function channelTitle(channel, title) {
  const clean = cleanTitle(title);
  if (channel === 'discord') return clean.replace(/[\\*_~`|[\]()<>#@:]/g, (character) => `\\${character}`);
  if (channel === 'mastodon') return clean.replace(/[@#]/g, (character) => `${character}​`);
  return clean;
}

// The head, the cut part and the tail as one post of at most the channel's limit: the cut part is cut
// on a grapheme with an ellipsis when it must be, so a link or a figure in the tail is never cut.
export function fit(channel, head, cut, tail) {
  const limit = LIMITS[channel];
  if (measure(channel, head + cut + tail) <= limit) return head + cut + tail;
  let out = '';
  for (const part of graphemes(cut)) {
    if (measure(channel, `${head}${out}${part}…${tail}`) > limit) break;
    out += part;
  }
  return `${head}${out.trimEnd()}…${tail}`;
}

// A link with its channel's tag, from=<channel>, so the site's counters see where a visit came from.
export function tagged(url, channel) {
  const link = new URL(url);
  link.searchParams.set('from', channel);
  return link.toString();
}

const usd = (value) => `$${round2(value).toFixed(2)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const inDust = (item) => item.folder === 'seed-1';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// "2026-09-14" as "14 September".
function weekDay(day) {
  const [, month, date] = String(day).split('-').map(Number);
  return `${date} ${MONTHS[month - 1] ?? ''}`.trim();
}

// "Shipped in Dust: <title>, funded by 3 supporters. Play: <play>?from=<ch> Card: <site>/card/<id>?from=<ch>".
// With no supporter the funded clause is left out; a card outside Dust says "at Mob Machine" and has
// no Play link.
export function shipMessage(item, channel, { site = SITE_URL, play }) {
  const card = tagged(`${site}/card/${item.card_id}`, channel);
  const links = inDust(item) ? [tagged(play, channel), card] : [card];
  const count = Number(item.supporter_count ?? 0);
  const funded = count > 0 ? `, funded by ${plural(count, 'supporter')}` : '';
  const tail = `${funded}.${inDust(item) ? ` Play: ${links[0]}` : ''} Card: ${card}`;
  const head = inDust(item) ? 'Shipped in Dust: ' : 'Shipped at Mob Machine: ';
  return {
    text: fit(channel, head, channelTitle(channel, item.title), tail),
    links,
    card: { uri: card, title: cleanTitle(item.title), description: inDust(item) ? 'Shipped in Dust, a free browser game built by AI agents at Mob Machine.' : 'Shipped at Mob Machine, a game studio run by AI agents.' },
  };
}

// "New in Dust, open for funding: <title> ($1.00 of $3.00). <site>/card/<id>?from=<ch>".
export function openedMessage(item, channel, { site = SITE_URL }) {
  const card = tagged(`${site}/card/${item.card_id}`, channel);
  const head = inDust(item) ? 'New in Dust, open for funding: ' : 'New at Mob Machine, open for funding: ';
  const tail = ` (${usd(item.funded_usd)} of ${usd(item.funding_target_usd)}). ${card}`;
  return {
    text: fit(channel, head, channelTitle(channel, item.title), tail),
    links: [card],
    card: { uri: card, title: cleanTitle(item.title), description: `Open for funding at Mob Machine: ${usd(item.funded_usd)} of ${usd(item.funding_target_usd)}.` },
  };
}

// "The week of 14 September at Mob Machine: 2 cards shipped (<title>, <title>). 5 cards were open for
// funding when the report was published. Read the report: <site>/reports?from=<ch>". Titles that do
// not fit are dropped from the end as "and n more" before any title is cut.
export function weeklyMessage(item, channel, { site = SITE_URL }) {
  const reports = tagged(`${site}/reports`, channel);
  const count = Number(item.shipped_count ?? 0);
  const titles = (Array.isArray(item.shipped_titles) ? item.shipped_titles : []).map((title) => channelTitle(channel, title)).filter(Boolean);
  const open = Number(item.open_count ?? 0);
  const counted = open === 0 ? 'No card was' : open === 1 ? '1 card was' : `${open} cards were`;
  const head = `The week of ${weekDay(item.ref)} at Mob Machine: ${plural(count, 'card')} shipped`;
  const tail = `. ${counted} open for funding when the report was published. Read the report: ${reports}`;
  const list = (named) => {
    if (named === 0) return '';
    const more = Math.max(0, count - named);
    return ` (${titles.slice(0, named).join(', ')}${more > 0 ? ` and ${more} more` : ''})`;
  };
  let named = Math.min(titles.length, WEEKLY_TITLES_NAMED);
  while (named > 1 && measure(channel, head + list(named) + tail) > LIMITS[channel]) named -= 1;
  return {
    text: fit(channel, head, list(named), tail),
    links: [reports],
    card: { uri: reports, title: `The week of ${weekDay(item.ref)} at Mob Machine`, description: `${plural(count, 'card')} shipped. Every week's report is built from the studio's public records.` },
  };
}

export function composeMessage(item, channel, options) {
  const build = { ship: shipMessage, opened: openedMessage, weekly: weeklyMessage }[item.kind];
  if (!build) throw new Error(`no message for kind ${item.kind}`);
  return { ...build(item, channel, options), key: `mobmachine-${item.kind}-${item.ref}-${channel}` };
}

// The gate's deny-list scan, then its secret scan, over the texts (the dispatcher's public-text.ts
// does the same): ok only when both ran and printed PASS. The texts go to a scratch file scanned as a
// commit message, which applies every list, trademarks included.
export async function gateScan(texts, { gateDir = GATE_DIR, timeoutMs = SCAN_TIMEOUT_MS } = {}) {
  const scans = [
    { name: 'the deny-list scan', hit: 'a deny-list hit', script: path.join(gateDir, 'banned-phrases.sh'), args: (file) => ['--commit-message-file', file] },
    { name: 'the secret scan', hit: 'a credential shape', script: path.join(gateDir, 'secret-scan.sh'), args: (file) => [file] },
  ];
  const missing = scans.find((scan) => !existsSync(scan.script));
  if (missing) return { ok: false, ran: false, detail: `${missing.name} could not run: ${path.basename(missing.script)} is missing` };
  const env = {};
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'LANG']) if (process.env[name] !== undefined) env[name] = process.env[name];
  const dir = await mkdtemp(path.join(os.tmpdir(), 'marketing-scan-'));
  try {
    const file = path.join(dir, 'posts.txt');
    await writeFile(file, `${texts.join('\n')}\n`, 'utf8');
    for (const scan of scans) {
      try {
        const { stdout } = await execFileAsync('bash', [scan.script, ...scan.args(file)], { env, timeout: timeoutMs, maxBuffer: 1024 * 1024 });
        const first = stdout.split('\n')[0] ?? '';
        if (!first.startsWith('PASS:')) return { ok: false, ran: false, detail: `${scan.name} could not run: ${first.slice(0, 200) || 'no output'}` };
      } catch (error) {
        const first = String(error?.stdout ?? '').split('\n')[0] ?? '';
        if (error?.code === 1 && first.startsWith('FAIL:')) return { ok: false, ran: true, detail: `${scan.hit}: ${first.slice(0, 200)}` };
        return { ok: false, ran: false, detail: `${scan.name} could not run: ${error?.killed ? 'timed out' : first.slice(0, 200) || `exit ${String(error?.code ?? 'unknown')}`}` };
      }
    }
    return { ok: true, ran: true };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runMarketing({ env, dryRun = false, fetchFn = fetch, now = new Date(), out = process.stdout, scan = gateScan, play = playUrl(), posters = POSTERS }) {
  const problems = jobEnvProblems('marketing', env);
  if (problems.length > 0) throw new JobEnvError('marketing', problems);
  const alerts = alerter({ ntfyUrl: env.NTFY_TOPIC_URL, healthcheckUrl: env.MARKETING_HEALTHCHECK_URL, fetchFn, title: 'Mob Machine marketing' });
  const lines = [];
  const failures = [];
  const counts = Object.fromEntries(CHANNELS.map((channel) => [channel, { posted: 0, failed: 0, skipped: 0, waiting: 0 }]));

  const active = [];
  const notSet = [];
  for (const channel of CHANNELS) {
    const missing = missingKeys(channel, env);
    if (missing.length > 0) {
      notSet.push(channel);
      lines.push(`${channel} skipped: ${missing.join(', ')} not set`);
    } else active.push(channel);
  }
  const finish = async (summary) => {
    const ok = failures.length === 0;
    out.write(`${ok ? 'PASS' : 'FAIL'}: marketing${dryRun ? ' (dry run)' : ''}: ${summary}\n`);
    for (const line of [...lines, ...failures]) out.write(`  - ${line}\n`);
    if (!dryRun) {
      if (!ok) await alerts.notify(`Marketing: ${summary}\n${failures.map((f) => `- ${f}`).join('\n')}`);
      await alerts.ping(ok);
    }
    return { ok, counts, lines, failures };
  };
  if (active.length === 0) return finish('no channel has its keys; nothing to post');

  const db = supabaseClient({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, fetchFn });
  const due = await db.rpc('marketing_posts_due', { p_channels: active, p_since: new Date(now.getTime() - WINDOW_MS).toISOString(), p_limit: DUE_LIMIT });
  if (!due || !Array.isArray(due.items)) throw new Error('marketing_posts_due did not answer a list');
  const options = { site: SITE_URL, play };
  const tally = () => [
    ...active.map((channel) => `${channel} ${dryRun ? 'would post' : 'posted'} ${counts[channel].posted}, failed ${counts[channel].failed}, skipped ${counts[channel].skipped}, waiting ${counts[channel].waiting}`),
    ...notSet.map((channel) => `${channel} not set`),
  ].join('; ');

  // The channels an item is still due on: the channel carries its kind, and no row holds it yet.
  const openOn = (item) => active.filter((channel) => !(item.claimed ?? []).includes(channel));

  if (due.stop) {
    // Nothing is posted while the studio is stopped, and what is due now is never posted after.
    for (const item of due.items) {
      for (const channel of openOn(item)) {
        if (dryRun || (await db.rpc('marketing_post_claim', { p_channel: channel, p_kind: item.kind, p_ref: item.ref, p_state: 'skipped', p_skip_reason: due.stop }))) counts[channel].skipped += 1;
      }
    }
    lines.unshift(`stopped: ${due.stop === 'kill_switch' ? 'the kill switch has fired' : 'the studio is paused'}; nothing posted`);
    return finish(tally());
  }

  const ready = {};
  const budget = Object.fromEntries(active.map((channel) => [channel, POSTS_PER_CHANNEL]));
  const made = Object.fromEntries(active.map((channel) => [channel, posters[channel]({ env, fetchFn, now: () => now })]));
  const skip = async (channel, item, reason) => {
    if (dryRun || (await db.rpc('marketing_post_claim', { p_channel: channel, p_kind: item.kind, p_ref: item.ref, p_state: 'skipped', p_skip_reason: reason }))) counts[channel].skipped += 1;
  };

  for (const item of due.items) {
    const open = openOn(item);
    const channels = [];
    for (const channel of open) {
      if (!CHANNEL_KINDS[channel].includes(item.kind)) await skip(channel, item, 'dispatcher_lane');
      // The dispatcher's announcements lane already posts a rare or legendary card's opening to Discord.
      else if (channel === 'discord' && item.kind === 'opened' && (item.rarity === 'rare' || item.rarity === 'legendary')) await skip(channel, item, 'announce_lane');
      else channels.push(channel);
    }
    if (channels.length === 0) continue;
    const messages = Object.fromEntries(channels.map((channel) => [channel, composeMessage(item, channel, options)]));
    const scanned = await scan(Object.values(messages).map((message) => message.text));
    if (!scanned.ok && !scanned.ran) throw new Error(`the content scan could not run, so nothing was posted: ${scanned.detail}`);
    if (!scanned.ok) {
      for (const channel of channels) await skip(channel, item, 'deny_list');
      failures.push(`${item.kind} ${item.ref}: refused by ${scanned.detail}; skipped on ${channels.join(', ')}`);
      continue;
    }
    for (const channel of channels) {
      if (budget[channel] <= 0) {
        counts[channel].waiting += 1;
        continue;
      }
      const message = messages[channel];
      if (dryRun) {
        budget[channel] -= 1;
        counts[channel].posted += 1;
        lines.push(`would post to ${channel} (${item.kind} ${item.ref}, ${measure(channel, message.text)} of ${LIMITS[channel]}): ${message.text}`);
        continue;
      }
      if (ready[channel] === undefined) {
        const prepared = await made[channel].prepare();
        ready[channel] = prepared.ok;
        // Nothing is claimed, so the next run tries again.
        if (!prepared.ok) failures.push(`${prepared.error}; nothing posted to ${channel} this run`);
      }
      if (!ready[channel]) continue;
      if (!(await db.rpc('marketing_post_claim', { p_channel: channel, p_kind: item.kind, p_ref: item.ref, p_state: 'sending', p_skip_reason: null }))) continue;
      budget[channel] -= 1;
      const result = await made[channel].post(message);
      await db.rpc('marketing_post_settle', {
        p_channel: channel,
        p_kind: item.kind,
        p_ref: item.ref,
        p_state: result.ok ? 'posted' : 'failed',
        p_status: result.status,
        p_post_id: result.ok ? result.id : null,
      });
      if (result.ok) {
        counts[channel].posted += 1;
        lines.push(`posted to ${channel}: ${item.kind} ${item.ref}`);
      } else {
        counts[channel].failed += 1;
        failures.push(`${item.kind} ${item.ref}: ${result.error}; not retried`);
      }
    }
  }
  return finish(tally());
}
