import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { siteEnv } from './env';

let cached: SupabaseClient | null = null;
let resolved = false;

export function getClient(): SupabaseClient | null {
  if (resolved) return cached;
  resolved = true;
  const env = siteEnv();
  if (env.supabaseUrl === '' || env.supabaseAnonKey === '') return null;
  cached = createClient(env.supabaseUrl, env.supabaseAnonKey);
  return cached;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
}
