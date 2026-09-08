import { apiError, describeError, json, notFound } from "@/lib/api";
import { grantForShare } from "@/lib/handlers/access";
import { commentInputSchema, createComment, listComments } from "@/lib/handlers/comments";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  const grant = await grantForShare(token);
  if (!grant) return notFound();

  try {
    return json({ comments: await listComments(grant) });
  } catch (error) {
    return apiError(describeError(error), 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  const grant = await grantForShare(token);
  if (!grant) return notFound();
  if (!grant.canComment) return apiError("This link is view-only.", 403);

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
  if (!parsed.data.authorName) {
    return apiError("Add your name so others know who commented.");
  }

  try {
    return json({ comment: await createComment(grant, parsed.data) }, 201);
  } catch (error) {
    return apiError(describeError(error), 500);
  }
}
