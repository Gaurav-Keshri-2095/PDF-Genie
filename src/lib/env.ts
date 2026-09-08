import "server-only";

import { z } from "zod";

/**
 * Server-side configuration.
 *
 * Validation is lazy and grouped by concern rather than done once at import
 * time, for two reasons:
 *
 *  - `next build` imports every route module. Eager validation would make a
 *    production build impossible without a full set of live credentials.
 *  - A missing Cohere key should break the chat endpoint with a precise
 *    message, not the login page with a vague one.
 */

const nonEmpty = z.string().trim().min(1);

function group<T extends z.ZodType>(name: string, schema: T) {
  let cached: z.infer<T> | undefined;

  return function read(): z.infer<T> {
    if (cached) return cached;

    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues
        .map((issue) => issue.path.join("."))
        .filter((key, index, all) => all.indexOf(key) === index)
        .join(", ");
      throw new Error(
        `${name} is not configured. Check these environment variables in .env.local: ${missing}. See .env.example.`,
      );
    }

    cached = parsed.data;
    return cached;
  };
}

export const supabaseEnv = group(
  "Supabase",
  z
    .object({
      NEXT_PUBLIC_SUPABASE_URL: nonEmpty,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: nonEmpty.optional(),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty.optional(),
      SUPABASE_SECRET_KEY: nonEmpty.optional(),
      SUPABASE_SERVICE_ROLE_KEY: nonEmpty.optional(),
      SUPABASE_STORAGE_BUCKET: nonEmpty.default("documents"),
    })
    .transform((env, ctx) => {
      const publishableKey =
        env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const secretKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;

      if (!publishableKey) {
        ctx.addIssue({
          code: "custom",
          path: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
          message: "required",
        });
      }
      if (!secretKey) {
        ctx.addIssue({ code: "custom", path: ["SUPABASE_SECRET_KEY"], message: "required" });
      }

      return {
        url: env.NEXT_PUBLIC_SUPABASE_URL,
        publishableKey: publishableKey!,
        secretKey: secretKey!,
        bucket: env.SUPABASE_STORAGE_BUCKET,
      };
    }),
);

export const cohereEnv = group(
  "Cohere",
  z
    .object({
      COHERE_API_KEY: nonEmpty,
      COHERE_EMBED_MODEL: nonEmpty.default("embed-v4.0"),
      COHERE_RERANK_MODEL: nonEmpty.default("rerank-v4.0-fast"),
    })
    .transform((env) => ({
      apiKey: env.COHERE_API_KEY,
      embedModel: env.COHERE_EMBED_MODEL,
      rerankModel: env.COHERE_RERANK_MODEL,
    })),
);

export const bedrockEnv = group(
  "Amazon Bedrock",
  z
    .object({
      BEDROCK_AWS_REGION: nonEmpty.default("us-east-1"),
      BEDROCK_API_KEY: nonEmpty.optional(),
      BEDROCK_AWS_ACCESS_KEY_ID: nonEmpty.optional(),
      BEDROCK_AWS_SECRET_ACCESS_KEY: nonEmpty.optional(),
      BEDROCK_CHAT_MODEL_ID: nonEmpty.default("us.amazon.nova-2-lite-v1:0"),
      BEDROCK_UTILITY_MODEL_ID: nonEmpty.default("us.amazon.nova-micro-v1:0"),
    })
    .transform((env, ctx) => {
      const hasKeyPair = Boolean(env.BEDROCK_AWS_ACCESS_KEY_ID && env.BEDROCK_AWS_SECRET_ACCESS_KEY);

      if (!env.BEDROCK_API_KEY && !hasKeyPair) {
        ctx.addIssue({
          code: "custom",
          path: ["BEDROCK_API_KEY"],
          message: "required (or BEDROCK_AWS_ACCESS_KEY_ID + BEDROCK_AWS_SECRET_ACCESS_KEY)",
        });
      }

      return {
        region: env.BEDROCK_AWS_REGION,
        apiKey: env.BEDROCK_API_KEY,
        accessKeyId: env.BEDROCK_AWS_ACCESS_KEY_ID,
        secretAccessKey: env.BEDROCK_AWS_SECRET_ACCESS_KEY,
        chatModelId: env.BEDROCK_CHAT_MODEL_ID,
        utilityModelId: env.BEDROCK_UTILITY_MODEL_ID,
      };
    }),
);

/** Absolute origin, used for share links and auth redirects. */
export function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  // Vercel sets this automatically for preview and production deployments.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}

/**
 * Non-throwing check used by pages so an unconfigured project renders a setup
 * screen rather than a 500. Returns the names of whatever is missing.
 */
export function missingSupabaseConfig(): string[] {
  const missing: string[] = [];

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() &&
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  ) {
    missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  if (!process.env.SUPABASE_SECRET_KEY?.trim() && !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    missing.push("SUPABASE_SECRET_KEY");
  }

  return missing;
}
