import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * The single authorisation choke point for anonymous share-link access.
 *
 * Every `/api/share/[token]/*` route resolves its token here before touching
 * any data, so there is exactly one place where "is this link still valid, and
 * which document does it grant?" is answered.
 */

export type ResolvedShare = {
  shareId: string;
  documentId: string;
  canComment: boolean;
};

export function createShareToken(): string {
  // 32 bytes of entropy, URL-safe. These links are bearer credentials, so the
  // token needs to be long enough that guessing is hopeless.
  return randomBytes(32).toString("base64url");
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Validates a raw share token. Returns null for anything unusable: unknown,
 * revoked, or expired.
 */
export async function resolveShare(token: string): Promise<ResolvedShare | null> {
  const trimmed = token?.trim();
  if (!trimmed) return null;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("shares")
    .select("id, document_id, can_comment, expires_at, revoked_at, token_hash")
    .eq("token_hash", hashShareToken(trimmed))
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null;

  // The lookup above is already an exact match on the hash; this comparison
  // exists so the code path does not depend on the database's string
  // comparison being constant-time.
  const expected = Buffer.from(data.token_hash, "utf8");
  const actual = Buffer.from(hashShareToken(trimmed), "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  return {
    shareId: data.id,
    documentId: data.document_id,
    canComment: data.can_comment,
  };
}
