import { apiError, describeError, json, notFound } from "@/lib/api";
import { grantForOwner } from "@/lib/handlers/access";
import { chatInputSchema, loadChatHistory, streamChatAnswer } from "@/lib/handlers/chat";

// The Bedrock SDK needs Node APIs, and Node functions on Vercel stream by
// default - so this must not run on the Edge runtime.
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const sessionId = new URL(request.url).searchParams.get("sessionId");

  const grant = await grantForOwner(id);
  if (!grant) return notFound();
  if (!sessionId) return apiError("sessionId is required.");

  try {
    return json({ messages: await loadChatHistory(grant, sessionId) });
  } catch (error) {
    return apiError(describeError(error), 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const grant = await grantForOwner(id);
  if (!grant) return notFound();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError("Expected a JSON body.");
  }

  const parsed = chatInputSchema.safeParse(payload);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid request.");
  }

  const stream = await streamChatAnswer(grant, parsed.data, request.signal);

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Tells any intermediate proxy not to buffer the response.
      "X-Accel-Buffering": "no",
    },
  });
}
