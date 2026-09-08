export type DocumentStatus = "processing" | "ready" | "failed";

export type DocumentRecord = {
  id: string;
  owner_id: string;
  filename: string;
  storage_path: string;
  size_bytes: number;
  page_count: number | null;
  status: DocumentStatus;
  summary: string | null;
  summary_model: string | null;
  has_text: boolean;
  error: string | null;
  created_at: string;
  updated_at: string;
};

/** What the dashboard and viewer need; excludes internal storage details. */
export type DocumentSummaryView = Pick<
  DocumentRecord,
  "id" | "filename" | "page_count" | "status" | "summary" | "has_text" | "error" | "created_at"
> & {
  /** Present only on semantic search results: why this document matched. */
  match_excerpt?: string | null;
  match_page?: number | null;
};

export type CommentRecord = {
  id: string;
  document_id: string;
  parent_id: string | null;
  page_number: number | null;
  body: string;
  author_user_id: string | null;
  author_share_id: string | null;
  author_name: string;
  created_at: string;
};

export type Citation = {
  page_start: number;
  page_end: number;
  excerpt: string;
};

export type ChatMessageRecord = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  created_at: string;
};

/**
 * Which lane a request arrived through. Every viewer component and API helper
 * takes this, so the owner view and the public share view share one
 * implementation instead of being duplicated.
 */
export type AccessContext =
  | { kind: "owner"; documentId: string }
  | { kind: "share"; token: string };

export function apiBase(access: AccessContext): string {
  return access.kind === "owner"
    ? `/api/documents/${access.documentId}`
    : `/api/share/${access.token}`;
}
