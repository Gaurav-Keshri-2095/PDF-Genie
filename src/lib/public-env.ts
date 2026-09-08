/**
 * Browser-visible configuration.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time only where it is
 * referenced literally, which is why these are spelled out rather than looked
 * up dynamically. Nothing secret belongs in this file.
 */

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

/**
 * The publishable (formerly "anon") key. Safe in the browser: Row Level
 * Security decides what it can read, and our tables grant it nothing beyond
 * the signed-in user's own rows.
 */
export const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

export const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ??
  (typeof window === "undefined" ? "http://localhost:3000" : window.location.origin);

export function assertSupabaseBrowserConfig() {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local (see .env.example).",
    );
  }
}
