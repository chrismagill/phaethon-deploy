# Installing Attestor on macOS

**Attestor** is a self-hosted compliance SIEM for NIST SP 800-171 / CMMC Level 2.
It runs entirely inside your own environment — your log data and CUI never leave
your machine. This guide installs it locally on a Mac with Docker.

**Time:** ~15 minutes · **Works on:** Apple Silicon (M-series) and Intel Macs.
*(On Windows? See `INSTALL-Windows.md` in this bundle instead.)*

---

## Before you begin

You'll need:

1. **Docker Desktop for Mac** — free. Download from
   <https://www.docker.com/products/docker-desktop/>, install it, and **launch
   it** (the whale icon should be in your menu bar). Attestor runs as Docker
   containers; Docker Desktop is the only prerequisite.
2. **Your Attestor license key** — the `PHLK1.…` string Phaethon Security sent
   you. Attestor will not start without it.
3. **This install bundle** — the folder containing `docker-compose.yml`,
   `.env.example`, and this guide.

Confirm Docker is ready — open **Terminal** (⌘-Space → "Terminal") and run:

```bash
docker --version && docker compose version
```

Both should print a version. If you get "command not found," Docker Desktop
isn't installed or isn't running yet.

---

## Step 1 — Open the bundle in Terminal

Unzip the bundle if you haven't, then `cd` into it. For example, if it's in
Downloads:

```bash
cd ~/Downloads/attestor
```

You should see `docker-compose.yml` when you run `ls`.

## Step 2 — Create your configuration

Copy the template and generate all the required secrets automatically:

```bash
cp .env.example .env

{
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 20)Aa9!"
  echo "APP_DB_PASSWORD=$(openssl rand -hex 20)Aa9!"
  echo "JWT_SECRET=$(openssl rand -hex 64)"
  echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
  echo "EVIDENCE_SIGNING_KEY=$(openssl rand -hex 32)"
} >> .env

chmod 600 .env
```

Now add your license key. Open `.env` in a text editor (`open -e .env`) and
paste your key into the `LICENSE_KEY=` line, so it reads:

```
LICENSE_KEY=PHLK1.eyJ...your...key...
```

Save and close. That's the only value you type by hand — the rest were
generated above.

> These secrets are unique to your install and are stored only in this `.env`
> file. Keep it private; don't email it or commit it anywhere.

## Step 3 — Start Attestor

```bash
docker compose up -d
```

The first run downloads the images and initializes the database — give it a
minute or two. Check that everything is healthy:

```bash
docker compose ps
```

Wait until `postgres`, `api`, and `web` all show **healthy** (re-run the
command as needed). If a service says `exited`, see **Troubleshooting** below.

## Step 4 — Open Attestor and create your account

Open **<http://localhost:8080>** in your browser. On first run Attestor greets
you with a short **Welcome** screen — enter an organization name, your email,
and a password (at least 12 characters), and click **Create account**. That's
it: your admin account is created **and the CMMC / NIST 800-171 control set is
loaded automatically** — no command line, no separate seeding step.

Then set up two-factor sign-in:
- Sign in with the email and password you just chose.
- You'll be **required to set up MFA**: add the shown setup key to an
  authenticator app (Microsoft Authenticator, Google Authenticator, etc.) and
  enter the current 6-digit code. This is mandatory — there's no password-only
  access.

You're now in the console:
- **Events** — the security events Attestor has ingested. Click **Simulate
  security event** to generate a sample failed-login and watch it get tagged to
  compliance controls in real time.
- **Evidence bundles** — pick a framework (NIST 800-171 or CMMC) and a date
  range, click **Generate**, and Attestor produces a signed, auditor-ready
  bundle. **Verify** re-checks its signature; **Download** saves the JSON.
- **Session** — your role, organization, and license status.

Ingested events are automatically tagged to their NIST 800-171 control (e.g.
`3.1.8`) and its CMMC equivalent (`AC.L2-3.1.8`) — the control set was loaded
for you during account creation. Configuring real log sources to forward into
Attestor is covered in the **Administrator Guide**.

---

## Everyday operations

| Task | Command (run from the bundle folder) |
|---|---|
| Check status | `docker compose ps` |
| View logs | `docker compose logs -f api` |
| Stop (keep data) | `docker compose down` |
| Start again | `docker compose up -d` |
| Update to a new release | `docker compose pull && docker compose up -d` |
| **Uninstall + erase all data** | `docker compose down -v` |

Your data lives in Docker volumes and survives stops, restarts, and updates.
`down -v` is the only command that deletes it — use it only when you truly want
a clean slate.

## Troubleshooting

- **A service won't start / `api` exits immediately.** Almost always a config
  issue. Run `docker compose logs api`. A clear message like *"license…"* means
  the `LICENSE_KEY` is missing, wrong, or for the wrong product — re-check
  Step 2. Exit code 78 means a secret is missing or too weak.
- **"Port is already allocated."** Something else is using 8080. Stop it, or
  change the web `ports:` line in `docker-compose.yml` (e.g. `"9090:8080"`) and
  browse to that port instead.
- **Welcome screen didn't appear / it went straight to sign-in?** That screen
  only shows before the first account exists. If an account was already created,
  just sign in. To start over, `docker compose down -v` (erases everything) and
  `docker compose up -d` again.

## Going to production

For a real deployment (not local evaluation):

1. **Turn off self-service setup.** The browser "create your account" screen is
   an evaluation convenience. In production set `ATTESTOR_SETUP_ENABLED=false`
   and create the first admin from the command line instead:
   ```bash
   set -a; source .env; set +a
   docker compose exec -T \
     -e ADMIN_DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
     api node scripts/create-user.js --email you@company.com \
     --password 'a-strong-passphrase' --role admin --org-name "Your Company"
   ```
2. Put Attestor behind a hostname with a **real TLS certificate** — run a
   reverse proxy (Caddy, nginx, or a Cloudflare Tunnel) in front of port 8080 to
   terminate HTTPS. Evaluation runs over plain HTTP on loopback.
2. Keep `.env` backed up securely — it holds the keys that encrypt your data and
   sign your evidence bundles. If you lose `ENCRYPTION_KEY`, existing data can't
   be decrypted.
3. Renew your license before it expires. After expiry Attestor keeps running for
   a grace period (default 14 days, with a warning) and then stops.

---

**Support:** info@phaethonsecurity.com · Book time:
<https://calendly.com/chris-phaethonsecurity>
