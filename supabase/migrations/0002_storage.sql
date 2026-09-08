-- ===========================================================================
-- PDF Genie - private storage bucket for uploaded PDFs
--
-- The browser uploads straight to Storage using a short-lived signed upload
-- URL minted server-side (Vercel caps request bodies at 4.5 MB, so proxying
-- the file through a route handler is not an option). Because the file never
-- passes through our server, the BUCKET is the enforcement point for type and
-- size - hence allowed_mime_types and file_size_limit here rather than only in
-- application code.
--
-- Deliberately no storage RLS policies: every read and write is a signed
-- capability issued by a server route that has already authorised the caller,
-- so neither the publishable key nor an anonymous visitor can reach the bucket
-- directly.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  26214400, -- 25 MiB
  array['application/pdf']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
