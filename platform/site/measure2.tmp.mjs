import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const w of [320, 375, 414]) {
  const p = await b.newPage({ viewport: { width: w, height: 800 } });
  await p.goto('http://127.0.0.1:4461/design-kit-7q4m');
  await p.evaluate(() => document.fonts.ready);
  console.log(w, JSON.stringify(await p.evaluate(() => ({
    filters: [...document.querySelectorAll('.filters')].map((f) => [...f.children].map((c) => [c.textContent, Math.round(c.getBoundingClientRect().width), Math.round(c.getBoundingClientRect().top)])),
    glyphs: [...document.querySelectorAll('.glyph-list > li')].map((c) => [c.textContent, Math.round(c.getBoundingClientRect().width), Math.round(c.getBoundingClientRect().top)]),
    content: document.querySelector('main .wrap, main')?.getBoundingClientRect().width,
  }))));
  await p.close();
}
await b.close();
