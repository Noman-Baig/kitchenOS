# Testing

## Backend (Vitest)

```bash
cd backend
cp .env.example .env    # dev values: NODE_ENV=development, COOKIE_SECURE=false, DB_* pointing at a local MySQL/MariaDB
npm test                # unit + integration (58 tests)
npm run test:unit
npm run test:integration
npm run typecheck
```

The integration tests create and migrate a throwaway database, **`umema_test`**, on the server configured in `backend/.env` (`tests/globalSetup.ts`). The DB user needs `CREATE`/`DROP` rights on that schema. Files go to `storage-test/`.

### Coverage

| Suite | What it proves |
|---|---|
| `unit/billCalc` | Inclusive and exclusive taxes, fixed and percentage, category, item and order-type scoping, optional taxes, discounts and coupon caps, rounding, split equally, by items or custom (sums always equal the total) |
| `unit/misc` | Timezone report ranges (including half-hour zones), order status transitions, least-privilege roles, signed file URLs and expiry, Ed25519 agreement signing and tamper detection, receipt width, ESC/POS commands, code-page encoding and drawer kick |
| `integration/e2e` (32) | Full lifecycle: registration with signed agreement, approval, subscription proof, branding, menu, taxes, recipes, stock, QR session, table PIN, server-side pricing (client prices ignored), idempotent submit, edit window, additions, live availability, kitchen flow and stock deduction, payment proof review, ledger balance and P&L, session re-scan, feedback, POS split sale (idempotent), hold and resume, online pickup, waiter orders, wastage approval, cancellation reversal, discrepancies, **tenant isolation for every resource**, CSRF, QR regeneration, account lock, password reset, suspension and reactivation, the expiry sweep, duplicate-safe jobs, verified backups, data export with secrets removed |
| `integration/realtime` (5) | Unauthenticated sockets rejected, order events to staff and status events to the guest (with event ids), reconnect and resync, WebRTC call signaling relay with call records, outsiders cannot inject call signals |

## Frontend

```bash
cd frontend
npm run typecheck
rm -rf .next && npm run build    # a production build fails on type or route errors
```

### Manual acceptance (about 20 minutes)

Run the API and web locally with `seed --demo`, then check each item:

1. `/` landing, `/pricing`, `/help`, `/privacy` and `/terms` render, and `/sitemap.xml` lists them.
2. Super Admin: approve a new registration, approve a payment proof, change the software name. The new name appears on the landing page within a minute.
3. Owner: create a tax, an item with a variant and add-on, a table. Open the table QR link on a phone.
4. Guest phone: order. The order appears instantly in **Orders**. Accept it and see it on the **Kitchen display**. Start, then Ready; the waiter sees it under Ready. Mark served. The guest status updates live at each step.
5. Guest: open the help button, then chat, then voice call (on two devices). Staff answer.
6. Guest: upload a payment proof. Approve it under **Payment approvals**. The bill shows as paid.
7. POS: open a shift, sell with split cash and card, print a receipt (browser print), close the shift.
8. Reports: Sales and P&L as PDF and Excel. The totals match the bills.
9. Turn Wi-Fi off on the guest phone for a moment. The badge shows Reconnecting, then resyncs.
