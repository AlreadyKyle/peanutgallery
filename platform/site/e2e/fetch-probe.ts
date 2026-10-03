import type { Page } from '@playwright/test';

export interface FetchProbe {
  /** How many times the page has called fetch for the path. */
  asked: () => Promise<number>;
  /** How many of those answers the page has finished acting on. */
  handled: () => Promise<number>;
}

/**
 * Counts, inside the page, its fetches of one path and the answers it has acted on, for tests that
 * move a fake clock (docs/specs/gate-speed.md). A poll schedules its next read only once an answer
 * is handled (studio.tsx, thanks.ts), so a test must not move the clock before then; and a fetch the
 * clock fires is counted the moment it is called, where the request event reaches the test only
 * later. `handled` rises in a task posted when the answer's JSON is read, which runs only after the
 * page's own handling of it has finished. Call before the page loads.
 */
export async function fetchProbe(page: Page, pathname: string): Promise<FetchProbe> {
  await page.addInitScript((path) => {
    const w = window as unknown as { __fetchProbe?: Record<string, { asked: number; handled: number }> };
    const counts = { asked: 0, handled: 0 };
    w.__fetchProbe = { ...w.__fetchProbe, [path]: counts };
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const mine = new URL(url, location.href).pathname === path;
      if (mine) counts.asked += 1;
      const response = await original(input, init);
      if (!mine) return response;
      const json = response.json.bind(response);
      response.json = () =>
        json().then((value: unknown) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => {
            counts.handled += 1;
          };
          channel.port2.postMessage(0);
          return value;
        });
      return response;
    };
  }, pathname);
  const read = (key: 'asked' | 'handled') =>
    page.evaluate(
      ([path, k]) => (window as unknown as { __fetchProbe?: Record<string, Record<string, number>> }).__fetchProbe?.[path]?.[k] ?? 0,
      [pathname, key] as const,
    );
  return { asked: () => read('asked'), handled: () => read('handled') };
}
