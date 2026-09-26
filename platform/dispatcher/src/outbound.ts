// The outbound lane (docs/specs/studio-reports.md): each tick, a post to the ships lane for each public
// card that went live in the last 6 hours, and one to the weekly lane for the newest published report,
// each posted at most once. Before a post the (kind, ref) row is inserted as 'sending', so the
// primary key refuses a second claim; after it the row becomes 'posted' or 'failed'. Any existing row
// is never posted again, so a timeout, an error or a crash mid-request loses that post rather than
// doubling it. While the studio is paused or the kill switch has fired nothing is posted, and a ship
// found then is recorded 'skipped' so it is never posted after resuming. With both lanes unset the lane
// makes no query and no request.
import type { DiscordPoster } from './discord.js';
import { escapeDiscord, fitPost } from './discord.js';
import type { OutboundDb, ReportPost, ShipPost } from './db.js';
import type { Logger } from './log.js';

export interface OutboundDeps {
  db: OutboundDb;
  poster: DiscordPoster;
  // The public site's origin, with no trailing slash.
  siteUrl: string;
  now: () => Date;
  log: Logger;
}

// A card first seen later than this after going live is never posted, so switching the lane on does not
// flood the channel.
export const SHIP_WINDOW_MS = 6 * 60 * 60_000;
// At most this many requests to Discord in one tick.
export const MAX_POSTS_PER_TICK = 5;
// At most this many supporters are named in a ship post; the rest are "and n more".
export const SHIP_SUPPORTERS_NAMED = 3;
// At most this many titles are named in a weekly post; the rest are "and n more".
export const WEEKLY_TITLES_NAMED = 5;

export interface OutboundOutcome {
  inert: boolean;
  posted: number;
  failed: number;
  skipped: number;
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function supporterName(supporter: { number: number; founding: boolean }): string {
  return `${supporter.founding ? 'Founding supporter' : 'Supporter'} ${supporter.number}`;
}

// "A", "A and B", "A, B and C", or "A, B, C and 4 more".
function listWithMore(items: readonly string[], total: number): string {
  const more = Math.max(0, total - items.length);
  if (more > 0) return `${items.join(', ')} and ${more} more`;
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

// "Shipped: <title>. Built by <role> for $0.29 from contributions, funded by Supporter 3, Founding
// supporter 1 and 2 more. Watch how it was built: <site>/card/<id>". At $0.00 from contributions
// (founder-billed work) the cost clause is left out, and with no supporter the funded clause.
export function shipText(card: ShipPost, siteUrl: string): string {
  let built = card.role_name ? `Built by ${escapeDiscord(card.role_name)}` : '';
  if (Math.round(card.cost_usd * 100) > 0) built += `${built ? ' for' : 'Built for'} ${usd(card.cost_usd)} from contributions`;
  const named = [...card.supporters].sort((a, b) => a.number - b.number).slice(0, SHIP_SUPPORTERS_NAMED).map(supporterName);
  if (named.length > 0) built += `${built ? ', funded' : 'Funded'} by ${listWithMore(named, Math.max(card.supporter_count, named.length))}`;
  const head = `Shipped: ${escapeDiscord(card.title)}.${built ? ` ${built}.` : ''}`;
  return fitPost(head, ` Watch how it was built: ${siteUrl}/card/${card.id}`);
}

// "This week at Mob Machine: 2 cards shipped (<title>, <title>). 6 cards are open for funding. Read
// the report: <site>/reports".
export function weeklyText(report: ReportPost, siteUrl: string): string {
  const titles = report.shipped_titles.slice(0, WEEKLY_TITLES_NAMED).map(escapeDiscord);
  const shipped = `${report.shipped_count} ${report.shipped_count === 1 ? 'card' : 'cards'} shipped`;
  const more = Math.max(0, report.shipped_count - titles.length);
  const list = titles.length > 0 ? ` (${titles.join(', ')}${more > 0 ? ` and ${more} more` : ''})` : '';
  const open = `${report.open_count} ${report.open_count === 1 ? 'card is' : 'cards are'} open for funding`;
  return fitPost(`This week at Mob Machine: ${shipped}${list}. ${open}.`, ` Read the report: ${siteUrl}/reports`);
}

export async function runOutbound(deps: OutboundDeps): Promise<OutboundOutcome> {
  const outcome: OutboundOutcome = { inert: false, posted: 0, failed: 0, skipped: 0 };
  const ships = deps.poster.enabled('ships');
  const weekly = deps.poster.enabled('weekly');
  if (!ships && !weekly) return { ...outcome, inert: true };

  const now = deps.now();
  const since = new Date(now.getTime() - SHIP_WINDOW_MS);
  const stop = await deps.db.postingStop();
  if (stop !== null) {
    if (ships) {
      for (const card of await deps.db.unpostedShips(since, 50)) {
        if (await deps.db.claimPost('ship', card.id, 'skipped', stop, now)) outcome.skipped += 1;
      }
    }
    return outcome;
  }

  let budget = MAX_POSTS_PER_TICK;
  const send = async (kind: 'ship' | 'weekly', ref: string, lane: 'ships' | 'weekly', content: string) => {
    // A row already there means another tick or process claimed it: never posted twice.
    if (!(await deps.db.claimPost(kind, ref, 'sending', null, now))) return;
    budget -= 1;
    const result = await deps.poster.post(lane, content);
    const state = result.outcome === 'posted' ? 'posted' : 'failed';
    await deps.db.finishPost(kind, ref, { state, status: result.status, messageId: result.messageId }, deps.now());
    if (state === 'posted') outcome.posted += 1;
    else outcome.failed += 1;
  };

  if (ships) {
    for (const card of await deps.db.unpostedShips(since, budget)) {
      if (budget <= 0) break;
      await send('ship', card.id, 'ships', shipText(card, deps.siteUrl));
    }
  }
  if (weekly && budget > 0) {
    const report = await deps.db.unpostedReport();
    if (report !== null) await send('weekly', report.week_start, 'weekly', weeklyText(report, deps.siteUrl));
  }
  return outcome;
}
