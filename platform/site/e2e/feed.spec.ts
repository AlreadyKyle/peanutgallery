import { expect, test, WIDTHS } from './fixtures';

// The Atom feed of shipped cards (docs/specs/ship-feed.md). vite preview has no Netlify Function, so
// the feed's own document is checked by netlify/feed.test.ts and live-check.mjs; here every page
// names it in the head for feed readers and the footer links to it, under the enforced policy.
for (const size of WIDTHS) {
  test(`the head names /feed.xml and the footer links to it at ${size.width}px`, async ({ page }) => {
    await page.setViewportSize(size);
    const reports: string[] = [];
    await page.exposeFunction('e2eFeedPolicyReport', (line: string) => reports.push(line));
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        (window as unknown as { e2eFeedPolicyReport: (line: string) => void }).e2eFeedPolicyReport(`${event.effectiveDirective} ${event.blockedURI}`);
      });
    });
    for (const path of ['/', '/contribute', '/how-it-works']) {
      await page.goto(path);
      const alternate = page.locator('head link[rel="alternate"][type="application/atom+xml"]');
      await expect(alternate).toHaveCount(1);
      await expect(alternate).toHaveAttribute('href', '/feed.xml');
      const link = page.getByRole('contentinfo').getByRole('link', { name: 'Follow every ship (RSS)', exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', '/feed.xml');
    }
    expect(reports).toEqual([]);
  });
}
