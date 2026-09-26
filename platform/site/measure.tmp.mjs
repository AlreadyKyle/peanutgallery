import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: Number(process.argv[2] ?? 375), height: 800 } });
await p.goto('http://127.0.0.1:4461/terms');
await p.evaluate(() => document.fonts.ready);
console.log(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.footer-links li')].map((li) => { const r = li.getBoundingClientRect(); const a = li.querySelector('a').getBoundingClientRect(); return [li.textContent, Math.round(r.left), Math.round(r.top), Math.round(a.width)]; }))));
await b.close();
