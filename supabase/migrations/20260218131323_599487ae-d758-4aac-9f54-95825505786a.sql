
-- Allow the trigger (handle_new_user) to insert profiles on signup.
-- Since handle_new_user is SECURITY DEFINER it bypasses RLS,
-- but we also need users to be able to insert their own row if signing up via client.
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);
