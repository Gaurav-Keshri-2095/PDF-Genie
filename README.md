# PDF Genie

A PDF intelligence and collaboration system: upload a PDF, get a grounded
3–5 sentence summary automatically, ask questions about the document in a
chat that cites its sources, share it by link with people who need no
account, and comment together on specific pages.

Built for the SpotDraft AI Intern take-home assignment.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, TypeScript) | One deployable for UI + API routes |
| Database / Auth / Storage | Supabase (Postgres + pgvector, Auth, Storage) | RLS gives per-row access control for free; pgvector + full-text live in the same database as everything else |
| Retrieval | Hybrid: Postgres full-text (sparse) + pgvector (dense), fused with Reciprocal Rank Fusion, then reranked with Cohere Rerank | Dense retrieval misses exact identifiers (clause numbers, names, figures); sparse misses paraphrase. Fusing both and reranking the result beats either alone. |
| Embeddings / Rerank | Cohere `embed-v4.0` (1024 dims) / `rerank-v4.0-fast` | Matryoshka embeddings let us use fewer dimensions with little quality loss; the fast rerank model is enough for reranking ~25 short chunks per question |
| Chat LLM | Amazon Nova 2 Lite via AWS Bedrock (`us.amazon.nova-2-lite-v1:0`) | 1M context window, current-generation model with no near-term EOL (Nova Premier, the larger sibling, is Legacy and closed to new AWS accounts as of this writing) |
| Deployment | Vercel | Native Next.js support, streaming Node functions |

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run the two files in `supabase/migrations/` **in order**:
   `0001_init.sql` (schema, RLS, hybrid search functions), then
   `0002_storage.sql` (the private `documents` storage bucket).
3. From **Project Settings → API**, copy the project URL, the publishable
   (`anon`) key, and the secret (`service_role`) key.

### 2. Cohere

Create an API key at [dashboard.cohere.com](https://dashboard.cohere.com/api-keys).
A trial key works but is capped at ~1,000 calls/month and 10 rerank
requests/minute — the app has fallbacks for both (see [Reliability](#reliability)
below), but a production key makes local development smoother.

### 3. AWS Bedrock

1. In the Bedrock console, request access to **Amazon Nova 2 Lite** and
   **Amazon Nova Micro** in `us-east-1` (or your preferred region — model
   access is granted per region and is not automatic).
2. Generate a **long-term Bedrock API key** (Bedrock console → API keys) —
   simplest option, works with `BEDROCK_API_KEY` below. A plain IAM access
   key/secret pair also works (`BEDROCK_AWS_ACCESS_KEY_ID` /
   `BEDROCK_AWS_SECRET_ACCESS_KEY`).

### 4. Environment

```bash
cp .env.example .env.local
```

Fill in the values from steps 1–3. See `.env.example` for the full list with
comments on each one.

### 5. Install and run

This project pins Node **24.x** (`.nvmrc`, `package.json#engines`) to match
Vercel's runtime — the repo was developed against Node 26 locally, which
Vercel does not offer, so pinning avoids "works on my machine" surprises at
deploy time. If you use `nvm`:

```bash
nvm install
nvm use
```

Then:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). If any required
environment variable is missing, the app shows a setup screen naming what's
missing instead of crashing.

### 6. Deploy

Push to a GitHub repo, import it in Vercel, and add the same environment
variables from `.env.local` to the Vercel project (Production + Preview).
No other configuration is needed — `next.config.ts` and the `engines` field
handle the rest.

## How the AI features work

### Summaries (on upload)

1. The PDF is downloaded from Storage and text is extracted **per page**
   with [`unpdf`](https://github.com/unjs/unpdf) (a prebundled, dependency-free
   build of pdf.js — no native/canvas requirement, so it runs cleanly in a
   Vercel serverless function).
2. If the document is under ~120K tokens, the full text goes to Nova 2 Lite
   in one call. Longer documents are **map-reduced**: consecutive sections
   (~30K tokens each) are summarized individually, then those summaries are
   reduced to one final 3–5 sentence summary. This means a 300-page PDF never
   needs to fit in one prompt.
3. The summary prompt (`src/lib/ai/prompts.ts`) explicitly bans the generic
   "This document discusses..." opener and requires the model to name the
   document type, the actual parties/subjects, and concrete terms/figures/dates
   — aimed at the assignment's note that summaries should be "concise,
   accurate, and useful, not a generic restatement."
4. **Scanned PDFs** (no text layer) are detected and marked `has_text: false`
   rather than being summarized from nothing — the dashboard shows this
   plainly instead of inventing a summary from an empty prompt.

### Chat (grounded, hybrid-retrieval RAG)

1. Text is chunked page-aware, ~1,700 characters with ~200 characters of
   overlap (`src/lib/pdf/chunk.ts`) — sized to fit under Cohere Rerank's
   ~510-token single-pass scoring window, so each chunk is reranked as one
   whole passage rather than being split and pooled internally.
2. Each chunk is embedded with Cohere `embed-v4.0` (`input_type:
   search_document`) and indexed in Postgres with both a `pgvector` HNSW
   index (dense) and a full-text `tsvector` GIN index (sparse).
3. On a question, a **query condensation** step (a cheap Nova Micro call)
   rewrites follow-ups like "what about the second one?" into a standalone
   search query using the last few turns of conversation — without this,
   follow-up questions embed as near-noise and retrieval degrades badly.
4. The condensed query is embedded and passed to a Postgres function,
   `hybrid_search_chunks`, which pulls the top ~25 candidates from each of the
   dense and sparse arms and fuses them by **Reciprocal Rank Fusion** (no
   score normalization needed — RRF fuses by rank, which is exactly why it
   suits pairing two differently-scaled retrievers).
5. The fused candidates are reranked with Cohere `rerank-v4.0-fast`, and the
   top ~6 (capped at ~4,000 tokens) go into the prompt, each labeled with its
   page range.
6. Nova 2 Lite answers via the **Converse Stream API**, so tokens appear as
   they're generated rather than after the full answer completes. The system
   prompt (`CHAT_SYSTEM_PROMPT`) requires page citations, forbids answering
   from outside the provided excerpts, and requires an explicit "not covered"
   response when the excerpts don't contain the answer.
7. The last 4 exchanges (8 messages) are replayed to the model on every turn,
   satisfying the "maintain 3–5 turns of context" requirement.

### Semantic dashboard search (good-to-have)

The dashboard search box does a fast filename match for short queries. For
longer, descriptive queries (≥12 characters) it also runs the same hybrid
retrieval — scoped across *all* of a user's documents instead of one — via a
second Postgres function, `hybrid_search_library`, and shows the matching
excerpt on the card. This is what lets "employment contract" surface a file
literally named `Agreement_v3.pdf`.

## Access model

The one design decision worth calling out: the assignment requires that
invited users can view and comment on a shared PDF **without an account**,
while also requiring that access is strictly controlled. Two lanes:

- **Owner lane** — the signed-in user's browser holds a Supabase session
  cookie. Every table has Row Level Security enabled, keyed on `auth.uid()`.
- **Share lane** — an anonymous link-holder never talks to Supabase directly.
  Every `/share/[token]` page and `/api/share/[token]/*` route resolves the
  token server-side (`src/lib/share.ts`) against a **SHA-256 hash** stored in
  the database (the raw token is shown to the owner exactly once and never
  stored), checks it isn't revoked/expired, and only then uses the Supabase
  **secret key** to read or write — scoped to exactly that one document.

RLS carries **no policies at all** for anonymous access. A leaked publishable
key therefore grants nothing beyond a signed-in user's own rows; a leaked
share link is scoped to exactly the one document it was issued for.

PDF bytes are never public — every read goes through a route that
authorizes the caller first, then issues a 5-minute signed Storage URL.

Uploads go **directly from the browser to Supabase Storage** via a
short-lived signed upload URL, not through our own API — Vercel caps
function request bodies at 4.5 MB, well under a real PDF.

## Reliability / degradation choices

- **Cohere rerank failure** (rate limit, outage) falls back to the RRF fusion
  order rather than failing the chat request.
- **Query condensation failure** falls back to searching the raw question.
- **Ingestion timeout on a very large PDF**: the document stays in
  `processing`, and there's a **Retry** button on the dashboard card and the
  document page that safely re-runs ingestion (it replaces chunks rather than
  appending, so retrying is idempotent).
- **Bedrock stream errors** (throttling, model errors) arrive *inside* the
  200 response after headers are already sent — they're forwarded to the
  client as an in-band error event rather than silently truncating the answer.
- **A cancelled chat request** (navigating away mid-stream) does not persist
  a truncated assistant message.

## Known trade-offs / scope notes

- **Threaded replies and rich-text formatting in comments** are not
  implemented. The schema already has `comments.parent_id` for threading, so
  it's additive, not a migration.
- **Share-notification emails** were left out — they need an email provider
  key (Resend, etc.) that wasn't part of the requested stack, and Supabase's
  built-in mail sender is rate-limited too tightly (2/hour) to rely on for a
  demo.
- **OCR for scanned PDFs** is out of scope; such documents are detected and
  clearly labeled rather than silently failing.

## Project structure

```
supabase/migrations/       Schema, RLS policies, hybrid search functions
src/lib/env.ts             Validated server-side config (throws with a clear
                            message naming exactly what's missing)
src/lib/ai/                Cohere client, Bedrock client, prompts, retrieval
src/lib/pdf/               Text extraction (unpdf) and page-aware chunking
src/lib/handlers/          Shared request logic used by both the owner and
                            share API lanes
src/lib/share.ts           The single choke point that validates share tokens
src/app/api/documents/     Owner-lane API routes (session-authorized)
src/app/api/share/         Share-lane API routes (token-authorized)
src/components/            UI - the PDF viewer, chat panel, and comment panel
                            are each written once and shared between the
                            owner and share pages via an `access` prop
```
