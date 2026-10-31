-- Draft for review, outside a transaction. Test before applying.
-- NOT VALID does not validate existing rows: plan VALIDATE CONSTRAINT separately.
SET lock_timeout = '3s';
CREATE INDEX CONCURRENTLY idx_orders_created_at ON orders (created_at);
ALTER TABLE orders ADD CONSTRAINT orders_account_fk
  FOREIGN KEY (account_id) REFERENCES accounts (id) NOT VALID;
