-- Fixture 8: Migration missing SET lock_timeout
-- Triggers: LG-008 (MISSING_LOCK_TIMEOUT)
-- Risk: Head-of-line blocking queues freezing all reads/writes if lock is contested

ALTER TABLE users ADD COLUMN is_verified BOOLEAN;
