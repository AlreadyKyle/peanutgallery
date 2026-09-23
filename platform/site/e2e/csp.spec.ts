import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { strayNetlifyHosts } from '../scripts/board-address.mjs';
import { PLAY_URL, SUPABASE_URL } from './fixture-env';
import { expect, test } from './fixtures';

// vite preview sends netlify.toml's headers (vite.config.ts), so this run loads every page under the
// production Content Security Policy: frame-ancestors, connect-src and form-action enforced, the full
// policy report-only. Any report, enforced or report-only, fails a page load; a connection to a host outside
// connect-src is refused.
const ROUTES = ['/', '/contribute', '/ledger', '/how-it-works', '/team', '/roadmap', '/terms', '/privacy', '/refunds', '/contact', '/board', '/no-such-page', '/design-kit-7q4m'];
const toml = readFileSync(fileURLToPath(new URL('../netlify.toml', import.meta.url)), 'utf8');
const enforced = toml.match(/^\s*Content-Security-Policy\s*=\s*"([^"]*)"/m)?.[1] ?? '';
const host = new URL(SUPABASE_URL).host;

async function watchPolicy(page: Page): Promise<string[]> {
  const reports: string[] = [];
  await page.exposeFunction('e2ePolicyReport', (line: string) => reports.push(line));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { e2ePolicyReport: (line: string) => void }).e2ePolicyReport(
        `${event.disposition} ${event.effectiveDirective} ${event.blockedURI || 'inline'} on ${location.pathname}`,
      );
    });
  });
  return reports;
}

test('the preview sends the enforced policy from netlify.toml: frame-ancestors, connect-src to the site and Supabase only, and form-action', async ({ page }) => {
  expect(enforced).toBe(`frame-ancestors 'none'; connect-src 'self' https://${host} wss://${host}; form-action 'self'`);
  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toBe(enforced);
  expect(response?.headers()['content-security-policy-report-only']).toContain(`connect-src 'self' https://${host} wss://${host}`);
});

test('every route loads its data under the policy with no report', async ({ page }) => {
  const reports = await watchPolicy(page);
  const supabase: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(SUPABASE_URL)) supabase.push(request.url());
  });
  for (const path of ROUTES) {
    await page.goto(path);
    // Realtime holds a socket open, so network idle may not come; give the data a moment either way.
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  }
  // The pages did reach the (fixture) database through the allowed host, and nothing was reported.
  expect(supabase.length).toBeGreaterThan(0);
  expect(reports).toEqual([]);
});

test('a connection to any other host is refused by the enforced policy', async ({ page }) => {
  const reports = await watchPolicy(page);
  // Belt and braces: if the policy let the request through, it still never leaves the machine.
  await page.route('https://example.com/**', (route) => route.abort());
  await page.goto('/');
  const outcome = await page.evaluate(() =>
    fetch('https://example.com/collect', { method: 'POST', body: 'x' }).then(
      () => 'sent',
      () => 'refused',
    ),
  );
  expect(outcome).toBe('refused');
  await expect.poll(() => reports).toContainEqual('enforce connect-src https://example.com/collect on /');
});

test('a form that posts to another host is refused by the enforced policy', async ({ page }) => {
  const reports = await watchPolicy(page);
  await page.route('https://example.com/**', (route) => route.abort());
  await page.goto('/');
  await page.evaluate(() => {
    const form = document.createElement('form');
    form.method = 'post';
    form.action = 'https://example.com/collect';
    document.body.append(form);
    form.submit();
  });
  await expect.poll(() => reports).toContainEqual('enforce form-action https://example.com/collect on /');
  expect(new URL(page.url()).origin).not.toBe('https://example.com');
});

test("/board is the not found page, with no sign-in form and no netlify.app address but the game's", async ({ page }) => {
  const reports = await watchPolicy(page);
  await page.goto('/board');
  await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveCount(0);
  // The build uses netlify.toml's play URL, a netlify.app address the top bar links to on every page.
  const playHost = new URL(PLAY_URL).host;
  expect(playHost).toMatch(/\.netlify\.app$/);
  await expect(page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Play' })).toHaveAttribute('href', PLAY_URL);
  expect(strayNetlifyHosts(await page.content(), [playHost])).toEqual([]);
  expect(reports).toEqual([]);
});
