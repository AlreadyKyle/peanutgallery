/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STRIPE_PAYMENT_LINK_URL?: string;
  readonly VITE_DISCORD_INVITE?: string;
  readonly VITE_PLAY_URL?: string;
  readonly VITE_TWITCH_CHANNEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
