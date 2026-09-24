-- Posts Terms version 3 (docs/specs/legal-copy.md, docs/specs/rename.md): version 2's words with the
-- studio's new name, Mob Machine (PLAN.md §10 decision 43). Can run twice.
--
-- Apply this only after the site deploy that carries version 3's words
-- (platform/site/src/lib/terms-versions.ts) is live: posting a version before
-- the site shows it would stamp contributions with words no page showed. Its
-- posted_at is the time it is applied, which is when version 3 takes effect.

insert into public.terms_versions (version) values (3) on conflict (version) do nothing;
