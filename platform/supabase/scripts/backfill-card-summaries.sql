-- Backfills the public summary on the four live Next cards
-- (docs/specs/card-summary.md). Run after 20260916000000_card_summary.sql.
--
-- Each update matches one goal card on its exact title and only while its
-- summary is still null, so the file can run twice and never overwrites a
-- summary the board has written. The texts match lib/next-cards.ts. The final
-- select should show all four summaries.

update public.cards
set summary = 'Add one more unlock after the last one, so players always have a next goal on screen.'
where title = 'A fourteenth unlock: Quiet rooms at 300M dust'
  and shape = 'goal'
  and summary is null;

update public.cards
set summary = 'Rename the first unit from Gatherer to Sweeper, with a new one-line description.'
where title = 'Rename the Gatherer to Sweeper'
  and shape = 'goal'
  and summary is null;

update public.cards
set summary = 'Lower the Cart''s cost so new players can buy one soon after it appears.'
where title = 'Cheaper Cart: baseCost 120'
  and shape = 'goal'
  and summary is null;

update public.cards
set summary = 'Save progress in the browser, so a reload picks up where you left off.'
where title = 'Save the game and resume on reload'
  and shape = 'goal'
  and summary is null;

select title, summary
from public.cards
where shape = 'goal'
  and title in (
    'A fourteenth unlock: Quiet rooms at 300M dust',
    'Rename the Gatherer to Sweeper',
    'Cheaper Cart: baseCost 120',
    'Save the game and resume on reload'
  )
order by created_at;
