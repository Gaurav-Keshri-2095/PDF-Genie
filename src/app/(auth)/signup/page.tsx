import Link from "next/link";

import { signUp } from "@/app/(auth)/actions";
import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Create an account - PDF Genie" };

export default function SignupPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
        <p className="text-sm text-muted-foreground">
          Your PDFs stay private to you unless you share a link.
        </p>
      </div>

      <AuthForm
        action={signUp}
        fields={[
          { name: "name", label: "Name", autoComplete: "name", placeholder: "Ada Lovelace" },
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
            autoComplete: "new-password",
            placeholder: "At least 8 characters",
          },
        ]}
        submitLabel="Create account"
        footer={
          <span>
            Already have an account?{" "}
            <Link href="/login" className="text-accent hover:underline">
              Sign in
            </Link>
          </span>
        }
      />
    </div>
  );
}
