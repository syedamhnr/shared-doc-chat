-- Allow admins to read all profiles (for user management)
CREATE POLICY "Admins read all profiles"
ON public.profiles
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));