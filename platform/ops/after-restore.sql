-- after-restore.sql: what the migrations make outside the schemas the backups dump (public and
-- money), for a restored copy. No dump carries these, so a restore that skipped this file would let
-- anyone sign up, stop the live pages' Realtime, and run none of the scheduled jobs. Run it after every dump
-- is loaded (platform/ops/README.md, Restore a Mac backup, step 4). Each statement is safe to run
-- twice. platform/ops/test/mac.test.mjs checks it against every migration.

-- Sign-in is limited to board accounts (20260914000000_week1_schema.sql).
create or replace trigger restrict_auth_users_to_board
  before insert on auth.users
  for each row execute function public.restrict_auth_users_to_board();

-- The tables Realtime sends to the live pages (20260914000000_week1_schema.sql).
alter publication supabase_realtime set table public.pool, public.cards, public.deploys;

-- The backup login's reads outside public (20260923000010_backup_role.sql), refused as there when
-- the project does not allow them.
do $$
begin
  grant usage on schema auth to peanutgallery_backup;
  grant select on all tables in schema auth to peanutgallery_backup;
exception
  when insufficient_privilege or invalid_schema_name then
    raise notice 'peanutgallery_backup: the auth schema grant was refused (%); the backups set BACKUP_SKIP_AUTH=1 and leave auth out', sqlerrm;
end
$$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'supabase_migrations') then
    grant usage on schema supabase_migrations to peanutgallery_backup;
    grant select on all tables in schema supabase_migrations to peanutgallery_backup;
  end if;
exception
  when insufficient_privilege then
    raise notice 'peanutgallery_backup: the supabase_migrations grant was refused (%)', sqlerrm;
end
$$;

-- The pg_cron jobs. cron.schedule with a job name replaces the job of that name.
-- 20260920000000_refunds_and_holds.sql: held credit is released hourly.
-- 20260924200000_money_logic.sql: leftovers are released and Not on a card yet drained.
-- 20260925100000_reports_supply.sql: the last ended New York week's report is published hourly.
-- 20260925300000_agent_upkeep.sql: the Janitor's daily check and hourly patch merge are queued.
-- 20261010200000_supply_refill.sql: a draft is queued every 20 minutes while the card supply is short.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('credit-held-contributions', '17 * * * *', 'select public.credit_held_contributions()');
select cron.schedule('waterfall-sweep', '*/5 * * * *', 'select public.waterfall_sweep()');
select cron.schedule('weekly-report', '7 * * * *', 'select public.publish_weekly_report()');
select cron.schedule('janitor', '0 8 * * *', $c$select public.enqueue_job_run('janitor', 'schedule')$c$);
select cron.schedule('upkeep_merge', '15 * * * *', $c$select public.enqueue_job_run('upkeep_merge', 'schedule')$c$);
select cron.schedule('supply-draft', '*/20 * * * *', $c$select public.enqueue_supply_draft()$c$);
