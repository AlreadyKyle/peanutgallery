-- Close the roles table to the public (docs/specs/launch-db.md).
-- Applies after 20260922000400_public_roles.sql and can run twice.
--
-- Apply this file to production only after the site that reads public_roles
-- instead of roles is deployed and verified: the site before that reads roles
-- as anon and would show no roles. The dispatcher and the seed read roles with
-- the service role, which this does not touch. Anon and authenticated read
-- the roles they need through public_roles. The row policy stays, so a
-- rollback is one grant.

set lock_timeout = '5s';

revoke all on table public.roles from anon, authenticated;

notify pgrst, 'reload schema';
