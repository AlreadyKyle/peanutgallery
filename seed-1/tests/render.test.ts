import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfigFromDir } from '../bots/config';
import { fill, formatDust, formatPercent, formatRate, groupThousands, pluralName } from '../render/format';
import { welcomeCount, WELCOME_COUNT_SECONDS } from '../render/hud';
import { parseStrings } from '../render/strings';
import { LIVE_CONFIG_DIR, LIVE_CONTENT_DIR } from './paths';

describe('number formatting', () => {
  it('groups thousands without a locale', () => {
    expect(groupThousands(0)).toBe('0');
    expect(groupThousands(999)).toBe('999');
    expect(groupThousands(1000)).toBe('1,000');
    expect(groupThousands(1234567.9)).toBe('1,234,567');
  });

  it('switches to suffixes at a million', () => {
    expect(formatDust(999999)).toBe('999,999');
    expect(formatDust(1000000)).toBe('1.00M');
    expect(formatDust(2450026)).toBe('2.45M');
    expect(formatDust(1.5e9)).toBe('1.50B');
    expect(formatDust(3e12)).toBe('3.00T');
  });

  it('names a count of units in the plural, and one unit in the singular', () => {
    expect(pluralName('Gatherer', 1)).toBe('Gatherer');
    expect(pluralName('Gatherer', 15)).toBe('Gatherers');
    expect(pluralName('Gatherer', 0)).toBe('Gatherers');
    expect(pluralName('Foundry', 3)).toBe('Foundries');
    expect(pluralName('Press', 2)).toBe('Presses');
    expect(pluralName('Dust Mill', 4)).toBe('Dust Mills');
    expect(pluralName('Relay', 2)).toBe('Relays');
    expect(pluralName('', 2)).toBe('');
    // Every unit in the live config reads right in the plural.
    const units = loadConfigFromDir(LIVE_CONFIG_DIR).spawnTable.rows.map((unit) => pluralName(unit.name, 2));
    expect(units).toEqual(['Gatherers', 'Carts', 'Mills', 'Forges', 'Foundries']);
  });

  it('shows one decimal for small rates and whole numbers for large ones', () => {
    expect(formatRate(1)).toBe('1.0');
    expect(formatRate(39.24)).toBe('39.2');
    expect(formatRate(1674.3)).toBe('1,674');
    expect(formatRate(2e6)).toBe('2.00M');
  });

  it('never prints a raw exponent float for a huge count', () => {
    expect(groupThousands(4.3088693800637674e98)).toBe('4.31e98');
    expect(groupThousands(1e21)).toBe('1.00e21');
    expect(groupThousands(9.99e20)).toBe('999,000,000,000,000,000,000');
    expect(formatPercent(1 + 4.3e98)).toBe('4.30e100%');
    expect(formatDust(1e301)).toBe('1.00e301');
  });

  it('renders multipliers as whole percentages', () => {
    expect(formatPercent(1.05)).toBe('5%');
    expect(formatPercent(2)).toBe('100%');
  });

  it('fills templates and leaves unknown keys visible', () => {
    expect(fill('Next: {name} at {amount} dust', { name: 'Mill', amount: '1,000' })).toBe('Next: Mill at 1,000 dust');
    expect(fill('{missing}', {})).toBe('{missing}');
  });
});

describe('number formatting at the edges', () => {
  it('names the scales past a trillion instead of printing a thousand trillions', () => {
    expect(formatDust(1.234e15)).toBe('1.23Qa');
    expect(formatDust(4.5e18)).toBe('4.50Qi');
    expect(formatDust(1.5e21)).toBe('1.50e21');
    expect(formatDust(2e306)).toBe('2.00e306');
  });

  it('rolls a rounded 1000.00 up to the next scale', () => {
    expect(formatDust(999_995_000)).toBe('1.00B');
    expect(formatDust(999_999_999_999)).toBe('1.00T');
    expect(formatDust(999_999.6)).toBe('999,999');
  });

  it('never prints a stray comma, a not-a-number or Infinity', () => {
    expect(groupThousands(-123)).toBe('-123');
    expect(groupThousands(-1234567)).toBe('-1,234,567');
    expect(formatDust(-2_500_000)).toBe('-2.50M');
    expect(formatDust(0 / 0)).toBe('0');
    expect(formatDust(Number.POSITIVE_INFINITY)).toBe('0');
    expect(groupThousands(0 / 0)).toBe('0');
    expect(formatRate(0 / 0)).toBe('0.0');
    expect(formatRate(Number.POSITIVE_INFINITY)).toBe('0.0');
    expect(formatRate(-1.25)).toBe('-1.3');
  });
});

describe('content/strings.json', () => {
  const raw = JSON.parse(readFileSync(join(LIVE_CONTENT_DIR, 'strings.json'), 'utf8')) as unknown;

  it('parses with every label present', () => {
    const strings = parseStrings(raw);
    expect(strings.title).toBe('Dust');
    expect(strings.labels.unlockedCount).toContain('{unlocked}');
    expect(strings.labels.nextUnlock).toContain('{name}');
    expect(strings.effects.multiplier).toContain('{percent}');
  });

  it('describes every unit in the live spawn table', () => {
    const strings = parseStrings(raw);
    const config = loadConfigFromDir(LIVE_CONFIG_DIR);
    for (const row of config.spawnTable.rows) expect(strings.unitDescriptions[row.id]).toBeTruthy();
  });

  it('rejects a file missing a label', () => {
    const broken = JSON.parse(JSON.stringify(raw)) as { labels: Record<string, string> };
    delete broken.labels['strike'];
    expect(() => parseStrings(broken)).toThrow('"strike"');
  });
});

describe('the welcome back count', () => {
  it('counts up from the total before the time away to the total now, easing out and never past it', () => {
    expect(WELCOME_COUNT_SECONDS).toBeGreaterThan(1);
    expect(welcomeCount(1000, 5000, 0)).toBe(1000);
    let last = 1000;
    for (const k of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      const shown = welcomeCount(1000, 5000, k);
      expect(shown).toBeGreaterThan(last);
      expect(shown).toBeLessThan(5000);
      last = shown;
    }
    // Eases out: more than half the gain is shown by a quarter of the way through.
    expect(welcomeCount(1000, 5000, 0.25)).toBeGreaterThan(3000);
    expect(welcomeCount(1000, 5000, 1)).toBe(5000);
    expect(welcomeCount(1000, 5000, 7)).toBe(5000);
    expect(welcomeCount(6000, 5000, 0.5)).toBe(5000);
    expect(welcomeCount(1000, 5000, Number.NaN)).toBe(5000);
  });
});
