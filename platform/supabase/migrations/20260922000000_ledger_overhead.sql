-- Ledger overhead (docs/specs/launch-db.md).
-- Applies after 20260921000200_ledger_request_id.sql and can run twice.
-- A ledger row billed to overhead records spend on the studio's own key that
-- belongs to no card: the unattended startup probe and its session-hour fee.
-- Postgres refuses to use a new enum label in the transaction that adds it,
-- and the Management API runs each file as one transaction, so this file adds
-- the label and nothing else. Every use of it is in a later file.

alter type public.ledger_billing add value if not exists 'overhead';
