import Link from "next/link";

import { requestPasswordReset } from "@/app/(auth)/actions";
import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Reset your password - PDF Genie" };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          We&apos;ll email you a link to choose a new one.
        </p>
      </div>

      <AuthForm
        action={requestPasswordReset}
        fields={[
          {
            name: "email",
            label: "Email",
            type: "email",
            autoComplete: "email",
            placeholder: "you@example.com",
          },
        ]}
        submitLabel="Send reset link"
        footer={
          <Link href="/login" className="text-accent hover:underline">
            Back to sign in
          </Link>
        }
      />
    </div>
  );
}
