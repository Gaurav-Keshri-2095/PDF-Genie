import "server-only";

import { z } from "zod";

import { converse, converseStream, describeBedrockError } from "@/lib/ai/bedrock";
import {
  CHAT_SYSTEM_PROMPT,
  CONDENSE_SYSTEM_PROMPT,
  buildChatContext,
  buildChatUserPrompt,
  buildCondensePrompt,
} from "@/lib/ai/prompts";
import { retrieveContext } from "@/lib/ai/retrieval";
import { bedrockEnv } from "@/lib/env";
import type { Grant } from "@/lib/handlers/access";
import { createServiceClient } from "@/lib/supabase/service";
import type { ChatMessageRecord, Citation } from "@/lib/types";

/**
 * Conversational turns replayed to the model. The brief asks for at least
 * 3-5 turns of context; four exchanges is enough for follow-ups to resolve
 * without letting an old tangent dominate retrieval.
 */
const HISTORY_TURNS = 8; // 4 user + 4 assistant

export const chatInputSchema = z.object({
  question: z.string().trim().min(1, "Ask a question first.").max(2_000),
  sessionId: z.string().uuid(),
});

export type ChatInput = z.infer<typeof chatInputSchema>;

/** Newline-delimited JSON events. One per line, so the client can parse as it reads. */
export type ChatStreamEvent =
  | { type: "citations"; citations: Citation[] }
  | { type: "delta"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

export async function loadChatHistory(
  grant: Grant,
  sessionId: string,
): Promise<ChatMessageRecord[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, citations, created_at")
    .eq("document_id", grant.documentId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ChatMessageRecord[];
}

/**
 * Answers a question about the document, streaming the response.
 *
 * Order matters here: retrieval completes *before* the response body opens, so
 * citations are known up front and are sent as the first event. The client can
 * render its sources while the answer is still being written.
 */
export async function streamChatAnswer(
  grant: Grant,
  input: ChatInput,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const supabase = createServiceClient();
  const encoder = new TextEncoder();

  const { data: document } = await supabase
    .from("documents")
    .select("status, has_text")
    .eq("id", grant.documentId)
    .maybeSingle();

  if (document && !document.has_text) {
    return errorStream(
      "This PDF has no extractable text (it looks like a scan), so there is nothing to answer questions about.",
    );
  }
  if (document && document.status !== "ready") {
    return errorStream("This document is still being processed. Try again in a moment.");
  }

  const history = await loadChatHistory(grant, input.sessionId);
  const recent = history.slice(-HISTORY_TURNS);

  // Retrieval runs against a standalone rewrite of the question, so follow-ups
  // like "what about the second one?" search for something meaningful.
  const searchQuery = await condenseQuestion(recent, input.question);

  let context = "";
  let citations: Citation[] = [];

  try {
    const retrieval = await retrieveContext(grant.documentId, searchQuery);
    context = buildChatContext(retrieval.chunks);
    citations = retrieval.chunks.map((chunk) => ({
      page_start: chunk.pageStart,
      page_end: chunk.pageEnd,
      excerpt: chunk.content.slice(0, 240),
    }));
  } catch (error) {
    // This is the retrieval path (Cohere embed / rerank / Postgres), not Bedrock.
    return errorStream(
      `Could not search the document: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const turns = [
    ...recent.map((message) => ({ role: message.role, content: message.content })),
    { role: "user" as const, content: buildChatUserPrompt(input.question, context) },
  ];

  await supabase.from("chat_messages").insert({
    document_id: grant.documentId,
    session_id: input.sessionId,
    role: "user",
    content: input.question,
    author_user_id: grant.userId ?? null,
    author_share_id: grant.shareId ?? null,
  });

  let answer = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      send({ type: "citations", citations });

      try {
        for await (const delta of converseStream({
          system: CHAT_SYSTEM_PROMPT,
          turns,
          maxTokens: 1_024,
          temperature: 0.2,
        })) {
          if (signal.aborted) break;
          answer += delta;
          send({ type: "delta", text: delta });
          
          // Artificially slow down the stream so it looks like it's typing,
          // instead of appearing instantly.
          await new Promise((resolve) => setTimeout(resolve, 30));
        }

        // Only persist a complete answer. A reader who navigates away
        // mid-stream should not find a truncated reply in their history.
        if (!signal.aborted && answer.trim()) {
          await supabase.from("chat_messages").insert({
            document_id: grant.documentId,
            session_id: input.sessionId,
            role: "assistant",
            content: answer.trim(),
            citations,
            author_user_id: grant.userId ?? null,
            author_share_id: grant.shareId ?? null,
          });
        }

        send({ type: "done" });
      } catch (error) {
        // Bedrock surfaces throttling and model errors inside the stream,
        // after headers are already sent - so this cannot become an HTTP
        // status and has to travel as an in-band event.
        send({ type: "error", message: describeBedrockError(error) });
      } finally {
        controller.close();
      }
    },
  });
}

async function condenseQuestion(
  history: ChatMessageRecord[],
  question: string,
): Promise<string> {
  if (history.length === 0) return question;

  try {
    const condensed = await converse({
      system: CONDENSE_SYSTEM_PROMPT,
      turns: [
        {
          role: "user",
          content: buildCondensePrompt(
            history.map((message) => ({ role: message.role, content: message.content })),
            question,
          ),
        },
      ],
      maxTokens: 120,
      temperature: 0,
      modelId: bedrockEnv().utilityModelId,
    });

    const cleaned = condensed.replace(/^["'`]|["'`]$/g, "").trim();
    return cleaned || question;
  } catch {
    // Condensation is an optimisation. If it fails, searching the raw question
    // is worse for follow-ups but still works.
    return question;
  }
}

function errorStream(message: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const events: ChatStreamEvent[] = [{ type: "error", message }, { type: "done" }];
      for (const event of events) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }
      controller.close();
    },
  });
}
