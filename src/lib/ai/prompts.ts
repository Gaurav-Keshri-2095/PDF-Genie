/**
 * Prompt construction.
 *
 * Kept in one file so the wording is reviewable in isolation - the quality of
 * these three prompts is most of what separates a useful answer from a
 * plausible-sounding one.
 */

import type { RerankableChunk } from "@/lib/ai/cohere";

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

/**
 * The failure mode this is written against is the generic summary: "This
 * document discusses various topics related to the agreement." It is useless
 * because it would be true of a thousand other documents. So the instructions
 * demand specifics (names, amounts, dates) and explicitly ban the throat-
 * clearing openers that lead into vagueness.
 */
export const SUMMARY_SYSTEM_PROMPT = `You summarise documents for a dashboard where each summary is the only thing a reader sees before deciding whether to open the file.

Write 3-5 sentences of plain prose. No preamble, no headings, no bullet points, no markdown.

Your summary must let a reader answer: what is this document, who or what is it about, and what does it actually say?

Requirements:
- Name the document type in the first sentence (contract, invoice, research paper, policy, report, manual, correspondence...).
- Name the specific parties, subjects, systems, or entities involved. Use the names as written in the document.
- State the substance: the key terms, findings, obligations, conclusions, or figures. Include concrete numbers, dates, amounts, and durations where the document gives them.
- If the document has an unusual or notable provision, say so.

Forbidden:
- Opening with "This document...", "The document outlines...", "This paper discusses..." or any equivalent. Start with the substance.
- Vague filler: "various topics", "several key points", "important information", "different aspects".
- Restating the title back as though it were a summary.
- Claiming anything the excerpts do not support. If the content is too fragmentary to summarise confidently, say plainly what the document appears to be and what is unclear.`;

export function buildSummaryUserPrompt(filename: string, text: string): string {
  return `Filename: ${filename}

Document text:
"""
${text}
"""

Write the 3-5 sentence summary now.`;
}

/**
 * Reduce step for documents too long to summarise in one pass: the model sees
 * summaries of consecutive sections rather than the raw text.
 */
export function buildSummaryReducePrompt(filename: string, sectionSummaries: string[]): string {
  const sections = sectionSummaries
    .map((summary, index) => `Section ${index + 1}: ${summary}`)
    .join("\n\n");

  return `Filename: ${filename}

These are summaries of consecutive sections of one long document, in order:
"""
${sections}
"""

Write a single 3-5 sentence summary of the document as a whole. Cover what the document is and what it says overall - do not summarise the sections one by one, and do not mention that you were given sections.`;
}

// ---------------------------------------------------------------------------
// Grounded chat
// ---------------------------------------------------------------------------

export const CHAT_SYSTEM_PROMPT = `You answer questions about one specific PDF. You will be given numbered excerpts from that PDF, each labelled with its page numbers.

Ground every claim in those excerpts.

Rules:
- Use only what the excerpts contain. Do not add outside knowledge, and do not infer beyond what the text supports.
- Cite the page you used, inline, like (p. 4) or (pp. 11-12). Cite the page the fact actually came from, not a guess.
- If the excerpts do not answer the question, say so directly: "The excerpts I can see don't cover that." Then, if the excerpts contain something adjacent and genuinely useful, offer it and label it as related rather than as the answer. Never fill a gap with a plausible-sounding invention.
- If the excerpts contradict each other, say so and cite both pages.
- When the question refers back to earlier conversation ("it", "that clause", "the second one"), resolve it from the conversation history.

Style: answer first, briefly. Use the document's own terminology. Plain prose for short answers; a short list only when the question genuinely calls for one. Do not describe your own process or mention "excerpts", "context", or "chunks" unless you are explaining that the answer isn't there.`;

export function buildChatContext(chunks: RerankableChunk[]): string {
  return chunks
    .map((chunk, index) => {
      const pages =
        chunk.pageStart === chunk.pageEnd
          ? `p. ${chunk.pageStart}`
          : `pp. ${chunk.pageStart}-${chunk.pageEnd}`;
      return `[Excerpt ${index + 1} | ${pages}]\n${chunk.content}`;
    })
    .join("\n\n");
}

export function buildChatUserPrompt(question: string, context: string): string {
  if (!context) {
    return `No excerpts could be retrieved from the document for this question.

Question: ${question}

Tell the user you could not find anything in the document about this.`;
  }

  return `Excerpts from the document:
"""
${context}
"""

Question: ${question}`;
}

// ---------------------------------------------------------------------------
// Query condensation
// ---------------------------------------------------------------------------

/**
 * Retrieval happens before the model sees the conversation, so a follow-up
 * like "what about the second one?" would be embedded as-is and match
 * nothing. Rewriting it into a standalone query first is the single cheapest
 * fix for follow-up questions returning irrelevant context.
 */
export const CONDENSE_SYSTEM_PROMPT = `Rewrite the user's latest message into a single standalone search query for retrieving passages from a document.

Resolve pronouns and references using the conversation history. Keep the specific nouns, names, and numbers - they are what the search matches on. Drop conversational filler.

Output only the rewritten query. No quotes, no explanation, no preamble. If the message is already standalone, output it unchanged.`;

export function buildCondensePrompt(history: { role: string; content: string }[], question: string): string {
  if (history.length === 0) return question;

  const transcript = history
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
    .join("\n");

  return `Conversation so far:
"""
${transcript}
"""

Latest user message: ${question}

Standalone search query:`;
}
