import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfigFromDir } from '../bots/config';
import { fill, formatDuration, formatDust, formatPercent, formatRate, groupThousands } from '../render/format';
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

  it('shows one decimal for small rates and whole numbers for large ones', () => {
    expect(formatRate(1)).toBe('1.0');
    expect(formatRate(39.24)).toBe('39.2');
    expect(formatRate(1674.3)).toBe('1,674');
    expect(formatRate(2e6)).toBe('2.00M');
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

describe('formatDuration', () => {
  it('rounds up to whole seconds and picks the unit by size', () => {
    expect(formatDuration(0.2)).toBe('1s');
    expect(formatDuration(59)).toBe('59s');
    expect(formatDuration(60)).toBe('1m 0s');
    expect(formatDuration(200)).toBe('3m 20s');
    expect(formatDuration(3599)).toBe('59m 59s');
    expect(formatDuration(3600)).toBe('1h 0m');
    expect(formatDuration(7530)).toBe('2h 5m');
  });
});

describe('content/strings.json', () => {
  const raw = JSON.parse(readFileSync(join(LIVE_CONTENT_DIR, 'strings.json'), 'utf8')) as unknown;

  it('parses with every label present', () => {
    const strings = parseStrings(raw);
    expect(strings.title).toBe('Dust');
    expect(strings.labels.unlockedCount).toContain('{unlocked}');
    expect(strings.labels.nextUnlock).toContain('{name}');
    expect(strings.labels.nextUnlockTime).toContain('{time}');
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
