-- User reporting and blocking (App Store Guideline 1.2).
--
-- Guideline 1.2 requires an app with user-generated content to give users a way
-- to (a) report objectionable content/users and (b) block abusive users. In
-- SpotOn the user-generated surfaces are chat messages and spot listings.
--
-- Messages and conversations are read and written DIRECTLY from the app with
-- the supabase client (Chat.tsx / Messages.tsx / conversations.ts), so the
-- block has to be enforced here in the database, not in app code -- a modified
-- client must not be able to message someone who has blocked it.
--
-- What this migration adds:
--
--   public.user_blocks   who has blocked whom. A user manages only their own
--                        rows (RLS). Blocking is one-directional to create but
--                        enforced in BOTH directions: neither side can message
--                        the other while a block exists either way.
--
--   public.reports       user/listing reports. Users may only INSERT; nobody
--                        but the service role can read, change or delete them.
--                        The team reviews them in the Supabase dashboard
--                        (Table Editor -> reports), see docs/moderation.md.
--
--   public.is_blocked_between(a, b)
--                        SECURITY DEFINER helper: is there a block between two
--                        users in either direction? Needs to see rows the
--                        caller's RLS would hide (the OTHER user's blocks), so
--                        it runs as the owner -- same pattern as
--                        get_visible_listings (20260825160000). Not callable by
--                        clients: exposed to anon/authenticated it would let
--                        anyone probe whether any two users blocked each other.
--
--   public.get_block_status(other)
--                        SECURITY DEFINER, the client-facing counterpart. It is
--                        pinned to auth.uid(), so it only ever answers "is there
--                        a block between ME and <other>" -- which the chat
--                        screen needs to hide the composer when the other
--                        person blocked the caller. It reveals nothing the
--                        caller could not learn from a rejected send anyway.
--
--   messages_block_guard BEFORE INSERT trigger on public.messages. Rejects the
--                        insert with message 'messaging_blocked' when the sender
--                        and the other participant of the conversation have a
--                        block in either direction. It also fires for the
--                        backend's service-role inserts (routes/messages.py),
--                        which is intended: a block must hold on every path.
--
-- Deliberate departures from the spec, all for correctness:
--
--   * reports "at least one of reported_user_id / listing_id" is enforced in the
--     INSERT policy's WITH CHECK, not a table CHECK constraint. Both columns are
--     ON DELETE SET NULL; with a table CHECK, deleting the only reported
--     profile/listing would try to NULL the last target and the DELETE itself
--     would fail. The policy gives the same guarantee for everything the app
--     can write, and leaves historic reports intact when a target is removed.
--
--   * A user cannot report themselves (reported_user_id <> reporter_id), also in
--     the policy.
--
-- Account deletion (backend/services/account_deletion.py) soft-deletes the auth
-- user and keeps the profile row, so none of the FKs below fire on deletion. The
-- ON DELETE behaviour only matters if a profile is ever hard-deleted: blocks
-- and the user's own reports go with them (CASCADE), reports ABOUT them or
-- about a removed listing/conversation are kept with the reference nulled.
--
-- APPLY THIS TO THE LIVE PROJECT *BEFORE* THE APP BUILD THAT CALLS IT SHIPS.
-- The new client reads user_blocks on every Messages/Chat load.

BEGIN;

-- ---------------------------------------------------------------------------
-- user_blocks
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_no_self_block CHECK (blocker_id <> blocked_id)
);

-- The PK already serves "who did I block" (blocker_id first). This serves the
-- reverse lookup used by is_blocked_between and by deletion cascades.
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked_id
  ON public.user_blocks (blocked_id);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_blocks_select_own ON public.user_blocks;
CREATE POLICY user_blocks_select_own ON public.user_blocks
  FOR SELECT TO authenticated
  USING (blocker_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS user_blocks_insert_own ON public.user_blocks;
CREATE POLICY user_blocks_insert_own ON public.user_blocks
  FOR INSERT TO authenticated
  WITH CHECK (blocker_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS user_blocks_delete_own ON public.user_blocks;
CREATE POLICY user_blocks_delete_own ON public.user_blocks
  FOR DELETE TO authenticated
  USING (blocker_id = (SELECT auth.uid()));

-- Supabase's default privileges hand every new public table to anon and
-- authenticated. Narrow to exactly what the policies describe; no UPDATE (a
-- block row has nothing to edit) and nothing for anon.
REVOKE ALL ON TABLE public.user_blocks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.user_blocks TO authenticated;
GRANT ALL ON TABLE public.user_blocks TO service_role;

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  reported_user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  listing_id uuid REFERENCES public.listings (id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations (id) ON DELETE SET NULL,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT reports_status_check
    CHECK (status IN ('open', 'reviewing', 'actioned', 'dismissed')),
  -- Keep free text bounded: this is user input that lands in a dashboard.
  CONSTRAINT reports_reason_length CHECK (char_length(reason) BETWEEN 1 AND 100),
  CONSTRAINT reports_details_length CHECK (details IS NULL OR char_length(details) <= 2000)
);

-- Review queue: newest open reports first.
CREATE INDEX IF NOT EXISTS idx_reports_status_created_at
  ON public.reports (status, created_at DESC);
-- FK lookups / "everything reported about this user".
CREATE INDEX IF NOT EXISTS idx_reports_reported_user_id
  ON public.reports (reported_user_id) WHERE reported_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_listing_id
  ON public.reports (listing_id) WHERE listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id
  ON public.reports (reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_conversation_id
  ON public.reports (conversation_id) WHERE conversation_id IS NOT NULL;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- INSERT only. There is intentionally no SELECT/UPDATE/DELETE policy: with RLS
-- on and no policy, every non-service role matches nothing. A reporter cannot
-- read back (or retract) a report, and the reported party can never see one.
--
-- status / reviewed_at are forced to their defaults on insert so a client cannot
-- file a report that is already 'dismissed'.
DROP POLICY IF EXISTS reports_insert_own ON public.reports;
CREATE POLICY reports_insert_own ON public.reports
  FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = (SELECT auth.uid())
    AND (reported_user_id IS NOT NULL OR listing_id IS NOT NULL)
    AND reported_user_id IS DISTINCT FROM reporter_id
    AND status = 'open'
    AND reviewed_at IS NULL
  );

REVOKE ALL ON TABLE public.reports FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.reports TO authenticated;
GRANT ALL ON TABLE public.reports TO service_role;

-- ---------------------------------------------------------------------------
-- Block lookup helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_blocked_between(a uuid, b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_blocks ub
    WHERE (ub.blocker_id = a AND ub.blocked_id = b)
       OR (ub.blocker_id = b AND ub.blocked_id = a)
  );
$$;

-- Internal only: see the header for why clients must not be able to call this.
-- PUBLIC, not just anon/authenticated -- every new function is executable by
-- PUBLIC by default (see 20260906223000).
REVOKE EXECUTE ON FUNCTION public.is_blocked_between(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_blocked_between(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_block_status(p_other uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR p_other IS NULL THEN 'none'
    WHEN EXISTS (
      SELECT 1 FROM public.user_blocks ub
      WHERE ub.blocker_id = auth.uid() AND ub.blocked_id = p_other
    ) THEN 'blocked_by_me'
    WHEN EXISTS (
      SELECT 1 FROM public.user_blocks ub
      WHERE ub.blocker_id = p_other AND ub.blocked_id = auth.uid()
    ) THEN 'blocked_by_them'
    ELSE 'none'
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_block_status(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_block_status(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enforce blocks on message insert
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_message_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_renter uuid;
  v_owner uuid;
  v_other uuid;
BEGIN
  SELECT c.renter_id, c.owner_id
    INTO v_renter, v_owner
    FROM public.conversations c
   WHERE c.id = NEW.conversation_id;

  -- Unknown conversation: let the FK report it with its own error.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_other := CASE WHEN v_renter = NEW.sender_id THEN v_owner ELSE v_renter END;

  IF public.is_blocked_between(NEW.sender_id, v_other) THEN
    RAISE EXCEPTION 'messaging_blocked'
      USING ERRCODE = 'P0001',
            HINT = 'A block exists between the participants of this conversation.';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger function: firing does not check the caller's EXECUTE privilege, so
-- revoking it just removes the pointless RPC surface (same as 20260906223000).
REVOKE EXECUTE ON FUNCTION public.enforce_message_block()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS messages_block_guard ON public.messages;
CREATE TRIGGER messages_block_guard
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_message_block();

-- ---------------------------------------------------------------------------
-- Verify. Fail the whole migration loudly rather than ship a silent hole.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  bad_rls int;
  bad_exec boolean;
  unpinned int;
BEGIN
  SELECT count(*) INTO bad_rls
  FROM pg_class
  WHERE oid IN ('public.user_blocks'::regclass, 'public.reports'::regclass)
    AND NOT relrowsecurity;
  IF bad_rls > 0 THEN
    RAISE EXCEPTION 'RLS is not enabled on user_blocks/reports';
  END IF;

  -- Users must not be able to read, edit or delete reports.
  IF has_table_privilege('authenticated', 'public.reports', 'SELECT')
     OR has_table_privilege('authenticated', 'public.reports', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.reports', 'DELETE')
     OR has_table_privilege('anon', 'public.reports', 'INSERT') THEN
    RAISE EXCEPTION 'reports has more client privileges than INSERT for authenticated';
  END IF;

  SELECT
    has_function_privilege('anon', 'public.is_blocked_between(uuid, uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.is_blocked_between(uuid, uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.enforce_message_block()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.enforce_message_block()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.get_block_status(uuid)', 'EXECUTE')
  INTO bad_exec;
  IF bad_exec THEN
    RAISE EXCEPTION 'a moderation function is executable by a role that should not have it';
  END IF;

  SELECT count(*) INTO unpinned
  FROM pg_proc
  WHERE oid IN (
    'public.is_blocked_between(uuid, uuid)'::regprocedure,
    'public.get_block_status(uuid)'::regprocedure,
    'public.enforce_message_block()'::regprocedure
  ) AND (proconfig IS NULL OR NOT prosecdef);
  IF unpinned > 0 THEN
    RAISE EXCEPTION '% moderation function(s) are not SECURITY DEFINER with a pinned search_path', unpinned;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.messages'::regclass
      AND tgname = 'messages_block_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'messages_block_guard trigger was not created';
  END IF;
END $$;

COMMIT;
