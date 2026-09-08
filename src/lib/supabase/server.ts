import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabaseEnv } from "@/lib/env";

/**
 * Request-scoped Supabase client that reads and refreshes the session cookie.
 * Queries run as the signed-in user, so RLS applies.
 */
export async function createSupabaseServerClient() {
  const env = supabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The middleware refreshes the
          // session on every request, so it is safe to ignore this here.
        }
      },
    },
  });
}

export type AuthenticatedUser = {
  id: string;
  email: string;
};

/**
 * Returns the verified current user, or null.
 *
 * Uses getClaims() rather than getSession(): getSession() trusts whatever is
 * in the cookie without revalidating it, which is not a basis for an
 * authorisation decision.
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) return null;

  return {
    id: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : "",
  };
}
