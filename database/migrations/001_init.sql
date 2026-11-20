-- umemaai_undated_version — initial schema
-- All timestamps are stored in UTC. All money columns are DECIMAL(19,4); never FLOAT/DOUBLE.
-- Every tenant-owned table carries restaurant_id and every query in the backend is scoped by it.

CREATE TABLE platform_settings (
  setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
  setting_value JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE subscription_plans (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  price DECIMAL(19,4) NOT NULL,
  currency CHAR(3) NOT NULL,
  duration_days INT NOT NULL DEFAULT 30,
  max_branches INT NOT NULL DEFAULT 1,
  features JSON NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE files (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL UNIQUE,
  restaurant_id BIGINT UNSIGNED NULL,
  category VARCHAR(40) NOT NULL,
  storage_key VARCHAR(300) NOT NULL,
  thumb_key VARCHAR(300) NULL,
  mime VARCHAR(100) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  width INT NULL,
  height INT NULL,
  visibility ENUM('public','private') NOT NULL DEFAULT 'private',
  owner_session_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NULL,
  KEY idx_files_rest (restaurant_id, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE restaurants (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL UNIQUE,
  slug VARCHAR(80) NOT NULL UNIQUE,
  custom_domain VARCHAR(190) NULL UNIQUE,
  name VARCHAR(190) NOT NULL,
  legal_name VARCHAR(190) NULL,
  logo_file_id BIGINT UNSIGNED NULL,
  banner_file_id BIGINT UNSIGNED NULL,
  address VARCHAR(500) NULL,
  country CHAR(2) NOT NULL,
  city VARCHAR(120) NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  currency CHAR(3) NOT NULL,
  locale VARCHAR(20) NOT NULL DEFAULT 'en',
  contact_email VARCHAR(190) NULL,
  contact_phone VARCHAR(40) NULL,
  status ENUM('pending','active','rejected','suspended','expired','deleted') NOT NULL DEFAULT 'pending',
  status_reason VARCHAR(500) NULL,
  plan_id BIGINT UNSIGNED NULL,
  subscription_expires_at DATETIME(3) NULL,
  grace_days INT NULL,
  suspended_at DATETIME(3) NULL,
  deletion_scheduled_at DATETIME(3) NULL,
  deletion_approved TINYINT(1) NOT NULL DEFAULT 0,
  settings JSON NOT NULL,
  theme_draft JSON NULL,
  theme_published JSON NULL,
  wifi_ssid VARCHAR(64) NULL,
  wifi_password VARCHAR(128) NULL,
  wifi_encryption ENUM('WPA','WEP','nopass') NOT NULL DEFAULT 'WPA',
  approved_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_rest_status (status),
  KEY idx_rest_expiry (subscription_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE branches (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(190) NOT NULL,
  address VARCHAR(500) NULL,
  phone VARCHAR(40) NULL,
  is_main TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_branch_rest (restaurant_id),
  CONSTRAINT fk_branch_rest FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE subscription_payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  plan_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(19,4) NOT NULL,
  currency CHAR(3) NOT NULL,
  method VARCHAR(80) NOT NULL,
  reference VARCHAR(190) NULL,
  proof_file_id BIGINT UNSIGNED NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  rejection_reason VARCHAR(500) NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME(3) NULL,
  period_start DATETIME(3) NULL,
  period_end DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_subpay (restaurant_id, status),
  KEY idx_subpay_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE agreements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  version VARCHAR(20) NOT NULL UNIQUE,
  title VARCHAR(190) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  is_material TINYINT(1) NOT NULL DEFAULT 1,
  is_current TINYINT(1) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE agreement_acceptances (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  agreement_id BIGINT UNSIGNED NOT NULL,
  signer_name VARCHAR(190) NOT NULL,
  signer_title VARCHAR(190) NULL,
  signer_email VARCHAR(190) NOT NULL,
  signature_file_id BIGINT UNSIGNED NOT NULL,
  pdf_file_id BIGINT UNSIGNED NULL,
  content_hash CHAR(64) NOT NULL,
  platform_signature TEXT NULL,
  signing_key_id VARCHAR(64) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(400) NULL,
  signed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_acc_rest (restaurant_id, agreement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  system_key VARCHAR(40) NULL,
  permissions JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_role (restaurant_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NULL,
  branch_id BIGINT UNSIGNED NULL,
  role_id BIGINT UNSIGNED NULL,
  is_super_admin TINYINT(1) NOT NULL DEFAULT 0,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(190) NOT NULL,
  phone VARCHAR(40) NULL,
  salary DECIMAL(19,4) NULL,
  pay_frequency ENUM('monthly','biweekly','weekly') NOT NULL DEFAULT 'monthly',
  active TINYINT(1) NOT NULL DEFAULT 1,
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_users_rest (restaurant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auth_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  csrf_token CHAR(64) NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(400) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  KEY idx_sess_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE kitchen_stations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  name VARCHAR(80) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_station_rest (restaurant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dining_tables (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  name VARCHAR(80) NOT NULL,
  table_number VARCHAR(20) NOT NULL,
  capacity INT NOT NULL DEFAULT 4,
  area VARCHAR(80) NULL,
  waiter_user_id BIGINT UNSIGNED NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_table_no (restaurant_id, branch_id, table_number),
  KEY idx_tables_rest (restaurant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE qr_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  table_id BIGINT UNSIGNED NULL,
  kind ENUM('table','online') NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  active TINYINT(1) NOT NULL DEFAULT 1,
  revoked_at DATETIME(3) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_qr_rest (restaurant_id, kind, active),
  KEY idx_qr_table (table_id, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(190) NOT NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(190) NULL,
  birthday DATE NULL,
  recognition_opt_in TINYINT(1) NOT NULL DEFAULT 0,
  marketing_opt_in TINYINT(1) NOT NULL DEFAULT 0,
  marketing_opt_in_at DATETIME(3) NULL,
  loyalty_points INT NOT NULL DEFAULT 0,
  visit_count INT NOT NULL DEFAULT 0,
  total_spent DECIMAL(19,4) NOT NULL DEFAULT 0,
  last_visit_at DATETIME(3) NULL,
  notes VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_cust_phone (restaurant_id, phone),
  KEY idx_cust_name (restaurant_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bills (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL UNIQUE,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  bill_no VARCHAR(40) NOT NULL,
  table_id BIGINT UNSIGNED NULL,
  customer_id BIGINT UNSIGNED NULL,
  customer_name VARCHAR(190) NULL,
  order_type ENUM('dine_in','takeaway','delivery','pickup') NOT NULL DEFAULT 'dine_in',
  channel ENUM('qr','online','pos','waiter') NOT NULL,
  currency CHAR(3) NOT NULL,
  status ENUM('open','closed','void') NOT NULL DEFAULT 'open',
  payment_status ENUM('unpaid','payment_submitted','under_review','cash_requested','partially_paid','paid','refunded','partially_refunded') NOT NULL DEFAULT 'unpaid',
  subtotal DECIMAL(19,4) NOT NULL DEFAULT 0,
  discount_total DECIMAL(19,4) NOT NULL DEFAULT 0,
  tax_total DECIMAL(19,4) NOT NULL DEFAULT 0,
  inclusive_tax_total DECIMAL(19,4) NOT NULL DEFAULT 0,
  delivery_charge DECIMAL(19,4) NOT NULL DEFAULT 0,
  total DECIMAL(19,4) NOT NULL DEFAULT 0,
  paid_total DECIMAL(19,4) NOT NULL DEFAULT 0,
  refunded_total DECIMAL(19,4) NOT NULL DEFAULT 0,
  tax_selection JSON NULL,
  discount JSON NULL,
  coupon_id BIGINT UNSIGNED NULL,
  revenue_posted TINYINT(1) NOT NULL DEFAULT 0,
  opened_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_at DATETIME(3) NULL,
  closed_by BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_bill_no (restaurant_id, bill_no),
  KEY idx_bill_status (restaurant_id, status, opened_at),
  KEY idx_bill_closed (restaurant_id, closed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bill_taxes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  bill_id BIGINT UNSIGNED NOT NULL,
  tax_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  rate DECIMAL(9,4) NOT NULL,
  calc_type ENUM('percent','fixed') NOT NULL,
  inclusive TINYINT(1) NOT NULL DEFAULT 0,
  is_liability TINYINT(1) NOT NULL DEFAULT 1,
  taxable_amount DECIMAL(19,4) NOT NULL,
  amount DECIMAL(19,4) NOT NULL,
  KEY idx_bt_bill (bill_id),
  KEY idx_bt_rest (restaurant_id, tax_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  table_id BIGINT UNSIGNED NULL,
  kind ENUM('table','online') NOT NULL DEFAULT 'table',
  customer_id BIGINT UNSIGNED NULL,
  customer_name VARCHAR(190) NOT NULL,
  customer_phone VARCHAR(40) NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  join_pin CHAR(4) NOT NULL,
  bill_id BIGINT UNSIGNED NULL,
  status ENUM('active','closed','expired') NOT NULL DEFAULT 'active',
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  closed_at DATETIME(3) NULL,
  KEY idx_cs_table (restaurant_id, table_id, status),
  KEY idx_cs_status (status, last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE menu_categories (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  station_id BIGINT UNSIGNED NULL,
  prep_minutes INT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_cat_rest (restaurant_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE menu_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(190) NOT NULL,
  description VARCHAR(1000) NULL,
  image_file_id BIGINT UNSIGNED NULL,
  price DECIMAL(19,4) NOT NULL,
  prep_minutes INT NULL,
  station_id BIGINT UNSIGNED NULL,
  allergens VARCHAR(500) NULL,
  ingredients_text VARCHAR(1000) NULL,
  is_featured TINYINT(1) NOT NULL DEFAULT 0,
  available TINYINT(1) NOT NULL DEFAULT 1,
  active TINYINT(1) NOT NULL DEFAULT 1,
  online_enabled TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_item_rest (restaurant_id, category_id, sort_order),
  FULLTEXT KEY ft_item_name (name, description)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE item_variants (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  price_delta DECIMAL(19,4) NOT NULL DEFAULT 0,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_var_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE item_addons (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  price DECIMAL(19,4) NOT NULL DEFAULT 0,
  ingredient_id BIGINT UNSIGNED NULL,
  ingredient_qty DECIMAL(18,4) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_addon_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE taxes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  calc_type ENUM('percent','fixed') NOT NULL DEFAULT 'percent',
  rate DECIMAL(9,4) NOT NULL,
  inclusive TINYINT(1) NOT NULL DEFAULT 0,
  applies_to JSON NULL,
  order_types JSON NULL,
  is_optional TINYINT(1) NOT NULL DEFAULT 0,
  default_selected TINYINT(1) NOT NULL DEFAULT 1,
  is_liability TINYINT(1) NOT NULL DEFAULT 1,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  effective_from DATE NULL,
  effective_to DATE NULL,
  sort_order INT NOT NULL DEFAULT 0,
  KEY idx_tax_rest (restaurant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL UNIQUE,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  bill_id BIGINT UNSIGNED NOT NULL,
  parent_order_id BIGINT UNSIGNED NULL,
  order_no VARCHAR(40) NOT NULL,
  order_type ENUM('dine_in','takeaway','delivery','pickup') NOT NULL,
  channel ENUM('qr','online','pos','waiter') NOT NULL,
  table_id BIGINT UNSIGNED NULL,
  customer_id BIGINT UNSIGNED NULL,
  session_id BIGINT UNSIGNED NULL,
  customer_name VARCHAR(190) NULL,
  customer_phone VARCHAR(40) NULL,
  delivery_address VARCHAR(500) NULL,
  delivery_instructions VARCHAR(500) NULL,
  scheduled_for DATETIME(3) NULL,
  status ENUM('draft','submitted','pending_approval','accepted','rejected','preparing','ready','served','completed','cancelled') NOT NULL,
  is_held TINYINT(1) NOT NULL DEFAULT 0,
  is_addition TINYINT(1) NOT NULL DEFAULT 0,
  notes VARCHAR(1000) NULL,
  subtotal DECIMAL(19,4) NOT NULL DEFAULT 0,
  prep_estimate_minutes INT NULL,
  editable_until DATETIME(3) NULL,
  stock_deducted TINYINT(1) NOT NULL DEFAULT 0,
  idempotency_key VARCHAR(80) NULL,
  rejection_reason VARCHAR(500) NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  served_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  submitted_at DATETIME(3) NULL,
  accepted_at DATETIME(3) NULL,
  ready_at DATETIME(3) NULL,
  served_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  cancelled_at DATETIME(3) NULL,
  UNIQUE KEY uq_order_no (restaurant_id, order_no),
  UNIQUE KEY uq_order_idem (restaurant_id, idempotency_key),
  KEY idx_order_status (restaurant_id, status, created_at),
  KEY idx_order_bill (bill_id),
  KEY idx_order_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE kitchen_tickets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  station_id BIGINT UNSIGNED NULL,
  status ENUM('new','preparing','ready','served','cancelled') NOT NULL DEFAULT 'new',
  priority TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at DATETIME(3) NULL,
  ready_at DATETIME(3) NULL,
  KEY idx_kt (restaurant_id, station_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  ticket_id BIGINT UNSIGNED NULL,
  menu_item_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(190) NOT NULL,
  variant_id BIGINT UNSIGNED NULL,
  variant_name VARCHAR(120) NULL,
  addons JSON NULL,
  unit_price DECIMAL(19,4) NOT NULL,
  addons_total DECIMAL(19,4) NOT NULL DEFAULT 0,
  quantity INT NOT NULL,
  line_total DECIMAL(19,4) NOT NULL,
  notes VARCHAR(500) NULL,
  station_id BIGINT UNSIGNED NULL,
  prep_minutes INT NULL,
  status ENUM('pending','preparing','ready','served','cancelled') NOT NULL DEFAULT 'pending',
  is_complimentary TINYINT(1) NOT NULL DEFAULT 0,
  complimentary_reason VARCHAR(300) NULL,
  stock_deducted TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_oi_order (order_id),
  KEY idx_oi_rest (restaurant_id, menu_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  event VARCHAR(60) NOT NULL,
  data JSON NULL,
  actor_type ENUM('customer','staff','system') NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_oe_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CREATE TABLE order_counters (
--   restaurant_id BIGINT UNSIGNED NOT NULL,
--   counter_key VARCHAR(30) NOT NULL,
--   last_value INT NOT NULL,
--   PRIMARY KEY (restaurant_id, counter_key)
-- ) ENGINE=InnoDB;

CREATE TABLE order_counters (
  restaurant_id BIGINT UNSIGNED NOT NULL,
  counter_key VARCHAR(30) NOT NULL,
  `last_value` INT NOT NULL,
  PRIMARY KEY (restaurant_id, counter_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payment_methods (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  type ENUM('bank','wallet','card','cash','other') NOT NULL DEFAULT 'bank',
  label VARCHAR(120) NOT NULL,
  bank_name VARCHAR(120) NULL,
  account_title VARCHAR(190) NULL,
  account_number VARCHAR(80) NULL,
  iban VARCHAR(80) NULL,
  instructions VARCHAR(1000) NULL,
  qr_file_id BIGINT UNSIGNED NULL,
  currency CHAR(3) NULL,
  fee_percent DECIMAL(9,4) NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  KEY idx_pm_rest (restaurant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  bill_id BIGINT UNSIGNED NOT NULL,
  method_id BIGINT UNSIGNED NULL,
  method_type ENUM('cash','bank','wallet','card','other') NOT NULL,
  amount DECIMAL(19,4) NOT NULL,
  fee_amount DECIMAL(19,4) NOT NULL DEFAULT 0,
  split_label VARCHAR(80) NULL,
  status ENUM('submitted','under_review','approved','rejected','cash_requested','cash_collected') NOT NULL,
  proof_file_id BIGINT UNSIGNED NULL,
  reference VARCHAR(190) NULL,
  rejection_reason VARCHAR(500) NULL,
  submitted_by_session_id BIGINT UNSIGNED NULL,
  recorded_by BIGINT UNSIGNED NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME(3) NULL,
  shift_id BIGINT UNSIGNED NULL,
  idempotency_key VARCHAR(80) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pay_idem (restaurant_id, idempotency_key),
  KEY idx_pay_bill (bill_id),
  KEY idx_pay_status (restaurant_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE refunds (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  bill_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(19,4) NOT NULL,
  tax_portion DECIMAL(19,4) NOT NULL DEFAULT 0,
  method_type ENUM('cash','bank','wallet','card','other') NOT NULL,
  reason VARCHAR(500) NOT NULL,
  restocked TINYINT(1) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NOT NULL,
  shift_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_ref_bill (bill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE coupons (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(40) NOT NULL,
  description VARCHAR(300) NULL,
  discount_type ENUM('percent','fixed') NOT NULL,
  value DECIMAL(19,4) NOT NULL,
  min_order DECIMAL(19,4) NOT NULL DEFAULT 0,
  max_uses INT NULL,
  used_count INT NOT NULL DEFAULT 0,
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  birthday_only TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_coupon (restaurant_id, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE loyalty_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  points INT NOT NULL,
  reason VARCHAR(120) NOT NULL,
  bill_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_loyalty_bill (restaurant_id, bill_id, reason),
  KEY idx_lt_cust (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE billing_discrepancies (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  customer_name VARCHAR(190) NULL,
  table_id BIGINT UNSIGNED NULL,
  order_id BIGINT UNSIGNED NULL,
  bill_id BIGINT UNSIGNED NULL,
  amount DECIMAL(19,4) NOT NULL,
  description VARCHAR(1000) NULL,
  reason VARCHAR(300) NOT NULL,
  responsible_user_id BIGINT UNSIGNED NULL,
  occurred_at DATETIME(3) NOT NULL,
  classification ENUM('loss','neutral') NOT NULL DEFAULT 'neutral',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_bd_rest (restaurant_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ingredients (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  sku VARCHAR(60) NULL,
  unit VARCHAR(20) NOT NULL,
  stock_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  min_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  reorder_qty DECIMAL(18,4) NULL,
  avg_cost DECIMAL(19,6) NOT NULL DEFAULT 0,
  is_finished_product TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  low_alerted TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_ing (restaurant_id, name),
  KEY idx_ing_low (restaurant_id, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE recipes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  menu_item_id BIGINT UNSIGNED NOT NULL,
  variant_id BIGINT UNSIGNED NULL,
  yield_qty DECIMAL(18,4) NOT NULL DEFAULT 1,
  wastage_pct DECIMAL(9,4) NOT NULL DEFAULT 0,
  notes VARCHAR(500) NULL,
  UNIQUE KEY uq_recipe (restaurant_id, menu_item_id, variant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE recipe_lines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  recipe_id BIGINT UNSIGNED NOT NULL,
  ingredient_id BIGINT UNSIGNED NOT NULL,
  quantity DECIMAL(18,4) NOT NULL,
  is_optional TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_rl_recipe (recipe_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE suppliers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(190) NOT NULL,
  contact_name VARCHAR(190) NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(190) NULL,
  address VARCHAR(500) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_sup_rest (restaurant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  supplier_id BIGINT UNSIGNED NULL,
  reference VARCHAR(80) NULL,
  purchase_date DATE NOT NULL,
  extra_charges DECIMAL(19,4) NOT NULL DEFAULT 0,
  total DECIMAL(19,4) NOT NULL,
  paid_via ENUM('cash','bank','credit') NOT NULL DEFAULT 'cash',
  notes VARCHAR(500) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_pur_rest (restaurant_id, purchase_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchase_lines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  purchase_id BIGINT UNSIGNED NOT NULL,
  ingredient_id BIGINT UNSIGNED NOT NULL,
  quantity DECIMAL(18,4) NOT NULL,
  unit_cost DECIMAL(19,6) NOT NULL,
  landed_unit_cost DECIMAL(19,6) NOT NULL,
  KEY idx_pl_pur (purchase_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_movements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  ingredient_id BIGINT UNSIGNED NOT NULL,
  movement_type ENUM('purchase','sale','sale_reversal','adjustment','wastage','transfer_in','transfer_out','return','complimentary','opening') NOT NULL,
  quantity DECIMAL(18,4) NOT NULL,
  unit_cost DECIMAL(19,6) NOT NULL DEFAULT 0,
  balance_after DECIMAL(18,4) NOT NULL,
  ref_type VARCHAR(40) NULL,
  ref_id BIGINT UNSIGNED NULL,
  note VARCHAR(500) NULL,
  user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_sm (restaurant_id, ingredient_id, created_at),
  KEY idx_sm_ref (ref_type, ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wastage_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  kind ENUM('ingredient','prepared_food','expired','damaged','complaint','complimentary','staff_meal','kitchen_testing','other') NOT NULL,
  ingredient_id BIGINT UNSIGNED NULL,
  menu_item_id BIGINT UNSIGNED NULL,
  quantity DECIMAL(18,4) NOT NULL,
  cost DECIMAL(19,4) NOT NULL DEFAULT 0,
  reason VARCHAR(500) NOT NULL,
  employee_id BIGINT UNSIGNED NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME(3) NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_w (restaurant_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reservations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  customer_name VARCHAR(190) NOT NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(190) NULL,
  party_size INT NOT NULL,
  reserved_for DATETIME(3) NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 90,
  table_id BIGINT UNSIGNED NULL,
  status ENUM('requested','confirmed','rejected','cancelled','arrived','completed','no_show') NOT NULL DEFAULT 'requested',
  special_requests VARCHAR(1000) NULL,
  source ENUM('online','staff','phone') NOT NULL DEFAULT 'online',
  reminded TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_res (restaurant_id, reserved_for),
  KEY idx_res_table (table_id, reserved_for)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE waitlist (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  customer_name VARCHAR(190) NOT NULL,
  phone VARCHAR(40) NULL,
  party_size INT NOT NULL,
  status ENUM('waiting','notified','seated','left') NOT NULL DEFAULT 'waiting',
  notes VARCHAR(300) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_wl (restaurant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE feedback (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NULL,
  bill_id BIGINT UNSIGNED NULL,
  customer_id BIGINT UNSIGNED NULL,
  customer_name VARCHAR(190) NULL,
  rating TINYINT NOT NULL,
  food_rating TINYINT NULL,
  service_rating TINYINT NULL,
  comment VARCHAR(2000) NULL,
  suggestion VARCHAR(2000) NULL,
  is_complaint TINYINT(1) NOT NULL DEFAULT 0,
  publish_permission TINYINT(1) NOT NULL DEFAULT 0,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('open','resolved') NOT NULL DEFAULT 'open',
  internal_note VARCHAR(2000) NULL,
  resolved_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_fb_bill (restaurant_id, bill_id),
  KEY idx_fb (restaurant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE expenses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  category ENUM('rent','electricity','water','gas','salaries','purchases','repairs','marketing','delivery','maintenance','other') NOT NULL,
  amount DECIMAL(19,4) NOT NULL,
  expense_date DATE NOT NULL,
  description VARCHAR(500) NULL,
  paid_via ENUM('cash','bank') NOT NULL DEFAULT 'cash',
  recurring_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_exp_recurring (recurring_id, expense_date),
  KEY idx_exp (restaurant_id, expense_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE recurring_expenses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  category ENUM('rent','electricity','water','gas','salaries','purchases','repairs','marketing','delivery','maintenance','other') NOT NULL,
  amount DECIMAL(19,4) NOT NULL,
  description VARCHAR(500) NULL,
  frequency ENUM('weekly','monthly') NOT NULL DEFAULT 'monthly',
  next_run_date DATE NOT NULL,
  paid_via ENUM('cash','bank') NOT NULL DEFAULT 'bank',
  active TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_rexp (restaurant_id, active, next_run_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payroll_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  base_salary DECIMAL(19,4) NOT NULL,
  bonuses DECIMAL(19,4) NOT NULL DEFAULT 0,
  deductions DECIMAL(19,4) NOT NULL DEFAULT 0,
  advances DECIMAL(19,4) NOT NULL DEFAULT 0,
  net_pay DECIMAL(19,4) NOT NULL,
  status ENUM('unpaid','paid') NOT NULL DEFAULT 'unpaid',
  paid_via ENUM('cash','bank') NULL,
  paid_at DATETIME(3) NULL,
  notes VARCHAR(500) NULL,
  UNIQUE KEY uq_payroll (restaurant_id, user_id, period_start),
  KEY idx_payroll (restaurant_id, period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Double-entry ledger: every txn_id balances (sum debit = sum credit).
CREATE TABLE ledger_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  txn_id CHAR(36) NOT NULL,
  entry_at DATETIME(3) NOT NULL,
  account VARCHAR(40) NOT NULL,
  debit DECIMAL(19,4) NOT NULL DEFAULT 0,
  credit DECIMAL(19,4) NOT NULL DEFAULT 0,
  ref_type VARCHAR(40) NOT NULL,
  ref_id BIGINT UNSIGNED NULL,
  memo VARCHAR(300) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_le (restaurant_id, account, entry_at),
  KEY idx_le_txn (txn_id),
  KEY idx_le_ref (restaurant_id, ref_type, ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE support_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  session_id BIGINT UNSIGNED NULL,
  table_id BIGINT UNSIGNED NULL,
  type ENUM('waiter','billing','general','order','call_back','cash_collection') NOT NULL,
  message VARCHAR(1000) NULL,
  status ENUM('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
  handled_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  KEY idx_sr (restaurant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE chat_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  session_id BIGINT UNSIGNED NOT NULL,
  sender_type ENUM('customer','staff') NOT NULL,
  sender_user_id BIGINT UNSIGNED NULL,
  body VARCHAR(2000) NOT NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_chat (restaurant_id, session_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE call_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL UNIQUE,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  session_id BIGINT UNSIGNED NOT NULL,
  table_id BIGINT UNSIGNED NULL,
  staff_user_id BIGINT UNSIGNED NULL,
  status ENUM('ringing','accepted','rejected','missed','ended','failed','busy') NOT NULL DEFAULT 'ringing',
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  answered_at DATETIME(3) NULL,
  ended_at DATETIME(3) NULL,
  end_reason VARCHAR(120) NULL,
  KEY idx_calls (restaurant_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE waiter_tasks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  assigned_to BIGINT UNSIGNED NULL,
  table_id BIGINT UNSIGNED NULL,
  title VARCHAR(300) NOT NULL,
  details VARCHAR(1000) NULL,
  kind ENUM('task','issue') NOT NULL DEFAULT 'task',
  status ENUM('assigned','accepted','in_progress','completed','cancelled') NOT NULL DEFAULT 'assigned',
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_wt (restaurant_id, assigned_to, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  audience VARCHAR(40) NOT NULL DEFAULT 'restaurant',
  type VARCHAR(60) NOT NULL,
  title VARCHAR(190) NOT NULL,
  body VARCHAR(1000) NULL,
  data JSON NULL,
  read_at DATETIME(3) NULL,
  emailed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_notif (restaurant_id, audience, created_at),
  KEY idx_notif_user (user_id, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE printers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  name VARCHAR(120) NOT NULL,
  connection ENUM('browser','usb','bluetooth','network') NOT NULL DEFAULT 'browser',
  address VARCHAR(190) NULL,
  paper_width_mm INT NOT NULL DEFAULT 80,
  chars_per_line INT NOT NULL DEFAULT 48,
  encoding VARCHAR(20) NOT NULL DEFAULT 'cp437',
  purpose ENUM('receipt','kitchen','both') NOT NULL DEFAULT 'receipt',
  station_id BIGINT UNSIGNED NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  last_status VARCHAR(40) NULL,
  last_test_at DATETIME(3) NULL,
  KEY idx_printers (restaurant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pos_shifts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  opened_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  opening_cash DECIMAL(19,4) NOT NULL DEFAULT 0,
  closed_at DATETIME(3) NULL,
  expected_cash DECIMAL(19,4) NULL,
  counted_cash DECIMAL(19,4) NULL,
  difference DECIMAL(19,4) NULL,
  notes VARCHAR(500) NULL,
  KEY idx_shift (restaurant_id, user_id, closed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  actor_type ENUM('staff','super_admin','customer','system') NOT NULL,
  action VARCHAR(80) NOT NULL,
  entity VARCHAR(60) NOT NULL,
  entity_id VARCHAR(64) NULL,
  data JSON NULL,
  ip_address VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_audit (restaurant_id, created_at),
  KEY idx_audit_entity (entity, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE idempotency_keys (
  restaurant_id BIGINT UNSIGNED NOT NULL,
  scope VARCHAR(40) NOT NULL,
  idem_key VARCHAR(80) NOT NULL,
  response JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (restaurant_id, scope, idem_key)
) ENGINE=InnoDB;

CREATE TABLE job_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job VARCHAR(60) NOT NULL,
  run_key VARCHAR(160) NOT NULL UNIQUE,
  status ENUM('running','success','failed') NOT NULL,
  info JSON NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  KEY idx_job (job, started_at)
) ENGINE=InnoDB;

CREATE TABLE backups (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('database','storage','restaurant_export') NOT NULL,
  restaurant_id BIGINT UNSIGNED NULL,
  file_path VARCHAR(400) NOT NULL,
  size_bytes BIGINT NULL,
  sha256 CHAR(64) NULL,
  status ENUM('running','verified','failed') NOT NULL,
  error VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  verified_at DATETIME(3) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE demo_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(40) NULL,
  restaurant_name VARCHAR(190) NULL,
  country VARCHAR(80) NULL,
  message VARCHAR(2000) NULL,
  status ENUM('new','contacted','closed') NOT NULL DEFAULT 'new',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
