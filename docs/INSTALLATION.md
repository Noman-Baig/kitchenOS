# Installation

## 1. Requirements

| Component | Minimum | Recommended |
|---|---|---|
| OS | Any Linux with Node 20 | Ubuntu 22.04/24.04 LTS |
| CPU / RAM | 2 vCPU / 2 GB | 4 vCPU / 8 GB (about 50 busy restaurants) |
| Disk | 20 GB SSD | 80 GB+ SSD. Uploads and backups grow over time. |
| Node.js | 20.11 | 22 LTS |
| Database | MySQL 8.0 or MariaDB 10.6 | MySQL 8.0/8.4 on the same host or a managed instance |
| Reverse proxy | nginx 1.18+ | nginx with HTTP/2 and Let's Encrypt |
| Optional | Redis 6+ | Needed for several API instances, or a separate worker that pushes live events |
| Optional | coturn 4.5+ | Needed for reliable voice calls on mobile networks |
| Optional | SMTP account | For password reset, reminders and receipts by email |

Required packages: `mysql-client` (it provides `mysqldump` for backups), `openssl`, `curl`, `tar` and `gzip`. The `sharp` image library ships prebuilt binaries for x64 and arm64 Linux.

## 2. Create the database

```sql
CREATE DATABASE umema CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'umema'@'localhost' IDENTIFIED BY 'a-long-random-password';
GRANT ALL PRIVILEGES ON umema.* TO 'umema'@'localhost';
FLUSH PRIVILEGES;
```

Use UTC on the server. All timestamps are stored in UTC. Each restaurant's own timezone is used for display and for report periods.

## 3. Get the code and configure it

```bash
sudo mkdir -p /opt && cd /opt
unzip umemaai_undated_version.zip && cd umemaai_undated_version
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.production
nano backend/.env
```

Set these values in `backend/.env`:

- `APP_URL`: your public HTTPS address, for example `https://app.yourdomain.com`.
- `CORS_ORIGINS`: the same address, plus any restaurant custom domains.
- `DB_*`: the database credentials from step 2.
- `FILE_SIGNING_SECRET`: generate it with `openssl rand -base64 48`. `setup.sh` fills it in if you leave it empty.
- `SMTP_*`: optional.
- `TURN_*`: optional (see DEPLOYMENT.md).
- `REDIS_URL` or `RUN_WORKER_IN_API`: choose one:
  - On a single server **without Redis**, set `RUN_WORKER_IN_API=true` and do not start the separate worker. Live notifications from scheduled jobs then reach browsers directly.
  - **With Redis**, set `REDIS_URL` and run the worker as its own process.

In `frontend/.env.production`, set `NEXT_PUBLIC_SITE_URL` to the same public address.

## 4. Install, build and migrate

```bash
bash scripts/setup.sh
```

The script does the following:

1. Checks the Node version.
2. Installs dependencies with `npm ci` for both apps.
3. Builds the API (`backend/dist`) and the web app (`frontend/.next`).
4. Creates `backend/storage`.
5. Applies `database/migrations/*.sql`. Each migration is recorded with a checksum, and an edited migration is refused.
6. Seeds the base data: default plans, platform settings and Agreement v1.

## 5. Create the Super Admin

```bash
cd backend
node dist/cli/createSuperAdmin.js --email you@yourdomain.com --name "Your Name"
# the password is prompted (hidden), or set SUPER_ADMIN_PASSWORD for non-interactive use
```

There is no public sign-up for Super Admins. Running the same command again for an existing Super Admin resets the password and signs out all of that admin's sessions.

## 6. Start the services

Use **one** of these options:

- `pm2 start deployment/pm2/ecosystem.config.cjs && pm2 save && pm2 startup`
- systemd: copy `deployment/systemd/*.service` to `/etc/systemd/system/`, adjust the paths and user, then run `systemctl enable --now umema-api umema-web` (and `umema-worker` if you run it separately).
- Docker: `cd deployment/docker && docker compose up -d --build` (see DEPLOYMENT.md).

Default ports:
- API and realtime on `127.0.0.1:4000`
- Web on `127.0.0.1:3000`

Expose only nginx on ports 80 and 443.

## 7. nginx and HTTPS

```bash
sudo cp deployment/nginx/umemaai.conf /etc/nginx/sites-available/umemaai.conf
sudo sed -i 's/app.example.com/app.yourdomain.com/g' /etc/nginx/sites-available/umemaai.conf
sudo ln -s /etc/nginx/sites-available/umemaai.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d app.yourdomain.com
sudo nginx -t && sudo systemctl reload nginx
```

## 8. Verify

```bash
bash scripts/healthcheck.sh https://app.yourdomain.com
```

Then:

1. Sign in at `/login` with the Super Admin account.
2. Fill in **Admin → Branding & settings**: software name, business address, support email and phone, and logo. The legal pages and emails use these values.
3. Check the plans under **Admin → Plans** and the payment instructions under **Admin → Branding & settings → Subscription**.
4. Register a test restaurant from `/register`, approve it under **Admin → Restaurants**, and follow the [Restaurant Guide](RESTAURANT_GUIDE.md).

## Optional: demo data

`node backend/dist/cli/seed.js --demo` creates "Demo Bistro" with the following:
- Menu, tables and staff for every role. The generated password is printed once.
- Inventory, recipes and sample orders.

Do not run the demo seed on a production database that real customers use.

## Updating to a new release

```bash
bash scripts/backup.sh                 # always back up first
# replace the code (keep backend/.env, frontend/.env.production and backend/storage)
bash scripts/maintenance.sh update     # ci + build + migrate + reload
```
