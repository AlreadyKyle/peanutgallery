-- Correction entries for the money tables (docs/specs/money-safety.md).
-- Applies after 20260922000500_roles_revoke.sql and can run twice.
-- The money tables become append-only in 20260923000020_append_only.sql, so a
-- correction is a new contributions row:
--   reinstated  the Controller puts back what a dispute took once Stripe
--               closes the dispute as won;
--   adjustment  the board books a correction, such as a Stripe fee no payment
--               row carries, through a second-factor RPC with a reason.
-- Postgres refuses to use a new enum label in the transaction that adds it,
-- and the Management API runs each file as one transaction, so this file adds
-- the labels and nothing else. Every use of them is in a later file.

alter type public.contribution_entry add value if not exists 'reinstated';
alter type public.contribution_entry add value if not exists 'adjustment';
