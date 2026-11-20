# Database

MySQL 8.0+ or MariaDB 10.6+, InnoDB, `utf8mb4_unicode_ci`. The schema lives in `database/migrations/` and is applied in order by `node backend/dist/cli/migrate.js`.

## Migrations

- Each file is applied once and recorded in the `schema_migrations` table, together with its SHA-256 checksum.
- If an already-applied file is changed, the migration runner **refuses to start**. Add a new numbered file instead.
- Files:
  - `001_init.sql`: full schema
  - `002_session_devices.sql`: guest device tokens and session order type
  - `003_branch_stock_and_theme.sql`: per-branch ingredients and extra indexes
  - `004_password_resets.sql`: password reset tokens
- Migrations are forward-only. To roll back, restore a backup (see BACKUP_RESTORE.md).

## Conventions

| Topic | Convention |
|---|---|
| Keys | `BIGINT UNSIGNED AUTO_INCREMENT`; public identifiers (`public_id`, slugs, QR tokens) are separate random values. Internal ids are never put in QR codes. |
| Tenancy | Every restaurant-owned table has `restaurant_id`, and almost all queries filter on it first. Composite indexes start with `restaurant_id`. |
| Money | `DECIMAL(19,4)` for amounts, `DECIMAL(18,4)` for quantities, `DECIMAL(19,6)` for unit costs, `DECIMAL(9,4)` for rates. mysql2 returns them as strings; code uses decimal.js, so no floating-point rounding errors occur. |
| Time | `DATETIME(3)` in UTC. The pool runs with `timezone: 'Z'`. |
| JSON | `JSON` columns (MariaDB stores them as LONGTEXT and returns strings, which the `j()` helper parses) |
| Soft delete | `deleted_at` or `active` on menu, tables, staff and suppliers, so historical bills keep their references |
| Snapshots | Order items store the name, price, variant, add-ons and tax snapshot at the time of the order. Later menu edits never change past bills. |

## Tables by area (58)

| Area | Tables |
|---|---|
| Platform | `platform_settings`, `subscription_plans`, `subscription_payments`, `agreements`, `agreement_acceptances`, `demo_requests`, `backups`, `job_runs`, `idempotency_keys`, `audit_logs`, `notifications`, `files` |
| Tenancy & people | `restaurants`, `branches`, `roles`, `users`, `auth_sessions`, `password_resets` |
| Floor | `dining_tables`, `qr_tokens`, `customer_sessions`, `customer_session_tokens`, `customers`, `reservations`, `waitlist` |
| Menu | `kitchen_stations`, `menu_categories`, `menu_items`, `item_variants`, `item_addons`, `taxes` |
| Orders | `orders`, `order_items`, `order_events`, `order_counters`, `kitchen_tickets`, `waiter_tasks`, `support_requests`, `chat_messages`, `call_records` |
| Billing | `bills`, `bill_taxes`, `payments`, `payment_methods`, `refunds`, `coupons`, `loyalty_transactions`, `billing_discrepancies`, `pos_shifts`, `printers` |
| Inventory | `ingredients`, `recipes`, `recipe_lines`, `suppliers`, `purchases`, `purchase_lines`, `stock_movements`, `wastage_records` |
| Finance | `expenses`, `recurring_expenses`, `payroll_entries`, `ledger_entries`, `feedback` |

## Accounting model

`ledger_entries` is a double-entry journal. Each posting has the same `entry_group`, and its debits equal its credits.

| Event | Debit | Credit |
|---|---|---|
| Payment received before close | Cash/Bank | Customer deposits |
| Bill closed | Customer deposits / Receivable | Sales revenue (net), Tax payable (liability taxes), Service income (non-liability charges) |
| Refund | Sales revenue / Tax payable | Cash/Bank |
| Stock consumed / wastage / complimentary | Cost of goods / Wastage expense / Complimentary expense | Inventory |
| Purchase | Inventory | Cash/Bank or Payables |
| Expense / payroll paid | Expense accounts | Cash/Bank |
| Neutral discrepancy | Suspense | Cash/Bank (or the reverse) |
| Loss discrepancy | Discrepancy loss | Cash/Bank |

`GET /r/ledger/health` checks that every group balances. The P&L report is built from the ledger, so tax liabilities, deposits and neutral suspense never inflate profit.

## Stock

- `ingredients.quantity` is changed only together with a `stock_movements` row, in the same transaction. Movement types:
  - purchase
  - sale
  - reversal
  - adjustment
  - count
  - transfer_in and transfer_out
  - return
  - wastage
  - complimentary
- The weighted-average cost is recalculated on each purchase. Deduction follows the restaurant's trigger setting. Cancellations post reversals.

## Sizing guide

A busy restaurant with about 300 bills a day generates roughly 30 MB of data a year, excluding images. Index maintenance is automatic. Run `ANALYZE TABLE` monthly on large installs.
