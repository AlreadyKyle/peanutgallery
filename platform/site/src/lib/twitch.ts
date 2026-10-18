// The Twitch channel the studio streams to (docs/specs/final-state.md, Channels), from the build's
// VITE_TWITCH_CHANNEL. Unset or not a Twitch login name, nothing shows. The site only links to it: the
// Content Security Policy (netlify.toml) allows no third-party frame or connection, so there is no embed.

const LOGIN = /^[A-Za-z0-9_]{4,25}$/;

export function twitchChannel(value: string | undefined = import.meta.env.VITE_TWITCH_CHANNEL): string | null {
  const channel = (value ?? '').trim();
  return LOGIN.test(channel) ? channel : null;
}

export function twitchUrl(channel: string): string {
  return `https://www.twitch.tv/${channel.toLowerCase()}`;
}
