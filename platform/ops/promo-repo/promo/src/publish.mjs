// Sends approved drafts. In review mode only drafts a person approved go out; in auto mode a draft
// that passed every check goes out too. Per channel: at most maxPerDay posts, at least minGapMinutes
// apart, highest priority first. A draft is marked sending and committed to disk before the request,
// so a crash loses a post rather than doubling it (the dispatcher's outbound lane works the same way).
import { adapterFor } from './channels/index.mjs';
import { appendSent, dayOf, listOutbox, loadConfig, readSent, removeDraft, ROOT, saveDraft } from './lib.mjs';

const MAX_ATTEMPTS = 3;

export function sendable(draft, mode) {
  if (draft.status === 'approved') return true;
  return mode === 'auto' && draft.status === 'pending' && (draft.problems ?? []).length === 0;
}

/** Drafts older than this are dropped: news that old is no longer news. */
export function expired(draft, now, lookbackHours) {
  const kind = draft.moment.kind;
  const hours = kind === 'custom' ? 14 * 24 : ['explainer', 'play_dust', 'spotlight'].includes(kind) ? 30 : lookbackHours * 2;
  return now - Date.parse(draft.moment.at ?? draft.createdAt) > hours * 3_600_000;
}

export async function publish({ root = ROOT, env = process.env, fetch: f = fetch, now = new Date(), dryRun = false, log = console.log } = {}) {
  const config = loadConfig(root);
  const sent = readSent(root);
  const today = dayOf(now.toISOString());
  const drafts = listOutbox(root).sort((a, b) => (b.moment.priority ?? 0) - (a.moment.priority ?? 0) || a.createdAt.localeCompare(b.createdAt));
  const summary = { sent: 0, skipped: 0, failed: 0, expired: 0 };

  for (const draft of drafts) {
    if (draft.status === 'rejected' || expired(draft, now.getTime(), config.lookbackHours ?? 72)) {
      if (!dryRun) removeDraft(draft.id, root);
      summary.expired += 1;
      continue;
    }
    if (!sendable(draft, config.mode)) continue;
    const ch = config.channels[draft.channel];
    const adapter = adapterFor(draft.channel, config);
    if (!ch?.enabled || !adapter) {
      summary.skipped += 1;
      continue;
    }
    if (!adapter.ready(env)) {
      log(`skip ${draft.id}: no ${draft.channel} credentials`);
      summary.skipped += 1;
      continue;
    }
    const mine = sent.filter((r) => r.channel === draft.channel);
    if (mine.filter((r) => dayOf(r.sentAt) === today).length >= (ch.maxPerDay ?? 2)) continue;
    const last = mine.at(-1);
    if (last && now - Date.parse(last.sentAt) < (config.minGapMinutes ?? 120) * 60_000) continue;
    if (draft.notBefore && Date.parse(draft.notBefore) > now) continue;

    if (dryRun) {
      log(`would send ${draft.id} to ${draft.channel}: ${draft.text}`);
      summary.sent += 1;
      sent.push({ channel: draft.channel, sentAt: now.toISOString() });
      continue;
    }
    saveDraft({ ...draft, status: 'sending', attempts: (draft.attempts ?? 0) + 1 }, root);
    try {
      const result = await adapter.send(draft, { env, fetch: f, root });
      const receipt = {
        id: draft.id,
        channel: draft.channel,
        kind: draft.moment.kind,
        ref: draft.moment.ref,
        variant: draft.variant,
        text: draft.text,
        link: draft.link,
        postId: result.postId,
        url: result.url,
        hour: now.getUTCHours(),
        sentAt: now.toISOString(),
      };
      appendSent(receipt, root);
      sent.push(receipt);
      removeDraft(draft.id, root);
      summary.sent += 1;
      log(`sent ${draft.id} ${result.url ?? result.postId ?? ''}`);
    } catch (error) {
      const attempts = (draft.attempts ?? 0) + 1;
      saveDraft({ ...draft, status: attempts >= MAX_ATTEMPTS ? 'failed' : draft.status, attempts, error: String(error.message).slice(0, 500) }, root);
      summary.failed += 1;
      log(`failed ${draft.id}: ${error.message}`);
    }
  }
  return summary;
}
