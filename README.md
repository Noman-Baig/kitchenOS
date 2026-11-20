# Fixprob — Restaurant Operating System (SaaS)

A multi-tenant platform that runs a whole restaurant from one system: QR table ordering, online ordering, kitchen display, waiter app, POS, billing and taxes, inventory and recipe costing, reservations, loyalty, payroll, a double-entry ledger and 22 exportable reports. One **Super Admin** runs the platform. Many **restaurants** subscribe, and each has its own staff, roles, branches, data and website.

| Layer     | Technology                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------- |
| Web app   | Next.js 15 (App Router), React 19, TypeScript, plain-CSS design system                         |
| API       | Node.js 20+, Express, TypeScript (ESM), zod validation                                         |
| Database  | MySQL 8.0+ or MariaDB 10.6+ (InnoDB, utf8mb4)                                                  |
| Realtime  | Socket.IO at `/realtime`; optional Redis for several instances; WebRTC voice calls with TURN |
| Documents | PDFKit (receipts, agreements, reports), ExcelJS (Excel export), ESC/POS thermal printing       |

## Repository layout

```
umemaai_undated_version/
├── backend/            API, worker, CLI tools, tests (Vitest)
│   ├── src/lib         db, money (decimal), crypto, permissions, http helpers
│   ├── src/services    billing, ledger, orders, inventory, reports, agreements …
│   ├── src/routes      auth, public (guests), platform (super admin), r/* (restaurant)
│   ├── src/realtime    Socket.IO server + event bus
│   ├── src/jobs        scheduler (suspension, deletion countdown, reminders, backups)
│   └── tests           unit + end-to-end integration tests
├── frontend/           Next.js web app (marketing site, dashboards, guest app, storefronts)
│   └── src/content     in-app help guides (/help) and marketing copy
├── database/           SQL migrations (checksummed) and seed text
├── deployment/         nginx, pm2, systemd, coturn, Docker
├── scripts/            setup, backup, restore, signing keys, health check, print bridge
└── docs/               installation, deployment, API, database, security, guides
```

## Quick start (development)

```bash
# 1. Database
mysql -uroot -p -e "CREATE DATABASE umema CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER 'umema'@'localhost' IDENTIFIED BY 'choose-a-password';
  GRANT ALL ON umema.* TO 'umema'@'localhost';"

# 2. Configure
cp backend/.env.example backend/.env       # set DB_PASSWORD, FILE_SIGNING_SECRET; NODE_ENV=development, COOKIE_SECURE=false, APP_URL=http://192.168.100.198:3000
cp frontend/.env.example frontend/.env.local


# 3. Install, migrate, seed (with demo restaurant)
npm run install:all
npm --prefix backend run migrate
npm --prefix backend run seed -- --demo
npm --prefix backend run create-super-admin -- --email admin@example.com --name "Platform Admin"
demo pass is : Admin123@1New

# 4. Run (two terminals)
npm run dev:api      # http://192.168.100.198:4000
npm run dev:web      # http://192.168.100.198:3000
```

Open http://192.168.100.198:3000 and sign in as the Super Admin. The demo seed prints the demo owner's login.

## Production

Read **[docs/INSTALLATION.md](docs/INSTALLATION.md)** and **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. In short:

```bash
bash scripts/setup.sh                            # install, build, migrate, seed
cd backend && node dist/cli/createSuperAdmin.js --email you@yourdomain.com
pm2 start deployment/pm2/ecosystem.config.cjs    # api + worker + web
# nginx: deployment/nginx/umemaai.conf   •   Docker: deployment/docker/docker-compose.yml
bash scripts/healthcheck.sh https://app.yourdomain.com
```

## Documentation

| Document                                                              | For                                                                                 |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [INSTALLATION](docs/INSTALLATION.md)                                   | Server requirements and step-by-step install                                        |
| [DEPLOYMENT](docs/DEPLOYMENT.md)                                       | nginx/HTTPS, pm2/systemd, Docker, TURN, scaling, shared-hosting notes               |
| [ADMIN_GUIDE](docs/ADMIN_GUIDE.md)                                     | Super Admin operations: approvals, plans, payments, suspension, agreements, backups |
| [RESTAURANT_GUIDE](docs/RESTAURANT_GUIDE.md)                           | Restaurant owners and managers: setup to daily operations                           |
| [STAFF_GUIDE](docs/STAFF_GUIDE.md)                                     | Waiters, kitchen, cashiers                                                          |
| [CUSTOMER_GUIDE](docs/CUSTOMER_GUIDE.md)                               | Guests: scanning, ordering, paying, calling staff                                   |
| [API](docs/API.md)                                                     | REST and realtime reference                                                         |
| [DATABASE](docs/DATABASE.md)                                           | Schema, migrations, money and time conventions                                      |
| [SECURITY](docs/SECURITY.md)                                           | Security model, tenant isolation, keys, hardening checklist                         |
| [BACKUP_RESTORE](docs/BACKUP_RESTORE.md)                               | Backups, verification, restore rehearsal                                            |
| [TESTING](docs/TESTING.md)                                             | Running the test suites                                                             |
| [COMPATIBILITY_AND_LIMITATIONS](docs/COMPATIBILITY_AND_LIMITATIONS.md) | Browsers, printers, hardware, known limitations                                     |

The same how-to guides are built into the app at **/help**: for guests, restaurant admins, waiters, kitchen, POS, printers, inventory, finance and the Super Admin. The **Privacy Policy** (`/privacy`) and **Terms of Service** (`/terms`) are published on the marketing site. The operator name, address and contact details come from Super Admin → Branding & settings. Have a lawyer review both texts before launch (see [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md#legal-pages)).

## Principles built into the code

- **The browser is never trusted.** Prices, taxes, discounts, totals, stock and permissions are recalculated on the server.
- **Tenant isolation.** Every restaurant query is scoped by `restaurant_id` taken from the authenticated session, never from the request body.
- **Exact money.** All amounts are DECIMAL in MySQL and use decimal.js in code. Floating-point numbers are never used for money.
- **Audit trail.** Sensitive actions (refunds, voids, discounts, payment approvals, role changes, suspensions) are written to `audit_logs`.
- **No secrets in the repository.** Only `.env.example` files are shipped. Private signing keys live outside the project directory.

## License

Proprietary. All rights reserved by the platform operator.
