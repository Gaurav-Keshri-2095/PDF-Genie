import "server-only";

import { embedDocuments } from "@/lib/ai/cohere";
import { summarizeDocument } from "@/lib/ai/summarize";
import { chunkPages } from "@/lib/pdf/chunk";
import { extractPdfText } from "@/lib/pdf/extract";
import { createServiceClient, storageBucket } from "@/lib/supabase/service";

/**
 * Ingestion: download the uploaded PDF, extract its text, index it for
 * retrieval, and generate the dashboard summary.
 *
 * Runs in its own request (not the upload request) because it is the slow part
 * - a long PDF means several embedding round trips plus at least one model
 * call. The document row exists in 'processing' state the whole time, so the
 * dashboard shows honest progress and a timeout degrades to a retryable state
 * rather than a lost upload.
 */

const CHUNK_INSERT_BATCH = 200;

export type IngestOutcome = {
  pageCount: number;
  chunkCount: number;
  hasText: boolean;
  summary: string | null;
};

export async function ingestDocument(documentId: string): Promise<IngestOutcome> {
  const supabase = createServiceClient();

  const { data: document, error: loadError } = await supabase
    .from("documents")
    .select("id, filename, storage_path")
    .eq("id", documentId)
    .single();

  if (loadError || !document) {
    throw new Error(`Document ${documentId} not found.`);
  }

  try {
    const { data: file, error: downloadError } = await supabase.storage
      .from(storageBucket())
      .download(document.storage_path);

    if (downloadError || !file) {
      throw new Error(`Could not download the uploaded file: ${downloadError?.message ?? "missing"}`);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const extracted = await extractPdfText(bytes);

    // A scanned PDF has pages but no text layer. That is an expected outcome,
    // not an error - and it must not turn into an empty prompt, which would
    // produce a confidently invented summary.
    if (!extracted.hasText) {
      await supabase
        .from("documents")
        .update({
          status: "ready",
          page_count: extracted.pageCount,
          has_text: false,
          summary: null,
          error: null,
        })
        .eq("id", documentId);

      return {
        pageCount: extracted.pageCount,
        chunkCount: 0,
        hasText: false,
        summary: null,
      };
    }

    const chunks = chunkPages(extracted.pages);
    if (chunks.length === 0) {
      throw new Error("The PDF contained text but produced no indexable chunks.");
    }

    const embeddings = await embedDocuments(chunks.map((chunk) => chunk.content));

    // Re-ingesting the same document should replace its index, not append.
    await supabase.from("document_chunks").delete().eq("document_id", documentId);

    for (let offset = 0; offset < chunks.length; offset += CHUNK_INSERT_BATCH) {
      const batch = chunks.slice(offset, offset + CHUNK_INSERT_BATCH).map((chunk, index) => ({
        document_id: documentId,
        chunk_index: chunk.chunkIndex,
        page_start: chunk.pageStart,
        page_end: chunk.pageEnd,
        content: chunk.content,
        token_count: chunk.tokenCount,
        embedding: embeddings[offset + index] as unknown as string,
      }));

      const { error: insertError } = await supabase.from("document_chunks").insert(batch);
      if (insertError) throw new Error(`Could not index chunks: ${insertError.message}`);
    }

    const { summary, model } = await summarizeDocument(document.filename, extracted.pages);

    const { error: finalizeError } = await supabase
      .from("documents")
      .update({
        status: "ready",
        page_count: extracted.pageCount,
        has_text: true,
        summary,
        summary_model: model,
        error: null,
      })
      .eq("id", documentId);

    if (finalizeError) throw new Error(finalizeError.message);

    return {
      pageCount: extracted.pageCount,
      chunkCount: chunks.length,
      hasText: true,
      summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed.";

    await supabase
      .from("documents")
      .update({ status: "failed", error: message.slice(0, 500) })
      .eq("id", documentId);

    throw error;
  }
}
