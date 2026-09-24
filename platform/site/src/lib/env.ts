export type SiteEnv = {
  stripePaymentLinkUrl: string;
  discordInvite: string;
  playUrl: string;
};

function read(value: string | null = null): string {
  return (value ?? '').trim();
}

/**
 * The public build values from netlify.toml. The site holds no Supabase value: its figures come from
 * its own /api documents (docs/specs/site-snapshot.md).
 */
export function siteEnv(): SiteEnv {
  const env = import.meta.env;
  return {
    stripePaymentLinkUrl: read(env.VITE_STRIPE_PAYMENT_LINK_URL),
    discordInvite: read(env.VITE_DISCORD_INVITE),
    playUrl: read(env.VITE_PLAY_URL),
  };
}
