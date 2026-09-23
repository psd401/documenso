-- Drop the hand-installed PSD401 auto-join trigger. It created OrganisationMember rows holding only
-- the org group (never the Default team group); baseline membership is now ensured in application
-- code on every Google login and nightly sweep. IF EXISTS keeps this a no-op on databases that never had it.
DROP TRIGGER IF EXISTS trg_auto_add_psd401 ON "Account";

DROP FUNCTION IF EXISTS public.auto_add_to_psd401_org();
