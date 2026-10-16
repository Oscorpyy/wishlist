import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  (supabaseAnonKey || supabaseServiceRoleKey) &&
  !supabaseUrl.includes('your-project') &&
  !supabaseAnonKey.includes('your-anon-key')
);

if (!isSupabaseConfigured && typeof window === 'undefined') {
  console.warn(
    '[Supabase] Warning: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY are missing. Please set them in .env.local.'
  );
}

// In server-side execution (Server Actions), prefer the service role key if available to bypass RLS policies
const authKey = (typeof window === 'undefined' && supabaseServiceRoleKey)
  ? supabaseServiceRoleKey
  : (supabaseAnonKey || 'placeholder');

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  authKey
);