-- Fixture 6: Direct DROP COLUMN and DROP TABLE
-- Triggers: LG-006 (DROP_TABLE_OR_COLUMN_DIRECT)
-- Risk: ACCESS EXCLUSIVE lock + breaks running application replicas

SET lock_timeout = '3s';

ALTER TABLE customers DROP COLUMN legacy_address;
DROP TABLE legacy_audit_logs;
