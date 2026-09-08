"use client";

import { Check, Copy, Link2 } from "lucide-react";
import { useState } from "react";

import { Alert, Button, Input, Spinner } from "@/components/ui";

/**
 * Creates a share link on demand.
 *
 * The raw token exists only in this response - the server stores just its hash
 * - so the link is shown until dismissed and can be copied, but cannot be
 * retrieved again later. Losing it means generating a new one.
 */
export function ShareButton({ documentId }: { documentId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createLink() {
    setCreating(true);
    setError(null);

    try {
      const response = await fetch(`/api/documents/${documentId}/share`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not create a share link.");
      setUrl(payload.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a share link.");
    } finally {
      setCreating(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError("Could not copy automatically - select the link and copy it manually.");
    }
  }

  if (url) {
    return (
      <div className="w-full space-y-2 sm:w-96">
        <div className="flex gap-2">
          <Input readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
          <Button variant="secondary" size="sm" onClick={() => void copy()} className="shrink-0">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Anyone with this link can read the PDF and comment - no account needed. Copy it now; it
          can&apos;t be shown again.
        </p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button variant="secondary" size="sm" onClick={() => void createLink()} disabled={creating}>
        {creating ? <Spinner className="size-3" /> : <Link2 className="size-3.5" />}
        Create share link
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
