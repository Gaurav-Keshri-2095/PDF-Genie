import "server-only";

import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";

import { bedrockEnv } from "@/lib/env";

/**
 * Amazon Nova via Bedrock, through the Converse API.
 *
 * Model choice: `us.amazon.nova-2-lite-v1:0`. The `us.` prefix selects a
 * cross-region inference profile - Nova 2 Lite has no in-region on-demand
 * throughput in any region, so the bare model id fails with a validation
 * error. (Nova Premier, the obvious "best" pick, entered Legacy status and is
 * closed to new accounts, so it is not an option.)
 */

let client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (client) return client;

  const env = bedrockEnv();

  // A Bedrock API key is read by the SDK from AWS_BEARER_TOKEN_BEDROCK. We
  // accept it under our own BEDROCK_API_KEY name and forward it, because on
  // Vercel the bare AWS_* names collide with Lambda's reserved variables.
  if (env.apiKey && !process.env.AWS_BEARER_TOKEN_BEDROCK) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = env.apiKey;
  }

  client = new BedrockRuntimeClient({
    region: env.region,
    ...(env.accessKeyId && env.secretAccessKey
      ? {
          credentials: {
            accessKeyId: env.accessKeyId,
            secretAccessKey: env.secretAccessKey,
          },
        }
      : {}),
  });

  return client;
}

export type ConverseTurn = {
  role: "user" | "assistant";
  content: string;
};

function toMessages(turns: ConverseTurn[]): Message[] {
  return turns.map((turn) => ({
    role: turn.role,
    content: [{ text: turn.content }],
  }));
}

type ConverseOptions = {
  system: string;
  turns: ConverseTurn[];
  maxTokens?: number;
  temperature?: number;
  /** Defaults to the chat model; pass the utility model for cheap side tasks. */
  modelId?: string;
};

/** Single-shot completion, used for summaries and query condensation. */
export async function converse({
  system,
  turns,
  maxTokens = 1_024,
  temperature = 0.2,
  modelId,
}: ConverseOptions): Promise<string> {
  const env = bedrockEnv();

  const response = await getClient().send(
    new ConverseCommand({
      modelId: modelId ?? env.chatModelId,
      system: [{ text: system }],
      messages: toMessages(turns),
      inferenceConfig: { maxTokens, temperature },
    }),
  );

  const text = response.output?.message?.content
    ?.map((block) => block.text ?? "")
    .join("")
    .trim();

  if (!text) throw new Error("Bedrock returned an empty response.");
  return text;
}

/**
 * Streaming completion for the chat panel.
 *
 * The subtlety worth knowing: Bedrock reports throttling and model errors as
 * members *inside* the 200 stream, after response headers have already been
 * flushed. They can't be turned into an HTTP error status, so they are thrown
 * here and the caller forwards them as an in-band error event - otherwise the
 * UI just stops mid-sentence with no explanation.
 */
export async function* converseStream({
  system,
  turns,
  maxTokens = 1_024,
  temperature = 0.2,
  modelId,
}: ConverseOptions): AsyncGenerator<string> {
  const env = bedrockEnv();

  const response = await getClient().send(
    new ConverseStreamCommand({
      modelId: modelId ?? env.chatModelId,
      system: [{ text: system }],
      messages: toMessages(turns),
      inferenceConfig: { maxTokens, temperature },
    }),
  );

  if (!response.stream) throw new Error("Bedrock returned no stream.");

  for await (const event of response.stream) {
    if (event.contentBlockDelta?.delta?.text) {
      yield event.contentBlockDelta.delta.text;
      continue;
    }

    const failure =
      event.throttlingException ??
      event.modelStreamErrorException ??
      event.validationException ??
      event.serviceUnavailableException ??
      event.internalServerException;

    if (failure) {
      throw new Error(failure.message ?? "Bedrock stream error.");
    }
  }
}

/** Turns SDK errors into something a user can act on. */
export function describeBedrockError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/AccessDenied|not authorized|don't have access/i.test(message)) {
    return "Bedrock denied the request. Request access to this Nova model in the Bedrock console for the configured region.";
  }
  if (/on-demand throughput isn't supported|ValidationException/i.test(message)) {
    return "Bedrock rejected the model id. Use the cross-region profile form, e.g. us.amazon.nova-2-lite-v1:0.";
  }
  if (/ThrottlingException|Too many requests/i.test(message)) {
    return "Bedrock is throttling requests. Wait a moment and try again.";
  }
  if (/could not be found|UnrecognizedClient|security token/i.test(message)) {
    return "Bedrock credentials are invalid. Check BEDROCK_API_KEY (or the BEDROCK_AWS_* key pair) and the region.";
  }

  return message;
}

/**
 * Uses Amazon Nova's multimodal capabilities to perform OCR on a PDF chunk.
 * Returns an array of strings, one per page.
 */
export async function transcribePdfChunk(bytes: Uint8Array): Promise<string> {
  const env = bedrockEnv();

  const response = await getClient().send(
    new ConverseCommand({
      modelId: env.chatModelId, // Nova models support document understanding natively
      system: [
        {
          text: "You are a strict OCR transcription engine. Your task is to transcribe the text from the provided document EXACTLY as it appears, page by page. Do NOT hallucinate, summarize, or add any conversational text. ONLY output the extracted text. If there is no text, output nothing. Separate the text of each page with exactly this delimiter: ---PAGE_BREAK---",
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              document: {
                format: "pdf",
                name: "scanned_pdf",
                source: { bytes },
              },
            },
            {
              text: "Transcribe the text in this document.",
            },
          ],
        },
      ],
      inferenceConfig: {
        maxTokens: 4096, // Large token limit for multiple pages
        temperature: 0.0, // Strict, deterministic output
      },
    }),
  );

  const text = response.output?.message?.content
    ?.map((block) => block.text ?? "")
    .join("")
    .trim();

  if (!text) return "";
  return text;
}
