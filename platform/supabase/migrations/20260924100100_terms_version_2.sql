-- Posts Terms version 2 (docs/specs/legal-copy.md).
-- Applies after 20260924100000_terms_versions.sql and can run twice.
--
-- Apply this only after the site deploy that carries version 2's words
-- (platform/site/src/lib/terms-versions.ts) is live: posting a version before
-- the site shows it would stamp contributions with words no page showed. Its
-- posted_at is the time it is applied, which is when version 2 takes effect.

insert into public.terms_versions (version) values (2) on conflict (version) do nothing;
