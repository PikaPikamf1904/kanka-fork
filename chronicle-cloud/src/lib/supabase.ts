import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// The publishable key is designed to be public. It grants nothing by itself: every table is
// protected by Row Level Security, and anon has no privileges at all.
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !publishableKey) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set at build time.');
}

export const supabase = createClient(url, publishableKey, {
  auth: {
    // Keeps the device signed in between visits; the refresh token is rotated by Supabase.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'chronicle-auth',
  },
});

export const MEDIA_BUCKET = 'chronicle-media';
