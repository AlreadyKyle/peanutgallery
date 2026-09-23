import { SUPABASE_URL } from './fixture-env';
import { expect, test } from './fixtures';

const PAGES = [
  { path: '/terms', title: 'Terms' },
  { path: '/privacy', title: 'Privacy' },
  { path: '/refunds', title: 'Refunds' },
  { path: '/contact', title: 'Contact' },
];

for (const { path, title } of PAGES) {
  test(`${path} renders one h1 at 375 px without horizontal overflow`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText([title]);
    await expect(page.getByRole('main').getByRole('link', { name: 'hello@clayhouse.studio' }).first()).toHaveAttribute(
      'href',
      'mailto:hello@clayhouse.studio',
    );
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflows).toBe(false);
  });
}

test('every footer links to Terms, Privacy, Refunds and Contact, and the links open the pages', async ({ page }) => {
  await page.goto('/');
  const footer = page.getByRole('contentinfo');
  for (const { path, title } of PAGES) {
    await expect(footer.getByRole('link', { name: title, exact: true })).toHaveAttribute('href', path);
  }
  await footer.getByRole('link', { name: 'Refunds', exact: true }).click();
  await expect(page).toHaveURL(/\/refunds$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(['Refunds']);
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Terms', exact: true })).toBeVisible();
});

// Numbered Terms versions (docs/specs/legal-copy.md): the fixture posts versions 1 and 2.
test('/terms shows version 2 in force, with version 1 listed and linked', async ({ page }) => {
  await page.goto('/terms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(['Terms']);
  const main = page.getByRole('main');
  await expect(main.getByText('Version 2, in force since 24 Sep 2026 at 11:00 Toronto time.')).toBeVisible();
  const earlier = page.getByRole('region', { name: 'Earlier versions' });
  await expect(earlier.getByRole('link')).toHaveText(['Version 1, in force from 22 Sep 2026 at 21:32 Toronto time until 24 Sep 2026 at 11:00 Toronto time']);
  await expect(earlier.getByRole('link')).toHaveAttribute('href', '/terms/1');
});

for (const { path, title, current } of [
  { path: '/terms/1', title: 'Terms, version 1', current: '/terms' },
  { path: '/refunds/1', title: 'Refunds, version 1', current: '/refunds' },
]) {
  test(`${path} shows version 1 with its range and a link to the version in force, without overflow`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText([title]);
    const main = page.getByRole('main');
    await expect(
      main.getByText(
        'Version 1, in force from 22 Sep 2026 at 21:32 Toronto time until 24 Sep 2026 at 11:00 Toronto time. It applies to contributions whose checkout started in that time.',
      ),
    ).toBeVisible();
    await expect(main.getByRole('link', { name: 'Read the version in force now' })).toHaveAttribute('href', current);
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflows).toBe(false);
  });
}

test("/terms/1's Refunds link goes to /refunds/1, the words that applied with version 1", async ({ page }) => {
  await page.goto('/terms/1');
  await expect(page.getByRole('region', { name: 'Refunds', exact: true }).getByRole('link', { name: 'Refunds page' })).toHaveAttribute('href', '/refunds/1');
});

// While the versions read runs, the page is drawn whole with only its status line different, so the
// title does not sit at the foot of a window-high signal plate and then jump when the words arrive.
// The title moves by no more than the status line's own change in height.
for (const width of [375, 768, 1440]) {
  test(`the Terms pages keep their layout while the versions read runs, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    // Each page load's read waits until the test releases it.
    let release = () => {};
    let held = Promise.resolve();
    await page.route(`${SUPABASE_URL}/rest/v1/public_terms_versions**`, async (route) => {
      await held;
      await route.fallback();
    });
    const measure = () =>
      page.evaluate(() => {
        const hero = document.querySelector('main .hero')!;
        const h1 = hero.querySelector('h1')!.getBoundingClientRect();
        const lede = hero.querySelector('.lede')!.getBoundingClientRect();
        return { h1: h1.top, status: hero.getBoundingClientRect().bottom - lede.bottom };
      });
    for (const path of ['/terms', '/refunds', '/terms/1', '/refunds/1']) {
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.goto(path);
      await expect(page.getByText('Loading the terms.')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const loading = await measure();
      release();
      await expect(page.getByText('Loading the terms.')).toHaveCount(0);
      await expect(page.locator('main .hero').getByText(/^Version \d, in force/)).toBeVisible();
      const loaded = await measure();
      expect(Math.abs(loaded.h1 - loading.h1), `${path}: the title moved`).toBeLessThanOrEqual(Math.abs(loaded.status - loading.status) + 1);
    }
  });
}

test('/terms/3, a version not posted or carried, is the not found page', async ({ page }) => {
  await page.goto('/terms/3');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(['Not found']);
});
