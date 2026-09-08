"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { appOrigin } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Auth is handled by Supabase Auth, which stores passwords as bcrypt hashes.
 * No password ever reaches our own tables, and none is ever logged.
 */

export type AuthFormState = { error: string | null; message?: string | null };

const emailSchema = z.string().trim().min(1, "Email is required.").email("Enter a valid email.");
const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(72, "Passwords can be at most 72 characters.");

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  email: emailSchema,
  password: passwordSchema,
});

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Mirrored into public.profiles by the on_auth_user_created trigger.
      data: { name: parsed.data.name },
      emailRedirectTo: `${appOrigin()}/auth/callback`,
    },
  });

  if (error) return { error: error.message };

  // With email confirmation enabled, signUp returns a user but no session.
  if (!data.session) {
    return {
      error: null,
      message: "Check your email to confirm your account, then sign in.",
    };
  }

  redirect("/dashboard");
}

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
});

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  // Deliberately vague: distinguishing "no such account" from "wrong password"
  // would let anyone enumerate registered email addresses.
  if (error) return { error: "That email and password combination didn't work." };

  const next = formData.get("next");
  redirect(typeof next === "string" && next.startsWith("/") ? next : "/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a valid email." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${appOrigin()}/auth/callback?next=/reset`,
  });

  if (error) return { error: error.message };

  // Same response whether or not the account exists - again, no enumeration.
  return {
    error: null,
    message: "If that email has an account, a reset link is on its way.",
  };
}

const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    message: "Passwords do not match.",
    path: ["confirm"],
  });

export async function updatePassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your password." };
  }

  const supabase = await createSupabaseServerClient();

  // The recovery link established a session when it was exchanged at
  // /auth/callback; without it there is nothing to update.
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return { error: "This reset link has expired. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: error.message };

  redirect("/dashboard");
}
