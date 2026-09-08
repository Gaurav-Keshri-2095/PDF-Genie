import "server-only";

import type { Grant } from "@/lib/handlers/access";
import { createServiceClient, storageBucket } from "@/lib/supabase/service";
import type { DocumentSummaryView } from "@/lib/types";

/** Short-lived: a signed Storage URL is a bearer capability, so it should not outlive the page view. */
const SIGNED_URL_TTL_SECONDS = 300;

export async function loadDocumentView(grant: Grant): Promise<DocumentSummaryView | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("documents")
    .select("id, filename, page_count, status, summary, has_text, error, created_at")
    .eq("id", grant.documentId)
    .maybeSingle();

  if (error || !data) return null;
  return data as DocumentSummaryView;
}

/**
 * Issues a signed URL for the PDF itself.
 *
 * The bucket is private and carries no RLS policies, so this is the only route
 * to the bytes - and it runs after the caller has been authorised through
 * `grantFor*`.
 */
export async function signedDocumentUrl(grant: Grant): Promise<string | null> {
  const supabase = createServiceClient();

  const { data: document, error: loadError } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", grant.documentId)
    .maybeSingle();

  if (loadError || !document) return null;

  const { data, error } = await supabase.storage
    .from(storageBucket())
    .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
