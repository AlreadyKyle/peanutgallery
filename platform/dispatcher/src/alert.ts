// Board alerts: a liveness ping to a healthcheck URL on every tick, and one-line messages to an
// ntfy topic when a card needs a human. Both are optional; an unset URL makes no request. A failed
// request is logged and never stops a tick or a card.
import { errorMessage, type Logger } from './log.js';

export interface Alerter {
  ping(): Promise<void>;
  notify(message: string): Promise<void>;
  // Sends the message the first time this process sees the key, so a condition that holds for a
  // whole day alerts once.
  notifyOnce(key: string, message: string): Promise<void>;
  // Lets notifyOnce send for the key again.
  forget(key: string): void;
}

export interface AlertOptions {
  healthcheckUrl: string | null;
  ntfyTopicUrl: string | null;
  log: Logger;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export const ALERT_TITLE = 'Mob Machine dispatcher';
const TIMEOUT_MS = 10_000;

export function createAlerter(opts: AlertOptions): Alerter {
  const fetchFn = opts.fetchFn ?? fetch;
  const sent = new Set<string>();

  async function send(url: string, init: RequestInit, what: string): Promise<void> {
    try {
      const response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS) });
      if (!response.ok) opts.log.warn('alert', `${what} returned http ${response.status}`);
    } catch (error) {
      opts.log.warn('alert', `${what} failed`, { error: errorMessage(error) });
    }
  }

  async function notify(message: string): Promise<void> {
    if (!opts.ntfyTopicUrl) return;
    await send(opts.ntfyTopicUrl, { method: 'POST', headers: { Title: ALERT_TITLE }, body: message }, 'ntfy post');
  }

  return {
    async ping() {
      if (opts.healthcheckUrl) await send(opts.healthcheckUrl, { method: 'GET' }, 'healthcheck ping');
    },
    notify,
    forget(key) {
      sent.delete(key);
    },
    async notifyOnce(key, message) {
      if (sent.has(key)) return;
      sent.add(key);
      await notify(message);
    },
  };
}
