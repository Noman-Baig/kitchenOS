# Super Admin Guide

The Super Admin runs the platform. Super Admins sign in at `/login` and land on `/admin`. Super Admin accounts are created only from the server console (`createSuperAdmin`). They never belong to a restaurant.

## Daily checklist

1. **Overview**. Check these counts:
   - pending registrations
   - payment proofs waiting
   - restaurants in their grace period or expiring soon
   - failed jobs
   - the last backup
2. **Restaurants → Pending**. Approve or reject new registrations.
3. **Subscription payments**. Verify each uploaded payment proof against your bank or wallet, then approve or reject it.
4. **Backups & operations**. The last database and storage backups should show **verified**.

## Restaurants

| Action | Effect |
|---|---|
| **Register restaurant** | Creates an approved restaurant with an owner account. Use it for restaurants you onboard yourself. |
| **Approve** | Gives access to the restaurant dashboard. The owner is notified. |
| **Reject** | Records the reason and blocks access. |
| **Suspend** | The following stop immediately: staff sessions are revoked, QR and online ordering are blocked, and the storefront shows "temporarily unavailable". Guests' active orders remain visible to them for safety. Deletion is scheduled after the retention period. |
| **Reactivate** | Restores access and cancels the deletion countdown. |
| **Grace days / expiry / plan** | Per-restaurant overrides on the Subscription tab. |
| **Deletion** | After `dataRetentionDays` (default 90) a suspended or expired restaurant is queued for deletion. Deletion waits for your approval unless **auto-delete after retention** is on. An export is always taken first. |
| **Export data** | Downloads a JSON archive of all of the restaurant's records. Secrets and password hashes are removed. |
| **Reset password** (Staff tab) | Creates a single-use 24-hour reset link for any user of that restaurant. It is emailed automatically when SMTP is configured; otherwise copy it and send it through a trusted channel. |
| **Orders tab** | Read-only support view. Every view is logged in the audit trail. |

### Subscription lifecycle

```
pending ──approve──► active ──expiry──► grace (still works, banner + reminders) ──grace ends──► expired
   │                   ▲                                                                       │
   └──reject           └────────────── payment approved (extends from expiry or today) ◄────────┘
                       suspended (manual) ──reactivate──► active
expired/suspended ── retention days ──► deletion scheduled ──(approval or auto)──► deleted
```

Reminders are sent at the configured days before expiry (default 7, 3 and 1). The hourly sweep moves restaurants between states. All of this is configured under **Branding & settings → Subscription**:
- payment instructions
- bank and wallet accounts shown to restaurants
- default grace days
- trial days
- retention period

## Plans

Under **Plans** you create plans. Each plan has:
- a name, description and price in any ISO currency
- a duration in days (30 for monthly, 365 for yearly)
- the maximum number of branches
- a feature list, one line per feature, shown on the public pricing page

Deactivating a plan hides it from new sign-ups. Existing restaurants keep their plan until you change it.

## Agreements

- **Agreements** stores versioned service agreements. Restaurants sign at registration with a drawn signature, typed name and title. The signature, IP address, user agent, time and a SHA-256 hash of the exact text are stored, along with a generated PDF.
- If a PEM signing key is configured (see SECURITY.md), each acceptance is also signed with the platform key. The admin restaurant page shows "signed by platform".
- Publishing a new version as **material** asks every restaurant to accept it, through a banner on their dashboard. A non-material version is informational only.
- Never edit an accepted version. Create a new version instead. The system enforces this.

## Branding & settings

| Section | What it controls |
|---|---|
| Branding | Software name (shown everywhere, including "Powered by" on receipts and storefronts), logo, favicon, primary and secondary colours, support email and phone, business address, website, copyright and footer text, optional external Terms and Privacy URLs, email sender name and address |
| Subscription | Payment instructions, accounts, grace, trial, retention, auto-delete |
| Automations | On/off switches for every background job (sweeps, reminders, recurring expenses, payroll generation, reservation reminders, session expiry, cleanup, backups, scheduled deletion) |

### Legal pages

`/privacy` and `/terms` are complete, plain-language documents. They cover:
- the data collected from restaurants, staff and guests
- purposes and legal bases
- sharing, retention and deletion
- security, international transfers and user rights
- cookies
- subscription, payment and suspension terms
- acceptable use, liability and governing law

The operator name (software name), business address and contact details come from **Branding**. If you host your own legal texts elsewhere, set the external Terms and Privacy URLs. Before going live:

1. Fill in the software name, business address, support email and phone in Branding.
2. Have a qualified lawyer in your jurisdiction review the texts. If you need changes, edit `frontend/src/app/(marketing)/privacy/page.tsx` and `terms/page.tsx`, then rebuild.
3. Restaurants are the data controllers for their own guests. The platform is their processor. Each restaurant should publish its own guest privacy notice. The storefront footer links to the platform policy by default.

## Reports

**Admin → Reports** shows the following for a date range. You can filter by country, status, restaurant and currency.
- daily registrations
- subscription payments by status and currency
- restaurants by country and status
- the top 50 restaurants by bills and GMV
- active branches
- daily renewals
- platform usage (orders, guest sessions, active staff)

## Backups & operations

- Database and storage backups run daily at `BACKUP_HOUR_UTC`. Each backup is checksummed, test-read (`gunzip -t` / `tar -t`) and marked verified. Download them from this page. Use **Run backup now** before risky changes.
- The **Jobs** list shows every scheduled run with its status and error. Each run is locked against duplicates.
- The **Audit log** records:
  - logins and failed logins
  - approvals, rejections, suspensions and deletions
  - payment decisions
  - refunds, voids and discounts
  - role changes and data exports
- **Demo requests** collects submissions from the marketing site's contact form.

## Account security for Super Admins

- Use a long, unique password and sign out on shared computers. Changing your password signs out every other session.
- Each Super Admin should have their own account. Create additional accounts with the CLI.
- If you lose a Super Admin password, reset it on the server: `bash scripts/maintenance.sh reset-admin you@yourdomain.com`.
