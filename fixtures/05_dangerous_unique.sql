-- Fixture 5: Direct UNIQUE constraint without concurrent index
-- Triggers: LG-005 (ADD_UNIQUE_CONSTRAINT_DIRECT)
-- Risk: ACCESS EXCLUSIVE lock while building index

SET lock_timeout = '3s';

ALTER TABLE subscriptions ADD CONSTRAINT uq_subscriptions_user_plan UNIQUE (user_id, plan_id);
