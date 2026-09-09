"use client";

import { ChevronLeft, ChevronRight, MessageSquare, ScanLine, Sparkles, ZoomIn, ZoomOut } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

import { ChatPanel } from "@/components/chat-panel";
import { CommentPanel } from "@/components/comment-panel";
import { RetryIngest } from "@/components/retry-ingest";
import { Badge, Button, Spinner } from "@/components/ui";
import type { AccessContext, CommentRecord, DocumentSummaryView } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * react-pdf touches browser-only APIs, so it must not be server-rendered.
 * (PageStepper is imported normally above - it is plain markup.)
 */
const PdfViewer = dynamic(() => import("@/components/pdf-viewer").then((m) => m.PdfViewer), {
  ssr: false,
  loading: () => (
    <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Spinner />
      Loading viewer...
    </p>
  ),
});

type Tab = "comments" | "chat";

/**
 * The reading surface, used by both the owner route and the public share
 * route. The only thing that differs between them is `access`, which decides
 * which API base every child talks to.
 */
export function DocumentWorkspace({
  access,
  document,
  canComment,
  initialComments,
  shareControl,
}: {
  access: AccessContext;
  document: DocumentSummaryView;
  canComment: boolean;
  initialComments: CommentRecord[];
  /** Owner-only affordance (the share-link button); absent in the share lane. */
  shareControl?: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("chat");
  const [currentPage, setCurrentPage] = useState(1);
  const [jumpTarget, setJumpTarget] = useState<{ page: number; nonce: number } | null>(null);
  const [scale, setScale] = useState(1);

  const jumpToPage = useCallback((page: number) => {
    // The nonce makes a repeat jump to the same page still scroll.
    setJumpTarget({ page, nonce: Date.now() });
    setCurrentPage(page);
  }, []);

  const chatDisabled = !document.has_text || document.status !== "ready";
  const chatDisabledReason = !document.has_text
    ? "This PDF has no text layer (it looks like a scan), so there is nothing to answer questions from."
    : document.status === "processing"
      ? "Still reading this document. Chat will be available in a moment."
      : "This document failed to process, so chat is unavailable.";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SummaryBanner document={document} access={access} shareControl={shareControl} />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section
          aria-label="Document"
          className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-border lg:border-r lg:border-b-0"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2">
            <span className="truncate text-xs font-medium text-muted-foreground">
              {document.filename}
            </span>
            <div className="flex items-center gap-4">
              <ZoomControls scale={scale} onScaleChange={setScale} />
              <PageStepper page={currentPage} pageCount={document.page_count} onJump={jumpToPage} />
            </div>
          </div>

          <div className="min-h-0 min-w-0 flex-1 relative">
            <PdfViewer
              access={access}
              hasText={document.has_text}
              jumpTarget={jumpTarget}
              onVisiblePageChange={setCurrentPage}
              scale={scale}
              onScaleChange={setScale}
            />
          </div>
        </section>

        <aside
          aria-label="Comments and chat"
          className="flex min-h-0 flex-1 w-full flex-col bg-surface lg:flex-none lg:w-[400px] xl:w-[440px]"
        >
          <div role="tablist" className="flex shrink-0 border-b border-border">
            <TabButton
              active={tab === "chat"}
              onClick={() => setTab("chat")}
              icon={<Sparkles className="size-4" />}
              label="AI Chat"
            />
            <TabButton
              active={tab === "comments"}
              onClick={() => setTab("comments")}
              icon={<MessageSquare className="size-4" />}
              label="Comments"
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className={cn("flex flex-1 flex-col min-h-0", tab !== "chat" && "hidden")}>
              <ChatPanel
                access={access}
                disabled={chatDisabled}
                disabledReason={chatDisabledReason}
                onJumpToPage={jumpToPage}
              />
            </div>
            <div className={cn("flex flex-1 flex-col min-h-0", tab !== "comments" && "hidden")}>
              <CommentPanel
                access={access}
                canComment={canComment}
                currentPage={currentPage}
                initialComments={initialComments}
                onJumpToPage={jumpToPage}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors",
        active
          ? "border-b-2 border-accent text-foreground"
          : "border-b-2 border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function SummaryBanner({
  document,
  access,
  shareControl,
}: {
  document: DocumentSummaryView;
  access: AccessContext;
  shareControl?: React.ReactNode;
}) {
  return (
    <div className="shrink-0 border-b border-border bg-surface px-4 py-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-base font-semibold tracking-tight">{document.filename}</h1>
            {document.status === "processing" ? (
              <Badge tone="accent">
                <Spinner className="size-2.5" />
                Processing
              </Badge>
            ) : null}
            {document.status === "failed" ? (
              <>
                <Badge tone="danger">Failed</Badge>
                {access.kind === "owner" ? (
                  <RetryIngest documentId={access.documentId} label="Retry processing" />
                ) : null}
              </>
            ) : null}
            {!document.has_text && document.status === "ready" ? (
              <Badge tone="warning">
                <ScanLine className="size-3" />
                No text layer
              </Badge>
            ) : null}
          </div>

          {summaryText(document) ? (
            <p className="max-w-3xl text-sm text-muted-foreground">{summaryText(document)}</p>
          ) : null}
        </div>

        {shareControl ? <div className="shrink-0">{shareControl}</div> : null}
      </div>
    </div>
  );
}

function summaryText(document: DocumentSummaryView): string | null {
  if (document.status === "processing") return "Reading the document and writing a summary...";
  if (document.status === "failed") {
    return document.error ?? "This document could not be processed.";
  }
  if (!document.has_text) {
    return "This PDF has no extractable text, so no summary could be generated. You can still read it and leave comments.";
  }
  return null;
}

export function PageStepper({
  page,
  pageCount,
  onJump,
}: {
  page: number;
  pageCount: number | null;
  onJump: (page: number) => void;
}) {
  if (!pageCount) return null;

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onJump(Math.max(1, page - 1))}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <span className="tabular-nums">
        {page} / {pageCount}
      </span>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Next page"
        disabled={page >= pageCount}
        onClick={() => onJump(Math.min(pageCount, page + 1))}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

export function ZoomControls({
  scale,
  onScaleChange,
}: {
  scale: number;
  onScaleChange: (scale: number | ((prev: number) => number)) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        aria-label="Zoom out"
        disabled={scale <= 1}
        onClick={() => onScaleChange((s) => Math.max(1, s - 0.25))}
      >
        <ZoomOut className="size-3.5" />
      </Button>
      <span className="w-10 text-center font-medium tabular-nums">{Math.round(scale * 100)}%</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        aria-label="Zoom in"
        onClick={() => onScaleChange((s) => Math.min(5, s + 0.25))}
      >
        <ZoomIn className="size-3.5" />
      </Button>
    </div>
  );
}
