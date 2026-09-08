import { apiError, describeError, json } from "@/lib/api";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * The signed-in user's documents, newest first.
 *
 * Read through the user-scoped client rather than the privileged one, so RLS
 * is the thing enforcing ownership here - not a WHERE clause we could forget.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Sign in to view your documents.", 401);

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("documents")
      .select("id, filename, page_count, status, summary, has_text, error, created_at")
      .order("created_at", { ascending: false });

    if (error) return apiError(error.message, 500);
    return json({ documents: data ?? [] });
  } catch (error) {
    return apiError(describeError(error), 500);
  }
}
