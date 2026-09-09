"use client";

import { FileText, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DocumentCard } from "@/components/document-card";
import { UploadDropzone } from "@/components/upload-dropzone";
import { Alert, EmptyState, Input, Spinner } from "@/components/ui";
import type { DocumentSummaryView } from "@/lib/types";

/** Long enough that the server switches to semantic search - see /api/search. */
const SEMANTIC_MIN_LENGTH = 12;
const SEARCH_DEBOUNCE_MS = 300;
const POLL_INTERVAL_MS = 2_500;

export function DashboardClient({ initialDocuments }: { initialDocuments: DocumentSummaryView[] }) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DocumentSummaryView[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    refreshRef.current?.abort();
    const controller = new AbortController();
    refreshRef.current = controller;

    try {
      const response = await fetch("/api/documents", { signal: controller.signal });
      if (!response.ok) return;
      const body = await response.json();
      setDocuments(body.documents ?? []);
    } catch {
      // Aborted or offline; the next poll or action will pick it up.
    }
  }, []);

  // Poll only while something is actually being processed, so an idle
  // dashboard makes no requests at all.
  const hasProcessing = useMemo(
    () => documents.some((document) => document.status === "processing"),
    [documents],
  );

  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasProcessing, refresh]);

  // Clearing and the "searching" flag belong to the typing event, not to an
  // effect - deriving them in an effect would cascade an extra render per
  // keystroke.
  const onQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (value.trim()) {
      setSearching(true);
    } else {
      setSearchResults(null);
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        const body = await response.json();

        if (!response.ok) throw new Error(body.error ?? "Search failed.");

        setSearchResults(body.documents ?? []);
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Search failed.");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const visible = searchResults ?? documents;
  const isSemantic = query.trim().length >= SEMANTIC_MIN_LENGTH;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search by filename, or describe what the document is about"
            aria-label="Search your PDFs"
            className="pl-9"
          />
          {searching ? (
            <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
          ) : null}
        </div>

        {query.trim() ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {isSemantic ? (
              <>
                <Sparkles className="size-3 text-accent" />
                Searching document contents, not just filenames
              </>
            ) : (
              <>Matching filenames. Type a longer phrase to search inside your documents.</>
            )}
          </p>
        ) : null}
      </div>

      <UploadDropzone onUploaded={refresh} />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {visible.length === 0 ? (
        query.trim() ? (
          <EmptyState
            icon={<Search className="size-6" />}
            title="Nothing matched"
            description="Try a different phrase, or describe what the document is about rather than its filename."
          />
        ) : (
          <EmptyState
            icon={<FileText className="size-6" />}
            title="No PDFs yet"
            description="Upload your first PDF and it will be summarised automatically."
          />
        )
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((document) => (
            <DocumentCard key={document.id} document={document} onRetried={refresh} onDeleted={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
