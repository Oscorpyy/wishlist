import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Fail fast and loudly if the environment variables are missing
if (!supabaseUrl) {
  throw new Error('CRITICAL: NEXT_PUBLIC_SUPABASE_URL is not defined in the environment.');
}

if (!supabaseAnonKey) {
  throw new Error('CRITICAL: NEXT_PUBLIC_SUPABASE_ANON_KEY is not defined in the environment.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);