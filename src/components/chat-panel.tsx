"use client";

import { Send, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Button, EmptyState, Spinner, Textarea } from "@/components/ui";
import { apiBase, type AccessContext, type ChatMessageRecord, type Citation } from "@/lib/types";

type PendingAnswer = {
  text: string;
  citations: Citation[];
};

/**
 * Grounded chat over one document.
 *
 * Responses arrive as newline-delimited JSON: a citations event first (the
 * sources are known before generation starts, because retrieval has already
 * finished), then text deltas, then either done or an in-band error.
 */
export function ChatPanel({
  access,
  disabled,
  disabledReason,
  onJumpToPage,
}: {
  access: AccessContext;
  disabled?: boolean;
  disabledReason?: string;
  onJumpToPage: (page: number) => void;
}) {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [pending, setPending] = useState<PendingAnswer | null>(null);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort an in-flight answer if the panel unmounts, so the server can skip
  // persisting a half-written reply.
  useEffect(() => () => abortRef.current?.abort(), []);

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);

  useEffect(scrollToBottom, [messages, pending, scrollToBottom]);

  async function ask() {
    const trimmed = question.trim();
    if (!trimmed || streaming) return;

    setQuestion("");
    setError(null);
    setStreaming(true);
    setMessages((existing) => [
      ...existing,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: trimmed,
        citations: [],
        created_at: new Date().toISOString(),
      },
    ]);
    setPending({ text: "", citations: [] });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${apiBase(access)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, sessionId }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "The assistant could not be reached.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let citations: Citation[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Events are newline-delimited; the last piece may be a partial line.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const event = JSON.parse(line) as
            | { type: "citations"; citations: Citation[] }
            | { type: "delta"; text: string }
            | { type: "error"; message: string }
            | { type: "done" };

          if (event.type === "citations") {
            citations = event.citations;
            setPending({ text: answer, citations });
          } else if (event.type === "delta") {
            answer += event.text;
            setPending({ text: answer, citations });
          } else if (event.type === "error") {
            setError(event.message);
          }
        }
      }

      if (answer.trim()) {
        setMessages((existing) => [
          ...existing,
          {
            id: `local-answer-${Date.now()}`,
            role: "assistant",
            content: answer.trim(),
            citations,
            created_at: new Date().toISOString(),
          },
        ]);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Something went wrong.");
      }
    } finally {
      setPending(null);
      setStreaming(false);
      abortRef.current = null;
    }
  }

  if (disabled) {
    return (
      <div className="p-4">
        <Alert tone="warning">{disabledReason ?? "Chat is unavailable for this document."}</Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && !pending ? (
          <EmptyState
            icon={<Sparkles className="size-5" />}
            title="Ask about this document"
            description="Answers come from the document itself and cite the pages they came from. Follow-up questions work - it remembers the conversation."
          />
        ) : null}

        {messages.map((message) => (
          <Message key={message.id} message={message} onJumpToPage={onJumpToPage} />
        ))}

        {pending ? (
          <Message
            message={{
              id: "pending",
              role: "assistant",
              content: pending.text,
              citations: pending.citations,
              created_at: new Date().toISOString(),
            }}
            streaming={!pending.text}
            onJumpToPage={onJumpToPage}
          />
        ) : null}

        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>

      <div className="space-y-2 border-t border-border p-4">
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask();
            }
          }}
          rows={2}
          placeholder="Ask a question about this PDF..."
          aria-label="Your question"
          maxLength={2000}
          disabled={streaming}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Enter to send, Shift+Enter for a new line</span>
          <Button size="sm" onClick={() => void ask()} disabled={streaming || !question.trim()}>
            {streaming ? <Spinner className="size-3" /> : <Send className="size-3.5" />}
            Ask
          </Button>
        </div>
      </div>
    </div>
  );
}

function Message({
  message,
  streaming,
  onJumpToPage,
}: {
  message: ChatMessageRecord;
  streaming?: boolean;
  onJumpToPage: (page: number) => void;
}) {
  const isUser = message.role === "user";

  return (
    <div className={isUser ? "flex justify-end" : "space-y-2"}>
      <div
        className={
          isUser
            ? "max-w-[85%] rounded-xl rounded-br-sm bg-accent px-3 py-2 text-sm text-accent-foreground"
            : "rounded-xl bg-surface-muted px-3 py-2 text-sm text-foreground"
        }
      >
        {streaming ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Spinner className="size-3" />
            Reading the document...
          </span>
        ) : (
          <SimpleMarkdown text={message.content} />
        )}
      </div>

      {!isUser && message.citations.length > 0 && !streaming ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Sources:</span>
          {dedupePages(message.citations).map((page) => (
            <button
              key={page}
              type="button"
              onClick={() => onJumpToPage(page)}
              className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent hover:underline"
            >
              p. {page}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One chip per page, in order - retrieved chunks often share pages. */
function dedupePages(citations: Citation[]): number[] {
  const pages = new Set<number>();
  for (const citation of citations) {
    for (let page = citation.page_start; page <= citation.page_end; page += 1) {
      pages.add(page);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

function SimpleMarkdown({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {paragraphs.map((p, i) => (
        <p key={i} className="whitespace-pre-wrap leading-relaxed">
          {formatBold(p)}
        </p>
      ))}
    </div>
  );
}

function formatBold(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}
