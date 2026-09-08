/**
 * Page-aware chunking.
 *
 * Sizing is driven by the reranker, not by the embedder: Cohere Rerank scores
 * documents longer than roughly 510 tokens by splitting them internally and
 * max-pooling, so a chunk that fits under that limit is scored as a whole
 * passage. ~1,800 characters is about 450 tokens of English prose, which sits
 * just under the line while still being large enough to hold a complete
 * argument or clause.
 *
 * Overlap is 200 characters (~11%) - enough that a sentence straddling a
 * boundary survives in one piece, without meaningfully inflating the index.
 */

export const CHUNK_TARGET_CHARS = 1_700;
export const CHUNK_OVERLAP_CHARS = 200;
/** Below this, a trailing fragment is merged backwards instead of standing alone. */
const MIN_CHUNK_CHARS = 200;

export type Chunk = {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  content: string;
  tokenCount: number;
};

type PageSegment = {
  page: number;
  text: string;
};

/**
 * Rough token estimate. Used for budgeting prompt context, never for billing
 * or hard limits, so ~4 characters per token is accurate enough and avoids
 * shipping a tokenizer to do arithmetic.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkPages(pages: string[]): Chunk[] {
  const segments = splitIntoSegments(pages);
  const chunks: Chunk[] = [];

  let buffer: PageSegment[] = [];
  let bufferLength = 0;

  const flush = () => {
    if (buffer.length === 0) return;

    const content = buffer
      .map((segment) => segment.text)
      .join(" ")
      .trim();

    if (content.length === 0) {
      buffer = [];
      bufferLength = 0;
      return;
    }

    chunks.push({
      chunkIndex: chunks.length,
      pageStart: buffer[0].page,
      pageEnd: buffer[buffer.length - 1].page,
      content,
      tokenCount: estimateTokens(content),
    });

    // Carry the tail of this chunk into the next one so context spanning a
    // boundary is not lost.
    //
    // The tail is measured in characters rather than whole segments. Carrying
    // whole segments meant a single long trailing sentence became the entire
    // overlap, which pushed the following chunk past the target size and out
    // of the reranker's single-pass window.
    const lastPage = buffer[buffer.length - 1].page;
    const tail = trailingWords(content, CHUNK_OVERLAP_CHARS);

    buffer = tail ? [{ page: lastPage, text: tail }] : [];
    bufferLength = tail.length;
  };

  for (const segment of segments) {
    // A single segment longer than the target (a page with no sentence breaks,
    // say) is hard-split rather than allowed to blow past the limit.
    if (segment.text.length > CHUNK_TARGET_CHARS) {
      flush();
      for (const piece of hardSplit(segment.text, CHUNK_TARGET_CHARS)) {
        chunks.push({
          chunkIndex: chunks.length,
          pageStart: segment.page,
          pageEnd: segment.page,
          content: piece,
          tokenCount: estimateTokens(piece),
        });
      }
      buffer = [];
      bufferLength = 0;
      continue;
    }

    if (bufferLength + segment.text.length + 1 > CHUNK_TARGET_CHARS) {
      flush();
    }

    buffer.push(segment);
    bufferLength += segment.text.length + 1;
  }

  flush();

  // The overlap carry-over can leave a final chunk that is nothing but the
  // previous chunk's tail; drop it rather than indexing a duplicate.
  const last = chunks[chunks.length - 1];
  if (chunks.length > 1 && last && last.content.length < MIN_CHUNK_CHARS) {
    chunks.pop();
  }

  return chunks.map((chunk, index) => ({ ...chunk, chunkIndex: index }));
}

/** Paragraph first, then sentence - never split mid-sentence if avoidable. */
function splitIntoSegments(pages: string[]): PageSegment[] {
  const segments: PageSegment[] = [];

  pages.forEach((pageText, pageIndex) => {
    const page = pageIndex + 1;
    if (!pageText.trim()) return;

    for (const paragraph of pageText.split(/\n{2,}/)) {
      const trimmed = paragraph.trim();
      if (!trimmed) continue;

      if (trimmed.length <= CHUNK_TARGET_CHARS) {
        segments.push({ page, text: trimmed });
        continue;
      }

      for (const sentence of trimmed.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/)) {
        const sentenceText = sentence.trim();
        if (sentenceText) segments.push({ page, text: sentenceText });
      }
    }
  });

  return segments;
}

/** The last `maxChars` of text, trimmed forward to a word boundary. */
function trailingWords(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const tail = text.slice(-maxChars);
  const boundary = tail.search(/\s/);
  return (boundary === -1 ? tail : tail.slice(boundary + 1)).trim();
}

function hardSplit(text: string, size: number): string[] {
  const pieces: string[] = [];
  for (let offset = 0; offset < text.length; offset += size) {
    const piece = text.slice(offset, offset + size).trim();
    if (piece) pieces.push(piece);
  }
  return pieces;
}
