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
import { parseGapAuditArgs } from './gap-audit-args.mjs';
import { auditLayout, LIMITS } from './layout-audit.mjs';

const parsed = parseGapAuditArgs(process.argv.slice(2));
if (parsed === null) {
  console.error('usage: gap-audit.mjs <url-or-html-file> [more...] [--widths 1440,1024,768,375,320]');
  process.exit(2);
}
const { targets, widths: WIDTHS } = parsed;

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
      // A web font that fails to load lets the fallback font set the text, which wraps differently,
      // so the audit would measure a page no visitor normally sees. Load once more; if the font
      // still fails, that is itself a finding.
      let failedFonts = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await page.goto(url(target), { waitUntil: 'load' });
        await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        failedFonts = await page.evaluate(() => [...document.fonts].filter((font) => font.status === 'error').map((font) => font.family));
        if (failedFonts.length === 0) break;
      }
      for (const family of failedFonts) findings.push(`${target} at ${width}px: font: ${family} failed to load`);
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
