import { randomUUID } from "node:crypto";

import { z } from "zod";

import { apiError, describeError, json } from "@/lib/api";
import { getCurrentUser } from "@/lib/supabase/server";
import { createServiceClient, storageBucket } from "@/lib/supabase/service";

export const runtime = "nodejs";

/**
 * Step 1 of upload: mint a signed upload URL and create the document row.
 *
 * The file itself is NOT posted here. Vercel caps function request bodies at
 * 4.5 MB, so the browser uploads straight to Supabase Storage using the signed
 * URL this route returns. That also keeps large files off our compute budget
 * entirely.
 *
 * Because the bytes bypass our server, type and size are enforced on the
 * bucket (allowed_mime_types / file_size_limit in 0002_storage.sql), and the
 * true structural check happens during ingestion, which reads the %PDF- header
 * before trusting the file.
 */

const MAX_BYTES = 25 * 1024 * 1024;

const requestSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_BYTES, "PDFs must be 25 MB or smaller."),
  contentType: z.string().trim().optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("Sign in to upload files.", 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError("Expected a JSON body.");
  }

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid request.");
  }

  const { filename, sizeBytes, contentType } = parsed.data;

  // A first, cheap gate. The client can lie about both of these, which is why
  // the bucket and the ingestion step check independently.
  if (!filename.toLowerCase().endsWith(".pdf")) {
    return apiError("Only PDF files can be uploaded.");
  }
  if (contentType && contentType !== "application/pdf") {
    return apiError("Only PDF files can be uploaded.");
  }

  try {
    const supabase = createServiceClient();
    const documentId = randomUUID();
    const storagePath = `${user.id}/${documentId}.pdf`;

    const { data: upload, error: uploadError } = await supabase.storage
      .from(storageBucket())
      .createSignedUploadUrl(storagePath);

    if (uploadError || !upload) {
      return apiError(uploadError?.message ?? "Could not prepare the upload.", 502);
    }

    const { error: insertError } = await supabase.from("documents").insert({
      id: documentId,
      owner_id: user.id,
      filename,
      storage_path: storagePath,
      size_bytes: sizeBytes,
      status: "processing",
    });

    if (insertError) return apiError(insertError.message, 502);

    return json({
      documentId,
      storagePath,
      token: upload.token,
      bucket: storageBucket(),
    });
  } catch (error) {
    return apiError(describeError(error), 500);
  }
}
