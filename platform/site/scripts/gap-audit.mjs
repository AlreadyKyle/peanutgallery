// The gap audit for a preview, a mockup or any page, before anyone is shown it (DESIGN.md, Mockups
// and No dead space). It runs the same checks as the site's layout balance e2e test
// (scripts/layout-audit.mjs) at 1440, 1024, 768, 375 and 320px wide.
//
// usage: node platform/site/scripts/gap-audit.mjs <url-or-html-file> [more...] [--widths 1440,768]
//        pnpm --filter @backseat/site exec node scripts/gap-audit.mjs http://127.0.0.1:4173/
//
// The first line is "gap audit clean at <widths>" or "FAIL gap audit: <n> findings"; one line per
// finding follows. Exit 0 clean, 1 with findings, 2 on a usage error. A mockup is shown to the board
// only with the clean line quoted beside it.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { auditLayout, LIMITS } from './layout-audit.mjs';

const args = process.argv.slice(2);
const widthsAt = args.indexOf('--widths');
const WIDTHS = widthsAt === -1 ? [1440, 1024, 768, 375, 320] : args[widthsAt + 1].split(',').map(Number);
const targets = args.filter((arg, i) => !arg.startsWith('--') && i !== widthsAt + 1);
if (targets.length === 0 || WIDTHS.some((w) => !Number.isFinite(w) || w <= 0)) {
  console.error('usage: gap-audit.mjs <url-or-html-file> [more...] [--widths 1440,1024,768,375,320]');
  process.exit(2);
}

const url = (target) => (/^https?:\/\//.test(target) ? target : pathToFileURL(resolve(target)).href);
for (const target of targets) {
  if (!/^https?:\/\//.test(target) && !existsSync(resolve(target))) {
    console.error(`gap-audit: no such file: ${target}`);
    process.exit(2);
  }
}

const findings = [];
const browser = await chromium.launch();
try {
  for (const target of targets) {
    for (const width of WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await page.goto(url(target), { waitUntil: 'load' });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      for (const line of await page.evaluate(auditLayout, LIMITS)) findings.push(`${target} at ${width}px: ${line}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}

console.log(findings.length === 0 ? `gap audit clean at ${WIDTHS.join(', ')}` : `FAIL gap audit: ${findings.length} findings`);
for (const line of findings) console.log(line);
process.exit(findings.length === 0 ? 0 : 1);
