-- Review against an existing orders table, outside an explicit transaction.
SET lock_timeout = '3s';
CREATE INDEX idx_orders_created_at ON orders (created_at);
ALTER TABLE orders ADD CONSTRAINT orders_account_fk
  FOREIGN KEY (account_id) REFERENCES accounts (id) NOT VALID;
