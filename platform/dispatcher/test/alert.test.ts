import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ALERT_TITLE, createAlerter } from '../src/alert.js';
import { createLogger } from '../src/log.js';

interface Sent {
  url: string;
  method: string;
  title: string | null;
  body: string | null;
}

function recorder(status = 200) {
  const sent: Sent[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    sent.push({ url: String(input), method: init?.method ?? 'GET', title: headers.get('Title'), body: typeof init?.body === 'string' ? init.body : null });
    return new Response('', { status });
  }) as typeof fetch;
  return { fetchFn, sent };
}

function logs() {
  const lines: string[] = [];
  const log = createLogger(new Writable({ write: (chunk, _enc, cb) => { lines.push(String(chunk)); cb(); } }));
  return { log, lines };
}

describe('createAlerter', () => {
  it('makes no request when neither URL is set', async () => {
    const { fetchFn, sent } = recorder();
    const alert = createAlerter({ healthcheckUrl: null, ntfyTopicUrl: null, log: logs().log, fetchFn });
    await alert.ping();
    await alert.notify('Card rejected');
    await alert.notifyOnce('k', 'Daily cap');
    expect(sent).toEqual([]);
  });

  it('pings the healthcheck and posts a titled line to the topic', async () => {
    const { fetchFn, sent } = recorder();
    const alert = createAlerter({ healthcheckUrl: 'https://hc-ping.com/check', ntfyTopicUrl: 'https://ntfy.sh/topic', log: logs().log, fetchFn });
    await alert.ping();
    await alert.notify('Card 4c2f5a1e rejected (gate): Rename the Gatherer.');
    expect(sent).toEqual([
      { url: 'https://hc-ping.com/check', method: 'GET', title: null, body: null },
      { url: 'https://ntfy.sh/topic', method: 'POST', title: ALERT_TITLE, body: 'Card 4c2f5a1e rejected (gate): Rename the Gatherer.' },
    ]);
  });

  it('sends a keyed message once per process', async () => {
    const { fetchFn, sent } = recorder();
    const alert = createAlerter({ healthcheckUrl: null, ntfyTopicUrl: 'https://ntfy.sh/topic', log: logs().log, fetchFn });
    await alert.notifyOnce('daily_cap:2026-09-14', 'cap');
    await alert.notifyOnce('daily_cap:2026-09-14', 'cap');
    await alert.notifyOnce('daily_cap:2026-09-15', 'cap');
    expect(sent).toHaveLength(2);
  });

  it('logs a failed or refused request and never throws', async () => {
    const { log, lines } = logs();
    const throwing = (async () => {
      throw new Error('getaddrinfo ENOTFOUND ntfy.sh');
    }) as typeof fetch;
    await expect(createAlerter({ healthcheckUrl: null, ntfyTopicUrl: 'https://ntfy.sh/topic', log, fetchFn: throwing }).notify('x')).resolves.toBeUndefined();
    await createAlerter({ healthcheckUrl: 'https://hc-ping.com/check', ntfyTopicUrl: null, log, fetchFn: recorder(404).fetchFn }).ping();
    expect(lines.map((line) => JSON.parse(line).msg)).toEqual(['ntfy post failed', 'healthcheck ping returned http 404']);
  });
});
