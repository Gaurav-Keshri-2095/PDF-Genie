import { apiError, describeError, json, notFound } from "@/lib/api";
import { appOrigin } from "@/lib/env";
import { grantForOwner } from "@/lib/handlers/access";
import { createShareToken, hashShareToken } from "@/lib/share";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/**
 * Creates a share link.
 *
 * The raw token is returned exactly once, here, and never stored - the
 * database keeps only its SHA-256 hash. A leaked database dump therefore does
 * not yield working links.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const grant = await grantForOwner(id);
  if (!grant || !grant.userId) return notFound();

  try {
    const supabase = createServiceClient();
    const token = createShareToken();

    const { error } = await supabase.from("shares").insert({
      document_id: id,
      token_hash: hashShareToken(token),
      created_by: grant.userId,
      can_comment: true,
    });

    if (error) return apiError(error.message, 500);

    return json({ url: `${appOrigin()}/share/${token}` }, 201);
  } catch (error) {
    return apiError(describeError(error), 500);
  }
}

/** Lists existing links for the owner's UI, without revealing their tokens. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const grant = await grantForOwner(id);
  if (!grant) return notFound();

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("shares")
      .select("id, can_comment, expires_at, revoked_at, created_at")
      .eq("document_id", id)
      .order("created_at", { ascending: false });

    if (error) return apiError(error.message, 500);
    return json({ shares: data ?? [] });
  } catch (error) {
    return apiError(describeError(error), 500);
  }
}
