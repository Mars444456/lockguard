-- Fixture 7: VACUUM or storage params in migration transaction
-- Triggers: LG-007 (UNSAFE_VACUUM_IN_TRANSACTION)
-- Risk: Transaction failure or worker lock conflicts

BEGIN;

SET lock_timeout = '3s';

ALTER TABLE event_logs SET (autovacuum_enabled = false);
VACUUM FULL event_logs;

COMMIT;
