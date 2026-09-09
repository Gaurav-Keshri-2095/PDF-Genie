import "server-only";

import { z } from "zod";

import type { Grant } from "@/lib/handlers/access";
import { createServiceClient } from "@/lib/supabase/service";
import type { CommentRecord } from "@/lib/types";

export const commentInputSchema = z.object({
  body: z.string().trim().min(1, "Write something first.").max(4_000, "Comment is too long."),
  pageNumber: z.number().int().positive().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  /** Required in the share lane, where there is no account to take a name from. */
  authorName: z.string().trim().min(1).max(80).optional(),
});

export type CommentInput = z.infer<typeof commentInputSchema>;

export async function listComments(grant: Grant): Promise<CommentRecord[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("comments")
    .select(
      "id, document_id, parent_id, page_number, body, author_user_id, author_share_id, author_name, created_at",
    )
    .eq("document_id", grant.documentId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as CommentRecord[];
}

export async function createComment(grant: Grant, input: CommentInput): Promise<CommentRecord> {
  if (!grant.canComment) {
    throw new Error("This link is view-only.");
  }

  const supabase = createServiceClient();
  const authorName = await resolveAuthorName(grant, input.authorName);

  const { data, error } = await supabase
    .from("comments")
    .insert({
      document_id: grant.documentId,
      parent_id: input.parentId ?? null,
      page_number: input.pageNumber ?? null,
      body: input.body,
      author_user_id: grant.userId ?? null,
      author_share_id: grant.shareId ?? null,
      author_name: authorName,
    })
    .select(
      "id, document_id, parent_id, page_number, body, author_user_id, author_share_id, author_name, created_at",
    )
    .single();

  if (error) throw new Error(error.message);
  return data as CommentRecord;
}

/**
 * Owners are named from their profile - a signed-in user should not be able to
 * post under someone else's name by editing the request body. Share visitors
 * supply their own display name, which is untrusted and treated as such (it is
 * stored as text and rendered as text, never as markup).
 */
async function resolveAuthorName(grant: Grant, provided?: string): Promise<string> {
  if (grant.userId) {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("profiles")
      .select("name, email")
      .eq("id", grant.userId)
      .maybeSingle();

    return data?.name?.trim() || data?.email?.trim() || "Owner";
  }

  return provided?.trim() || "Guest";
}
