"use client";

import { MessageSquare, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Alert, Avatar, Badge, Button, EmptyState, Input, Spinner, Textarea } from "@/components/ui";
import { apiBase, type AccessContext, type CommentRecord } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

const POLL_INTERVAL_MS = 5_000;

/**
 * Comments, anchored to the page the reader was on when they wrote them.
 *
 * The same component serves the owner and an anonymous share visitor; the only
 * difference is that a visitor has no account to take a name from, so they are
 * asked for one once and it is remembered per share link.
 *
 * The initial list is rendered on the server, so the thread is present on first
 * paint and the client only polls for what arrives afterwards.
 */
export function CommentPanel({
  access,
  canComment,
  currentPage,
  initialComments,
  onJumpToPage,
}: {
  access: AccessContext;
  canComment: boolean;
  currentPage: number;
  initialComments: CommentRecord[];
  onJumpToPage: (page: number) => void;
}) {
  const isGuest = access.kind === "share";
  const nameStorageKey = isGuest ? `pdf-genie:name:${access.token}` : null;

  const [comments, setComments] = useState<CommentRecord[]>(initialComments);
  const [body, setBody] = useState("");
  const [anchorToPage, setAnchorToPage] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Uncontrolled: the remembered name is written straight to the DOM node
  // after mount, which avoids a hydration mismatch between the server (which
  // cannot read localStorage) and the browser.
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!nameStorageKey || !nameInputRef.current) return;
    try {
      nameInputRef.current.value = window.localStorage.getItem(nameStorageKey) ?? "";
    } catch {
      // Private browsing can throw on access; the field just starts empty.
    }
  }, [nameStorageKey]);

  useEffect(() => {
    // Polling rather than realtime: anonymous visitors have no Supabase
    // session to authorise a realtime subscription, and five seconds is well
    // inside what a comment thread needs.
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`${apiBase(access)}/comments`);
        if (!response.ok) return;
        const payload = await response.json();
        setComments(payload.comments ?? []);
      } catch {
        // Transient failure; the next tick tries again.
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [access]);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed) return;

    const authorName = nameInputRef.current?.value.trim() ?? "";
    if (isGuest && !authorName) {
      setError("Add your name so others know who commented.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${apiBase(access)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: trimmed,
          pageNumber: anchorToPage ? currentPage : null,
          ...(isGuest ? { authorName } : {}),
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not post the comment.");

      setComments((existing) => [...existing, payload.comment]);
      setBody("");

      if (nameStorageKey) {
        try {
          window.localStorage.setItem(nameStorageKey, authorName);
        } catch {
          // Not being able to remember the name is not worth surfacing.
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not post the comment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {comments.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="size-5" />}
            title="No comments yet"
            description={
              canComment
                ? "Add the first one below. It will be tagged with the page you're reading."
                : "This link is view-only."
            }
          />
        ) : (
          <ul className="space-y-4">
            {comments.map((comment) => (
              <li key={comment.id} className="flex gap-3">
                <Avatar name={comment.author_name} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {comment.author_name}
                    </span>
                    {comment.author_share_id && !comment.author_user_id ? (
                      <Badge>Guest</Badge>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(comment.created_at)}
                    </span>
                  </div>

                  {/* Rendered as text, never as markup - the author name and
                      body of a guest comment are untrusted input. */}
                  <p className="text-sm whitespace-pre-wrap text-foreground">{comment.body}</p>

                  {comment.page_number ? (
                    <button
                      type="button"
                      onClick={() => onJumpToPage(comment.page_number!)}
                      className="text-xs font-medium text-accent hover:underline"
                    >
                      Page {comment.page_number}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canComment ? (
        <div className="space-y-2 border-t border-border p-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}

          {isGuest ? (
            <Input
              ref={nameInputRef}
              name="authorName"
              placeholder="Your name"
              aria-label="Your name"
              maxLength={80}
            />
          ) : null}

          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            rows={3}
            placeholder="Add a comment..."
            aria-label="Comment"
            maxLength={4000}
          />

          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={anchorToPage}
                onChange={(event) => setAnchorToPage(event.target.checked)}
                className="size-3.5 accent-[var(--accent)]"
              />
              Attach to page {currentPage}
            </label>

            <Button size="sm" onClick={() => void submit()} disabled={submitting || !body.trim()}>
              {submitting ? <Spinner className="size-3" /> : <Send className="size-3.5" />}
              Comment
            </Button>
          </div>
        </div>
      ) : (
        <p className="border-t border-border p-4 text-xs text-muted-foreground">
          This link is view-only.
        </p>
      )}
    </div>
  );
}
