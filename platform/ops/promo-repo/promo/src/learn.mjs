// The learning loop. Every sent post gets a reward from its measured engagement, normalised per
// channel, and the playbook keeps a running mean per arm (kind x channel x variant) and per posting
// hour. Composing picks variants by UCB1, so a new framing is always tried a few times and a framing
// that keeps losing is tried less. Channel weights move toward what brings people to the site.

export function emptyPlaybook() {
  return { version: 1, arms: {}, hours: {}, channels: {}, scale: {}, notes: [], updatedAt: null };
}

const armKey = (kind, channel, variant) => `${kind}|${channel}|${variant}`;

/** UCB1 over the variants usable for this moment. An untried variant goes first. */
export function chooseVariant(playbook, kind, channel, variants, explore = 0.6) {
  const arms = (playbook ?? emptyPlaybook()).arms;
  const stats = variants.map((v) => arms[armKey(kind, channel, v)] ?? { n: 0, mean: 0 });
  const untried = variants.filter((_, i) => stats[i].n === 0);
  if (untried.length) return untried[0];
  const total = stats.reduce((s, a) => s + a.n, 0);
  let best = variants[0];
  let bestScore = -Infinity;
  variants.forEach((v, i) => {
    const score = stats[i].mean + explore * Math.sqrt(Math.log(total) / stats[i].n);
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  });
  return best;
}

/** Raw engagement for one post's metrics; platforms that report fewer fields just count less. */
export function engagement(m) {
  return (m.likes ?? 0) + 2 * (m.reposts ?? 0) + 2 * (m.replies ?? 0) + 2 * (m.quotes ?? 0) + 3 * (m.clicks ?? 0) + (m.views ?? 0) / 100;
}

function runningUpdate(entry, reward, alpha = 0.3) {
  const n = (entry?.n ?? 0) + 1;
  // A plain mean for the first few, then an exponential average so the playbook follows change.
  const mean = n <= 5 ? ((entry?.mean ?? 0) * (n - 1) + reward) / n : (1 - alpha) * entry.mean + alpha * reward;
  return { n, mean: Number(mean.toFixed(4)) };
}

/**
 * results: [{ kind, channel, variant, hour, metrics }] for posts at least a day old.
 * siteVisits: { channelTag: count } from the site's own counters, when they exist.
 */
export function updatePlaybook(playbook, results, siteVisits = {}, now = new Date()) {
  const next = structuredClone(playbook ?? emptyPlaybook());
  const byChannel = {};
  for (const r of results) (byChannel[r.channel] ??= []).push(engagement(r.metrics));
  for (const [channel, values] of Object.entries(byChannel)) {
    const sorted = [...values].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
    const prev = next.scale[channel] ?? p75;
    next.scale[channel] = Number((0.7 * prev + 0.3 * p75).toFixed(4));
  }
  for (const r of results) {
    const scale = (next.scale[r.channel] ?? 0) + 1;
    const reward = Math.min(1, engagement(r.metrics) / scale);
    const key = armKey(r.kind, r.channel, r.variant);
    next.arms[key] = runningUpdate(next.arms[key], reward);
    const hourKey = `${r.channel}|${r.hour}`;
    next.hours[hourKey] = runningUpdate(next.hours[hourKey], reward);
    const ch = (next.channels[r.channel] ??= { posts: 0, engagement: 0, visits: 0 });
    ch.posts += 1;
    ch.engagement = Number((ch.engagement + engagement(r.metrics)).toFixed(2));
  }
  for (const [channel, visits] of Object.entries(siteVisits)) {
    (next.channels[channel] ??= { posts: 0, engagement: 0, visits: 0 }).visits = visits;
  }
  next.updatedAt = now.toISOString();
  return next;
}

/** The UTC hour to post on a channel: the best measured hour once there is evidence, else a default. */
export function bestHour(playbook, channel, fallback = 15) {
  let best = fallback;
  let bestMean = -1;
  for (const [key, stat] of Object.entries(playbook?.hours ?? {})) {
    const [ch, hour] = key.split('|');
    if (ch !== channel || stat.n < 3) continue;
    if (stat.mean > bestMean) {
      bestMean = stat.mean;
      best = Number(hour);
    }
  }
  return best;
}
