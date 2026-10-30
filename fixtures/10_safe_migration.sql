-- Fixture 10: 100% Safe Zero-Downtime PostgreSQL Migration
-- Strictly adheres to PostgreSQL lock-free / non-blocking standards.

-- 1. Essential Safeguard: fail quickly instead of queueing behind long transactions
SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- 2. Add column as nullable without default (Instant catalog change, no table rewrite)
ALTER TABLE accounts ADD COLUMN updated_at TIMESTAMP;

-- 3. Set default only for future incoming inserts
ALTER TABLE accounts ALTER COLUMN updated_at SET DEFAULT now();

-- 4. Safe Foreign Key: Add with NOT VALID (instant catalog lock)
ALTER TABLE transactions 
  ADD CONSTRAINT fk_tx_account 
  FOREIGN KEY (account_id) 
  REFERENCES accounts(id) 
  NOT VALID;

-- 4b. Supporting index for Foreign Key (prevents table lock escalation on parent updates/deletes)
CREATE INDEX CONCURRENTLY idx_transactions_account_id ON transactions (account_id);

-- 5. Validate Foreign Key separately (takes only weak SHARE UPDATE EXCLUSIVE - writes proceed!)
ALTER TABLE transactions VALIDATE CONSTRAINT fk_tx_account;

-- 6. Concurrent Unique Index (Safe, no lock)
CREATE UNIQUE INDEX CONCURRENTLY idx_accounts_iban_unique ON accounts (iban);

-- 7. Attach Unique Constraint using existing concurrent index
ALTER TABLE accounts ADD CONSTRAINT uq_account_iban UNIQUE USING INDEX idx_accounts_iban_unique;

-- 8. Non-blocking index creation
CREATE INDEX CONCURRENTLY idx_transactions_created_at ON transactions (created_at);
