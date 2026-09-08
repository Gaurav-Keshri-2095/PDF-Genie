import "server-only";

import { resolveShare } from "@/lib/share";
import { getCurrentUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Resolves either lane - a signed-in owner or a share-link visitor - into one
 * value the rest of the request can work with.
 *
 * Both `/api/documents/[id]/*` and `/api/share/[token]/*` authorise through
 * here, which is what lets the two lanes share every downstream handler
 * without either one being able to reach the other's data.
 */

export type Grant = {
  documentId: string;
  canComment: boolean;
  /** Set for the owner lane. */
  userId?: string;
  /** Set for the share lane; recorded as comment/chat provenance. */
  shareId?: string;
};

/** Owner lane: the signed-in user must own this document. */
export async function grantForOwner(documentId: string): Promise<Grant | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id")
    .eq("id", documentId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (error || !data) return null;

  return { documentId, canComment: true, userId: user.id };
}

/** Share lane: a valid, unexpired, unrevoked token. No account required. */
export async function grantForShare(token: string): Promise<Grant | null> {
  const share = await resolveShare(token);
  if (!share) return null;

  return {
    documentId: share.documentId,
    canComment: share.canComment,
    shareId: share.shareId,
  };
}
