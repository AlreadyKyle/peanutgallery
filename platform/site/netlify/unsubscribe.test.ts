// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
// Beside the functions folder, not in it: Netlify deploys every file in netlify/functions as a function.
import cardFunction from './functions/card.mts';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './lib/public-env';
import { followUnsubscribeCopy, unsubscribeCopy } from './lib/unsubscribe';

const ORIGIN = 'https://site.example';
const PAYMENT = '00000000-0000-4000-8000-0000000000aa';
const TOKEN = 'ab'.repeat(32);
const LINK = `/api/unsubscribe?p=${PAYMENT}&t=${TOKEN}`;
const USER = '00000000-0000-4000-8000-0000000000bb';
const FOLLOW_LINK = `/api/unsubscribe?f=${USER}&t=${TOKEN}`;

type Call = { url: string; init: RequestInit };

function stubFetch(respond: (call: Call) => Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  });
  return calls;
}

const answering = (body: string, status = 200) => () => Promise.resolve(new Response(body, { status }));
const request = (path: string, init: RequestInit = {}) => cardFunction(new Request(`${ORIGIN}${path}`, init));
const oneClick = (path = LINK) =>
  request(path, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } });

function expectPage(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Netlify-CDN-Cache-Control')).toBe('no-store');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/unsubscribe', () => {
  it('answers a page with one button that posts to the same link, and changes nothing', async () => {
    const calls = stubFetch(answering('true'));
    const response = await request(LINK);
    expectPage(response, 200);
    const html = await response.text();
    expect(html).toContain(`<form method="post" action="/api/unsubscribe?p=${PAYMENT}&amp;t=${TOKEN}">`);
    expect(html).toContain(unsubscribeCopy.button);
    expect(html).not.toMatch(/<script|<style| style=/);
    expect(calls).toHaveLength(0);
  });

  it('answers a missing, malformed or extra parameter 400 with no Supabase call', async () => {
    const calls = stubFetch(answering('true'));
    for (const path of [
      '/api/unsubscribe',
      `/api/unsubscribe?p=${PAYMENT}`,
      `/api/unsubscribe?t=${TOKEN}`,
      `/api/unsubscribe?p=not-a-uuid&t=${TOKEN}`,
      `/api/unsubscribe?p=${PAYMENT}&t=${TOKEN.slice(1)}`,
      `/api/unsubscribe?p=${PAYMENT}&t=${TOKEN.toUpperCase()}`,
      `/api/unsubscribe?p=${PAYMENT.toUpperCase()}&t=${TOKEN}`,
      `${LINK}&x=1`,
      `${LINK}&t=${TOKEN}`,
      `/api/unsubscribe?f=not-a-uuid&t=${TOKEN}`,
      `/api/unsubscribe?f=${USER}&p=${PAYMENT}`,
      `${FOLLOW_LINK}&p=${PAYMENT}`,
      `/api/unsubscribe?x=${USER}&t=${TOKEN}`,
    ]) {
      const response = await request(path);
      expectPage(response, 400);
      expect(await response.text(), path).toContain(unsubscribeCopy.invalid);
    }
    expect(calls).toHaveLength(0);
  });
});

describe('POST /api/unsubscribe', () => {
  it('calls ship_notice_unsubscribe with the publishable key, the payment and the token, and confirms', async () => {
    const calls = stubFetch(answering('true'));
    const response = await oneClick();
    expectPage(response, 200);
    expect(await response.text()).toContain(unsubscribeCopy.done);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/rest/v1/rpc/ship_notice_unsubscribe`);
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe(SUPABASE_PUBLISHABLE_KEY);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ p_payment: PAYMENT, p_token: TOKEN });
  });

  it('answers 400 when the database finds the token does not match', async () => {
    stubFetch(answering('false'));
    const response = await oneClick();
    expectPage(response, 400);
    expect(await response.text()).toContain(unsubscribeCopy.invalid);
  });

  it('answers 502 when Supabase errs, answers something else or cannot be reached', async () => {
    for (const respond of [answering('{"message":"boom"}', 500), answering('{"ok":true}'), answering('not json'), () => Promise.reject(new Error('down'))]) {
      stubFetch(respond);
      const response = await oneClick();
      expectPage(response, 502);
      expect(await response.text()).toContain(unsubscribeCopy.failed);
      vi.unstubAllGlobals();
    }
  });

  it('refuses a malformed link before Supabase, and any other method', async () => {
    const calls = stubFetch(answering('true'));
    expectPage(await oneClick(`/api/unsubscribe?p=${PAYMENT}&t=nope`), 400);
    const put = await request(LINK, { method: 'PUT' });
    expectPage(put, 405);
    expect(put.headers.get('Allow')).toBe('GET, POST');
    expect(calls).toHaveLength(0);
  });
});

// docs/specs/card-follows.md: the same page for the emails about cards a player follows.
describe('/api/unsubscribe for a follow email', () => {
  it('answers GET with one button that posts to the same link, and changes nothing', async () => {
    const calls = stubFetch(answering('true'));
    const response = await request(FOLLOW_LINK);
    expectPage(response, 200);
    const html = await response.text();
    expect(html).toContain(`<form method="post" action="/api/unsubscribe?f=${USER}&amp;t=${TOKEN}">`);
    expect(html).toContain(followUnsubscribeCopy.button);
    expect(html).toContain(`<h1>${followUnsubscribeCopy.title}</h1>`);
    expect(html).not.toMatch(/<script|<style| style=/);
    expect(calls).toHaveLength(0);
  });

  it('answers POST with follow_unsubscribe, the publishable key, the profile and the token, and confirms', async () => {
    const calls = stubFetch(answering('true'));
    const response = await oneClick(FOLLOW_LINK);
    expectPage(response, 200);
    expect(await response.text()).toContain(followUnsubscribeCopy.done);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/rest/v1/rpc/follow_unsubscribe`);
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe(SUPABASE_PUBLISHABLE_KEY);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ p_user: USER, p_token: TOKEN });
  });

  it('answers 400 on a token the database refuses and 502 when Supabase fails', async () => {
    stubFetch(answering('false'));
    const refused = await oneClick(FOLLOW_LINK);
    expectPage(refused, 400);
    expect(await refused.text()).toContain(followUnsubscribeCopy.invalid);
    vi.unstubAllGlobals();
    stubFetch(answering('{"message":"boom"}', 500));
    const failed = await oneClick(FOLLOW_LINK);
    expectPage(failed, 502);
    expect(await failed.text()).toContain(followUnsubscribeCopy.failed);
  });
});
