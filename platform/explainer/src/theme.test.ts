import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { C, CREATURE } from './theme';

// The video's colours are the site's tokens, value for value.
const tokens = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'site', 'src', 'tokens.css'), 'utf8');

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(tokens);
  if (match === null) throw new Error(`tokens.css has no --${name}`);
  return match[1]!.toLowerCase();
}

const NAMES: Record<keyof typeof C, string> = {
  paper: 'paper',
  ink: 'ink',
  muted: 'muted',
  field: 'field',
  line: 'line',
  paperHover: 'paper-hover',
  mutedOnInk: 'muted-on-ink',
  lineOnInk: 'line-on-ink',
  work: 'work',
  suitGame: 'suit-game',
  live: 'live',
  coin: 'coin',
  coinDown: 'coin-down',
  coinUp: 'coin-up',
};

describe('the theme', () => {
  it('uses the site tokens', () => {
    for (const [key, name] of Object.entries(NAMES)) {
      expect(C[key as keyof typeof C], name).toBe(token(name));
    }
  });

  it('uses the avatar fills', () => {
    for (const [colour, hex] of Object.entries(CREATURE)) expect(hex, colour).toBe(token(`creature-${colour}`));
  });
});
