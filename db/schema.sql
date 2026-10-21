-- Relational data: users, chats and chat membership.
-- Messages, read receipts and last-seen state live in Firestore.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE chat_type AS ENUM ('direct', 'group');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE member_role AS ENUM ('admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS chats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        chat_type NOT NULL,
  name        TEXT CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 100),
  created_by  UUID NOT NULL REFERENCES users(id),
  -- For direct chats: "<smallerUserId>:<largerUserId>". The unique constraint
  -- guarantees exactly one 1:1 chat per pair of users, even under concurrent requests.
  direct_key  TEXT UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT direct_key_matches_type CHECK (
    (type = 'direct' AND direct_key IS NOT NULL AND name IS NULL) OR
    (type = 'group'  AND direct_key IS NULL AND name IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id    UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       member_role NOT NULL DEFAULT 'member',
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

-- "List user chats" looks members up by user.
CREATE INDEX IF NOT EXISTS idx_chat_members_user_id ON chat_members(user_id);
