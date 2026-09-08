import Link from "next/link";

import { signIn } from "@/app/(auth)/actions";
import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Sign in - PDF Genie" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/dashboard";
  const linkError = typeof params.error === "string" ? params.error : null;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">Pick up where you left off.</p>
      </div>

      {linkError ? (
        <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {linkError === "invalid-link"
            ? "That link has expired or was already used. Request a new one."
            : "Something went wrong with that link. Try signing in instead."}
        </p>
      ) : null}

      <AuthForm
        action={signIn}
        hidden={{ next }}
        fields={[
          {
            name: "email",
            label: "Email",
            type: "email",
            autoComplete: "email",
            placeholder: "you@example.com",
          },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "current-password",
          },
        ]}
        submitLabel="Sign in"
        footer={
          <div className="flex flex-col gap-1">
            <Link href="/forgot" className="text-accent hover:underline">
              Forgot your password?
            </Link>
            <span>
              No account yet?{" "}
              <Link href="/signup" className="text-accent hover:underline">
                Create one
              </Link>
            </span>
          </div>
        }
      />
    </div>
  );
}
