# Deployment

## Architecture

```
            Internet (HTTPS 443)
                   │
               ┌───▼───┐
               │ nginx │  TLS, HTTP/2, gzip, upload limit, WebSocket upgrade
               └┬──┬──┬┘
     /api/*     │  │  │ /realtime (WebSocket)       everything else
   ┌────────────▼┐ │ ┌▼────────────┐            ┌──────────────┐
   │ umema-api   │◄┘ │ umema-api   │            │ umema-web    │ Next.js :3000
   │ Express:4000│   │ Socket.IO   │            │ SSR + static │
   └──────┬──────┘   └─────┬───────┘            └──────────────┘
          │  ┌─────────────┘ (optional Redis adapter / emitter)
   ┌──────▼──▼──┐   ┌──────────────┐   ┌──────────────┐
   │  MySQL 8   │   │ umema-worker │   │   coturn     │ TURN for voice calls
   └────────────┘   │ jobs, backups│   │ 3478 / 5349  │
                    └──────────────┘   └──────────────┘
```

- The Next.js server also rewrites `/api/*` and `/realtime` to the API. A bare `next start` behind any proxy therefore works for HTTP. The Next server does **not** proxy WebSocket upgrades: Socket.IO falls back to long-polling there. For real WebSockets, route `/realtime` directly to port 4000 in nginx. The supplied config already does this.
- Uploaded files are stored under `STORAGE_DIR` (default `backend/storage`) and are always served through the API, using signed short-lived links for private files. Never expose that directory directly in nginx.

## Option A: single server with pm2 (recommended to start)

```bash
npm i -g pm2
pm2 start deployment/pm2/ecosystem.config.cjs
pm2 save && pm2 startup
pm2 logs umema-api
```

If you do not run Redis, set `RUN_WORKER_IN_API=true` in `backend/.env` and remove or stop `umema-worker`. Jobs then run inside the API process and their live notifications reach browsers directly. With Redis, keep `RUN_WORKER_IN_API=false` and run the worker.

## Option B: systemd

Use the units in `deployment/systemd/`. Edit `User=`, `WorkingDirectory=` and `EnvironmentFile=`, then run:

```bash
sudo cp deployment/systemd/umema-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now umema-api umema-web umema-worker
journalctl -u umema-api -f
```

## Option C: Docker Compose

```bash
cd deployment/docker
cp ../../backend/.env.example ../../backend/.env     # edit it; DB_HOST=mysql, REDIS_URL=redis://redis:6379
export MYSQL_ROOT_PASSWORD=... DB_PASSWORD=...      # or put them in deployment/docker/.env
docker compose up -d --build
docker compose exec api node dist/cli/migrate.js
docker compose exec api node dist/cli/seed.js
docker compose exec api node dist/cli/createSuperAdmin.js --email you@yourdomain.com
```

The stack contains `mysql`, `redis`, `api`, `worker`, `web` and a small nginx. Persistent volumes hold the database, Redis and uploads/backups. Put TLS in front with a host nginx or Caddy, or extend `nginx.docker.conf` with your certificates.

## nginx

`deployment/nginx/umemaai.conf`:
- Redirects HTTP to HTTPS.
- Proxies `/api/` and `/realtime` (with `Upgrade` headers and long timeouts) to `:4000`, and everything else to `:3000`.
- Sets `client_max_body_size 12m` and passes `X-Forwarded-*` headers.

Keep `TRUST_PROXY=1` so rate limits and audit logs see the real client IP.

The API refuses plain HTTP in production unless the proxy reports `X-Forwarded-Proto: https`. Cookies are `Secure`, `HttpOnly` and `SameSite=Lax`.

### Restaurant custom domains

Restaurants can enter a custom domain under **Dashboard → Website**. To serve it:

1. The restaurant points a DNS `A`/`CNAME` record to your server.
2. Add the domain to `server_name` and obtain a certificate (`certbot --nginx -d menu.theirdomain.com`).
3. Add the domain to `CORS_ORIGINS` and restart the API.

The app resolves the host through `/api/v1/public/domain/:host` and renders that restaurant's storefront.

## Voice calls (WebRTC) and TURN

Guests can call staff from the table app. Calls are peer-to-peer WebRTC and the API relays only the signaling.
- STUN alone works on many Wi-Fi networks.
- Mobile carriers and corporate NATs need **TURN**.

1. Install coturn: `sudo apt install coturn`.
2. Use `deployment/coturn/turnserver.conf`. Set `realm`, `static-auth-secret` (the same value as `TURN_SECRET`), `external-ip` and the certificate paths.
3. Open the firewall: 3478/udp+tcp, 5349/tcp and the relay range 49152–65535/udp.
4. In `backend/.env`, set:
   - `TURN_URLS=turn:turn.yourdomain.com:3478?transport=udp,turn:turn.yourdomain.com:3478?transport=tcp,turns:turn.yourdomain.com:5349?transport=tcp`
   - `TURN_SECRET=<same secret>`

The API issues time-limited TURN credentials (REST API scheme) to authenticated staff and to active guest sessions only. If no TURN server is configured, calls still try STUN. If a call cannot connect, guests can always fall back to chat or "Call waiter".

## Scaling

| Load | Setup |
|---|---|
| 1–50 restaurants | One VM: nginx + api + web (+ worker) + MySQL |
| 50–300 | Managed MySQL, 2+ API instances with `REDIS_URL`, sticky sessions (`ip_hash`) for `/realtime`, a separate worker |
| 300+ | Also: read replica for reports, object storage sync for `storage/`, a CDN for `/_next/static` |

Jobs (suspension, deletion countdown, reminders, recurring expenses, backups) use database locks (`GET_LOCK`) and a unique `job_runs.run_key`. Running more than one worker never executes a job twice.

## Shared hosting assessment

| Hosting type | Works? | Notes |
|---|---|---|
| Classic shared PHP hosting (cPanel without Node) | **No** | Needs a long-running Node process, WebSockets and a background worker |
| cPanel "Setup Node.js App" (Passenger) | Partially | API and web can run, but WebSockets are often blocked (polling fallback still works), there is no worker (set `RUN_WORKER_IN_API=true`), `mysqldump` backups may be blocked and `sharp` may not install. Suitable for a demo only. |
| Hostinger / similar **VPS** (KVM 2 or higher) | **Yes** | Recommended low-cost option. Follow Option A. |
| PaaS (Render, Railway, Fly.io) | Yes | Run api, web and worker as three services. Use managed MySQL and Redis and a persistent volume for `storage/`. |

## Post-deploy checklist

- [ ] `bash scripts/healthcheck.sh https://your-domain` is all OK.
- [ ] Software name, business address and support email are set in Branding (the legal pages use them).
- [ ] SMTP test: use **Forgot password** on `/login` for your own account. The reset email should arrive within a minute.
- [ ] A backup has run and is marked **verified** in Admin → Backups & operations. An off-site copy is configured.
- [ ] A test call between two phones on mobile data works (TURN).
- [ ] The firewall allows only 22, 80 and 443, plus the TURN ports if you use TURN.
- [ ] `backend/.env` has permissions 600 and is owned by the service user.
