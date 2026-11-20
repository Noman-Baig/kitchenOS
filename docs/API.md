# API Reference

Base path: **`/api/v1`**. Requests and responses are JSON unless noted. In production the API is reached through the web domain (`https://app.example.com/api/v1/...`).

## Conventions

| Topic | Rule |
|---|---|
| Staff and Super Admin auth | HttpOnly session cookie `um_sid`, issued by `POST /auth/login` |
| CSRF | Every state-changing request from a signed-in browser must send header `x-csrf-token` with the value of the `um_csrf` cookie (also returned by `/auth/login` and `/auth/me`) |
| Guest auth | Header `x-customer-session: <token>` (from QR or online session start) or the HttpOnly cookie `um_cust` |
| Money | Decimal **strings** (`"12.5000"`). Never send floats. Clients may display prices, but the server recalculates every amount. |
| Time | ISO-8601 UTC. Report ranges use the restaurant's timezone (`preset=today\|yesterday\|week\|month\|year\|custom&from=YYYY-MM-DD&to=YYYY-MM-DD`). |
| Paging | `?page=1&pageSize=25` (max 200). Responses: `{ data, page, pageSize }` |
| Idempotency | Order submission, additions, POS sales, payments and refunds accept `idempotencyKey` in the body. A repeated key returns the original result. |
| Errors | `{ "error": { "code": "VALIDATION", "message": "...", "details": { "fieldErrors": { ... } } } }` with the matching HTTP status: 400 validation, 401 unauthenticated, 402 restaurant unavailable or suspended, 403 permission or CSRF, 404 not found or other tenant, 409 conflict, 429 rate limited |
| Rate limits | 600 requests/min per IP overall. Login is limited to 20 per 15 minutes, registration to 10 per hour, password reset to 8 per hour. |

Health: `GET /api/health` returns `{ status, db, time }`.

## Auth: `/auth`

| Method | Path | Notes |
|---|---|---|
| POST | `/login` | `{ email, password }`. Accounts lock after `MAX_FAILED_LOGINS`. |
| POST | `/logout` | |
| GET | `/me` | Current user, permissions, restaurant, availability, pending agreement |
| POST | `/register` | Restaurant sign-up with the owner account and a signed agreement (`signatureDataUrl`) |
| POST | `/change-password` | `{ currentPassword, newPassword }`; signs out the user's other sessions |
| POST | `/forgot-password` | `{ email }`. The response is always the same; it emails a 60-minute single-use link when SMTP is set. |
| POST | `/reset-password` | `{ token, password }`; revokes all of the user's sessions |
| GET / DELETE | `/sessions`, `/sessions/:id` | List or revoke your own sessions |

## Public and guest: `/public`

| Method | Path | Purpose |
|---|---|---|
| GET | `/branding`, `/plans`, `/agreement/current` | Platform branding, public plans, current agreement text |
| POST | `/demo-requests` | Contact form |
| GET | `/restaurants/:slug`, `/restaurants/:slug/menu`, `/domain/:host` | Storefront data (published theme only) |
| GET | `/qr/:token` | Resolve a table QR: table, restaurant, open session state |
| POST | `/qr/:token/session` | Start or join a table session (`{ name, phone?, pin?, recoverOnly? }`); returns the session token |
| POST | `/restaurants/:slug/online-session` | Start an online pickup or delivery session |
| POST | `/session/resume` | Resume from the stored cookie or device token |
| GET | `/` (with session) | Current session, orders, bill summary |
| GET | `/menu` | Live menu for the session's restaurant |
| POST | `/orders` | Submit an order: `{ items:[{ itemId, variantId?, addonIds?, qty, notes? }], idempotencyKey }` |
| PATCH | `/orders/:orderId` | Edit inside the edit window |
| POST | `/orders/:orderId/additions` | Add items after the window |
| GET | `/bill` | Itemized bill with each tax |
| POST | `/payments` | Multipart: method plus proof image (status stays *pending* until staff approve) |
| POST | `/cash-request`, `/support`, `/feedback` | Ask for cash collection, a waiter or billing help; leave feedback |
| GET / POST | `/chat` | Guest chat |
| GET | `/ice-servers` | STUN/TURN with short-lived credentials for calls |
| POST | `/restaurants/:slug/reservations` | Booking from the website |

## Files: `/files`

`GET /files/:publicId`. Public images (menu, logo) are served directly. Private files (payment proofs, agreement PDFs, exports) need a signed link (`?exp=&sig=`, valid for 5 minutes) issued by an authorized endpoint.

## Restaurant: `/r` (staff session, tenant from the session, permission-checked)

Generic CRUD (`GET /x`, `GET /x/:id`, `POST /x`, `PATCH /x/:id`, `DELETE /x/:id`, tenant-scoped, soft delete where history matters):
`/branches`, `/roles`, `/taxes`, `/payment-methods`, `/printers`, `/stations`, `/categories`, `/items`, `/tables`, `/ingredients`, `/suppliers`, `/recurring-expenses`, `/customers`, `/coupons`, `/waitlist`.

| Area | Endpoints |
|---|---|
| Core | `GET /dashboard`, `GET/PATCH /settings`, `POST /uploads/:category`, `GET /website`, `PUT /website/draft`, `POST /website/publish`, `GET /permissions`, `GET/POST/PATCH /staff`, `GET /qr/wifi`, `GET /qr/online`, `GET /subscription`, `POST /subscription/payments`, `GET /agreements`, `POST /agreements/accept`, `GET /notifications`, `POST /notifications/read`, `GET /audit-logs`, `POST /export`, `GET /export/:id`, `GET /defaults/roles` |
| Menu | `GET /menu`, `GET /items/:id/full`, `POST /items/:id/availability`, variants `POST/PATCH/DELETE /items/:itemId/variants[/:id]`, add-ons `POST/DELETE /items/:itemId/addons[/:id]` |
| Tables & QR | `GET /tables-overview`, `GET /tables/:id/qr?format=json\|png\|svg` (svg default), `POST /tables/:id/qr/regenerate`, `POST /tables/:id/qr/block`, `POST /qr/online/regenerate`, `POST /tables/:id/close-session` |
| Orders | `GET /orders`, `GET /orders/:id`, `POST /orders` (waiter/staff), `POST /orders/:id/additions`, `POST /orders/:id/status`, `POST /order-items/:id/cancel`, `POST /order-items/:id/complimentary` |
| Kitchen | `GET /kitchen/tickets?stations=1,2`, `POST /kitchen/tickets/:id/status`, `POST /kitchen/tickets/:id/priority` |
| Waiter & support | `GET/POST /tasks`, `POST /tasks/:id/status`, `GET /support`, `POST /support/:id/status`, `GET /chats`, `GET/POST /chats/:sessionId`, `GET /calls`, `GET /ice-servers` |
| Billing | `GET /bills`, `GET /bills/:id`, `POST /bills/:id/adjust` (discount, coupon, optional taxes), `POST /bills/:id/split-preview`, `POST /bills/:id/payments`, `GET /payments/pending`, `POST /payments/:id/approve`, `POST /payments/:id/reject`, `POST /bills/:id/close`, `POST /bills/:id/refund`, `POST /bills/:id/void`, `GET /bills/:id/receipt?format=json\|text\|escpos\|pdf&width=24–64&encoding=cp437\|cp858\|utf8&drawer=1` |
| POS | `POST /pos/quote`, `POST /pos/sales`, `GET /pos/held`, `POST /pos/held/:id/resume`, `DELETE /pos/held/:id`, `GET /pos/shift`, `POST /pos/shift/open`, `POST /pos/shift/close`, `GET /printers/test-page`, `POST /printers/:id/status` |
| Discrepancies | `GET/POST /discrepancies`, `POST /discrepancies/:id/classify` |
| Inventory | `GET /inventory/low-stock`, `GET /inventory/movements`, `POST /inventory/adjust`, `POST /inventory/transfer`, `POST /inventory/returns`, `GET/PUT /recipes/:itemId`, `GET/POST /purchases`, `GET /purchases/:id`, `GET/POST /wastage`, `POST /wastage/:id/approve\|reject` |
| Finance | `GET/POST /expenses`, `DELETE /expenses/:id`, `GET /payroll`, `POST /payroll/generate`, `POST/PATCH /payroll[/:id]`, `POST /payroll/:id/advance`, `POST /payroll/:id/pay` |
| Customers | `GET /customers/:id/history`, `POST /customers/:id/anonymize`, `POST /customers/:id/loyalty`, `GET /marketing/audience` (opted-in only) |
| Reservations & feedback | `GET/POST /reservations`, `PATCH /reservations/:id`, `GET /feedback`, `PATCH /feedback/:id` |
| Reports | `GET /reports` (catalogue), `GET /reports/:key?preset=&from=&to=&branchId=&userId=&method=&orderType=&categoryId=&itemId=&format=json\|pdf\|xlsx`, `GET /ledger/health`, `GET /ledger/pnl` |

Report keys: `sales, revenue, expenses, pnl, cash, reconciliation, tax, inventory, valuation, purchases, food_cost, recipe_profitability, wastage, complimentary, payroll, employees, customers, loyalty, reservations, orders, kitchen, branches`.

## Platform: `/platform` (Super Admin only)

`GET /overview` · `GET/POST /restaurants` · `GET/PATCH /restaurants/:id` · `GET /restaurants/:id/orders` · `POST /restaurants/:id/approve|reject|suspend|reactivate` · `POST /restaurants/:id/deletion` · `POST /restaurants/:id/export` · `POST /restaurants/:id/users/:userId/reset-link` · `GET /subscription-payments` · `POST /subscription-payments/:id/approve|reject` · `GET/POST/PATCH /plans` · `GET /settings` · `PUT /settings/branding|subscription|automations` · `POST /settings/branding/logo|favicon` · `GET/POST /agreements` · `GET /agreements/:id` · `POST /agreements/:id/make-current` · `GET /reports` · `GET /audit-logs` · `GET /backups` · `POST /backups/run` · `GET /backups/:id/download` · `GET /jobs` · `GET/PATCH /demo-requests` · `GET /notifications` · `POST /notifications/read`.

## Realtime (Socket.IO)

Connect to path **`/realtime`** on the web origin.
- Staff are authenticated by their session cookie.
- Guests pass `auth: { customerToken }`.

Rooms are joined on the server side according to permissions, so a client cannot subscribe to another tenant.

| Event (server → client) | Audience |
|---|---|
| `order:new`, `order:updated`, `order:edited` | Staff with `orders.view`; the guest's own session |
| `kds:ticket` | Kitchen stations (`kds:subscribe` with station ids) |
| `bill:updated`, `payment:rejected` | Billing staff; the guest session |
| `menu:updated`, `restaurant:ordering` | Everyone viewing that restaurant's menu |
| `table:session`, `session:closed` | Staff; the guest session |
| `task:new`, `task:updated`, `support:updated` | Waiters and support handlers |
| `chat:message`, `chat:typing` | The guest session and support staff |
| `call:incoming`, `call:accepted`, `call:signal`, `call:ended`, `call:cancelled` | Call receivers and the calling guest |
| `notification` | User, restaurant (by permission) or platform |

Client to server: `kds:subscribe`, `chat:typing`, `call:start`, `call:answer`, `call:signal`, `call:hangup`, `call:failed`.

Every event carries an `eventId` and an `at` timestamp. After reconnecting, clients re-fetch their state through REST. The UI does this automatically.
