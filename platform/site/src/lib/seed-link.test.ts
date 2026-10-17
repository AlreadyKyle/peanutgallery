import { afterEach, describe, expect, it } from 'vitest';
import { clearPendingSeed, parseSeedCode, pendingSeed, pendingSeedPath, rememberPendingSeed } from './seed-link';

// The seed code rule is save_seed's (20261017100000_community_core.sql); a code that fails it is never sent.
describe('parseSeedCode', () => {
  it('reads the game, the version and the code from a valid seed code', () => {
    expect(parseSeedCode('dust:v3:AbC-_09')).toEqual({ game: 'dust', version: 3, code: 'dust:v3:AbC-_09' });
    expect(parseSeedCode('  seed-2:v1234:x  ')).toEqual({ game: 'seed-2', version: 1234, code: 'seed-2:v1234:x' });
    expect(parseSeedCode(`dust:v1:${'a'.repeat(1992)}`)?.code.length).toBe(2000);
  });

  it('refuses anything outside the rule', () => {
    for (const bad of [
      null,
      undefined,
      '',
      'dust',
      'dust:v3:',
      'dust:3:abc',
      'Dust:v3:abc',
      'd:v3:abc',
      'a-very-long-game-name-x:v3:abc',
      'dust:v12345:abc',
      'dust:v3:abc=',
      'dust:v3:ab c',
      'dust:v3:<script>',
      'dust:v3:abc\nother',
      `dust:v1:${'a'.repeat(1993)}`,
    ]) {
      expect(parseSeedCode(bad), String(bad)).toBeNull();
    }
  });
});

describe('the pending seed', () => {
  afterEach(() => clearPendingSeed());

  it('keeps a valid code until it is cleared, and gives /me the way back', () => {
    expect(pendingSeedPath()).toBeNull();
    rememberPendingSeed('dust:v3:abc');
    expect(pendingSeed()).toBe('dust:v3:abc');
    expect(pendingSeedPath()).toBe('/seeds?save=dust%3Av3%3Aabc');
    clearPendingSeed();
    expect(pendingSeed()).toBeNull();
  });

  it('ignores a kept value that is not a seed code', () => {
    window.localStorage.setItem('mm:pending-seed', 'javascript:alert(1)');
    expect(pendingSeed()).toBeNull();
    expect(pendingSeedPath()).toBeNull();
  });
});
