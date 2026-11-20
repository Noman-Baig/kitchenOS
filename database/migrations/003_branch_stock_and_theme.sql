-- Branch-scoped stock items (NULL = shared/central store) enabling stock transfers between branches.
ALTER TABLE ingredients ADD COLUMN branch_id BIGINT UNSIGNED NULL AFTER restaurant_id;
ALTER TABLE ingredients DROP INDEX uq_ing;
ALTER TABLE ingredients ADD UNIQUE KEY uq_ing (restaurant_id, branch_id, name);

-- Reports performance
ALTER TABLE orders ADD KEY idx_order_created (restaurant_id, created_at);
ALTER TABLE payments ADD KEY idx_pay_shift (shift_id);
