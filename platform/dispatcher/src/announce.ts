// The announcements lane (docs/specs/operations.md): when DISCORD_WEBHOOK_URL is set, each tick posts
// the notable feed events to it: a card funded, a card shipped, a rare or legendary card opened, a
// milestone reached and an era begun. With no address the lane is inert and makes no query.
//
// - Structured fields only. A post is built from the event's kind, the card's title, rarity and suit,
//   the goal's title and amount or the era's name (announcements_pending), never from the feed's text
//   and never from anything a player wrote; no supporter is named, not even by handle.
// - Once only. Before a post the ('announce', event id) row is claimed in outbound_posts, whose primary
//   key refuses a second claim; a timeout or a crash loses that post rather than doubling it.
// - Rate-limited: at most MAX_ANNOUNCE_PER_TICK posts a tick and MAX_ANNOUNCE_PER_HOUR an hour; an event
//   older than ANNOUNCE_WINDOW_MS is never posted, so switching the lane on does not flood the channel.
// - A ship is left to the ships lane (outbound.ts) while that lane has an address, recorded 'skipped'.
// - While the studio is paused or the kill switch has fired nothing is posted, and what is found is
//   recorded 'skipped' so it is not posted after resuming.
import type { DiscordPoster } from './discord.js';
import { escapeDiscord, fitPost } from './discord.js';
import type { Announcement, OutboundDb } from './db.js';
import type { Logger } from './log.js';

export interface AnnounceDeps {
  db: OutboundDb;
  poster: DiscordPoster;
  // The public site's origin, with no trailing slash.
  siteUrl: string;
  now: () => Date;
  log: Logger;
}

export const ANNOUNCE_WINDOW_MS = 6 * 60 * 60_000;
export const MAX_ANNOUNCE_PER_TICK = 2;
export const MAX_ANNOUNCE_PER_HOUR = 12;

export interface AnnounceOutcome {
  inert: boolean;
  posted: number;
  failed: number;
  skipped: number;
  // The hourly limit was reached; what is left waits for a later tick.
  limited: boolean;
}

const SUIT_WORDS: Record<string, string> = {
  game: 'Game',
  new_game: 'New game',
  studio: 'Studio',
  platform: 'Platform',
  machine: 'Machine',
};
const RARITIES = ['common', 'uncommon', 'rare', 'legendary'];

// "a rare Game card", from the closed lists only; anything else is left out.
function cardWords(item: Pick<Announcement, 'rarity' | 'suit'>): string {
  const rarity = item.rarity && RARITIES.includes(item.rarity) ? item.rarity : null;
  const suit = item.suit ? SUIT_WORDS[item.suit] ?? null : null;
  const words = [rarity, suit].filter((word): word is string => word !== null).join(' ');
  if (!words) return 'a card';
  return `${/^[aeiu]/i.test(words) ? 'an' : 'a'} ${words} card`;
}

function dollars(cents: number): string {
  return cents % 100 === 0 ? `$${(cents / 100).toLocaleString('en-US')}` : `$${(cents / 100).toFixed(2)}`;
}

// The post for one event, or null when a field it needs is missing.
export function announcementText(item: Announcement, siteUrl: string): string | null {
  const card = item.card_id && item.card_title ? { id: item.card_id, title: escapeDiscord(item.card_title) } : null;
  switch (item.kind) {
    case 'funded':
      return card ? fitPost(`Funded: ${card.title}, ${cardWords(item)}. The agents start building it.`, ` Watch it: ${siteUrl}/card/${card.id}`) : null;
    case 'shipped':
      return card ? fitPost(`Shipped: ${card.title}, ${cardWords(item)}.`, ` See how it was built: ${siteUrl}/card/${card.id}`) : null;
    case 'rare_card':
      return card ? fitPost(`${cardWords(item).replace(/^a/, 'A')} appeared: ${card.title}.`, ` Have a look: ${siteUrl}/card/${card.id}`) : null;
    case 'milestone':
      if (!item.goal_title) return null;
      return fitPost(
        `Milestone reached: ${escapeDiscord(item.goal_title)}${typeof item.goal_amount_cents === 'number' ? ` at ${dollars(item.goal_amount_cents)} raised` : ''}.`,
        ` The goals: ${siteUrl}/goals`,
      );
    case 'era':
      return item.era_name ? fitPost(`The studio grew into the ${escapeDiscord(item.era_name)}.`, ` Its history: ${siteUrl}/studio/history`) : null;
    default:
      return null;
  }
}

export async function runAnnouncements(deps: AnnounceDeps): Promise<AnnounceOutcome> {
  const outcome: AnnounceOutcome = { inert: false, posted: 0, failed: 0, skipped: 0, limited: false };
  if (!deps.poster.enabled('announce') || !deps.db.announcementsPending) return { ...outcome, inert: true };
  const now = deps.now();
  const since = new Date(now.getTime() - ANNOUNCE_WINDOW_MS);
  const stop = await deps.db.postingStop();
  if (stop !== null) {
    const batch = await deps.db.announcementsPending(since, 20);
    for (const item of batch.items) {
      if (await deps.db.claimPost('announce', item.ref, 'skipped', stop, now)) outcome.skipped += 1;
    }
    return outcome;
  }
  const batch = await deps.db.announcementsPending(since, 10);
  let budget = Math.min(MAX_ANNOUNCE_PER_TICK, MAX_ANNOUNCE_PER_HOUR - batch.sentLastHour);
  for (const item of batch.items) {
    if (item.kind === 'shipped' && deps.poster.enabled('ships')) {
      if (await deps.db.claimPost('announce', item.ref, 'skipped', 'ships_lane', now)) outcome.skipped += 1;
      continue;
    }
    const content = announcementText(item, deps.siteUrl);
    if (content === null) {
      if (await deps.db.claimPost('announce', item.ref, 'skipped', 'incomplete', now)) outcome.skipped += 1;
      continue;
    }
    if (budget <= 0) {
      outcome.limited = true;
      break;
    }
    if (!(await deps.db.claimPost('announce', item.ref, 'sending', null, now))) continue;
    budget -= 1;
    const result = await deps.poster.post('announce', content);
    const state = result.outcome === 'posted' ? 'posted' : 'failed';
    await deps.db.finishPost('announce', item.ref, { state, status: result.status, messageId: result.messageId }, deps.now());
    if (state === 'posted') outcome.posted += 1;
    else outcome.failed += 1;
  }
  return outcome;
}
