-- Fixture 1: Dangerous ADD COLUMN with volatile DEFAULT
-- Triggers: LG-001 (ADD_COLUMN_WITH_DEFAULT)
-- Risk: ACCESS EXCLUSIVE lock + full table rewrite

SET lock_timeout = '3s';

ALTER TABLE orders ADD COLUMN created_at TIMESTAMP DEFAULT clock_timestamp() NOT NULL;
ALTER TABLE payments ADD COLUMN transaction_token UUID DEFAULT gen_random_uuid();
