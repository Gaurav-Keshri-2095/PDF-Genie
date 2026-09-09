"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, ScanLine } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  scale: number;
  onScaleChange: (scale: number | ((prev: number) => number)) => void;
};

export function PdfViewer({
  access,
  hasText,
  jumpTarget,
  onVisiblePageChange,
  scale,
  onScaleChange,
}: PdfViewerProps) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [width, setWidth] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollAnchor = useRef<{
    page: number;
    ratioX: number;
    ratioY: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  const prevScale = useRef(scale);
  if (prevScale.current !== scale) {
    // If the scale changed (e.g. via UI buttons) but we have no scroll anchor from
    // a wheel or touch event, we capture the center of the viewport right now, BEFORE
    // the DOM updates to the new scale, so we can zoom into the center smoothly.
    if (!scrollAnchor.current && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const centerY = containerRect.top + containerRect.height / 2;
      const centerX = containerRect.left + containerRect.width / 2;

      let anchorPageNode: HTMLDivElement | null = null;
      let minDistance = Infinity;

      for (const node of Array.from(pageRefs.current.values())) {
        const rect = node.getBoundingClientRect();
        if (centerY >= rect.top && centerY <= rect.bottom) {
          anchorPageNode = node;
          break;
        }
        const dist = Math.min(Math.abs(centerY - rect.top), Math.abs(centerY - rect.bottom));
        if (dist < minDistance) {
          minDistance = dist;
          anchorPageNode = node;
        }
      }

      if (anchorPageNode) {
        const rect = anchorPageNode.getBoundingClientRect();
        scrollAnchor.current = {
          page: Number(anchorPageNode.dataset.page),
          ratioX: (centerX - rect.left) / Math.max(1, rect.width),
          ratioY: (centerY - rect.top) / Math.max(1, rect.height),
          clientX: centerX,
          clientY: centerY,
        };
      }
    }
    prevScale.current = scale;
  }

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
      setWidth(Math.max(240, Math.floor(next)));
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

  // scrollAnchor is initialized above to ensure it can be updated during render

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        onScaleChange((prev) => {
          const newScale = Math.min(Math.max(1, prev - e.deltaY * 0.01), 5);
          if (newScale === prev) return prev;

          let anchorPageNode: HTMLDivElement | null = null;
          let minDistance = Infinity;

          for (const node of Array.from(pageRefs.current.values())) {
            const rect = node.getBoundingClientRect();
            if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
              anchorPageNode = node;
              break;
            }
            const dist = Math.min(Math.abs(e.clientY - rect.top), Math.abs(e.clientY - rect.bottom));
            if (dist < minDistance) {
              minDistance = dist;
              anchorPageNode = node;
            }
          }

          if (anchorPageNode) {
            const rect = anchorPageNode.getBoundingClientRect();
            scrollAnchor.current = {
              page: Number(anchorPageNode.dataset.page),
              ratioX: (e.clientX - rect.left) / Math.max(1, rect.width),
              ratioY: (e.clientY - rect.top) / Math.max(1, rect.height),
              clientX: e.clientX,
              clientY: e.clientY,
            };
          }

          return newScale;
        });
      }
    };

    let prevPinchDistance: number | null = null;
    let pinchCenter: { x: number; y: number } | null = null;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        prevPinchDistance = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        pinchCenter = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && prevPinchDistance !== null && pinchCenter !== null) {
        if (e.cancelable) e.preventDefault();
        
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const distance = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const ratio = distance / prevPinchDistance;
        prevPinchDistance = distance;

        pinchCenter = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };
        const currentCenter = pinchCenter;

        onScaleChange((prev) => {
          const newScale = Math.min(Math.max(1, prev * ratio), 5);
          if (newScale === prev) return prev;

          let anchorPageNode: HTMLDivElement | null = null;
          let minDistance = Infinity;

          for (const node of Array.from(pageRefs.current.values())) {
            const rect = node.getBoundingClientRect();
            if (currentCenter.y >= rect.top && currentCenter.y <= rect.bottom) {
              anchorPageNode = node;
              break;
            }
            const dist = Math.min(
              Math.abs(currentCenter.y - rect.top),
              Math.abs(currentCenter.y - rect.bottom)
            );
            if (dist < minDistance) {
              minDistance = dist;
              anchorPageNode = node;
            }
          }

          if (anchorPageNode) {
            const rect = anchorPageNode.getBoundingClientRect();
            scrollAnchor.current = {
              page: Number(anchorPageNode.dataset.page),
              ratioX: (currentCenter.x - rect.left) / Math.max(1, rect.width),
              ratioY: (currentCenter.y - rect.top) / Math.max(1, rect.height),
              clientX: currentCenter.x,
              clientY: currentCenter.y,
            };
          }
          return newScale;
        });
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        prevPinchDistance = null;
        pinchCenter = null;
      }
    };

    // must be non-passive to preventDefault
    element.addEventListener("wheel", handleWheel, { passive: false });
    element.addEventListener("touchstart", handleTouchStart, { passive: false });
    element.addEventListener("touchmove", handleTouchMove, { passive: false });
    element.addEventListener("touchend", handleTouchEnd);
    element.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      element.removeEventListener("wheel", handleWheel);
      element.removeEventListener("touchstart", handleTouchStart);
      element.removeEventListener("touchmove", handleTouchMove);
      element.removeEventListener("touchend", handleTouchEnd);
      element.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [onScaleChange]);

  useLayoutEffect(() => {
    if (scrollAnchor.current && containerRef.current) {
      const { page, ratioX, ratioY, clientX, clientY } = scrollAnchor.current;
      const node = pageRefs.current.get(page);
      if (node) {
        const rect = node.getBoundingClientRect();
        const currentX = rect.left + rect.width * ratioX;
        const currentY = rect.top + rect.height * ratioY;

        containerRef.current.scrollLeft += currentX - clientX;
        containerRef.current.scrollTop += currentY - clientY;
      }
      scrollAnchor.current = null;
    }
  }, [scale]);

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col">
      {!hasText && (
        <div className="shrink-0 border-b border-border bg-warning-soft px-4 py-2 text-xs text-warning">
          <span className="inline-flex items-center gap-1.5">
            <ScanLine className="size-3.5" />
            No text layer detected. You can read and comment on this PDF, but the AI features need
            extractable text.
          </span>
        </div>
      )}
      <PdfSurface
        containerRef={containerRef}
        file={file}
        width={width}
        scale={scale}
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

type SurfaceProps = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  file: { data: Uint8Array } | null;
  width: number;
  scale: number;
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
  scale,
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
    <div ref={containerRef} className="h-full min-h-0 min-w-0 flex-1 overflow-auto bg-surface-muted px-4 py-4">
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
          className="mx-auto flex w-fit flex-col gap-4"
        >
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
            <LazyPage
              key={page}
              page={page}
              width={width}
              scale={scale}
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
  scale,
  register,
  onVisible,
}: {
  page: number;
  width: number;
  scale: number;
  register: (page: number, element: HTMLDivElement | null) => void;
  onVisible: (page: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(page <= 2);
  const [aspectRatio, setAspectRatio] = useState(1 / 1.414);
  const [layers, setLayers] = useState<{ renderScale: number; isReady: boolean }[]>([]);

  useEffect(() => {
    if (!shouldRender || width === 0) return;
    
    // Add a new rendering layer when scale settles, to achieve a seamless double-buffered swap
    const timeout = setTimeout(() => {
      setLayers((prev) => {
        if (prev.length > 0 && prev[prev.length - 1].renderScale === scale) return prev;
        return [...prev, { renderScale: scale, isReady: false }];
      });
    }, 150);
    return () => clearTimeout(timeout);
  }, [scale, shouldRender, width]);

  useEffect(() => {
    // Inject the initial layer immediately
    if (shouldRender && width > 0 && layers.length === 0) {
      setLayers([{ renderScale: scale, isReady: false }]);
    }
  }, [shouldRender, width, scale, layers.length]);

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
    <div 
      ref={ref} 
      data-page={page} 
      className="relative origin-top-left overflow-hidden rounded-lg border border-border bg-surface shadow-sm" 
      style={{ 
        width: width > 0 ? `${width * scale}px` : undefined,
        aspectRatio
      }}
    >
      {layers.length === 0 ? (
        <PagePlaceholder page={page} />
      ) : (
        layers.map((layer, index) => {
          const isFirstLayer = index === 0 && !layer.isReady && layers.length === 1;

          return (
            <div
              key={layer.renderScale}
              className="absolute top-0 left-0 origin-top-left"
              style={{
                zoom: scale / layer.renderScale,
                zIndex: index,
                opacity: !layer.isReady && index > 0 ? 0 : 1,
              }}
            >
              <Page
                pageNumber={page}
                width={width * layer.renderScale}
                onRenderSuccess={() => {
                  const pageDiv = ref.current?.querySelector('.react-pdf__Page') as HTMLDivElement | null;
                  if (pageDiv && pageDiv.offsetHeight > 0) {
                    setAspectRatio(pageDiv.offsetWidth / pageDiv.offsetHeight);
                  }
                  
                  // Once this high-res canvas is ready, make it the base layer and throw away the old ones
                  setLayers((prev) => {
                    const updated = prev.map((l) =>
                      l.renderScale === layer.renderScale ? { ...l, isReady: true } : l
                    );
                    const thisIndex = updated.findIndex((l) => l.renderScale === layer.renderScale);
                    return updated.slice(thisIndex);
                  });
                }}
                renderAnnotationLayer
                renderTextLayer
                className="h-full w-full"
                loading={isFirstLayer ? <PagePlaceholder page={page} /> : <div />}
              />
            </div>
          );
        })
      )}
      <span className="pointer-events-none absolute right-2 bottom-2 z-10 rounded bg-foreground/70 px-1.5 py-0.5 text-[10px] font-medium text-background">
        {page}
      </span>
    </div>
  );
}

function PagePlaceholder({ page }: { page: number }) {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-lg border border-border bg-surface text-xs text-muted-foreground">
      Page {page}
    </div>
  );
}

