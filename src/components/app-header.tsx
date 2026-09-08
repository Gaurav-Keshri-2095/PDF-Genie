import { FileText, LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/ui";

export function AppHeader({
  email,
  children,
}: {
  email?: string;
  children?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2 text-accent">
          <FileText className="size-5" />
          <span className="text-sm font-semibold tracking-tight">PDF Genie</span>
        </Link>

        <div className="min-w-0 flex-1">{children}</div>

        {email ? (
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">{email}</span>
            <form action={signOut}>
              <Button variant="ghost" size="sm" type="submit" aria-label="Sign out">
                <LogOut className="size-4" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </form>
          </div>
        ) : null}
      </div>
    </header>
  );
}
