"use client";

import { createBrowserClient } from "@supabase/ssr";

import { assertSupabaseBrowserConfig, supabasePublishableKey, supabaseUrl } from "@/lib/public-env";

/**
 * Browser-side Supabase client. Carries the publishable key and the user's
 * session cookie, so every query it makes is filtered by RLS.
 */
export function createClient() {
  assertSupabaseBrowserConfig();
  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
