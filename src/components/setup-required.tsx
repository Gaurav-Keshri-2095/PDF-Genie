import { Settings2 } from "lucide-react";

import { Card } from "@/components/ui";

/**
 * Shown instead of a stack trace when the app is running without credentials -
 * which is exactly the state of a fresh clone before .env.local is filled in.
 */
export function SetupRequired({ missing }: { missing: string[] }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 items-center px-6 py-16">
      <Card className="w-full space-y-4 p-6">
        <div className="flex items-center gap-2 text-accent">
          <Settings2 className="size-5" />
          <h1 className="text-base font-semibold tracking-tight">Finish the setup</h1>
        </div>

        <p className="text-sm text-muted-foreground">
          PDF Genie needs a Supabase project before it can store anything. Copy{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs">.env.example</code>{" "}
          to{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs">.env.local</code>{" "}
          and fill in these values, then restart the dev server.
        </p>

        <ul className="space-y-1">
          {missing.map((key) => (
            <li key={key} className="font-mono text-xs text-foreground">
              {key}
            </li>
          ))}
        </ul>

        <p className="text-sm text-muted-foreground">
          The SQL in{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs">
            supabase/migrations
          </code>{" "}
          also needs to be applied to the project. The README walks through both steps.
        </p>
      </Card>
    </main>
  );
}
