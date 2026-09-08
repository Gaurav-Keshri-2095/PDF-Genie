import { FileText } from "lucide-react";
import Link from "next/link";

import { DocumentWorkspace } from "@/components/document-workspace";
import { SetupRequired } from "@/components/setup-required";
import { EmptyState } from "@/components/ui";
import { missingSupabaseConfig } from "@/lib/env";
import { grantForShare } from "@/lib/handlers/access";
import { listComments } from "@/lib/handlers/comments";
import { loadDocumentView } from "@/lib/handlers/document";

export const metadata = {
  title: "Shared PDF - PDF Genie",
  // A share link is a bearer credential; keep it out of search indexes.
  robots: { index: false, follow: false },
};

/**
 * The public lane. No session, no account - authorisation is the share token in
 * the URL, validated server-side on this render and again on every API call
 * the panels make.
 *
 * force-dynamic because a token can be revoked or expire at any time; a cached
 * render would keep serving a link that should no longer work.
 */
export const dynamic = "force-dynamic";

export default async function SharePage({ params }: PageProps<"/share/[token]">) {
  const { token } = await params;

  const missing = missingSupabaseConfig();
  if (missing.length > 0) return <SetupRequired missing={missing} />;

  const grant = await grantForShare(token);
  const [document, comments] = grant
    ? await Promise.all([loadDocumentView(grant), listComments(grant)])
    : [null, []];

  if (!grant || !document) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-6 py-16">
        <EmptyState
          icon={<FileText className="size-6" />}
          title="This link isn't valid"
          description="It may have expired, been revoked, or been copied incompletely. Ask the person who shared it for a new link."
          action={
            <Link href="/" className="text-sm font-medium text-accent hover:underline">
              Go to PDF Genie
            </Link>
          }
        />
      </main>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <span className="flex items-center gap-2 text-accent">
            <FileText className="size-5" />
            <span className="text-sm font-semibold tracking-tight">PDF Genie</span>
          </span>
          <span className="text-xs text-muted-foreground">Shared with you</span>
        </div>
      </header>

      <DocumentWorkspace
        access={{ kind: "share", token }}
        document={document}
        canComment={grant.canComment}
        initialComments={comments}
      />
    </div>
  );
}
