-- always-open (docs/specs/always-open.md): the agents keep cards open for
-- funding on their own. The card supply floor stays at 6 open cards; the Game
-- Designer may now start up to 12 draft_card runs a New York day instead of 4,
-- so a day in which the Game Director withdraws some drafts still refills the
-- floor. Each run is billed to the card it drafts (docs/PLAN.md §10 decision
-- 66), and the daily, monthly and per-card caps are unchanged. Applies after
-- 20261011000000_home_flow_supply.sql and can run twice.

set lock_timeout = '5s';

alter table public.studio_state alter column draft_runs_per_day set default 12;
update public.studio_state set draft_runs_per_day = 12 where id = 1 and draft_runs_per_day < 12;

notify pgrst, 'reload schema';
