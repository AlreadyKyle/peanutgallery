// Kernel (platform/gate/kernel-paths.txt; docs/specs/site-snapshot.md): the Supabase project the
// public site's one Netlify Function reads, and its publishable key. Both are public values: the key
// is the anon key Supabase publishes for browsers, and it reads only what anon may read. They are
// constants, not environment variables, so no secret ever lives on the public site's host and a
// card cannot point the function at another project. The URL equals the board site's
// (platform/board/netlify.toml); snapshot.test.ts checks it.

export const SUPABASE_URL = 'https://lyxndueoeisyqzewflpu.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_-i-BKWMS4TmEfSldTE9b7g_UMBRV2wh';
