# First production launch (Git + Docker + local Postgres)

This is a **clean first install**. Production uses **Postgres in Docker** on the same server. The browser is only the UI.

Repo: https://github.com/Akab-Informatique/Portail-Construction

## 0. Server prerequisites

Ubuntu / Debian:

```bash
sudo apt update
sudo apt install -y git ca-certificates curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Log out and back in so the `docker` group applies. Confirm:

```bash
docker --version
docker compose version
```

Open host port **8080** (or change `PORT` later).

## Wipe production for a clean slate

A normal `update.sh` **keeps** Postgres data. Demo clients/projects stay until you reset.

**Preferred (keep the volume, wipe rows only):**

```bash
cd /opt/frx-portal
sudo bash scripts/update.sh
sudo bash scripts/reset-data.sh
```

Type `RESET` when asked. You get only:

- Email: `admin@frxconstruction.ca`
- Password: `admin123`

Sign in, create your real admin, then delete this default account.

**Nuclear (delete the whole Postgres volume):**

```bash
cd /opt/frx-portal
sudo docker compose down -v
sudo bash scripts/update.sh
```

Do **not** run `down -v` for a normal update.

## 1. Remove any previous broken install

Only do this if you want a **true first launch**. This deletes the old Postgres volume.

```bash
sudo docker compose -f /opt/frx-portal/docker-compose.yml down -v || true
sudo rm -rf /opt/frx-portal
```

## 2. Clone

```bash
sudo git clone --branch main https://github.com/Akab-Informatique/Portail-Construction.git /opt/frx-portal
cd /opt/frx-portal
```

Private repo: Git will ask for your username and a personal access token.

## 3. Create `.env` from the sample

```bash
sudo cp /opt/frx-portal/.env.sample /opt/frx-portal/.env
sudo nano /opt/frx-portal/.env
```

Required values (password must match in **both** places):

```
PORT=8080
GIT_BRANCH=main
POSTGRES_DB=frx
POSTGRES_USER=frx
POSTGRES_PASSWORD=<strong unique password>
DATABASE_URL=postgres://frx:<same-password>@db:5432/frx
SESSION_SECRET=<long random string>
SHAREPOINT_CLIENT_SECRET=
```

`db` in `DATABASE_URL` is the Docker service name. Do not use `localhost`.

## 4. Build and start

```bash
cd /opt/frx-portal
sudo bash scripts/install.sh
```

Or:

```bash
cd /opt/frx-portal
sudo docker compose up -d --build
```

Wait until both services are healthy:

```bash
sudo docker compose -f /opt/frx-portal/docker-compose.yml ps
```

You should see `db` (healthy) and `app` (running).

## 5. Sign in

Open:

```
http://<server-ip>:8080
```

Hard-refresh the page. Use:

| Role | Email | Password |
|---|---|---|
| Admin | admin@frxconstruction.ca | admin123 |
| Project manager | marc@frxconstruction.ca | frx123 |
| Client | sophie@nordique.com | client123 |

These three accounts are created (or reset) automatically in Postgres on first API use.

## 6. Later updates (keeps Postgres data)

```bash
sudo bash /opt/frx-portal/scripts/update.sh
```

Never run `docker compose down -v` unless you intend to wipe the database.

## Login fails / no users after an update

Postgres keeps the password from the **first** time the volume was created. If `.env` later got a new `POSTGRES_PASSWORD`, the app cannot open the existing database, so login looks empty.

1. Put the **original** password back in `/opt/frx-portal/.env` (`POSTGRES_PASSWORD` and the password in `DATABASE_URL` must match).
2. Then:

```bash
cd /opt/frx-portal
sudo docker compose up -d
```

Do **not** run `docker compose down -v` unless you intend to wipe all users.

## Fix: `SESSION_SECRET is missing a value`

Compose interpolates `.env` before the container starts. An empty `SESSION_SECRET=` line is treated as missing.

On the server:

```bash
cd /opt/frx-portal
sudo bash scripts/ensure-env.sh
sudo docker compose up -d --build
```

That script fills a blank `SESSION_SECRET` (and a blank `POSTGRES_PASSWORD`) without overwriting values you already set.

Or set it by hand:

```bash
sudo nano /opt/frx-portal/.env
# SESSION_SECRET=<paste output of: openssl rand -hex 32>
sudo docker compose -f /opt/frx-portal/docker-compose.yml up -d
```

## Troubleshooting

```bash
sudo docker compose -f /opt/frx-portal/docker-compose.yml logs --tail=100 app
sudo docker compose -f /opt/frx-portal/docker-compose.yml logs --tail=50 db
curl -s http://127.0.0.1:8080/healthz
```

Password auth failed to Postgres usually means `.env` was changed after the volume was created. Either put the **original** password back, or wipe and reinstall from step 1.

## After deploying the security update (Oct 2026)

The app now enforces access in Postgres itself (restricted roles + row-level security),
so clients only ever receive their own company's data. On first start after the update
the app creates the roles automatically; the `DATABASE_URL` user must be allowed to
create roles (the default Docker `POSTGRES_USER` is).

Sign everyone out once so any session copied before the fix stops working:

```bash
sudo docker compose -f /opt/frx-portal/docker-compose.yml exec db psql -U frx -d frx -c "DELETE FROM sessions;"
```

Check the logs for `Could not set up restricted database roles` — if it appears, the
database user lacks the CREATEROLE privilege and only the weaker fallback checks apply.

## Local development

`npm run dev:local` runs the app on this machine with an in-browser database
(sign in with the seeded `admin@frxconstruction.ca` / `admin123`).
`npm run dev` keeps the page-builder preview settings.

## Network hardening (recommended)

The app must only be reachable through the HTTPS reverse proxy.

### Proxy on another machine (FRX setup)

1. **Allow only the proxy in the app** — in `/opt/frx-portal/.env`:

   ```
   PROXY_IPS=<public IP of the proxy>
   ```

   then `sudo docker compose up -d`. Any other connection gets 403, and the logs show
   `Refused direct connection from <ip>` once per address. If the site stops working,
   that line shows which address the proxy really connects from — put that one in
   `PROXY_IPS`.

2. **Allow only the proxy in the firewall** (Ubuntu):

   ```bash
   sudo ufw allow from <proxy-ip> to any port 8080 proto tcp
   sudo ufw deny 8080/tcp
   sudo ufw enable
   ```

   Docker publishes ports past ufw on some systems; step 1 still protects the app.

3. **Encrypt the proxy → app hop.** Between two sites this traffic crosses the internet.
   If the proxy forwards to `http://<server>:8080`, passwords and session cookies travel
   in clear text on that hop. Use one of:
   - a private tunnel between the two machines (WireGuard or Tailscale), with the proxy
     forwarding to the tunnel address — simplest and recommended;
   - or HTTPS between proxy and app (certificate on the app server, proxy forwarding to
     `https://`).

### Proxy on the same machine

Set `BIND_ADDR=127.0.0.1` so port 8080 is closed to the outside.

### Built-in protections

Per-account and per-address login throttling, an API rate limit (1,200 requests/min per
signed-in session, 300/min per address when signed out), a 15 s limit on every database
query, and a 12 MB request size cap.
