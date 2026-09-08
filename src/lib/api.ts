import "server-only";

import { NextResponse } from "next/server";

export function json<T>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Anything unauthorised answers 404 rather than 403.
 *
 * A 403 on a document id confirms that the document exists, which is a small
 * information leak we get nothing for. "Not found" is the honest answer from
 * the caller's point of view: as far as their access goes, it isn't there.
 */
export function notFound() {
  return apiError("Not found", 404);
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
