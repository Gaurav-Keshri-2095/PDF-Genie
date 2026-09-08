import { apiError, describeError, json, notFound } from "@/lib/api";
import { grantForOwner } from "@/lib/handlers/access";
import { ingestDocument } from "@/lib/ingest";

export const runtime = "nodejs";
/**
 * Extraction + embedding + summarisation for a long PDF is the slowest thing
 * the app does, so it gets the full function budget. It lives in its own
 * request precisely so the upload is never held open for it.
 */
export const maxDuration = 300;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const grant = await grantForOwner(id);
  if (!grant) return notFound();

  try {
    const outcome = await ingestDocument(id);
    return json(outcome);
  } catch (error) {
    // ingestDocument has already marked the row 'failed' with this message, so
    // the dashboard can show it without the client having to report anything.
    return apiError(describeError(error), 500);
  }
}
