import "server-only";

import { CohereClientV2 } from "cohere-ai";

import { cohereEnv } from "@/lib/env";

/**
 * Cohere: dense embeddings for the vector arm of retrieval, plus reranking of
 * the fused candidate set.
 *
 * CohereClientV2 (not CohereClient) - the v2 endpoints take plain strings for
 * rerank documents and return embeddings grouped by type.
 */

/** Hard SDK limit: "Maximum number of texts per call is 96". */
const EMBED_BATCH_SIZE = 96;

/** Matches vector(1024) in the schema. */
export const EMBED_DIMENSIONS = 1024;

let client: CohereClientV2 | null = null;

function getClient(): CohereClientV2 {
  if (!client) {
    client = new CohereClientV2({ token: cohereEnv().apiKey });
  }
  return client;
}

type EmbedPurpose = "document" | "query";

async function embed(texts: string[], purpose: EmbedPurpose): Promise<number[][]> {
  if (texts.length === 0) return [];

  const env = cohereEnv();
  const response = await getClient().embed({
    texts,
    model: env.embedModel,
    // Asymmetric embedding: chunks and questions are encoded differently, and
    // getting this backwards quietly degrades every retrieval.
    inputType: purpose === "document" ? "search_document" : "search_query",
    embeddingTypes: ["float"],
    outputDimension: EMBED_DIMENSIONS,
    truncate: "END",
  });

  const embeddings = response.embeddings?.float;
  if (!embeddings || embeddings.length !== texts.length) {
    throw new Error("Cohere returned an unexpected number of embeddings.");
  }

  return embeddings;
}

/** Embeds chunks at ingest time, batched to the API limit. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];

  for (let offset = 0; offset < texts.length; offset += EMBED_BATCH_SIZE) {
    const batch = texts.slice(offset, offset + EMBED_BATCH_SIZE);
    results.push(...(await embed(batch, "document")));
  }

  return results;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await embed([text], "query");
  return embedding;
}

export type RerankableChunk = {
  id: number;
  content: string;
  pageStart: number;
  pageEnd: number;
};

/**
 * Reranks fused candidates with a cross-encoder, which is what turns "these
 * chunks mention the right words" into "these chunks answer the question".
 *
 * Falls back to the incoming RRF order on failure. A trial Cohere key allows
 * only 10 rerank requests per minute, so a 429 here is likely during
 * development and must not take the whole chat down with it.
 */
export async function rerankChunks(
  query: string,
  chunks: RerankableChunk[],
  topN: number,
): Promise<{ chunks: RerankableChunk[]; reranked: boolean }> {
  if (chunks.length === 0) return { chunks: [], reranked: false };
  if (chunks.length <= 1) return { chunks, reranked: false };

  const env = cohereEnv();

  try {
    const response = await getClient().rerank({
      query,
      documents: chunks.map((chunk) => chunk.content),
      topN: Math.min(topN, chunks.length),
      model: env.rerankModel,
    });

    const ordered = response.results
      .map((result) => chunks[result.index])
      .filter((chunk): chunk is RerankableChunk => Boolean(chunk));

    return { chunks: ordered, reranked: true };
  } catch (error) {
    console.warn(
      "[cohere] rerank failed, falling back to fusion order:",
      error instanceof Error ? error.message : error,
    );
    return { chunks: chunks.slice(0, topN), reranked: false };
  }
}
