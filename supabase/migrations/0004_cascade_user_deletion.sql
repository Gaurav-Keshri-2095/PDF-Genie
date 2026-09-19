-- Modify comments table to cascade delete on user deletion
ALTER TABLE public.comments
DROP CONSTRAINT IF EXISTS comments_author_present;

ALTER TABLE public.comments
DROP CONSTRAINT IF EXISTS comments_author_user_id_fkey;

ALTER TABLE public.comments
ADD CONSTRAINT comments_author_user_id_fkey
FOREIGN KEY (author_user_id)
REFERENCES auth.users(id)
ON DELETE CASCADE;

ALTER TABLE public.comments
ADD CONSTRAINT comments_author_present
CHECK (
  author_user_id IS NOT NULL
  OR author_share_id IS NOT NULL
);

-- Modify chat_messages table to cascade delete on user deletion
ALTER TABLE public.chat_messages
DROP CONSTRAINT IF EXISTS chat_messages_author_user_id_fkey;

ALTER TABLE public.chat_messages
ADD CONSTRAINT chat_messages_author_user_id_fkey
FOREIGN KEY (author_user_id)
REFERENCES auth.users(id)
ON DELETE CASCADE;
