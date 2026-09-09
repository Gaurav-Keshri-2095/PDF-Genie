import { apiError, describeError, json } from "@/lib/api";
import { searchLibrary } from "@/lib/ai/retrieval";
import { getCurrentUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { DocumentSummaryView } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Dashboard search.
 *
 * Two modes on purpose. A short query is almost always someone typing a
 * filename, and a trigram match answers that instantly and predictably. A
 * longer query is a description of content, which is what the hybrid retrieval
 * index is for. Sending "agreement" through an embedding model would be slower
 * and worse than a substring match.
 */
const SEMANTIC_QUERY_MIN_LENGTH = 3;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("Sign in to search.", 401);

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query) return json({ documents: [], mode: "none" });

  const supabase = createServiceClient();

  try {
    if (query.length < SEMANTIC_QUERY_MIN_LENGTH) {
      const { data, error } = await supabase
        .from("documents")
        .select("id, filename, page_count, status, summary, has_text, error, created_at")
        .eq("owner_id", user.id)
        .ilike("filename", `%${query}%`)
        .order("created_at", { ascending: false });

      if (error) return apiError(error.message, 500);
      return json({ documents: data ?? [], mode: "filename" });
    }

    // Longer query: run both, so a descriptive phrase that happens to match a
    // filename still finds it.
    const [matches, filenameHits] = await Promise.all([
      searchLibrary(user.id, query),
      supabase
        .from("documents")
        .select("id, filename, page_count, status, summary, has_text, error, created_at")
        .eq("owner_id", user.id)
        .ilike("filename", `%${query}%`),
    ]);

    const ids = [
      ...new Set([
        ...(filenameHits.data ?? []).map((row) => row.id as string),
        ...matches.map((match) => match.documentId),
      ]),
    ];

    if (ids.length === 0) return json({ documents: [], mode: "semantic" });

    const { data, error } = await supabase
      .from("documents")
      .select("id, filename, page_count, status, summary, has_text, error, created_at")
      .eq("owner_id", user.id)
      .in("id", ids);

    if (error) return apiError(error.message, 500);

    const byId = new Map((data ?? []).map((row) => [row.id as string, row as DocumentSummaryView]));
    const excerpts = new Map(matches.map((match) => [match.documentId, match]));

    // Semantic hits first, in relevance order; filename-only hits after.
    const ordered: DocumentSummaryView[] = ids
      .flatMap((id) => {
        const row = byId.get(id);
        if (!row) return [];
        const match = excerpts.get(id);

        return [
          {
            ...row,
            match_excerpt: match ? match.excerpt.slice(0, 240) : null,
            match_page: match?.page ?? null,
          },
        ];
      })
      .sort((a, b) => {
        const scoreA = excerpts.get(a.id)?.score ?? -1;
        const scoreB = excerpts.get(b.id)?.score ?? -1;
        return scoreB - scoreA;
      });

    return json({ documents: ordered, mode: "semantic" });
  } catch (error) {
    return apiError(describeError(error), 500);
  }
}
