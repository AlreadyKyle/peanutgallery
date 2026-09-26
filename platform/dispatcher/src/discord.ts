// The Discord poster (docs/specs/studio-reports.md): plain-text posts to the ships and weekly
// webhooks, outbound only. An unset lane is inert and makes no request. Every post sets the studio's
// username, allows no mention, waits for Discord's message id (?wait=true) and gives up after the
// timeout. A webhook address is a bearer secret: no log line, error or result carries it, only the
// lane and the HTTP status.
import { fetchWithTimeout } from './db.js';
import type { Logger } from './log.js';

export type Lane = 'ships' | 'weekly';

export interface PostResult {
  outcome: 'posted' | 'failed' | 'inert';
  // Discord's HTTP status; null when no answer came (inert, a timeout or a network failure).
  status: number | null;
  messageId: string | null;
}

export interface DiscordPoster {
  // Whether a lane has an address.
  enabled(lane: Lane): boolean;
  post(lane: Lane, content: string): Promise<PostResult>;
}

export interface DiscordPosterOptions {
  ships: string | null;
  weekly: string | null;
  fetchFn?: typeof fetch;
  log: Logger;
  timeoutMs?: number;
}

export const DISCORD_USERNAME = 'Mob Machine';
// Discord refuses a message longer than this.
export const MAX_CONTENT = 2000;
export const DISCORD_TIMEOUT_MS = 10_000;

// Discord markdown and the characters of a mention, escaped with a backslash, and every run of white
// space (a line break included) made one space, so a title can neither format the post nor start a
// heading, a list or a quote.
export function escapeDiscord(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\*_~`|[\]()<>#@:]/g, (character) => `\\${character}`);
}

// At most `max` UTF-16 units (the stricter count), cut on a code point, ending with an ellipsis when cut.
export function truncate(text: string, max = MAX_CONTENT): string {
  if (text.length <= max) return text;
  let out = '';
  for (const point of text) {
    if (out.length + point.length > max - 1) break;
    out += point;
  }
  return `${out}…`;
}

// The head, cut to leave room for the tail whole: a post's link is never cut off.
export function fitPost(head: string, tail: string, max = MAX_CONTENT): string {
  if (head.length + tail.length <= max) return head + tail;
  return truncate(head, max - tail.length) + tail;
}

export function createDiscordPoster(options: DiscordPosterOptions): DiscordPoster {
  const urls: Record<Lane, string | null> = { ships: options.ships, weekly: options.weekly };
  const fetchFn = fetchWithTimeout(options.fetchFn ?? fetch, options.timeoutMs ?? DISCORD_TIMEOUT_MS);
  const { log } = options;
  return {
    enabled: (lane) => urls[lane] !== null,
    async post(lane, content) {
      const url = urls[lane];
      if (url === null) return { outcome: 'inert', status: null, messageId: null };
      const body = { content: truncate(content), username: DISCORD_USERNAME, allowed_mentions: { parse: [] } };
      let response: Response;
      try {
        response = await fetchFn(`${url}?wait=true`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (error) {
        // The error's message could quote the address, so only its kind is logged.
        log.warn('discord', 'post failed', { lane, status: null, error: error instanceof Error ? error.name : 'unknown' });
        return { outcome: 'failed', status: null, messageId: null };
      }
      if (!response.ok) {
        log.warn('discord', 'post failed', { lane, status: response.status });
        return { outcome: 'failed', status: response.status, messageId: null };
      }
      const answer: unknown = await response.json().catch(() => null);
      const id = typeof answer === 'object' && answer !== null ? (answer as { id?: unknown }).id : null;
      log.info('discord', 'posted', { lane, status: response.status });
      return { outcome: 'posted', status: response.status, messageId: typeof id === 'string' ? id : null };
    },
  };
}
