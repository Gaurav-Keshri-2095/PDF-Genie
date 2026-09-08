import { apiError, describeError, json, notFound } from "@/lib/api";
import { grantForOwner } from "@/lib/handlers/access";
import { commentInputSchema, createComment, listComments } from "@/lib/handlers/comments";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const grant = await grantForOwner(id);
  if (!grant) return notFound();

  try {
    return json({ comments: await listComments(grant) });
  } catch (error) {
    return apiError(describeError(error), 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const grant = await grantForOwner(id);
  if (!grant) return notFound();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError("Expected a JSON body.");
  }

  const parsed = commentInputSchema.safeParse(payload);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid comment.");
  }

  try {
    return json({ comment: await createComment(grant, parsed.data) }, 201);
  } catch (error) {
    return apiError(describeError(error), 500);
  }
}
