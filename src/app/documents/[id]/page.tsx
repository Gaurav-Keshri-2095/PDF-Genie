import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { DocumentWorkspace } from "@/components/document-workspace";
import { SetupRequired } from "@/components/setup-required";
import { ShareButton } from "@/components/share-button";
import { missingSupabaseConfig } from "@/lib/env";
import { grantForOwner } from "@/lib/handlers/access";
import { listComments } from "@/lib/handlers/comments";
import { loadDocumentView } from "@/lib/handlers/document";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

// Per-user data behind a session cookie: never prerender or cache.
export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: PageProps<"/documents/[id]">) {
  const { id } = await params;

  const missing = missingSupabaseConfig();
  if (missing.length > 0) return <SetupRequired missing={missing} />;

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/documents/${id}`);

  // Same authorisation the API routes use, so the page and its data can never
  // disagree about who may see this document.
  const grant = await grantForOwner(id);
  if (!grant) notFound();

  const [document, comments, profileResult] = await Promise.all([
    loadDocumentView(grant), 
    listComments(grant),
    createSupabaseServerClient().then(supabase => 
      supabase.from("profiles").select("has_completed_tour").eq("id", user.id).single()
    )
  ]);
  
  if (!document) notFound();
  
  const hasCompletedTour = profileResult.data?.has_completed_tour ?? false;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <AppHeader email={user.email}>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          All PDFs
        </Link>
      </AppHeader>

      <DocumentWorkspace
        access={{ kind: "owner", documentId: id }}
        document={document}
        canComment
        initialComments={comments}
        shareControl={<ShareButton documentId={id} />}
        userId={user.id}
        hasCompletedTour={hasCompletedTour}
      />
    </div>
  );
}
