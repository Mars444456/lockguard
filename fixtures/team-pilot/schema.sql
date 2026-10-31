-- Synthetic structure snapshot. No customer data or database connection.
CREATE TABLE accounts (id bigint PRIMARY KEY);
CREATE TABLE orders (
  id bigint PRIMARY KEY,
  account_id bigint,
  created_at timestamptz
);
CREATE INDEX idx_orders_account_id ON orders (account_id);
