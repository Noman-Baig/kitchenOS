-- Each device that joins a table session gets its own opaque token (hash stored), so a second
-- guest can join with the table PIN without taking over the first guest's device.
CREATE TABLE customer_session_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  device_label VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  KEY idx_cst_session (session_id)
) ENGINE=InnoDB;

ALTER TABLE customer_sessions ADD COLUMN order_type ENUM('dine_in','takeaway','delivery','pickup') NOT NULL DEFAULT 'dine_in' AFTER kind;
