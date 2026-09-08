import { AlertTriangle, FileText, ScanLine } from "lucide-react";
import Link from "next/link";

import { RetryIngest } from "@/components/retry-ingest";
import { Badge, Card, Spinner } from "@/components/ui";
import type { DocumentSummaryView } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export function DocumentCard({
  document,
  onRetried,
}: {
  document: DocumentSummaryView;
  onRetried?: () => void;
}) {
  return (
    <Card className="group flex flex-col transition-colors hover:border-accent/50">
      <Link href={`/documents/${document.id}`} className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 size-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground" title={document.filename}>
              {document.filename}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatDate(document.created_at)}
              {document.page_count ? ` · ${document.page_count} pages` : ""}
            </p>
          </div>
        </div>

        <SummaryBody document={document} onRetried={onRetried} />

        {document.match_excerpt ? (
          <p className="border-l-2 border-accent/40 pl-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              Match{document.match_page ? ` on p. ${document.match_page}` : ""}:
            </span>{" "}
            {document.match_excerpt}
          </p>
        ) : null}
      </Link>
    </Card>
  );
}

function SummaryBody({
  document,
  onRetried,
}: {
  document: DocumentSummaryView;
  onRetried?: () => void;
}) {
  if (document.status === "processing") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-3" />
        Reading and summarising...
      </p>
    );
  }

  if (document.status === "failed") {
    return (
      <div className="space-y-2">
        <Badge tone="danger">
          <AlertTriangle className="size-3" />
          Processing failed
        </Badge>
        {document.error ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{document.error}</p>
        ) : null}
        <RetryIngest documentId={document.id} onDone={onRetried} />
      </div>
    );
  }

  // Expected outcome for a scan, not a failure - so it reads as information
  // rather than as an error, and no invented summary is shown.
  if (!document.has_text) {
    return (
      <div className="space-y-1">
        <Badge tone="warning">
          <ScanLine className="size-3" />
          No text layer
        </Badge>
        <p className="text-xs text-muted-foreground">
          This looks like a scanned PDF, so it can&apos;t be summarised or queried.
        </p>
      </div>
    );
  }

  return (
    <p className="line-clamp-4 text-sm text-muted-foreground">
      {document.summary ?? "No summary available."}
    </p>
  );
}
