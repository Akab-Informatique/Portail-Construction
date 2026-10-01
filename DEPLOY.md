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
