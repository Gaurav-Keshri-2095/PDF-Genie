"use client";

import { RotateCw } from "lucide-react";
import { useState } from "react";

import { Button, Spinner } from "@/components/ui";

/**
 * Re-runs processing for a document.
 *
 * Needed because ingestion is the one operation that can exceed a serverless
 * function's time budget on a very large PDF. When that happens the row is
 * left in 'processing' with nothing driving it, so the user needs a way to
 * kick it again. Ingestion replaces the document's chunks rather than
 * appending, so retrying is safe to repeat.
 */
export function RetryIngest({
  documentId,
  onDone,
  label = "Retry",
}: {
  documentId: string;
  onDone?: () => void;
  label?: string;
}) {
  const [running, setRunning] = useState(false);

  async function retry(event: React.MouseEvent) {
    // The card is wrapped in a link; this button is not navigation.
    event.preventDefault();
    event.stopPropagation();

    setRunning(true);
    try {
      await fetch(`/api/documents/${documentId}/ingest`, { method: "POST" });
    } catch {
      // The resulting status (or a repeated failure) is shown on the card.
    } finally {
      setRunning(false);
      onDone?.();
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={retry} disabled={running}>
      {running ? <Spinner className="size-3" /> : <RotateCw className="size-3" />}
      {running ? "Processing..." : label}
    </Button>
  );
}
