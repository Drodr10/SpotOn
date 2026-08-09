-- Publish the tables the app actually subscribes to.
--
-- The supabase_realtime publication exists but has never had a single table
-- added to it. The only thing the schema does with it is
--
--   ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";
--
-- Postgres logical replication only emits changes for tables that are MEMBERS
-- of a publication, so Realtime received nothing and every postgres_changes
-- subscription in the app has been listening to a channel that is never
-- broadcast on. The subscriptions themselves are fine — they just never fire.
--
-- What that cost, in the UI:
--
--   Chat.tsx:146-160   subscribes to INSERT on messages for the open
--                      conversation. Because it never fires, a message sent by
--                      the OTHER participant never appears while you are
--                      sitting in the chat, and your own only appears if you
--                      leave and re-enter (which re-runs the one-shot fetch at
--                      Chat.tsx:140). Two people coordinating a handoff both
--                      watch a frozen thread and conclude they are being
--                      ignored.
--
--   SuggestionsList.tsx:76-86  subscribes to '*' on listings to refetch the
--                      homescreen. Silently dead the same way, so a new or
--                      edited listing never shows up without a manual reload.
--
-- Only these two are published, because only these two have subscribers.
-- conversations has none — adding it would replicate rows nothing listens for.
--
-- Realtime applies RLS per subscriber on top of this, and the policies needed
-- already exist: messages_conversation_participants_select restricts delivery
-- to the renter and owner of the parent conversation, so publishing the table
-- does not expose a message to anyone who could not already read it.
--
-- Replica identity is deliberately left at the default (primary key). Both
-- handlers ignore the payload's old-record — Chat appends payload.new, and
-- SuggestionsList just refetches — so REPLICA IDENTITY FULL would ship extra
-- data over the wire for no gain.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'listings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.listings;
  END IF;
END $$;

-- Fail loudly rather than silently leaving chat broken again.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO missing
  FROM unnest(ARRAY['messages', 'listings']) AS t
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'not published to supabase_realtime: %', missing;
  END IF;
END $$;
