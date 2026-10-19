// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUNT_PATH } from './lib/count';

// The live check is the studio's own robot, not a visitor (docs/specs/counter-senders.md): every page
// scripts/live-check.mjs opens answers the counters' beacons in the browser, so a run adds nothing to
// the daily counts. Paths resolve from the package root vitest runs in (see styles.test.ts).
const script = readFileSync(resolve(process.cwd(), 'scripts/live-check.mjs'), 'utf8');

describe('live-check.mjs and the counters', () => {
  it('opens every page through newPage, and no page another way', () => {
    expect(script.match(/browser\.newPage\(/g)).toHaveLength(1);
    expect(script).not.toMatch(/\.newContext\(/);
    expect(script.match(/await newPage\(browser, /g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("answers the site's count path with a 204 inside the browser and checks none got out", () => {
    const route = script.match(/const COUNT_ROUTE = '([^']+)';/)?.[1];
    expect(route).toBe(`**${COUNT_PATH}`);
    const start = script.indexOf('async function newPage(browser, viewport)');
    const helper = script.slice(start, script.indexOf('\n}\n', start));
    expect(helper).toContain('const page = await browser.newPage({ viewport });');
    expect(helper).toContain('await page.route(COUNT_ROUTE, (route) => {');
    expect(helper).toContain('return route.fulfill({ status: 204 });');
    expect(script).toContain('check(beacons.held === beacons.sent, `every count beacon answered in the browser, none sent to ${BASE}');
  });

  it('presses nothing, so a run never opens checkout or the game and sends no checkout_open or home_play_click', () => {
    expect(script).not.toMatch(/\.(click|dblclick|tap|press|dispatchEvent)\(|\.mouse\./);
  });
});
