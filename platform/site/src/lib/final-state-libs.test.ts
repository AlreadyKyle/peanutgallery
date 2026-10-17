import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cardRarity } from './rarity';
import { qrModules, qrPath } from './qr';
import { sha256Hex } from './sha256';
import { eraKey, iso, roomPlan, ERA_KEYS } from './studio-scene';
import { rarityOfId, suitOf, suitOfFolder, suitTile } from './suits';
import { relativeTime } from './community';

// The final state's small libraries (docs/specs/final-state.md): the sync SHA-256 the card face uses
// to draw rarity in render, the suits, the QR code /broadcast draws, the studio's room plan and the
// pipe's relative times.

describe('sha256', () => {
  it('matches node:crypto on short, long and unicode input', () => {
    for (const text of ['', 'abc', 'a'.repeat(1000), 'card-é-☃', '0b4c4a3e-1f2d-4c5e-9a7b-123456789abc']) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });
});

describe('suits and rarity', () => {
  it('reads the suit from the folder unless the card names one', () => {
    expect(suitOfFolder('platform')).toBe('studio');
    expect(suitOfFolder('seed-1')).toBe('game');
    expect(suitOf({ folder: 'seed-1', suit: 'machine' })).toBe('machine');
    expect(suitTile('new_game')).toBe('game');
    expect(suitTile('platform')).toBe('studio');
  });

  it('computes the same rarity as the async rule in lib/rarity.ts', async () => {
    for (let i = 0; i < 200; i++) {
      const id = `card-${i}`;
      expect(rarityOfId(id)).toBe(await cardRarity(id));
    }
  });
});

describe('qr', () => {
  it('draws a square symbol with three finder patterns', () => {
    const m = qrModules('https://mobmachine.games/contribute');
    const n = m.length;
    expect(n).toBeGreaterThanOrEqual(21);
    expect((n - 17) % 4).toBe(0);
    for (const row of m) expect(row.length).toBe(n);
    const finder = (r: number, c: number) => [0, 6].every((d) => m[r]![c + d] && m[r + d]![c]) && m[r + 3]![c + 3];
    expect(finder(0, 0)).toBe(true);
    expect(finder(0, n - 7)).toBe(true);
    expect(finder(n - 7, 0)).toBe(true);
    expect(qrPath(m)).toMatch(/^M/);
  });
});

describe('studio scene', () => {
  it('names the era by name, then by index, else the garage', () => {
    expect(eraKey({ name: 'Campus', index: 0 })).toBe('campus');
    expect(eraKey({ name: 'Something new', index: 1 })).toBe('workshop');
    expect(eraKey(null)).toBe('garage');
  });

  it('grows the room with each era', () => {
    const areas = ERA_KEYS.map((key) => {
      const plan = roomPlan(key);
      return plan.w * plan.d;
    });
    for (let i = 1; i < areas.length; i++) expect(areas[i]!).toBeGreaterThan(areas[i - 1]!);
  });

  it('projects isometrically', () => {
    expect(iso(1, 0)).toEqual({ sx: 32, sy: 16 });
    expect(iso(0, 1)).toEqual({ sx: -32, sy: 16 });
    expect(iso(0, 0, 1)).toEqual({ sx: 0, sy: -32 });
  });
});

describe('relative time', () => {
  it('says how long ago in words', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    expect(relativeTime('2026-10-01T11:59:40Z', now)).not.toBe('');
    expect(relativeTime('2026-10-01T11:00:00Z', now)).not.toBe(relativeTime('2026-09-29T12:00:00Z', now));
  });
});
