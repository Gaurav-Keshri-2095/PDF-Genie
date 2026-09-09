import "server-only";

/**
 * Server-side PDF text extraction.
 *
 * unpdf is used rather than pdf-parse or raw pdfjs-dist because it ships a
 * prebundled serverless build of pdf.js with no native dependencies and no
 * canvas requirement - which is what makes it work inside a Vercel function.
 */

export type ExtractedPdf = {
  pageCount: number;
  /** One entry per page, index 0 = page 1. May contain empty strings. */
  pages: string[];
  /** False when the PDF carries no text layer at all (i.e. it is a scan). */
  hasText: boolean;
};

const PDF_MAGIC = "%PDF-";

/** Cheap structural check: is this actually a PDF, whatever the client claimed? */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  const header = Buffer.from(bytes.subarray(0, PDF_MAGIC.length)).toString("latin1");
  return header === PDF_MAGIC;
}

export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdf> {
  if (!looksLikePdf(bytes)) {
    throw new Error("File is not a PDF (missing %PDF- header).");
  }

  const { getDocumentProxy, extractText } = await import("unpdf");

  // pdf.js often detaches the underlying ArrayBuffer. We pass a copy so the
  // original bytes remain intact for the OCR fallback to use if needed.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  // mergePages: false gives one string per page, which is what lets chunks
  // carry real page numbers and the chat cite them.
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  let pages = (Array.isArray(text) ? text : [text]).map((page) =>
    normalizeWhitespace(page ?? ""),
  );

  let hasText = pages.some((page) => page.length > 0);

  if (!hasText) {
    console.log(`[extractPdfText] No text layer found for document. Initiating OCR fallback...`);
    try {
      pages = await ocrPdf(bytes);
      hasText = pages.some((page) => page.length > 0);
      console.log(`[extractPdfText] OCR complete. hasText: ${hasText}, pages extracted: ${pages.length}`);
    } catch (e) {
      console.error("[extractPdfText] OCR extraction failed completely:", e);
    }
  }

  return {
    pageCount: totalPages ?? pages.length,
    pages,
    hasText,
  };
}

const OCR_PAGES_PER_CHUNK = 8;

async function ocrPdf(bytes: Uint8Array): Promise<string[]> {
  const { PDFDocument } = await import("pdf-lib");
  const { transcribePdfChunk } = await import("@/lib/ai/bedrock");

  const pdfDoc = await PDFDocument.load(bytes);
  const totalPages = pdfDoc.getPageCount();
  const allPages: string[] = [];

  for (let i = 0; i < totalPages; i += OCR_PAGES_PER_CHUNK) {
    const end = Math.min(i + OCR_PAGES_PER_CHUNK, totalPages);
    console.log(`[ocrPdf] Processing pages ${i} to ${end - 1} out of ${totalPages}...`);
    
    const chunkDoc = await PDFDocument.create();
    const pageIndices = Array.from({ length: end - i }, (_, index) => i + index);
    const copiedPages = await chunkDoc.copyPages(pdfDoc, pageIndices);
    
    for (const page of copiedPages) {
      chunkDoc.addPage(page);
    }
    
    const chunkBytes = await chunkDoc.save();
    console.log(`[ocrPdf] Created chunk of size ${chunkBytes.byteLength} bytes. Sending to Bedrock...`);
    
    try {
      const transcribedText = await transcribePdfChunk(chunkBytes);
      console.log(`[ocrPdf] Bedrock transcription received. Length: ${transcribedText.length} characters.`);
      
      const pagesText = transcribedText.split("---PAGE_BREAK---").map((t) => normalizeWhitespace(t));
      
      // Align the number of transcribed pages exactly to the chunk size for correct citation indexing
      if (pagesText.length < end - i) {
        console.warn(`[ocrPdf] Bedrock returned ${pagesText.length} pages, expected ${end - i}. Padding with empty strings.`);
        while (pagesText.length < end - i) pagesText.push("");
      } else if (pagesText.length > end - i) {
        console.warn(`[ocrPdf] Bedrock returned ${pagesText.length} pages, expected ${end - i}. Merging excess into last page.`);
        const excess = pagesText.splice(end - i - 1);
        pagesText.push(excess.join("\n\n"));
      }

      allPages.push(...pagesText);
    } catch (chunkError) {
      console.error(`[ocrPdf] Error transcribing chunk ${i} to ${end - 1}:`, chunkError);
      // Pad with empty pages to maintain page alignment even if chunk fails
      while (allPages.length < end) allPages.push("");
    }
  }

  return allPages;
}

/**
 * pdf.js emits text positionally, which leaves ragged runs of spaces and
 * newlines. Collapsing them keeps chunk boundaries meaningful and stops us
 * paying for whitespace tokens on every embedding call.
 */
function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
