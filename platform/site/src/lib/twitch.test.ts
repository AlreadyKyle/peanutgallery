import { describe, expect, it } from 'vitest';
import { twitchChannel, twitchUrl } from './twitch';

describe('the Twitch channel', () => {
  it('is null when the build sets none or something that is not a Twitch login', () => {
    for (const value of [undefined, '', '   ', 'abc', 'has space', 'https://twitch.tv/x', 'a'.repeat(26), 'bad/slash']) {
      expect(twitchChannel(value), String(value)).toBeNull();
    }
  });

  it('reads a login and links to twitch.tv', () => {
    expect(twitchChannel(' MobMachine ')).toBe('MobMachine');
    expect(twitchUrl('MobMachine')).toBe('https://www.twitch.tv/mobmachine');
  });

  it('reads nothing in a build without VITE_TWITCH_CHANNEL, the default', () => {
    expect(twitchChannel()).toBeNull();
  });
});
