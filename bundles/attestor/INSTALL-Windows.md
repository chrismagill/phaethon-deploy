# Installing Attestor on Windows

**Attestor** is a self-hosted compliance SIEM for NIST SP 800-171 / CMMC Level 2.
It runs entirely inside your own environment — your log data and CUI never leave
your machine. This guide installs it locally on a Windows PC with Docker.

**Time:** ~15 minutes · **Works on:** Windows 10 / 11 (64-bit).
*(On a Mac? See `INSTALL-macOS.md` in this bundle instead.)*

> The Docker images are identical on Windows and Mac — Docker automatically runs
> the right ones for your machine. Only the two setup commands below differ from
> the Mac guide; everything after that is the same.

---

## Before you begin

You'll need:

1. **Docker Desktop for Windows** — free. Download from
   <https://www.docker.com/products/docker-desktop/>, install it (accept the
   **WSL 2** option when prompted — it's the default), and **launch it**. Wait
   until the Docker whale icon in your system tray says "Docker Desktop is
   running." Docker Desktop is the only prerequisite.
2. **Your Attestor license key** — the `PHLK1.…` string Phaethon Security sent
   you. Attestor will not start without it.
3. **This install bundle** — the folder containing `docker-compose.yml`,
   `.env.example`, and this guide.

Open **PowerShell** (click Start, type "PowerShell", press Enter) and confirm
Docker is ready:

```powershell
docker --version; docker compose version
```

Both should print a version. If you get an error, Docker Desktop isn't installed
or isn't running yet.

---

## Step 1 — Open the bundle in PowerShell

Unzip the bundle if you haven't, then `cd` into it. For example, if it unzipped
to your Downloads folder:

```powershell
cd $HOME\Downloads\attestor
```

Run `dir` — you should see `docker-compose.yml`.

## Step 2 — Create your configuration

Copy the template and generate all the required secrets automatically. Paste
this whole block into PowerShell:

```powershell
Copy-Item .env.example .env

function New-Hex([int]$bytes) {
  $b = New-Object 'byte[]' $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  -join ($b | ForEach-Object { $_.ToString('x2') })
}

Add-Content .env "POSTGRES_PASSWORD=$(New-Hex 20)Aa9!"   -Encoding ascii
Add-Content .env "APP_DB_PASSWORD=$(New-Hex 20)Aa9!"     -Encoding ascii
Add-Content .env "JWT_SECRET=$(New-Hex 64)"              -Encoding ascii
Add-Content .env "ENCRYPTION_KEY=$(New-Hex 32)"          -Encoding ascii
Add-Content .env "EVIDENCE_SIGNING_KEY=$(New-Hex 32)"    -Encoding ascii
```

Now add your license key. Open `.env` in Notepad:

```powershell
notepad .env
```

Find the `LICENSE_KEY=` line and paste your key after the `=`, so it reads:

```
LICENSE_KEY=PHLK1.eyJ...your...key...
```

Save (Ctrl+S) and close Notepad. That's the only value you type by hand — the
rest were generated above.

> These secrets are unique to your install and are stored only in this `.env`
> file. Keep it private; don't email it or commit it anywhere.

## Step 3 — Start Attestor

```powershell
docker compose up -d
```

The first run downloads the images and initializes the database — give it a
minute or two. Check that everything is healthy:

```powershell
docker compose ps
```

Wait until `postgres`, `api`, and `web` all show **healthy** (re-run the command
as needed). If a service says `exited`, see **Troubleshooting** below.

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
`3.1.8`) and its CMMC equivalent (`AC.L2-3.1.8`) — the control set was loaded for
you during account creation. Configuring real log sources to forward into
Attestor is covered in the **Administrator Guide**.

---

## Everyday operations

Run these from the bundle folder in PowerShell:

| Task | Command |
|---|---|
| Check status | `docker compose ps` |
| View logs | `docker compose logs -f api` |
| Stop (keep data) | `docker compose down` |
| Start again | `docker compose up -d` |
| Update to a new release | `docker compose pull; docker compose up -d` |
| **Uninstall + erase all data** | `docker compose down -v` |

Your data lives in Docker volumes and survives stops, restarts, and updates.
`down -v` is the only command that deletes it — use it only when you truly want a
clean slate.

## Troubleshooting

- **A service won't start / `api` exits immediately.** Almost always a config
  issue. Run `docker compose logs api`. A message like *"license…"* means the
  `LICENSE_KEY` is missing, wrong, or for the wrong product — re-check Step 2.
  Exit code 78 means a secret is missing or too weak.
- **"port is already allocated."** Something else is using 8080. Stop it, or
  change the web `ports:` line in `docker-compose.yml` (e.g. `"9090:8080"`) and
  browse to that port instead.
- **Welcome screen didn't appear / it went straight to sign-in?** That screen
  only shows before the first account exists. If an account was already created,
  just sign in. To start over, `docker compose down -v` (erases everything) and
  `docker compose up -d` again.
- **`docker` command not recognized.** Docker Desktop isn't running, or the
  window that opened wasn't PowerShell. Start Docker Desktop, wait for "running,"
  and use PowerShell (not the old Command Prompt).

## Going to production

For a real deployment (not local evaluation):

1. **Turn off self-service setup.** The browser "create your account" screen is
   an evaluation convenience. In production set `ATTESTOR_SETUP_ENABLED=false` in
   `.env` and create the first admin from the command line instead:
   ```powershell
   # load POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB from .env
   Get-Content .env | Where-Object { $_ -match '^(POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB)=' } |
     ForEach-Object { $k,$v = $_.Split('=',2); Set-Item "env:$k" $v }
   docker compose exec -T `
     -e ADMIN_DATABASE_URL="postgresql://$($env:POSTGRES_USER):$($env:POSTGRES_PASSWORD)@postgres:5432/$($env:POSTGRES_DB)" `
     api node scripts/create-user.js --email you@company.com `
     --password 'a-strong-passphrase' --role admin --org-name "Your Company"
   ```
2. Put Attestor behind a hostname with a **real TLS certificate** — run a reverse
   proxy (Caddy, nginx, or a Cloudflare Tunnel) in front of port 8080 to
   terminate HTTPS. Evaluation runs over plain HTTP on loopback.
3. Keep `.env` backed up securely — it holds the keys that encrypt your data and
   sign your evidence bundles. If you lose `ENCRYPTION_KEY`, existing data can't
   be decrypted.
4. Renew your license before it expires. After expiry Attestor keeps running for
   a grace period (default 14 days, with a warning) and then stops.

---

**Support:** info@phaethonsecurity.com · Book time:
<https://calendly.com/chris-phaethonsecurity>
