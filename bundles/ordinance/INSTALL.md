# Try Ordinance (Mac or Windows)

**Ordinance** is a lightweight policy-enforcement layer. Your systems — or AI
agents — ask it "should this action be allowed?" *before* acting, and it returns
**ALLOW / DENY / ESCALATE** with the governing compliance control attached, plus
a real human approval workflow for escalations. It runs locally as a single
Docker container.

**Time:** ~5 minutes · **No license key needed for the trial.**

---

## 1. Install Docker Desktop

Free, from <https://www.docker.com/products/docker-desktop/>. Install and
**launch it** (whale icon in the menu bar / system tray), then confirm it's
ready in a terminal:

- **macOS:** ⌘-Space → "Terminal"
- **Windows:** Start → "PowerShell"

```bash
docker --version && docker compose version
```

## 2. Accept the Terms of Use

Ordinance fails closed until you accept its Terms of Use. This is a deliberate
acknowledgment by you as the operator — we don't pre-accept it for you — and the
version you accept is recorded in the boot log.

Read them first — they ship inside the image, so you can read them before
accepting anything:

```bash
docker run --rm --entrypoint sh ghcr.io/chrismagill/ordinance:3.3.0 \
  -c 'cat /srv/legal/terms_of_use.md'
```

(They're also served at `GET /terms` once it's running.) Then:

```bash
cp .env.example .env
```

and in `.env`, uncomment:

```
ORDINANCE_ACCEPT_TERMS=1
```

**Still no licence key required** — that's the only line you need.

## 3. Start Ordinance

From this folder (the one with `docker-compose.yml`):

```bash
docker compose up -d
```

The first run downloads the image. Confirm it's healthy:

```bash
docker compose ps
curl http://localhost:8088/health
```

`/health` returns `"status":"ok"` and `"license":{"status":"evaluation",…}` — the
trial self-issues a short-lived evaluation license.

## 4. Open the console

Visit **<http://localhost:8088/>** in your browser and sign in with the trial
API key:

```
ordinance-trial-key
```

You'll land on a dashboard with:

- **Approvals** — the human gate: review escalations and approve/reject them.
- **Audit Log** — every decision, filterable, with one-click evidence exports
  (decision-log CSV, a control-coverage matrix, or a zip).
- **Policies** — the loaded rules, and a "what would this action require?" lookup.

> Change the key for anything beyond a local trial: set `ORDINANCE_API_KEY` in a
> `.env` file (copy `.env.example`) and `docker compose up -d` again.

## 5. Make some decisions (optional, via API)

Point any caller at `/v1/evaluate`. A few examples against the built-in
reference policy:

```bash
KEY=ordinance-trial-key

# ALLOW — an AI model call with prompt classified and PII redacted
curl -s -X POST http://localhost:8088/v1/evaluate \
  -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
  -d '{"action":"ai.model_invoke","subject":{"id":"svc-1"},
       "context":{"prompt_classified":true,"pii_redacted":true,"model_family":"reviewed"}}'
echo

# DENY — a CUI export where the destination is explicitly NOT approved
curl -s -X POST http://localhost:8088/v1/evaluate \
  -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
  -d '{"action":"data.export_cui","subject":{"id":"u-9"},
       "context":{"destination_approved":false,"dlp_scan_passed":true}}'
echo

# ESCALATE — creating a privileged account with the required facts missing
curl -s -X POST http://localhost:8088/v1/evaluate \
  -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
  -d '{"action":"account.create_privileged","subject":{"id":"u-9"},"context":{}}'
echo
```

Each response carries the `decision`, the compliance `controls` that applied,
and — for an ESCALATE — an `approval_id` you can then work in the **Approvals**
tab. Enforcing these decisions in your own code is one line — see the reference
client in the product repo's `client/` folder.

---

## Everyday operations

| Task | Command (from this folder) |
|---|---|
| Check status | `docker compose ps` |
| View logs | `docker compose logs -f` |
| Stop (keep data) | `docker compose down` |
| Start again | `docker compose up -d` |
| Update to a new release | `docker compose pull && docker compose up -d` |
| Uninstall + erase data | `docker compose down -v` |

## Use your own policies

The container ships with a reference policy bundle. To use your own: create a
`policies/` folder next to `docker-compose.yml`, drop your `*.yaml` bundles in,
uncomment the `./policies:/srv/policies:ro` line in `docker-compose.yml`, and
`docker compose up -d`.

## Going to production

Evaluation mode is for local trials only (it prints an "EVALUATION MODE" banner).
For a licensed deployment: in `.env`, comment out `ORDINANCE_EVAL`, set your
`LICENSE_KEY`, and set a strong `ORDINANCE_API_KEY`.

## Troubleshooting

- **Port already in use.** Set `ORDINANCE_HOST_PORT` in `.env` to a free port and
  `docker compose up -d` again.
- **`401` on API calls / can't sign in.** Your key doesn't match
  `ORDINANCE_API_KEY` (default `ordinance-trial-key`).
- **Container keeps restarting.** `docker compose logs` — the reason is printed.

---

**Support:** info@phaethonsecurity.com · Book time:
<https://calendly.com/chris-phaethonsecurity>
