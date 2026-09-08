import { apiError, describeError, json, notFound } from "@/lib/api";
import { grantForShare } from "@/lib/handlers/access";
import { loadDocumentView } from "@/lib/handlers/document";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  const grant = await grantForShare(token);
  if (!grant) return notFound();

  try {
    const document = await loadDocumentView(grant);
    if (!document) return notFound();

    return json({ document, canComment: grant.canComment });
  } catch (error) {
    return apiError(describeError(error), 500);
  }
}
