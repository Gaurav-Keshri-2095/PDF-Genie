"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, ScanLine } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

import { Alert, Button, Spinner } from "@/components/ui";
import { apiBase, type AccessContext } from "@/lib/types";

/**
 * pdf.js needs its worker set before any document loads, and it must be set in
 * the same module that renders <Document> - react-pdf's README is explicit
 * that doing it in a separate file loses the race with module execution order.
 *
 * The worker is served from /public (copied there by scripts/copy-pdf-worker.mjs)
 * rather than bundled, because pdf.js loads it through a dynamic import that
 * Turbopack does not resolve.
 */
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type PdfViewerProps = {
  access: AccessContext;
  hasText: boolean;
  /** Set to a page number to scroll there; re-set to the same page re-scrolls. */
  jumpTarget: { page: number; nonce: number } | null;
  onVisiblePageChange: (page: number) => void;
};

export function PdfViewer({ access, hasText, jumpTarget, onVisiblePageChange }: PdfViewerProps) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [width, setWidth] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  /**
   * The file is downloaded once, through a short-lived signed URL, and then
   * handed to pdf.js as bytes. Passing the URL directly would let pdf.js fetch
   * page ranges lazily - and fail partway through a long reading session when
   * the signature expires.
   */
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(`${apiBase(access)}/file`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not open this PDF.");

        const file = await fetch(body.url);
        if (!file.ok) throw new Error("The document could not be downloaded.");

        const buffer = await file.arrayBuffer();
        if (cancelled) return;

        setBytes(new Uint8Array(buffer));
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not open this PDF.");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [access]);

  // pdf.js may detach the buffer it is given, so hand it a fresh copy rather
  // than the master - otherwise a re-render (or StrictMode's double render)
  // fails on a detached ArrayBuffer.
  const file = useMemo(() => (bytes ? { data: new Uint8Array(bytes) } : null), [bytes]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      // Leave room for the page's own padding and shadow.
      setWidth(Math.max(240, Math.floor(next - 32)));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const registerPage = useCallback((page: number, element: HTMLDivElement | null) => {
    if (element) pageRefs.current.set(page, element);
    else pageRefs.current.delete(page);
  }, []);

  useEffect(() => {
    if (!jumpTarget) return;
    pageRefs.current.get(jumpTarget.page)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [jumpTarget]);

  if (!hasText) {
    // Still show the document - it is readable, just not queryable.
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border bg-warning-soft px-4 py-2 text-xs text-warning">
          <span className="inline-flex items-center gap-1.5">
            <ScanLine className="size-3.5" />
            No text layer detected. You can read and comment on this PDF, but the AI features need
            extractable text.
          </span>
        </div>
        <PdfSurface
          containerRef={containerRef}
          file={file}
          width={width}
          error={error}
          pageCount={pageCount}
          setPageCount={setPageCount}
          setError={setError}
          registerPage={registerPage}
          onVisiblePageChange={onVisiblePageChange}
        />
      </div>
    );
  }

  return (
    <PdfSurface
      containerRef={containerRef}
      file={file}
      width={width}
      error={error}
      pageCount={pageCount}
      setPageCount={setPageCount}
      setError={setError}
      registerPage={registerPage}
      onVisiblePageChange={onVisiblePageChange}
    />
  );
}

type SurfaceProps = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  file: { data: Uint8Array } | null;
  width: number;
  error: string | null;
  pageCount: number;
  setPageCount: (count: number) => void;
  setError: (message: string) => void;
  registerPage: (page: number, element: HTMLDivElement | null) => void;
  onVisiblePageChange: (page: number) => void;
};

function PdfSurface({
  containerRef,
  file,
  width,
  error,
  pageCount,
  setPageCount,
  setError,
  registerPage,
  onVisiblePageChange,
}: SurfaceProps) {
  if (error) {
    return (
      <div className="p-4">
        <Alert tone="danger">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="size-4" />
            {error}
          </span>
        </Alert>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-y-auto bg-surface-muted px-4 py-4">
      {!file ? (
        <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Spinner />
          Loading document...
        </p>
      ) : (
        <Document
          file={file}
          onLoadSuccess={({ numPages }) => setPageCount(numPages)}
          onLoadError={(cause) => setError(cause.message || "This PDF could not be rendered.")}
          loading={
            <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Spinner />
              Rendering...
            </p>
          }
          className="mx-auto flex w-full max-w-3xl flex-col gap-4"
        >
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
            <LazyPage
              key={page}
              page={page}
              width={width}
              register={registerPage}
              onVisible={onVisiblePageChange}
            />
          ))}
        </Document>
      )}
    </div>
  );
}

/**
 * Renders a page only once it is near the viewport.
 *
 * A 300-page PDF would otherwise rasterise every page on open, which locks up
 * the tab. The placeholder keeps roughly A4 proportions so the scrollbar does
 * not jump around as pages resolve.
 */
function LazyPage({
  page,
  width,
  register,
  onVisible,
}: {
  page: number;
  width: number;
  register: (page: number, element: HTMLDivElement | null) => void;
  onVisible: (page: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(page <= 2);

  useEffect(() => {
    const element = ref.current;
    register(page, element);
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setShouldRender(true);
          // Fires while scrolling, so the comment box knows which page the
          // reader is looking at.
          if (entry.intersectionRatio > 0.5) onVisible(page);
        }
      },
      { rootMargin: "800px 0px", threshold: [0, 0.51] },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
      register(page, null);
    };
  }, [page, register, onVisible]);

  return (
    <div ref={ref} data-page={page} className="relative">
      {shouldRender && width > 0 ? (
        <Page
          pageNumber={page}
          width={width}
          renderAnnotationLayer
          renderTextLayer
          className="overflow-hidden rounded-lg border border-border shadow-sm"
          loading={<PagePlaceholder page={page} />}
        />
      ) : (
        <PagePlaceholder page={page} />
      )}
      <span className="pointer-events-none absolute right-2 bottom-2 rounded bg-foreground/70 px-1.5 py-0.5 text-[10px] font-medium text-background">
        {page}
      </span>
    </div>
  );
}

function PagePlaceholder({ page }: { page: number }) {
  return (
    <div
      className="flex w-full items-center justify-center rounded-lg border border-border bg-surface text-xs text-muted-foreground"
      style={{ aspectRatio: "1 / 1.414" }}
    >
      Page {page}
    </div>
  );
}

