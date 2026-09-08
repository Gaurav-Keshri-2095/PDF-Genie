import { describeError, json, notFound, apiError } from "@/lib/api";
import { grantForOwner } from "@/lib/handlers/access";
import { signedDocumentUrl } from "@/lib/handlers/document";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const grant = await grantForOwner(id);
  if (!grant) return notFound();

  try {
    const url = await signedDocumentUrl(grant);
    if (!url) return notFound();
    return json({ url });
  } catch (error) {
    return apiError(describeError(error), 500);
  }
}
