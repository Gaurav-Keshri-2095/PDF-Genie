import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { DashboardClient } from "@/components/dashboard-client";
import { SetupRequired } from "@/components/setup-required";
import { Alert } from "@/components/ui";
import { missingSupabaseConfig } from "@/lib/env";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import type { DocumentSummaryView } from "@/lib/types";

export const metadata = { title: "Your PDFs - PDF Genie" };

// Per-user data behind a session cookie: this must never be prerendered or cached.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const missing = missingSupabaseConfig();
  if (missing.length > 0) return <SetupRequired missing={missing} />;

  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id, filename, page_count, status, summary, has_text, error, created_at")
    .order("created_at", { ascending: false });

  console.log("--- SUPABASE FETCH RESULT ---");
  console.log("User:", user?.email, "(ID:", user?.id, ")");
  console.log("Data:", data);
  console.log("Error:", error);
  console.log("-----------------------------");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("has_completed_tour")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="rounded-xl border border-border bg-surface p-6 shadow-xl w-full max-w-sm text-center space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Account Deleted</h2>
          <p className="text-sm text-muted-foreground">
            This account no longer exists.
          </p>
          <form action={async () => {
            "use server";
            const s = await createSupabaseServerClient();
            await s.auth.signOut();
            redirect("/");
          }}>
            <button 
              type="submit" 
              className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              Refresh
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <>
      <AppHeader email={user.email} />
      {error ? (
        <div className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6">
          <Alert tone="danger">
            Could not load your documents: {error.message}. If this is a fresh project, check that
            the migrations in <code>supabase/migrations</code> have been applied.
          </Alert>
        </div>
      ) : null}
      <DashboardClient
        initialDocuments={(data ?? []) as DocumentSummaryView[]}
        userId={user.id}
        hasCompletedTour={profile?.has_completed_tour ?? false}
      />
    </>
  );
}
