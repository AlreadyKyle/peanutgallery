export type SiteEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  stripePaymentLinkUrl: string;
  discordInvite: string;
};

function read(value: string | null = null): string {
  return (value ?? '').trim();
}

export function siteEnv(): SiteEnv {
  const env = import.meta.env;
  return {
    supabaseUrl: read(env.VITE_SUPABASE_URL),
    supabaseAnonKey: read(env.VITE_SUPABASE_ANON_KEY),
    stripePaymentLinkUrl: read(env.VITE_STRIPE_PAYMENT_LINK_URL),
    discordInvite: read(env.VITE_DISCORD_INVITE),
  };
}
