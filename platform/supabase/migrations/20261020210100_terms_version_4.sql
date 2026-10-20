-- Posts Terms version 4 (docs/specs/legal-copy.md, docs/specs/governance-copy.md): version 3's words
-- with "or the board cancels it" read as "or the studio cancels it", and no other change. Can run
-- twice.
--
-- Apply this only after the site deploy that carries version 4's words
-- (platform/site/src/lib/terms-versions.ts) is live: posting a version before
-- the site shows it would stamp contributions with words no page showed. Its
-- posted_at is the time it is applied, which is when version 4 takes effect.

insert into public.terms_versions (version) values (4) on conflict (version) do nothing;
