-- Fixture 2: Dangerous non-concurrent CREATE INDEX
-- Triggers: LG-002 (CREATE_INDEX_NON_CONCURRENTLY)
-- Risk: SHARE lock, freezes all concurrent INSERTs/UPDATEs/DELETEs

SET lock_timeout = '3s';

CREATE INDEX idx_users_email ON users (email);
CREATE UNIQUE INDEX idx_orders_reference ON orders (reference_number);
