# Security

## Model

| Threat | Control |
|---|---|
| Tampered prices or totals from the browser | The server re-prices every order, addition, POS sale and bill from the database: price, variant, add-ons, tax rules, discount and coupon limits. Client amounts are ignored. |
| Cross-tenant access | `restaurant_id` always comes from the authenticated session (staff) or from the guest session row (guests), never from the request. Every query filters by it. Requests for another tenant's ids return 404. Integration tests check isolation for every resource type. |
| Privilege escalation | Permission checks on every route (`requirePerm`). Users can grant only the permissions they hold. Owner and super-admin flags cannot be set through the API. |
| Session theft | Opaque random 256-bit tokens; only the SHA-256 is stored. Cookies are HttpOnly, Secure and SameSite=Lax. Idle and absolute expiry apply. Sessions are revoked on password change, password reset, role change, deactivation and suspension. |
| CSRF | Double-submit token (`um_csrf` cookie with the `x-csrf-token` header), compared in constant time, on every state-changing request |
| Brute force | Per-IP rate limits. The account locks after `MAX_FAILED_LOGINS` for `LOCK_MINUTES`. Unknown accounts take the same time to answer (dummy argon2 verify). |
| Passwords | argon2id (19 MiB, t=2), at least 10 characters with letters and digits, automatic rehash. Reset links are single-use, hashed at rest, expire after 60 minutes (24 hours when issued by an admin) and give the same response for unknown emails. |
| QR abuse | Random unguessable tokens. Regenerate or block per table. Joining an occupied table requires the table PIN. Sessions end when the bill closes or after the idle timeout. |
| Uploads | Size limit; magic-byte type detection (`file-type`), not the file extension; images re-encoded by sharp (strips EXIF/GPS and payloads); dimension limits; random names; stored outside the web root; private files only through 5-minute HMAC-signed links |
| XSS | React escaping; no `dangerouslySetInnerHTML` with user content; theme values validated (colours, fonts and URLs whitelisted); strict security headers (helmet on the API; `X-Frame-Options SAMEORIGIN`, `nosniff`, `Referrer-Policy` and `Permissions-Policy` on the web) |
| SQL injection | Parameterized queries only. Dynamic column lists come from fixed allow-lists. |
| Replay / double submit | `idempotencyKey` on orders, payments, POS sales and refunds; row locks (`SELECT … FOR UPDATE`) around bill close, payments and stock |
| Payment fraud | Uploaded proofs are never treated as paid until a permitted staff member approves them. Every approve or reject is audited. |
| Repudiation | `audit_logs` records actor, IP, user agent, before and after values, and reasons for sensitive actions. Agreement acceptances store a content hash, signature image, IP and time, plus an optional platform PEM signature. |
| Print bridge | Listens only on 127.0.0.1; forwards only to RFC1918 / link-local addresses on whitelisted ports |
| TURN | Time-limited HMAC credentials only for authenticated staff or active guest sessions; no static TURN users |

## Secrets

- The repository ships only `.env.example`. Keep `backend/.env` at `chmod 600`, owned by the service user.
- `FILE_SIGNING_SECRET` must be 32+ random characters. The API refuses to start in production without it, and also requires `APP_URL` to be https.
- **Platform signing key (optional):**
  - Create it with `bash scripts/generate-signing-key.sh /etc/umemaai/keys platform-key-YYYY-MM`.
  - Store the private key **outside** the project directory with mode 600 and an offline backup. It is never logged, returned by the API or included in exports or backups.
  - **Rotation:** generate a new key id, then point `PLATFORM_SIGNING_KEY_PATH` and `PLATFORM_SIGNING_KEY_ID` at it. Keep the old public key in `PLATFORM_PUBLIC_KEYS_DIR` so old signatures still verify.
  - **Revocation:** create `<public dir>/<key-id>.revoked`. Verification of that key's signatures then fails.
- Restaurant Wi-Fi passwords and similar values are removed from exports and from Super Admin API responses.

## Privacy features

- Guests need only a name. Recognition and marketing are opt-in.
- `POST /r/customers/:id/anonymize` erases a guest's personal data while keeping the financial records.
- Restaurants can export all of their data. Deletion follows the retention policy, and a final export is kept as a backup.
- Super Admin views of restaurant orders are themselves audited.

## Hardening checklist

- [ ] HTTPS only (HSTS is set by nginx). `COOKIE_SECURE=true`.
- [ ] Firewall: only 22, 80 and 443 (and the TURN ports). MySQL and Redis bound to localhost or a private network.
- [ ] The database user has privileges on its own schema only.
- [ ] Unique Super Admin accounts. Remove accounts that are no longer needed.
- [ ] Off-site, encrypted backups, with a restore rehearsed quarterly.
- [ ] OS security updates enabled (`unattended-upgrades`). Run `npm audit` on each release.
- [ ] Log rotation for pm2 or journald.
- [ ] The legal pages have been reviewed for your jurisdiction.

## Reporting vulnerabilities

Send reports to the support email configured in Branding. Include the steps to reproduce. Do not test against other tenants' data.
