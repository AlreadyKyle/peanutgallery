// Reads back how each sent post did, then feeds settled posts (two days old) to the playbook once.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { adapterFor } from './channels/index.mjs';
import { emptyPlaybook, updatePlaybook } from './learn.mjs';
import { dayOf, loadConfig, paths, readJson, readSent, ROOT, writeJson } from './lib.mjs';

const HOUR = 3_600_000;
// Postiz allows 30 analytics reads an hour; stay under it.
const MAX_POSTIZ_READS = 25;

export async function collect({ root = ROOT, env = process.env, fetch: f = fetch, now = new Date(), log = console.log } = {}) {
  const config = loadConfig(root);
  const p = paths(root);
  const receipts = readSent(root).filter((r) => now - Date.parse(r.sentAt) >= 20 * HOUR && now - Date.parse(r.sentAt) <= 14 * 24 * HOUR);
  const snapshotFile = join(p.metrics, `${dayOf(now.toISOString())}.json`);
  const snapshot = readJson(snapshotFile, {});
  let postizReads = 0;
  for (const r of receipts) {
    const adapter = adapterFor(r.channel, config);
    if (!adapter?.ready(env) || !r.postId) continue;
    if (config.channels[r.channel]?.via === 'postiz' && ++postizReads > MAX_POSTIZ_READS) continue;
    try {
      const m = await adapter.stats(r, { env, fetch: f, root });
      if (m) snapshot[r.id] = { ...m, channel: r.channel, at: now.toISOString() };
    } catch (error) {
      log(`stats ${r.id}: ${error.message}`);
    }
  }
  writeJson(snapshotFile, snapshot);
  return { read: Object.keys(snapshot).length };
}

/** Latest known metrics per post id across the daily snapshots. */
export function latestMetrics(root = ROOT) {
  const p = paths(root);
  const out = {};
  if (!existsSync(p.metrics)) return out;
  for (const name of readdirSync(p.metrics).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()) {
    Object.assign(out, readJson(join(p.metrics, name), {}));
  }
  return out;
}

export function learn({ root = ROOT, now = new Date(), log = console.log } = {}) {
  const p = paths(root);
  const learnedFile = join(root, 'state', 'learned.json');
  const learned = new Set(readJson(learnedFile, []));
  const metrics = latestMetrics(root);
  const results = [];
  for (const r of readSent(root)) {
    if (learned.has(r.id) || now - Date.parse(r.sentAt) < 48 * HOUR) continue;
    // Channels that report nothing (Discord) are judged on site visits instead, below.
    const m = metrics[r.id];
    if (!m) continue;
    results.push({ kind: r.kind, channel: r.channel, variant: r.variant, hour: r.hour, metrics: m });
    learned.add(r.id);
  }
  // Site visits per channel tag, written by the marketer routine from the studio's own counters.
  // The file is keyed by the link's source tag (bsky, yt); the playbook by channel name (bluesky, youtube).
  const visits = readJson(join(p.metrics, 'site-visits.json'), {});
  const config = loadConfig(root);
  const playbook = updatePlaybook(readJson(p.playbook, emptyPlaybook()), results, visitsByChannel(visits.byChannel ?? {}, config), now);
  writeJson(p.playbook, playbook);
  writeJson(learnedFile, [...learned]);
  log(`learned from ${results.length} posts`);
  return { learned: results.length };
}

/** Site visits keyed by channel name: a tag maps to the channel whose config carries it; an unknown tag is kept as it is. */
export function visitsByChannel(byTag, config) {
  const nameOf = new Map(Object.entries(config.channels ?? {}).map(([name, c]) => [c.tag ?? name, name]));
  const out = {};
  for (const [tag, n] of Object.entries(byTag)) out[nameOf.get(tag) ?? tag] = (out[nameOf.get(tag) ?? tag] ?? 0) + n;
  return out;
}
