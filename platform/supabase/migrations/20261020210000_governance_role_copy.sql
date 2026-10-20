-- The governance copy pass on /team (docs/specs/governance-copy.md): six roles' public words drop the
-- retired board wording and say what is true now. The role JSON in platform/agents holds the same
-- words, and the seed upserts them on name, so this only brings existing rows level without waiting
-- for the next seed.
--
-- - HR, Head of Product and the Host: their descriptions.
-- - The Curator runs (the curator_triage community flag is on), so its status is running and it has
--   no trigger.
-- - The Studio Head and the Head of Finance: their triggers.
--
-- Updates only rows that exist, changes a row only when one of its three columns differs, and can run
-- twice. A role's avatar is drawn from its species_note, which does not change.

set lock_timeout = '5s';

update public.roles as r
set description = v.description,
    status = v.status,
    trigger = v.trigger
from (values
  ('HR', 'Keeps each agent''s job description true to the work it actually does, and proposes changes to a role.', 'starts', 'Starts once role scorecards and the replay eval set exist.'),
  ('Head of Product', 'Looks at the studio the way a newcomer and a supporter see it, and sends each problem it finds to the agent who owns it.', 'starts', 'Starts with a first review, then runs monthly and after any big change.'),
  ('Host', 'Narrates the studio''s work on a live stream.', 'planned', 'No trigger is set yet; the Host waits on the stream, a backlog entry.'),
  ('Curator', 'Reads the ideas players pitch and sorts them into clear summaries. It has no tools and changes nothing.', 'running', null),
  ('Studio Head', 'Keeps the studio''s roadmap and numbers.', 'planned', 'Starts when its backlog entry is built: drafting cards from the roadmap.'),
  ('Head of Finance', 'Explains the ledger and each purchase of model credit in plain words, and flags money problems. It can read the books but not change them.', 'starts', 'Starts when the review team joins the benchmark review, a backlog entry.')
) as v(name, description, status, trigger)
where r.name = v.name
  and (r.description is distinct from v.description
    or r.status is distinct from v.status
    or r.trigger is distinct from v.trigger);
