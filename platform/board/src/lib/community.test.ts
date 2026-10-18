import { describe, expect, it } from 'vitest';
import { centsFrom, clusterOptions, confirmText, dollarsText } from './community';
import { errorMessage } from './supabase';

describe('centsFrom', () => {
  it('takes plain amounts, a leading $ and thousands commas', () => {
    expect(centsFrom('500')).toBe(50000);
    expect(centsFrom(' $500 ')).toBe(50000);
    expect(centsFrom('$ 25.5')).toBe(2550);
    expect(centsFrom('1,000')).toBe(100000);
    expect(centsFrom('$1,250.50')).toBe(125050);
    expect(centsFrom('1,000,000')).toBe(100000000);
    expect(centsFrom('0.01')).toBe(1);
  });

  it('refuses anything that is not an amount above zero', () => {
    for (const bad of ['', '$', 'abc', '0', '0.00', '-5', '1,00', '10,0000', '1.234', '5$', '$$5', '1e3', '1,000,000,000']) expect(centsFrom(bad), bad).toBeNull();
  });
});

describe('the confirms', () => {
  it('name the object each action changes', () => {
    expect(confirmText.suspend('supporter-1')).toContain('supporter-1');
    expect(confirmText.decline('Night mode', 'duplicate')).toContain('"Night mode" as duplicate');
    expect(confirmText.draft('night-mode')).toMatch(/cluster night-mode\?.*paid draft_card run/);
    expect(confirmText.merge('night-mode', 'glow-sand')).toBe('Merge cluster night-mode into glow-sand? Its suggestions move to glow-sand, and this cannot be undone.');
    expect(confirmText.deleteGoal('Sound', dollarsText(50000))).toContain('"Sound" ($500.00)');
    expect(confirmText.era('Workshop')).toContain('Set the studio era to Workshop?');
    expect(confirmText.flag('profiles_open', false)).toBe('Turn profiles_open off? No new player can sign in or make a profile until it is turned back on.');
    expect(confirmText.flag('something_new', true)).toBe('Turn something_new on? The site reads it at once.');
  });
});

describe('clusterOptions', () => {
  it('lists each loaded cluster once, by key, and skips suggestions with none', () => {
    const items = [
      { id: 's1', clusterId: 'k2', clusterKey: 'night-mode' },
      { id: 's2', clusterId: 'k1', clusterKey: 'glow-sand' },
      { id: 's3', clusterId: 'k2', clusterKey: 'night-mode' },
      { id: 's4', clusterId: null },
      { id: 's5', clusterId: 'abcdef12-0000', clusterKey: null },
    ];
    expect(clusterOptions(items)).toEqual([
      { id: 'abcdef12-0000', key: 'abcdef12' },
      { id: 'k1', key: 'glow-sand' },
      { id: 'k2', key: 'night-mode' },
    ]);
  });
});

describe('errorMessage', () => {
  it('turns an error page, an empty answer, a lost connection and a bad id into a plain sentence', () => {
    expect(errorMessage(new Error('<html>Bad gateway</html>'))).toBe(
      'The server sent back an error page instead of an answer; it may be down or restarting. Try again in a minute.',
    );
    expect(errorMessage({ message: '<!DOCTYPE html><title>502</title>' })).toMatch(/^The server sent back an error page/);
    expect(errorMessage(new Error(''))).toBe('The server gave an empty answer. Try again in a minute.');
    expect(errorMessage(null)).toBe('The server gave an empty answer. Try again in a minute.');
    expect(errorMessage(new Error('Failed to fetch'))).toBe('The server could not be reached. Check the connection and try again.');
    expect(errorMessage(new Error('invalid input syntax for type uuid: "abc"'))).toBe('That id is not one the database knows. Choose it from the list instead.');
  });

  it('keeps the database own refusals as they are', () => {
    expect(errorMessage(new Error('A second factor is required'))).toBe('A second factor is required');
    expect(errorMessage({ message: 'Give a reason of 1 to 500 characters' })).toBe('Give a reason of 1 to 500 characters');
    expect(errorMessage('x'.repeat(400))).toHaveLength(300);
  });
});
