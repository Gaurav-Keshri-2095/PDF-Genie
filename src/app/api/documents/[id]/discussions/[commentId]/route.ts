import { apiError, describeError, json, notFound } from "@/lib/api";
import { grantForOwner } from "@/lib/handlers/access";
import { deleteComment } from "@/lib/handlers/comments";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; commentId: string }> }
) {
  const { id, commentId } = await context.params;

  const grant = await grantForOwner(id);
  if (!grant) return notFound();

  try {
    await deleteComment(grant, commentId);
    return json({ success: true });
  } catch (error) {
    return apiError(describeError(error), 500);
  }
}
