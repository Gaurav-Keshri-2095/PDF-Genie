import "server-only";

import { embedQuery, rerankChunks, type RerankableChunk } from "@/lib/ai/cohere";
import { estimateTokens } from "@/lib/pdf/chunk";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Hybrid retrieval: fuse a dense (vector) and a sparse (full-text) candidate
 * list in Postgres, rerank the fused set with a cross-encoder, then keep only
 * as much as belongs in a prompt.
 *
 * Why hybrid rather than vector-only: the two arms fail differently. Dense
 * retrieval misses exact identifiers - a clause number, a party name, an
 * invoice figure - because they carry little semantic signal. Full-text
 * retrieval nails those and misses paraphrase. Fusing by rank (RRF) needs no
 * score normalisation between them, which is what makes the combination
 * practical.
 */

/** Candidates pulled from each arm before fusion (per arm, inside SQL). */
const FUSED_CANDIDATES = 25;
/** How many survive reranking and reach the prompt. */
const CONTEXT_CHUNKS = 6;
/**
 * Prompt context budget. Nova 2 Lite has a 1M window, so this is a quality
 * limit rather than a capacity one: past roughly this much context, answers
 * get worse (relevant text buried mid-prompt) and slower for no gain.
 */
const CONTEXT_TOKEN_BUDGET = 4_000;

export type RetrievalResult = {
  chunks: RerankableChunk[];
  reranked: boolean;
  /** The standalone query actually used, after condensation. */
  searchQuery: string;
};

export async function retrieveContext(
  documentId: string,
  searchQuery: string,
): Promise<RetrievalResult> {
  const supabase = createServiceClient();
  const embedding = await embedQuery(searchQuery);

  const { data, error } = await supabase.rpc("hybrid_search_chunks", {
    filter_document_id: documentId,
    query_text: searchQuery,
    query_embedding: embedding as unknown as string,
    match_count: FUSED_CANDIDATES,
  });

  if (error) throw new Error(`Retrieval failed: ${error.message}`);

  const candidates: RerankableChunk[] = (data ?? []).map(
    (row: { id: number; content: string; page_start: number; page_end: number }) => ({
      id: row.id,
      content: row.content,
      pageStart: row.page_start,
      pageEnd: row.page_end,
    }),
  );

  const { chunks: ranked, reranked } = await rerankChunks(searchQuery, candidates, CONTEXT_CHUNKS);

  return { chunks: withinTokenBudget(ranked), reranked, searchQuery };
}

/**
 * Library-wide semantic search for the dashboard: same fusion, scoped to the
 * user's documents, collapsed to one hit per document.
 */
export type LibraryMatch = {
  documentId: string;
  excerpt: string;
  page: number;
  score: number;
};

export async function searchLibrary(ownerId: string, query: string): Promise<LibraryMatch[]> {
  const supabase = createServiceClient();
  const embedding = await embedQuery(query);

  const { data, error } = await supabase.rpc("hybrid_search_library", {
    filter_owner_id: ownerId,
    query_text: query,
    query_embedding: embedding as unknown as string,
    match_count: 20,
  });

  if (error) throw new Error(`Search failed: ${error.message}`);

  return (data ?? []).map(
    (row: { document_id: string; best_chunk: string; best_page: number; score: number }) => ({
      documentId: row.document_id,
      excerpt: row.best_chunk,
      page: row.best_page,
      score: row.score,
    }),
  );
}

function withinTokenBudget(chunks: RerankableChunk[]): RerankableChunk[] {
  const kept: RerankableChunk[] = [];
  let tokens = 0;

  for (const chunk of chunks) {
    const cost = estimateTokens(chunk.content);
    // Always keep the top-ranked chunk, even if it alone exceeds the budget -
    // returning nothing would be strictly worse than returning too much.
    if (kept.length > 0 && tokens + cost > CONTEXT_TOKEN_BUDGET) break;
    kept.push(chunk);
    tokens += cost;
  }

  return kept;
}
