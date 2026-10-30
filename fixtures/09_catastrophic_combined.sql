-- Fixture 9: Combined Real-world Catastrophic Migration
-- Emulates a realistic developer PR touching multiple tables without lock safety precautions.

-- Missing SET lock_timeout!
BEGIN;

-- 1. Blocking Index
CREATE INDEX idx_transactions_created_at ON transactions (created_at);

-- 2. Heavy ADD COLUMN with volatile DEFAULT
ALTER TABLE accounts ADD COLUMN token UUID DEFAULT gen_random_uuid() NOT NULL;

-- 3. Unvalidated Foreign Key
ALTER TABLE transactions 
  ADD CONSTRAINT fk_tx_account 
  FOREIGN KEY (account_id) 
  REFERENCES accounts(id);

-- 4. Direct Table Rewrite
ALTER TABLE transactions ALTER COLUMN amount TYPE NUMERIC(18, 4);

-- 5. Direct Unique Constraint
ALTER TABLE accounts ADD CONSTRAINT uq_account_iban UNIQUE (iban);

-- 6. Immediate DROP COLUMN
ALTER TABLE accounts DROP COLUMN legacy_pin;

COMMIT;
