-- The Game Designer drafts on a cheaper model (docs/PLAN.md §10 decision 77, which changes decision 36
-- for that one role; docs/specs/unattended-roles.md). roles.model holds a model id, which /team shows; the
-- seed writes it from MODEL_DESIGNER, which now defaults to DEFAULT_DESIGNER_MODEL when .env leaves it
-- unset (platform/supabase/lib/roles.ts), as make-dispatcher-env.sh writes it for the dispatcher. This brings
-- the existing row level without waiting for the next seed. Every other role is unchanged. Updates only
-- a row that exists, and can run twice.

set lock_timeout = '5s';

update public.roles
set model = 'claude-sonnet-5-5'
where name = 'Game Designer'
  and model is distinct from 'claude-sonnet-5-5';
