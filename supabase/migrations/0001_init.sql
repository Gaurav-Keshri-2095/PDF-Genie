-- ===========================================================================
-- PDF Genie - initial schema
--
-- Run this once in the Supabase SQL editor (or via `supabase db push`).
--
-- Access model, in one paragraph:
--   Signed-in owners talk to Postgres directly through the publishable key, so
--   every table has RLS enabled and policies keyed on auth.uid(). Anonymous
--   share-link visitors get NO policies at all - they never touch Postgres
--   directly. Their requests go through server route handlers that validate a
--   hashed share token and then use the secret key. The consequence worth
--   stating: a leaked publishable key grants access to nothing.
-- ===========================================================================

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null default '',
  email      text not null default '',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: owner reads own"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "profiles: owner updates own"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Signup collects a display name; mirror it (and the email) into profiles so
-- the app never has to query auth.users from application code.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------
create type public.document_status as enum ('processing', 'ready', 'failed');

create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  filename      text not null,
  storage_path  text not null unique,
  size_bytes    bigint not null default 0,
  page_count    int,
  status        public.document_status not null default 'processing',
  summary       text,
  summary_model text,
  -- Set when a PDF has no extractable text layer (i.e. it is a scan). Kept
  -- separate from `error` because it is an expected outcome, not a failure.
  has_text      boolean not null default true,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists documents_owner_created_idx
  on public.documents (owner_id, created_at desc);

-- Trigram index backs the dashboard's literal filename search (ILIKE '%q%').
create index if not exists documents_filename_trgm_idx
  on public.documents using gin (filename extensions.gin_trgm_ops);

alter table public.documents enable row level security;

create policy "documents: owner selects"
  on public.documents for select to authenticated
  using (owner_id = auth.uid());

create policy "documents: owner inserts"
  on public.documents for insert to authenticated
  with check (owner_id = auth.uid());

create policy "documents: owner updates"
  on public.documents for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "documents: owner deletes"
  on public.documents for delete to authenticated
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- document_chunks - the retrieval index
--
-- 1024 dimensions: Cohere embed-v4.0 is Matryoshka-trained, so requesting
-- outputDimension 1024 instead of the 1536 default halves storage and index
-- size for a negligible quality cost, and stays well inside pgvector's
-- 2,000-dimension HNSW ceiling (so plain `vector` works; no halfvec needed).
-- ---------------------------------------------------------------------------
create table if not exists public.document_chunks (
  id          bigint generated always as identity primary key,
  document_id uuid not null references public.documents (id) on delete cascade,
  chunk_index int not null,
  page_start  int not null,
  page_end    int not null,
  content     text not null,
  token_count int not null default 0,
  embedding   extensions.vector(1024),
  fts         tsvector generated always as (to_tsvector('english', content)) stored,
  created_at  timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists document_chunks_document_idx
  on public.document_chunks (document_id);

create index if not exists document_chunks_fts_idx
  on public.document_chunks using gin (fts);

-- HNSW rather than IVFFlat: it can be built on an empty table, which matters
-- because a fresh deployment has no vectors to train on.
--
-- Cosine distance (<=>) rather than the inner product used by Supabase's
-- reference hybrid_search: Cohere does not document that embed-v4.0 returns
-- unit-normalised vectors, and <#> is only equivalent to cosine when they are.
create index if not exists document_chunks_embedding_idx
  on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);

alter table public.document_chunks enable row level security;

create policy "chunks: owner selects via document"
  on public.document_chunks for select to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_chunks.document_id and d.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- shares
--
-- Only a SHA-256 hash of the token is stored. A database leak therefore does
-- not hand over working share links.
-- ---------------------------------------------------------------------------
create table if not exists public.shares (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  token_hash  text not null unique,
  created_by  uuid not null references auth.users (id) on delete cascade,
  can_comment boolean not null default true,
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists shares_document_idx on public.shares (document_id);

alter table public.shares enable row level security;

create policy "shares: owner selects"
  on public.shares for select to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = shares.document_id and d.owner_id = auth.uid()
    )
  );

create policy "shares: owner inserts"
  on public.shares for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.documents d
      where d.id = shares.document_id and d.owner_id = auth.uid()
    )
  );

create policy "shares: owner updates"
  on public.shares for update to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = shares.document_id and d.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- comments
--
-- author_user_id  set when a signed-in owner comments
-- author_share_id set when an anonymous link visitor comments
-- exactly one of the two is always present.
-- parent_id is unused for now; it is here so threaded replies need no migration.
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.documents (id) on delete cascade,
  parent_id       uuid references public.comments (id) on delete cascade,
  page_number     int,
  body            text not null,
  author_user_id  uuid references auth.users (id) on delete set null,
  author_share_id uuid references public.shares (id) on delete set null,
  author_name     text not null,
  created_at      timestamptz not null default now(),
  constraint comments_author_present check (
    author_user_id is not null or author_share_id is not null
  )
);

create index if not exists comments_document_created_idx
  on public.comments (document_id, created_at);

alter table public.comments enable row level security;

create policy "comments: owner selects via document"
  on public.comments for select to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = comments.document_id and d.owner_id = auth.uid()
    )
  );

create policy "comments: owner inserts via document"
  on public.comments for insert to authenticated
  with check (
    author_user_id = auth.uid()
    and exists (
      select 1 from public.documents d
      where d.id = comments.document_id and d.owner_id = auth.uid()
    )
  );

create policy "comments: author deletes own"
  on public.comments for delete to authenticated
  using (author_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- chat_messages
--
-- session_id groups a conversation, so the owner and each share visitor get
-- independent histories over the same document.
-- ---------------------------------------------------------------------------
create table if not exists public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.documents (id) on delete cascade,
  session_id      uuid not null,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  citations       jsonb not null default '[]'::jsonb,
  author_user_id  uuid references auth.users (id) on delete set null,
  author_share_id uuid references public.shares (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists chat_messages_session_idx
  on public.chat_messages (document_id, session_id, created_at);

alter table public.chat_messages enable row level security;

create policy "chat: owner selects via document"
  on public.chat_messages for select to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = chat_messages.document_id and d.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists documents_touch_updated_at on public.documents;
create trigger documents_touch_updated_at
  before update on public.documents
  for each row execute function public.touch_updated_at();

-- ===========================================================================
-- Hybrid retrieval
--
-- Reciprocal Rank Fusion over two arms:
--   dense  - pgvector cosine distance
--   sparse - Postgres full-text search
--
-- RRF fuses by RANK, not score, which is exactly why it suits this pairing:
-- ts_rank_cd values and cosine distances are not on comparable scales, and
-- ranks need no normalisation.
--
-- Two details that matter more than they look:
--
--  1. `set local hnsw.iterative_scan` - with an HNSW index plus a WHERE
--     filter, the index walks the global graph and can return far fewer than
--     `match_count` rows for the filtered document. Iterative scan keeps
--     searching until it has enough. Without this, retrieval silently
--     degrades on any account holding more than a few documents.
--
--  2. The full-text arm is skipped when the query reduces to nothing after
--     stopword removal ("what about it" -> empty tsquery). Otherwise that arm
--     contributes zero rows while appearing to work.
-- ===========================================================================
create or replace function public.hybrid_search_chunks(
  filter_document_id uuid,
  query_text         text,
  query_embedding    extensions.vector(1024),
  match_count        int default 25,
  rrf_k              int default 50
)
returns table (
  id          bigint,
  document_id uuid,
  chunk_index int,
  page_start  int,
  page_end    int,
  content     text,
  score       double precision
)
language plpgsql
security definer
set search_path = 'public, extensions'
as $$
declare
  candidates int := greatest(match_count, 10) * 2;
  tsq        tsquery := websearch_to_tsquery('english', coalesce(query_text, ''));
begin
  -- Let the vector index keep scanning until the filtered result set is full.
  begin
    set local hnsw.iterative_scan = 'relaxed_order';
  exception when others then
    -- Older pgvector builds do not expose this knob. Retrieval still works,
    -- it just may under-return on heavily filtered scans.
    null;
  end;

  return query
  with dense as (
    select
      c.id,
      row_number() over (order by c.embedding OPERATOR(extensions.<=>) query_embedding) as rank_position
    from public.document_chunks c
    where c.document_id = filter_document_id
      and c.embedding is not null
    order by c.embedding OPERATOR(extensions.<=>) query_embedding
    limit candidates
  ),
  sparse as (
    select
      c.id,
      row_number() over (order by ts_rank_cd(c.fts, tsq) desc) as rank_position
    from public.document_chunks c
    where c.document_id = filter_document_id
      and tsq is not null
      and tsq::text <> ''
      and c.fts @@ tsq
    order by ts_rank_cd(c.fts, tsq) desc
    limit candidates
  ),
  fused as (
    select
      coalesce(d.id, s.id) as chunk_id,
      (coalesce(1.0 / (rrf_k + d.rank_position), 0.0)
        + coalesce(1.0 / (rrf_k + s.rank_position), 0.0))::double precision as score
    from dense d
    full outer join sparse s on s.id = d.id
  )
  select
    c.id,
    c.document_id,
    c.chunk_index,
    c.page_start,
    c.page_end,
    c.content,
    f.score
  from fused f
  join public.document_chunks c on c.id = f.chunk_id
  order by f.score desc, c.chunk_index asc
  limit match_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Semantic search across one user's whole library.
--
-- Same fusion, scoped by owner instead of by document, then collapsed to one
-- row per document keyed on its best-matching chunk. This is what lets
-- "employment contract" surface a file named Agreement_v3.pdf.
-- ---------------------------------------------------------------------------
create or replace function public.hybrid_search_library(
  filter_owner_id uuid,
  query_text      text,
  query_embedding extensions.vector(1024),
  match_count     int default 20,
  rrf_k           int default 50
)
returns table (
  document_id  uuid,
  best_chunk   text,
  best_page    int,
  score        double precision
)
language plpgsql
security definer
set search_path = 'public, extensions'
as $$
declare
  candidates int := greatest(match_count, 10) * 4;
  tsq        tsquery := websearch_to_tsquery('english', coalesce(query_text, ''));
begin
  begin
    set local hnsw.iterative_scan = 'relaxed_order';
  exception when others then
    null;
  end;

  return query
  with scoped as (
    select c.id, c.document_id, c.content, c.page_start, c.fts, c.embedding
    from public.document_chunks c
    join public.documents d on d.id = c.document_id
    where d.owner_id = filter_owner_id
  ),
  dense as (
    select s.id, row_number() over (order by s.embedding OPERATOR(extensions.<=>) query_embedding) as rank_position
    from scoped s
    where s.embedding is not null
    order by s.embedding OPERATOR(extensions.<=>) query_embedding
    limit candidates
  ),
  sparse as (
    select s.id, row_number() over (order by ts_rank_cd(s.fts, tsq) desc) as rank_position
    from scoped s
    where tsq is not null and tsq::text <> '' and s.fts @@ tsq
    order by ts_rank_cd(s.fts, tsq) desc
    limit candidates
  ),
  fused as (
    select
      coalesce(d.id, sp.id) as chunk_id,
      (coalesce(1.0 / (rrf_k + d.rank_position), 0.0)
        + coalesce(1.0 / (rrf_k + sp.rank_position), 0.0))::double precision as score
    from dense d
    full outer join sparse sp on sp.id = d.id
  ),
  ranked as (
    select
      s.document_id,
      s.content,
      s.page_start,
      f.score,
      row_number() over (partition by s.document_id order by f.score desc) as per_document_rank
    from fused f
    join scoped s on s.id = f.chunk_id
  )
  select r.document_id, r.content, r.page_start, r.score
  from ranked r
  where r.per_document_rank = 1
  order by r.score desc
  limit match_count;
end;
$$;

-- These functions are SECURITY DEFINER, so revoke the default grant and hand
-- execution only to the roles the app actually uses. hybrid_search_chunks is
-- additionally only ever called from server routes that have already
-- authorised the caller against the document.
revoke all on function public.hybrid_search_chunks(uuid, text, extensions.vector, int, int) from public;
revoke all on function public.hybrid_search_library(uuid, text, extensions.vector, int, int) from public;
grant execute on function public.hybrid_search_chunks(uuid, text, extensions.vector, int, int) to authenticated, service_role;
grant execute on function public.hybrid_search_library(uuid, text, extensions.vector, int, int) to authenticated, service_role;
