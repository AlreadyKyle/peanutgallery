import { describe, expect, it } from 'vitest';
import { postThanks, readThanksSession, SESSION_KEY, thanksAnswerFrom } from './thanks';

const SESSION = 'cs_test_a1B2c3D4e5F6g7H8';

function memory(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), store };
}

describe('readThanksSession', () => {
  it('takes a well-formed session from the address, stores it and replaces the address with /thanks', () => {
    const storage = memory();
    const replaced: string[] = [];
    expect(readThanksSession(`?session=${SESSION}`, storage, (path) => replaced.push(path))).toBe(SESSION);
    expect(storage.store.get(SESSION_KEY)).toBe(SESSION);
    expect(replaced).toEqual(['/thanks']);
  });

  it('drops a malformed session from the address too, and falls back to the stored one', () => {
    const replaced: string[] = [];
    expect(readThanksSession('?session=cs_live_short', memory(), (path) => replaced.push(path))).toBeNull();
    expect(replaced).toEqual(['/thanks']);
    expect(readThanksSession('?session=<script>', memory({ [SESSION_KEY]: SESSION }), () => undefined)).toBe(SESSION);
  });

  it('reads the stored session after a reload, and none when nothing is stored or storage is blocked', () => {
    const replaced: string[] = [];
    expect(readThanksSession('', memory({ [SESSION_KEY]: SESSION }), (path) => replaced.push(path))).toBe(SESSION);
    expect(replaced).toEqual([]);
    expect(readThanksSession('', memory(), () => undefined)).toBeNull();
    expect(readThanksSession('', memory({ [SESSION_KEY]: 'tampered value' }), () => undefined)).toBeNull();
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readThanksSession(`?session=${SESSION}`, blocked, () => undefined)).toBe(SESSION);
    expect(readThanksSession('', blocked, () => undefined)).toBeNull();
    expect(readThanksSession(`?session=${SESSION}`, null, () => undefined)).toBe(SESSION);
  });
});

describe('the /api/thanks answer', () => {
  it('reads each status and only the recorded keys it knows', () => {
    expect(thanksAnswerFrom({ status: 'pending' })).toEqual({ status: 'pending' });
    expect(thanksAnswerFrom({ status: 'not_counted' })).toEqual({ status: 'not_counted' });
    expect(
      thanksAnswerFrom({
        status: 'recorded',
        supporter: { number: 12, founding: true },
        named_card_id: 'a',
        reached: ['a', 'b', 'c', 'd', 'e', 'f'],
        waiting: true,
        credit: 'held',
        held_until: '2026-10-07',
        terms_version: 2,
      }),
    ).toEqual({ status: 'recorded', supporter: { number: 12, founding: true }, namedCardId: 'a', reached: ['a', 'b', 'c', 'd', 'e'], waiting: true, credit: 'held', heldUntil: '2026-10-07', termsVersion: 2 });
    expect(() => thanksAnswerFrom({ status: 'weird' })).toThrow();
    expect(() => thanksAnswerFrom([])).toThrow();
  });

  it('posts the session as JSON and rejects a status other than 200', async () => {
    const sent: RequestInit[] = [];
    const ok = (async (_url: string, init: RequestInit) => {
      sent.push(init);
      return new Response('{"status":"pending"}', { status: 200 });
    }) as unknown as typeof fetch;
    expect(await postThanks(SESSION, ok)).toEqual({ status: 'pending' });
    expect(sent[0]!.method).toBe('POST');
    expect(JSON.parse(String(sent[0]!.body))).toEqual({ session: SESSION });
    const bad = (async () => new Response('{"error":"x"}', { status: 400 })) as unknown as typeof fetch;
    await expect(postThanks(SESSION, bad)).rejects.toThrow('answered 400');
  });
});
