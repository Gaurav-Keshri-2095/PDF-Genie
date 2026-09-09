"use client";

import { Check, Copy, Link2, Mail, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSent, setInviteSent] = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setInviting(false);
        // We do NOT automatically clear `url` on click outside, to prevent accidental loss
        // of the one-time share link. They must explicitly click the X to dismiss it.
      }
    }

    if (inviting || url) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [inviting, url]);

  async function createLink() {
    setCreating(true);
    setError(null);
    setInviting(false); // Close invite if open

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

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail) return;
    
    setSendingInvite(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/invite`, { 
        method: "POST", 
        body: JSON.stringify({ email: inviteEmail }),
        headers: {
          "Content-Type": "application/json"
        }
      });
      const payload = await response.json();
      
      if (!response.ok) throw new Error(payload.error ?? "Could not send invite.");
      
      setInviteSent(true);
      setInviting(false);
      setInviteEmail("");
      setTimeout(() => setInviteSent(false), 3000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send invite.");
    } finally {
      setSendingInvite(false);
    }
  }

  return (
    <div className="space-y-2 relative" ref={containerRef}>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => void createLink()} disabled={creating}>
          {creating ? <Spinner className="size-3" /> : <Link2 className="size-3.5" />}
          Create share link
        </Button>
        <Button 
          variant={inviting ? "secondary" : "secondary"} 
          size="sm" 
          onClick={() => {
            setInviting((prev) => !prev);
            setUrl(null); // Close url if open
          }} 
          disabled={creating}
        >
          <Plus className="size-3.5" />
          Invite
        </Button>
      </div>

      {url && (
        <div className="absolute left-0 top-full z-10 mt-2 w-full sm:w-96">
          <div className="rounded-xl border border-border bg-surface p-3 shadow-lg space-y-2">
            <div className="flex justify-between items-center mb-1">
              <p className="text-sm font-medium text-foreground">Share link created</p>
              <button 
                onClick={() => setUrl(null)} 
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex gap-2">
              <Input readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
              <Button variant="secondary" onClick={() => void copy()} className="shrink-0">
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Anyone with this link can read the PDF and comment - no account needed. Copy it now; it
              can&apos;t be shown again.
            </p>
            {error && !inviting ? <Alert tone="danger">{error}</Alert> : null}
          </div>
        </div>
      )}
      
      {inviting && (
        <div className="absolute left-0 top-full z-10 mt-2 w-full sm:w-96">
          <div className="rounded-xl border border-border bg-surface p-3 shadow-lg">
            <form onSubmit={sendInvite} className="space-y-2">
              <div className="flex gap-2">
                <Input 
                  type="email" 
                  placeholder="friend@example.com" 
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  autoFocus
                />
                <Button type="submit" disabled={sendingInvite} className="shrink-0">
                  {sendingInvite ? <Spinner className="size-3.5" /> : <Mail className="size-3.5" />}
                  Send
                </Button>
              </div>
              {error && inviting ? <Alert tone="danger">{error}</Alert> : null}
            </form>
          </div>
        </div>
      )}

      {inviteSent ? <Alert tone="success">Invite sent successfully!</Alert> : null}
    </div>
  );
}
