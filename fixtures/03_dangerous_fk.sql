-- Fixture 3: Dangerous Foreign Key without NOT VALID
-- Triggers: LG-003 (FOREIGN_KEY_WITHOUT_NOT_VALID)
-- Risk: ACCESS EXCLUSIVE lock on source table during full validation scan

SET lock_timeout = '3s';

ALTER TABLE order_items 
  ADD CONSTRAINT fk_order_items_product 
  FOREIGN KEY (product_id) 
  REFERENCES products(id);
