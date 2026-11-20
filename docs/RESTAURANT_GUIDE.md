# Restaurant Guide (owners, admins and managers)

This guide is also available inside the app at **/help/restaurant-admins**. Menu names below match the dashboard sidebar.

## 1. Get started

1. Click **Get started** on the website (`/register`) and fill in:
   - the restaurant name, country, city, **currency** and **timezone** (these cannot easily change later)
   - the owner's name, email and password
2. Read the platform agreement, draw your signature and type your name and title. You can download a PDF copy later under **Subscription**.
3. Sign in. Until the platform team approves you, the dashboard shows "pending approval".
4. Go to **Setup → Subscription**:
   1. Choose a plan.
   2. Pay using the bank or wallet details shown.
   3. Upload the payment screenshot.
   You are notified when the payment is approved, and the expiry date is extended.

## 2. Setup, in this order

| Step | Where | What to do |
|---|---|---|
| 1 | **Settings → General** | Address, phone, email, locale and Wi-Fi details (for the Wi-Fi QR) |
| 2 | **Settings → Ordering & kitchen**, **Online & delivery**, **Loyalty** | Approval required (accept or reject each guest order), customer edit window in minutes (0 disables editing), one session per table or shared tables, stock deduction trigger, kitchen delay threshold, dine-in and online ordering on or off, delivery and pickup, delivery charge, minimum order, opening hours, loyalty points |
| 3 | **Settings → Calls & support** | Which roles or people receive guest voice calls; fallback phone number |
| 4 | **Branches** | Add more locations (limited by your plan). Stock, tables, staff and reports can be filtered by branch. |
| 5 | **Taxes** | Each tax: percentage or fixed, inclusive or exclusive, scoped to categories, items or order types, optional or default-selected. Mark government taxes as **liability** so they are excluded from revenue. |
| 6 | **Payment methods** | Bank accounts, wallets and QR images that guests can pay to (proof upload). Cash and card are always available at the POS. |
| 7 | **Categories & stations** | Kitchen stations (Grill, Pizza, Drinks…), then categories with their default station and preparation time |
| 8 | **Menu items** | Name, description, price, photo, allergens, preparation time, variants (sizes) and add-ons. Availability is a one-tap toggle. |
| 9 | **Tables & QR** | Tables with capacity, area and assigned waiter. Print each table's QR; download the online-ordering QR and the Wi-Fi QR. **Regenerate** a QR if it is lost or copied: the old code stops working instantly. |
| 10 | **Staff & roles** | Add staff with a role. The built-in roles are Owner, Administrator, Manager, Assistant Manager, Cashier, Waiter, Kitchen Staff, Inventory Manager and Accountant. You can create custom roles from 45 permissions. You can only grant permissions you hold. |
| 11 | **Printers** | Add receipt and kitchen printers (see [COMPATIBILITY](COMPATIBILITY_AND_LIMITATIONS.md#printers)) |
| 12 | **Stock / Recipes / Suppliers** | Ingredients with units, minimum levels and opening stock; recipes per item and variant; suppliers |
| 13 | **Website & theme** | Theme, colours, fonts, logo, cover and sections: hero, featured, menu, gallery, reviews, hours, contact, reservations. Save the draft, then click **Preview**, then **Publish**. Your site is at `/r/<your-slug>`, or on a custom domain. |

## 3. During service

- **Orders**: every order from QR, online, waiter and POS, shown live.
  - Accept or reject pending orders, change their status, cancel single items (with a reason) or mark them complimentary.
  - Open an order to see its full event history.
- **Kitchen display**: tickets per station. See [STAFF_GUIDE](STAFF_GUIDE.md#kitchen).
- **Waiter**: a mobile screen for tables, ready orders, requests and tasks.
- **Chat & requests**: guest chat, waiter calls, billing help, cash collection and call-back requests. Incoming voice calls ring for staff with the "receive calls" permission.
- **Reservations**: bookings from your website or by phone, the waitlist, seating and no-shows. Guests get reminders when email is configured.

## 4. Billing and payments

- One table session = one bill. Additions go onto the same bill.
- Every tax is shown separately to guests.
- **Payment approvals**: guests upload transfer screenshots. A payment does **not** count as paid until you approve it. Rejecting it asks the guest to pay again.
- **Bills**: open any bill to do any of the following:
  - apply a discount (with permission and a reason)
  - preview a split (equally, by items or custom)
  - record payments
  - close the bill
  - reprint the receipt
  - refund in full or in part, optionally returning stock
  - void an unpaid bill
- **Billing errors**: record a discrepancy as a *loss* (reduces profit) or *neutral* (kept in suspense). Each reclassification is audited.

## 5. Back office

| Area | Notes |
|---|---|
| Stock | Adjustments, counts, transfers between branches, returns to suppliers, movement history, low-stock alerts |
| Purchases | Deliveries with landed cost (extra charges spread across lines). Updates the weighted-average cost. |
| Recipes & costing | Estimated cost and margin per item. Items above 35% food cost are flagged. |
| Wastage & comps | Recorded by staff, approved by a manager. Stock and the ledger update on approval. |
| Customers | History, visits, spend. **Anonymize** removes personal data on request (privacy rights). |
| Loyalty & coupons | Points per currency unit, redemption value, coupons with limits and expiry |
| Feedback | Ratings and comments after service. Mark them as handled. |
| Expenses | One-off or recurring (generated automatically) |
| Payroll | Generated monthly for salaried staff; bonuses, deductions, advances, mark as paid |
| Reports | 22 reports with PDF and Excel export (list below) |
| Audit log | Who did what and when, including discounts, refunds, voids, role changes and payment decisions |

### The 22 reports

Sales · Revenue by channel · Expenses · Profit & loss · Cash · Payment reconciliation · Tax collection · Inventory · Stock valuation · Purchases · Food cost · Recipe profitability · Wastage · Complimentary items · Payroll · Employee performance · Customer history · Loyalty · Reservations · Order performance · Kitchen preparation performance · Branch comparison.

Report filters: date preset or custom range (in your restaurant's timezone), branch, employee, payment method, order type, category and item. Financial reports need the **reports.financial** permission.

## 6. Subscription and suspension

- Expiry reminders arrive 7, 3 and 1 days before the expiry date (the platform can change these).
- After expiry there is a **grace period** during which everything still works and a banner is shown.
- When grace ends, or if the platform suspends the account:
  - staff are signed out
  - QR and online ordering stop
  - the storefront shows "temporarily unavailable"
  - data is kept for the retention period (default 90 days)
  Pay and upload the proof from the suspension page to get reactivated.
- **Subscription → Export all data** downloads all of your data at any time.

## 7. Good practice

- Give each person their own login. Never share the owner account.
- Use the narrowest role that works. The audit log shows who did what.
- Regenerate a table QR if someone photographs it and orders remotely.
- Approve payment proofs only after checking your bank or wallet.
- Close the POS shift every day so cash differences are visible.
- Forgotten staff password: set a new one from the person's Staff entry. Signing in again is then required on every device.
