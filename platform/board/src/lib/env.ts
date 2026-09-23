// The board site's public build values, from its netlify.toml. Secrets never go here.
export type BoardEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

function read(value: string | null = null): string {
  return (value ?? '').trim();
}

export function boardEnv(): BoardEnv {
  const env = import.meta.env;
  return {
    supabaseUrl: read(env.VITE_SUPABASE_URL),
    supabaseAnonKey: read(env.VITE_SUPABASE_ANON_KEY),
  };
}
