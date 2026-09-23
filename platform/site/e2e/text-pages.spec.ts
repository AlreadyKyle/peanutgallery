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

test('/terms/3, a version not posted or carried, is the not found page', async ({ page }) => {
  await page.goto('/terms/3');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(['Not found']);
});
