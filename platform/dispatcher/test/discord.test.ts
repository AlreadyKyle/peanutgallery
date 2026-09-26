import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createDiscordPoster, DISCORD_USERNAME, escapeDiscord, fitPost, MAX_CONTENT, truncate } from '../src/discord.js';
import { createLogger } from '../src/log.js';
import { hangingFetch, mockFetch } from './helpers/mock-fetch.js';

// docs/specs/studio-reports.md: the Discord poster. The webhook addresses carry a token that must never
// reach a log line.
const TOKEN = 'tok-FIXTURE_SecretPart-0123';
const SHIPS = `https://discord.com/api/webhooks/111/${TOKEN}`;
const WEEKLY = `https://discord.com/api/webhooks/222/${TOKEN}-weekly`;

function capture() {
  const lines: string[] = [];
  const log = createLogger(new Writable({ write: (chunk, _enc, cb) => { lines.push(String(chunk)); cb(); } }));
  return { log, lines };
}

describe('the Discord poster', () => {
  it('posts plain text with the username, no mentions and ?wait=true, and keeps the message id', async () => {
    const { log, lines } = capture();
    const { fetchFn, calls } = mockFetch(() => ({ status: 200, json: { id: '998877', content: 'x' } }));
    const poster = createDiscordPoster({ ships: SHIPS, weekly: WEEKLY, fetchFn, log });
    expect(await poster.post('ships', 'Shipped: a card.')).toEqual({ outcome: 'posted', status: 200, messageId: '998877' });
    expect(calls).toEqual([
      { method: 'POST', url: `${SHIPS}?wait=true`, body: { content: 'Shipped: a card.', username: DISCORD_USERNAME, allowed_mentions: { parse: [] } } },
    ]);
    expect(DISCORD_USERNAME).toBe('Mob Machine');
    await poster.post('weekly', 'This week.');
    expect(calls[1]!.url).toBe(`${WEEKLY}?wait=true`);
    expect(lines.join('')).not.toContain(TOKEN);
    expect(lines.map((line) => JSON.parse(line)).map((line) => [line.msg, line.lane, line.status])).toEqual([
      ['posted', 'ships', 200],
      ['posted', 'weekly', 200],
    ]);
  });

  it('is inert for an unset lane: no request', async () => {
    const { log } = capture();
    const { fetchFn, calls } = mockFetch(() => ({ status: 200, json: { id: '1' } }));
    const poster = createDiscordPoster({ ships: null, weekly: WEEKLY, fetchFn, log });
    expect(poster.enabled('ships')).toBe(false);
    expect(poster.enabled('weekly')).toBe(true);
    expect(await poster.post('ships', 'x')).toEqual({ outcome: 'inert', status: null, messageId: null });
    expect(calls).toEqual([]);
  });

  it('answers failed on a non-2xx, a throw or a timeout, and logs only the lane and the status', async () => {
    const { log, lines } = capture();
    const server = mockFetch(() => ({ status: 500, text: `upstream said ${TOKEN}` }));
    expect(await createDiscordPoster({ ships: SHIPS, weekly: null, fetchFn: server.fetchFn, log }).post('ships', 'x')).toEqual({ outcome: 'failed', status: 500, messageId: null });
    const throwing = (async () => {
      throw new TypeError(`fetch failed for ${SHIPS}`);
    }) as typeof fetch;
    expect(await createDiscordPoster({ ships: SHIPS, weekly: null, fetchFn: throwing, log }).post('ships', 'x')).toEqual({ outcome: 'failed', status: null, messageId: null });
    const hanging = hangingFetch();
    const started = Date.now();
    expect(await createDiscordPoster({ ships: SHIPS, weekly: null, fetchFn: hanging.fetchFn, log, timeoutMs: 30 }).post('ships', 'x')).toEqual({ outcome: 'failed', status: null, messageId: null });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(hanging.signals[0]!.aborted).toBe(true);
    const text = lines.join('');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('discord.com');
    expect(lines.map((line) => JSON.parse(line)).map((line) => [line.level, line.msg, line.lane, line.status, line.error])).toEqual([
      ['warn', 'post failed', 'ships', 500, undefined],
      ['warn', 'post failed', 'ships', null, 'TypeError'],
      ['warn', 'post failed', 'ships', null, 'TimeoutError'],
    ]);
  });

  it('truncates a body to 2,000 characters', async () => {
    const { log } = capture();
    const { fetchFn, calls } = mockFetch(() => ({ status: 200, text: '' }));
    const result = await createDiscordPoster({ ships: SHIPS, weekly: null, fetchFn, log }).post('ships', 'a'.repeat(5000));
    expect(result).toEqual({ outcome: 'posted', status: 200, messageId: null });
    const content = (calls[0]!.body as { content: string }).content;
    expect(content.length).toBe(MAX_CONTENT);
    expect(content.endsWith('…')).toBe(true);
  });
});

describe('escaping and fitting', () => {
  it('escapes Discord markdown and mentions, and flattens line breaks', () => {
    expect(escapeDiscord('**bold** _it_ ~~x~~ `code` ||spoiler||')).toBe('\\*\\*bold\\*\\* \\_it\\_ \\~\\~x\\~\\~ \\`code\\` \\|\\|spoiler\\|\\|');
    expect(escapeDiscord('@everyone and @here <@123> <#9> <:e:1>')).toBe('\\@everyone and \\@here \\<\\@123\\> \\<\\#9\\> \\<\\:e\\:1\\>');
    expect(escapeDiscord('[click](https://evil.test)')).toBe('\\[click\\]\\(https\\://evil.test\\)');
    expect(escapeDiscord('# heading\n> quote\n- item')).toBe('\\# heading \\> quote - item');
    expect(escapeDiscord('back\\slash')).toBe('back\\\\slash');
    expect(escapeDiscord('Plain title, with a comma.')).toBe('Plain title, with a comma.');
  });

  it('cuts on a code point and keeps the tail whole', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
    // An emoji is two UTF-16 units and is never split.
    expect(truncate('ab😀cd', 4)).toBe('ab…');
    const fitted = fitPost('x'.repeat(3000), ' Read the report: https://site.test/reports');
    expect(fitted.length).toBe(MAX_CONTENT);
    expect(fitted.endsWith('… Read the report: https://site.test/reports')).toBe(true);
    expect(fitPost('short.', ' tail')).toBe('short. tail');
  });
});
