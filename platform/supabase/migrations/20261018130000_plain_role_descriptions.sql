-- Plain role descriptions on /team (the copy audit of 18 October 2026, item 13): nine roles' one-line
-- descriptions drop studio jargon ("check lines", "typed proposals", "kernel pull requests"). The
-- role JSON in platform/agents holds the same words, and the seed upserts them on name, so this only
-- brings existing rows level without waiting for the next seed. A role's avatar is drawn from its
-- species_note, which does not change. Updates only rows that exist, and can run twice.

set lock_timeout = '5s';

update public.roles as r
set description = v.description
from (values
  ('Curator', 'Reads the ideas players pitch and sorts them into clear summaries. It has no tools and changes nothing.'),
  ('Game Designer', 'Drafts a new game card, with its numbers and a cost estimate, whenever too few cards are open, for the Game Director to grade.'),
  ('Game Director', 'Keeps the game true to its core ideas and safe for all ages, and grades each drafted game card before it can be funded.'),
  ('Head of Finance', 'Explains the ledger and each purchase of model credit in plain words, and flags money problems. It can read the books but not change them.'),
  ('Head of Product', 'Looks at the studio the way a newcomer, a supporter and the board see it, and sends each problem it finds to the agent who owns it.'),
  ('HR', 'Keeps each agent''s job description true to the work it actually does, and proposes changes to a role for the board to approve.'),
  ('Janitor', 'Plain code that checks every day that the database, the models and the tools still match what the studio''s code expects, and raises an alert when they don''t.'),
  ('Platform Director', 'Checks how each change to the site looks before it goes live, against the studio''s design standards.'),
  ('Tech Artist', 'Draws the game''s look in code and designs cards for its visuals and motion, for the Game Director to approve.')
) as v(name, description)
where r.name = v.name
  and r.description is distinct from v.description;
