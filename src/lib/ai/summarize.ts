import "server-only";

import { converse } from "@/lib/ai/bedrock";
import {
  SUMMARY_SYSTEM_PROMPT,
  buildSummaryReducePrompt,
  buildSummaryUserPrompt,
} from "@/lib/ai/prompts";
import { estimateTokens } from "@/lib/pdf/chunk";
import { bedrockEnv } from "@/lib/env";

/**
 * How long a document may be before we stop sending it whole.
 *
 * Nova 2 Lite accepts 1M tokens, so this threshold is not about capacity - it
 * is about answer quality and latency. Under it, one pass over the full text
 * gives the model everything at once and produces the best summary. Over it,
 * we map-reduce: summarise consecutive sections, then summarise those.
 */
const SINGLE_PASS_TOKEN_LIMIT = 120_000;
const SECTION_TOKEN_LIMIT = 30_000;

export type SummaryResult = {
  summary: string;
  model: string;
  strategy: "single-pass" | "map-reduce";
};

export async function summarizeDocument(
  filename: string,
  pages: string[],
): Promise<SummaryResult> {
  const model = bedrockEnv().chatModelId;
  const fullText = pages.join("\n\n").trim();

  if (!fullText) {
    throw new Error("Cannot summarise a document with no extractable text.");
  }

  if (estimateTokens(fullText) <= SINGLE_PASS_TOKEN_LIMIT) {
    const summary = await converse({
      system: SUMMARY_SYSTEM_PROMPT,
      turns: [{ role: "user", content: buildSummaryUserPrompt(filename, fullText) }],
      maxTokens: 400,
      temperature: 0.3,
    });

    return { summary: tidy(summary), model, strategy: "single-pass" };
  }

  const sections = groupIntoSections(pages);
  const sectionSummaries: string[] = [];

  for (const section of sections) {
    const summary = await converse({
      system: SUMMARY_SYSTEM_PROMPT,
      turns: [{ role: "user", content: buildSummaryUserPrompt(filename, section) }],
      maxTokens: 400,
      temperature: 0.3,
    });
    sectionSummaries.push(tidy(summary));
  }

  const reduced = await converse({
    system: SUMMARY_SYSTEM_PROMPT,
    turns: [{ role: "user", content: buildSummaryReducePrompt(filename, sectionSummaries) }],
    maxTokens: 400,
    temperature: 0.3,
  });

  return { summary: tidy(reduced), model, strategy: "map-reduce" };
}

/** Consecutive pages packed into sections that each fit comfortably in one call. */
function groupIntoSections(pages: string[]): string[] {
  const sections: string[] = [];
  let buffer: string[] = [];
  let tokens = 0;

  for (const page of pages) {
    const cost = estimateTokens(page);

    if (tokens > 0 && tokens + cost > SECTION_TOKEN_LIMIT) {
      sections.push(buffer.join("\n\n"));
      buffer = [];
      tokens = 0;
    }

    buffer.push(page);
    tokens += cost;
  }

  if (buffer.length > 0) sections.push(buffer.join("\n\n"));
  return sections;
}

/** Strips markdown scaffolding the model may add despite being told not to. */
function tidy(summary: string): string {
  return summary
    .replace(/^\s*(summary|answer)\s*:\s*/i, "")
    .replace(/^[#>\-*\s]+/, "")
    .replace(/\*\*/g, "")
    .trim();
}
