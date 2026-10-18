// Turns the public documents into moments: things that happened (or standing facts) worth a post.
// The kinds follow docs/strategy/growth.md "Content as a process" in the studio repository.
// A moment is { kind, ref, at, priority, facts }. ref is stable, so the same moment is never drafted twice.

export const PRIORITY = {
  era: 95,
  milestone: 90,
  stage: 85,
  card_legendary: 80,
  suggestion_live: 75,
  ship: 70,
  weekly_report: 65,
  card_rare: 60,
  seed_featured: 50,
  daily_dust: 45,
  spotlight: 30,
  play_dust: 20,
  explainer: 15,
};

export const GAMES = { 'seed-1': 'Dust' };

// Standing facts about how the studio works, rotated as evergreen posts. Each is true today and
// follows docs/COPY.md: plain, no slogans, no chance words, no countdowns.
export const EXPLAINERS = [
  { ref: 'ledger', text: 'Every change our AI agents make is on a public ledger, with what it cost and who funded it.', path: '/ledger' },
  { ref: 'cards', text: 'Each change to our games starts as a card. Fund a card and an AI agent builds it, then automated checks decide if it goes live.', path: '/how-it-works' },
  { ref: 'free', text: 'Our games are free to play in a browser. Contributions pay for the agent work that changes them.', path: '/' },
  { ref: 'watch', text: 'You can watch the studio work live: each agent at its desk, and each card moving from funded to live.', path: '/' },
  { ref: 'rarity', text: 'Every card has a rarity anyone can check, set by its id. Nobody pays for a roll.', path: '/faq' },
  { ref: 'suggest', text: 'Anyone can suggest a change to the games. The good ones become cards the agents build.', path: '/suggest' },
];

const DAY = 86_400_000;
const CLOSED_STAGES = ['live', 'building', 'gated', 'queued', 'funded', 'rejected', 'paused'];

function within(at, now, hours) {
  return at && now - Date.parse(at) <= hours * 3_600_000 && Date.parse(at) <= now;
}

export function harvestMoments(docs, config, now = Date.now()) {
  const moments = [];
  const roles = config.roles ?? {};
  const liveCards = docs.live?.cards ?? {};
  const cards = docs.cards?.cards ?? [];
  const lookback = config.lookbackHours ?? 72;
  const spotlights = [];

  for (const card of cards) {
    const live = liveCards[card.id] ?? {};
    const game = GAMES[card.folder] ?? null;
    const base = {
      id: card.id,
      title: card.title,
      summary: card.summary,
      game,
      suit: card.suit,
      rarity: card.rarity,
      role: roles[card.executor_role_id ?? live.executor_role_id] ?? null,
      spentUsd: Number(live.spent_usd ?? 0),
      fundedUsd: Number(live.funded_usd ?? card.funded_usd ?? 0),
      targetUsd: Number(live.funding_target_usd ?? card.funding_target_usd ?? 0),
      supporters: live.contributors ?? 0,
      path: `/card/${card.id}`,
      image: `/api/card/${card.id}/preview.png`,
    };
    if (card.stage === 'live' && within(card.live_at, now, lookback)) {
      moments.push({ kind: 'ship', ref: card.id, at: card.live_at, facts: base });
    }
    const openForFunding = card.horizon === 'now' && !CLOSED_STAGES.includes(card.stage) && base.targetUsd > base.fundedUsd;
    if (openForFunding) spotlights.push(base);
  }

  // One open card a day: the one nearest its target, so a spotlight points where money finishes work.
  const pick = spotlights.sort((a, b) => b.fundedUsd / b.targetUsd - a.fundedUsd / a.targetUsd)[0];
  if (pick) moments.push({ kind: 'spotlight', ref: `${pick.id}:${new Date(now).toISOString().slice(0, 10)}`, at: new Date(now).toISOString(), facts: pick });

  for (const event of docs.feed?.events ?? []) {
    if (!within(event.at, now, lookback)) continue;
    const facts = { id: event.cardId ?? null, text: event.text, rarity: event.rarity, suit: event.suit, path: event.cardId ? `/card/${event.cardId}` : '/' };
    if (event.kind === 'card_opened' && event.rarity === 'legendary') moments.push({ kind: 'card_legendary', ref: event.id, at: event.at, facts });
    else if (event.kind === 'card_opened' && event.rarity === 'rare') moments.push({ kind: 'card_rare', ref: event.id, at: event.at, facts });
    else if (event.kind === 'milestone') moments.push({ kind: 'milestone', ref: event.id, at: event.at, facts: { ...facts, path: '/goals' } });
    else if (event.kind === 'era') moments.push({ kind: 'era', ref: event.id, at: event.at, facts: { ...facts, path: '/studio/history' } });
    else if (event.kind === 'stage') moments.push({ kind: 'stage', ref: event.id, at: event.at, facts });
    else if (event.kind === 'seed_featured') moments.push({ kind: 'seed_featured', ref: event.id, at: event.at, facts: { ...facts, path: '/seeds' } });
    else if (event.kind === 'suggestion' && /live/i.test(event.text)) moments.push({ kind: 'suggestion_live', ref: event.id, at: event.at, facts });
  }

  const report = docs.reports?.reports?.[0];
  if (report && within(report.published_at, now, 7 * 24)) {
    const shipped = report.facts?.shipped ?? [];
    moments.push({
      kind: 'weekly_report',
      ref: report.week_start,
      at: report.published_at,
      facts: { weekStart: report.week_start, shipped: shipped.map((s) => s.title), count: shipped.length, path: '/reports' },
    });
  }

  // Evergreen: one a day, rotated by day so consecutive days differ.
  const dayIndex = Math.floor(now / DAY);
  const explainer = EXPLAINERS[dayIndex % EXPLAINERS.length];
  const day = new Date(now).toISOString().slice(0, 10);
  if (dayIndex % 2 === 0) {
    moments.push({ kind: 'explainer', ref: `${explainer.ref}:${day}`, at: new Date(now).toISOString(), facts: { text: explainer.text, path: explainer.path } });
  } else {
    const shipped = cards.filter((c) => c.stage === 'live' && GAMES[c.folder]).length;
    moments.push({ kind: 'play_dust', ref: `dust:${day}`, at: new Date(now).toISOString(), facts: { game: 'Dust', shipped, url: config.playUrl ?? 'https://play.mobmachine.games' } });
  }

  return moments.map((m) => ({ ...m, priority: PRIORITY[m.kind] ?? 10 })).sort((a, b) => b.priority - a.priority || b.at.localeCompare(a.at));
}
