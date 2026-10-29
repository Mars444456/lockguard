-- Fixture 4: Dangerous column type alteration
-- Triggers: LG-004 (ALTER_COLUMN_TYPE_REWRITE)
-- Risk: ACCESS EXCLUSIVE lock + complete table rewrite

SET lock_timeout = '3s';

ALTER TABLE invoices ALTER COLUMN amount TYPE BIGINT;
ALTER TABLE user_profiles ALTER COLUMN bio TYPE VARCHAR(255);
