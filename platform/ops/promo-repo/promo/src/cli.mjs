// The promo engine's entry point, run by .github/workflows/promo.yml and by the marketer routine.
//   node promo/src/cli.mjs harvest [--dry-run]   read the public documents, draft new posts
//   node promo/src/cli.mjs publish [--dry-run]   send what is approved (or, in auto mode, clean)
//   node promo/src/cli.mjs metrics               read back post stats and update the playbook
//   node promo/src/cli.mjs status                the outbox and the last week, as text
//   node promo/src/cli.mjs approve <id|all>...   mark drafts approved (review mode)
//   node promo/src/cli.mjs reject <id>...        drop drafts
//   node promo/src/cli.mjs add <file.json>       add hand-written drafts (launch posts, clips)
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { composeDrafts, linkFor } from './compose.mjs';
import { emptyPlaybook } from './learn.mjs';
import { lintText } from './lint.mjs';
import { listOutbox, loadConfig, paths, readJson, readSent, removeDraft, ROOT, saveDraft, writeJson } from './lib.mjs';
import { collect, learn } from './metrics.mjs';
import { harvestMoments } from './moments.mjs';
import { publish } from './publish.mjs';
import { readPublic } from './sources.mjs';

export async function harvest({ root = ROOT, fetch: f = fetch, now = new Date(), dryRun = false, docsFile = null, log = console.log } = {}) {
  const config = loadConfig(root);
  const p = paths(root);
  // --docs <file> takes the documents from a file (a session that reads them through the Supabase
  // connector instead of the network).
  const docs = docsFile ? { errors: [], ...readJson(docsFile, {}) } : await readPublic(config, f);
  for (const e of docs.errors) log(`source ${e}`);
  const moments = harvestMoments(docs, config, now.getTime());
  const seen = new Set(readJson(p.seen, []));
  for (const d of listOutbox(root)) seen.add(d.id);
  const drafts = composeDrafts(moments, config, readJson(p.playbook, emptyPlaybook()), seen, now);
  for (const d of drafts) {
    if (config.mode === 'auto' && d.status === 'pending') d.status = 'approved';
    log(`${dryRun ? 'would draft' : 'drafted'} ${d.id} [${d.status}] ${d.text}`);
    if (!dryRun) {
      saveDraft(d, root);
      seen.add(d.id);
    }
  }
  if (!dryRun) writeJson(p.seen, [...seen].slice(-5000));
  return { moments: moments.length, drafts: drafts.length };
}

/**
 * Adds hand-written drafts (the marketer routine's launch posts, replies to a moment, a clip):
 * a JSON array of { ref, text, path or url, channels: [...], image?, video?, title? }.
 * They go through the same checks and the same review as harvested drafts.
 */
export function addCustom(items, { root = ROOT, now = new Date() } = {}) {
  const config = loadConfig(root);
  const existing = new Set(listOutbox(root).map((d) => d.id));
  const added = [];
  for (const item of items) {
    for (const channel of item.channels) {
      const ch = config.channels[channel];
      if (!ch) throw new Error(`unknown channel ${channel}`);
      const id = `custom-${item.ref}-${channel}`;
      if (existing.has(id)) continue;
      const moment = { kind: 'custom', ref: item.ref, priority: item.priority ?? 55, at: now.toISOString(), facts: { path: item.path, url: item.url } };
      const link = linkFor(moment, ch.tag ?? channel, config);
      const text = item.text[channel] ?? item.text.default;
      const problems = lintText(text, { channel, link });
      const draft = {
        id,
        createdAt: now.toISOString(),
        status: problems.length ? 'needs_edit' : config.mode === 'auto' ? 'approved' : 'pending',
        problems,
        moment: { kind: 'custom', ref: item.ref, priority: moment.priority, at: moment.at },
        channel,
        variant: item.variant ?? 'custom',
        text,
        link,
        title: item.title ?? null,
        image: item.image ?? null,
        video: item.video ?? null,
        notBefore: item.notBefore ?? null,
      };
      saveDraft(draft, root);
      added.push(draft);
    }
  }
  return added;
}

export function setStatus(ids, status, { root = ROOT, by = 'board' } = {}) {
  const drafts = listOutbox(root);
  const chosen = ids.includes('all') ? drafts.filter((d) => d.status === 'pending') : drafts.filter((d) => ids.includes(d.id));
  for (const d of chosen) {
    if (status === 'approved') {
      const problems = lintText(d.text, { channel: d.channel, link: d.link });
      if (problems.length) {
        saveDraft({ ...d, status: 'needs_edit', problems }, root);
        continue;
      }
      saveDraft({ ...d, status, approvedBy: by, approvedAt: new Date().toISOString(), problems: [] }, root);
    } else if (status === 'rejected') removeDraft(d.id, root);
  }
  return chosen.length;
}

export function status({ root = ROOT, now = new Date() } = {}) {
  const lines = [];
  const config = loadConfig(root);
  lines.push(`mode: ${config.mode}`);
  for (const d of listOutbox(root)) lines.push(`${d.status.padEnd(10)} ${d.id}  ${d.text}${d.problems?.length ? `  [${d.problems.join('; ')}]` : ''}`);
  const week = readSent(root).filter((r) => now - Date.parse(r.sentAt) < 7 * 86_400_000);
  lines.push(`sent in the last 7 days: ${week.length}`);
  for (const r of week) lines.push(`  ${r.sentAt.slice(0, 16)} ${r.channel} ${r.url ?? r.postId ?? ''}`);
  return lines.join('\n');
}

export async function main(argv, log = console.log) {
  const [command, ...rest] = argv;
  const dryRun = rest.includes('--dry-run');
  const args = rest.filter((a) => a !== '--dry-run');
  switch (command) {
    case 'harvest': {
      const at = args.indexOf('--docs');
      log(JSON.stringify(await harvest({ dryRun, log, docsFile: at >= 0 ? args[at + 1] : null })));
      return 0;
    }
    case 'publish':
      log(JSON.stringify(await publish({ dryRun, log })));
      return 0;
    case 'metrics':
      log(JSON.stringify(await collect({ log })));
      log(JSON.stringify(learn({ log })));
      return 0;
    case 'add':
      for (const d of addCustom(JSON.parse(readFileSync(args[0], 'utf8')))) log(`added ${d.id} [${d.status}]${d.problems.length ? ` ${d.problems.join('; ')}` : ''}`);
      return 0;
    case 'status':
      log(status());
      return 0;
    case 'approve':
    case 'reject':
      log(`${command === 'approve' ? 'approved' : 'rejected'} ${setStatus(args, command === 'approve' ? 'approved' : 'rejected', { by: process.env.PROMO_APPROVER ?? 'board' })}`);
      return 0;
    default:
      log('usage: node promo/src/cli.mjs harvest|publish|metrics|status|approve <id|all>|reject <id> [--dry-run]');
      return 2;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
