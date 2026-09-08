-- The self-hosted production restore kept the profiles RLS policies but lost
-- the base-table grants that PostgreSQL checks before RLS.  Authenticated
-- users therefore received 403 while loading their own profile after login.
-- Keep cross-user reads behind get_public_profiles; the existing
-- profiles_select_own policy still limits this SELECT grant to auth.uid().
GRANT SELECT ON TABLE public.profiles TO authenticated;

-- These columns are already used by the current client.  Some restored
-- installations predate their original migrations, so make the repair
-- idempotent and bring the production schema up to the contract the client
-- expects.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS about text;

-- Existing column grants deliberately restrict which profile fields a user
-- may edit.  Extend that allowlist for the two self-service profile fields.
GRANT UPDATE (avatar_url, about) ON TABLE public.profiles TO authenticated;
