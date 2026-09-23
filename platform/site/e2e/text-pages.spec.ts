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
