
-- Allow users to read their own google tokens
CREATE POLICY "Users can view own google tokens"
ON public.google_tokens
FOR SELECT
USING (user_id = auth.uid());

-- Drop the overly broad admin read-all profiles policy and replace with a scoped one
-- that only exposes id and full_name to admins (email already visible via user_roles join)
-- Actually, RLS can't restrict columns — so instead we keep the policy but it's already scoped.
-- The real fix: ensure non-admin users can't see other users' profiles (already done).
-- No change needed for profiles — policies are already correct.
