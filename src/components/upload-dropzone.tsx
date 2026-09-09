"use client";

import { Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Alert, Spinner } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cn, formatBytes } from "@/lib/utils";

const MAX_BYTES = 25 * 1024 * 1024;
const PDF_MAGIC = "%PDF-";

type Stage = "idle" | "preparing" | "uploading" | "processing";

/**
 * Three-step upload.
 *
 *  1. Ask our server for a signed upload URL (it creates the document row).
 *  2. PUT the file straight to Supabase Storage.
 *  3. Ask our server to ingest it.
 *
 * Step 2 bypasses our own backend entirely, which is not an optimisation but a
 * requirement: Vercel rejects request bodies over 4.5 MB, so a PDF can never
 * be posted through a route handler.
 */
export function UploadDropzone({
  onUploaded,
  existingFilenames = [],
}: {
  onUploaded: () => void;
  existingFilenames?: string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const busy = stage !== "idle";

  const upload = useCallback(
    async (file: File) => {
      setError(null);

      if (file.size > MAX_BYTES) {
        setError(`That file is ${formatBytes(file.size)}. The limit is 25 MB.`);
        return;
      }

      if (existingFilenames.includes(file.name)) {
        setError(`A file named "${file.name}" already exists.`);
        return;
      }

      // Check the actual file header, not just the extension - a renamed .txt
      // would otherwise upload and fail confusingly during processing.
      const header = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
      if (header !== PDF_MAGIC) {
        setError("That doesn't look like a PDF. Only real PDF files can be uploaded.");
        return;
      }

      try {
        setStage("preparing");
        const prepared = await fetch("/api/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            sizeBytes: file.size,
            contentType: file.type || "application/pdf",
          }),
        });

        const preparedBody = await prepared.json();
        if (!prepared.ok) throw new Error(preparedBody.error ?? "Could not start the upload.");

        setStage("uploading");
        const supabase = createClient();
        const { error: storageError } = await supabase.storage
          .from(preparedBody.bucket)
          .uploadToSignedUrl(preparedBody.storagePath, preparedBody.token, file, {
            contentType: "application/pdf",
          });

        if (storageError) throw new Error(storageError.message);

        // Show the card immediately in its 'processing' state; ingestion runs
        // in its own request and the dashboard polls for the result.
        onUploaded();

        setStage("processing");
        const ingested = await fetch(`/api/documents/${preparedBody.documentId}/ingest`, {
          method: "POST",
        });

        if (!ingested.ok) {
          const body = await ingested.json().catch(() => ({}));
          throw new Error(body.error ?? "Processing failed.");
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Upload failed.");
      } finally {
        setStage("idle");
        onUploaded();
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [onUploaded],
  );

  return (
    <div className="space-y-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file && !busy) void upload(file);
        }}
        className={cn(
          "rounded-xl border border-dashed px-6 py-8 text-center transition-colors",
          dragging ? "border-accent bg-accent-soft" : "border-border bg-surface",
        )}
      >
        <input
          ref={inputRef}
          id="pdf-upload"
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />

        {busy ? (
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            {stage === "preparing" && "Preparing upload..."}
            {stage === "uploading" && "Uploading..."}
            {stage === "processing" && "Reading and summarising..."}
          </p>
        ) : (
          <>
            <Upload className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-sm text-foreground">
              <label
                htmlFor="pdf-upload"
                className="cursor-pointer font-medium text-accent hover:underline"
              >
                Choose a PDF
              </label>{" "}
              or drag one here
            </p>
            <p className="mt-1 text-xs text-muted-foreground">PDF only, up to 25 MB</p>
          </>
        )}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
