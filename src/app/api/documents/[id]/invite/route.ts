import { apiError, describeError, json, notFound } from "@/lib/api";
import { appOrigin } from "@/lib/env";
import { grantForOwner } from "@/lib/handlers/access";
import { createShareToken, hashShareToken } from "@/lib/share";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentUser } from "@/lib/supabase/server";
import { Resend } from "resend";

export const runtime = "nodejs";

const resend = new Resend(process.env.RESEND_API_KEY || "re_dummy");

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  const { email } = body;
  if (!email || typeof email !== "string") {
    return apiError("Email is required", 400);
  }

  const grant = await grantForOwner(id);
  if (!grant || !grant.userId) return notFound();
  
  const user = await getCurrentUser();
  const ownerEmail = user?.email || "Someone";

  try {
    const supabase = createServiceClient();
    
    // First, fetch the document to get its filename for the email
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("filename")
      .eq("id", id)
      .single();

    if (docError || !document) {
      return apiError("Document not found", 404);
    }

    const token = createShareToken();

    const { error } = await supabase.from("shares").insert({
      document_id: id,
      token_hash: hashShareToken(token),
      created_by: grant.userId,
      can_comment: true,
    });

    if (error) return apiError(error.message, 500);

    const shareUrl = `${appOrigin()}/share/${token}`;

    // Send the email using Resend
    const { error: resendError } = await resend.emails.send({
      from: "onboarding@resend.dev",
      reply_to: ownerEmail !== "Someone" ? ownerEmail : undefined,
      to: email, // This is the invitee's gmail
      subject: `${ownerEmail} invited you to view "${document.filename}"`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>You've been invited!</h2>
          <p><strong>${ownerEmail}</strong> has shared the document <strong>${document.filename}</strong> with you on PDF Genie.</p>
          <p>You can view and comment on it by clicking the link below:</p>
          <div style="margin: 30px 0;">
            <a href="${shareUrl}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              View Document
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">Or copy and paste this URL into your browser:</p>
          <p style="color: #666; font-size: 14px; word-break: break-all;">
            <a href="${shareUrl}">${shareUrl}</a>
          </p>
        </div>
      `,
    });

    if (resendError) {
      console.error("Resend API error:", resendError);
      return apiError("Failed to send email invite.", 500);
    }

    return json({ success: true, url: shareUrl }, 201);
  } catch (error) {
    return apiError(describeError(error), 500);
  }
}
