import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseEnv } from "@/lib/env";

/**
 * Privileged client used only after a request has been authorised - either by a
 * verified user session or by a validated share token.
 *
 * Built with no cookie or auth wiring on purpose. If a user access token were
 * attached, PostgREST would run these queries under that user's RLS policies
 * instead of bypassing them, which would silently break the anonymous
 * share-link path.
 */
let cached: SupabaseClient | null = null;

export function createServiceClient(): SupabaseClient {
  if (cached) return cached;

  const env = supabaseEnv();
  cached = createClient(env.url, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cached;
}

export function storageBucket(): string {
  return supabaseEnv().bucket;
}
