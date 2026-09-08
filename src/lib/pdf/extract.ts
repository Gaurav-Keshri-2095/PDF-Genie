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

  const pdf = await getDocumentProxy(bytes);
  // mergePages: false gives one string per page, which is what lets chunks
  // carry real page numbers and the chat cite them.
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  const pages = (Array.isArray(text) ? text : [text]).map((page) =>
    normalizeWhitespace(page ?? ""),
  );

  return {
    pageCount: totalPages ?? pages.length,
    pages,
    hasText: pages.some((page) => page.length > 0),
  };
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
