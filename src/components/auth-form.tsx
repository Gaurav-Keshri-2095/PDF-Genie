"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Button, Card, Input, Label, Spinner } from "@/components/ui";
import type { AuthFormState } from "@/app/(auth)/actions";

type Field = {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
};

function SubmitButton({ label }: { label: string }) {
  // useFormStatus reads the parent form's pending state, so the button
  // disables itself for the duration of the server action without the page
  // having to track it.
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? <Spinner /> : null}
      {pending ? "Working..." : label}
    </Button>
  );
}

export function AuthForm({
  action,
  fields,
  submitLabel,
  hidden,
  footer,
}: {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  fields: Field[];
  submitLabel: string;
  hidden?: Record<string, string>;
  footer?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, { error: null, message: null });

  return (
    <Card className="p-6">
      <form action={formAction} className="space-y-4">
        {hidden
          ? Object.entries(hidden).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))
          : null}

        {fields.map((field) => (
          <div key={field.name} className="space-y-1.5">
            <Label htmlFor={field.name}>{field.label}</Label>
            <Input
              id={field.name}
              name={field.name}
              type={field.type ?? "text"}
              autoComplete={field.autoComplete}
              placeholder={field.placeholder}
              required
            />
          </div>
        ))}

        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        {state.message ? <Alert tone="success">{state.message}</Alert> : null}

        <SubmitButton label={submitLabel} />
      </form>

      {footer ? <div className="mt-4 text-sm text-muted-foreground">{footer}</div> : null}
    </Card>
  );
}
