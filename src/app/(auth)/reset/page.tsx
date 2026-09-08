import { updatePassword } from "@/app/(auth)/actions";
import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Choose a new password - PDF Genie" };

/**
 * Reached from the recovery email, after /auth/callback has exchanged the code
 * for a session. That session is what authorises the password change.
 */
export default function ResetPasswordPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">
          You&apos;ll be signed in once it&apos;s saved.
        </p>
      </div>

      <AuthForm
        action={updatePassword}
        fields={[
          {
            name: "password",
            label: "New password",
            type: "password",
            autoComplete: "new-password",
            placeholder: "At least 8 characters",
          },
          {
            name: "confirm",
            label: "Confirm new password",
            type: "password",
            autoComplete: "new-password",
          },
        ]}
        submitLabel="Save password"
      />
    </div>
  );
}
