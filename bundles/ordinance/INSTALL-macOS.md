# Installing Ordinance on macOS

**Ordinance** is a lightweight policy-enforcement layer. Your systems (or AI
agents) ask it "should this action be allowed?" before acting, and it returns
**ALLOW / DENY / ESCALATE** with the governing compliance control attached —
and a real approval workflow for escalations. It runs locally as a single
Docker container.

**Time:** ~5 minutes · **Works on:** Apple Silicon (M-series) and Intel Macs.

---

## Before you begin

You'll need:

1. **Docker Desktop for Mac** — free, from
   <https://www.docker.com/products/docker-desktop/>. Install it and **launch
   it** (whale icon in the menu bar).
2. **Your Ordinance license key** — the `PHLK1.…` string from Phaethon
   Security. Ordinance won't start without it.
3. **This install bundle** — the folder with `docker-compose.yml`,
   `.env.example`, and this guide.

Confirm Docker is ready in **Terminal** (⌘-Space → "Terminal"):

```bash
docker --version && docker compose version
```

---

## Step 1 — Configure

`cd` into the bundle folder, then:

```bash
cp .env.example .env
echo "ORDINANCE_API_KEY=$(openssl rand -hex 32)" >> .env
chmod 600 .env
```

Open `.env` (`open -e .env`) and paste your license key into `LICENSE_KEY=`.
Save and close.

> `ORDINANCE_API_KEY` is the shared secret your callers present as the
> `X-Api-Key` header. It was generated above — copy it out of `.env` when you
> wire up a client.

## Step 2 — Start Ordinance

```bash
docker compose up -d
```

The first run downloads the image. Confirm it's healthy:

```bash
docker compose ps
curl http://localhost:8088/health
```

`/health` should return an OK status. (Ordinance publishes on port **8088** by
default so it won't clash with Attestor on the same Mac; change
`ORDINANCE_HOST_PORT` in `.env` if you want a different port.)

## Step 3 — Try a policy decision

Load your API key into the shell, then send a few example actions against the
built-in reference policy bundle:

```bash
set -a; source .env; set +a
KEY="$ORDINANCE_API_KEY"

# ALLOW — an AI model call with prompt classified and PII redacted
curl -s -X POST http://localhost:8088/v1/evaluate \
  -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
  -d '{"action":"ai.model_invoke","subject":{"id":"svc-1"},
       "context":{"prompt_classified":true,"pii_redacted":true}}'
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

Each response includes the `decision`, the compliance `controls` that applied,
and — for an ESCALATE — an `approval_id`.

## Step 4 — Work an approval through the gate

Take an `approval_id` from an ESCALATE response above and act on it:

```bash
# See what's pending
curl -s -H "X-Api-Key: $KEY" \
  "http://localhost:8088/v1/approvals?status=pending"
echo

# Approve (or reject) it
curl -s -X POST -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
  -d '{"approver":"you@yourcompany.com","decision":"approve","rationale":"Confirmed via ticket #123"}' \
  "http://localhost:8088/v1/approvals/PASTE_APPROVAL_ID/decide"
echo
```

Every decision and approval is written to an append-only audit ledger you can
query at `GET /v1/audit`.

---

## Everyday operations

| Task | Command (from the bundle folder) |
|---|---|
| Check status | `docker compose ps` |
| View logs | `docker compose logs -f` |
| Stop (keep data) | `docker compose down` |
| Start again | `docker compose up -d` |
| Update to a new release | `docker compose pull && docker compose up -d` |
| Uninstall + erase data | `docker compose down -v` |

## Using your own policies

The container ships with a reference policy bundle. To use your own: create a
`policies/` folder next to `docker-compose.yml`, drop your `*.yaml` bundles in
it, uncomment the `./policies:/srv/policies:ro` line in `docker-compose.yml`,
and `docker compose up -d`. Policy format is documented in the Administrator
Guide.

## Troubleshooting

- **Container exits immediately.** Run `docker compose logs`. A license message
  means `LICENSE_KEY` is missing/wrong/for the wrong product; a config message
  means `ORDINANCE_API_KEY` is unset. Re-check Step 1.
- **`401` on API calls.** Your `X-Api-Key` header doesn't match
  `ORDINANCE_API_KEY` in `.env`.
- **Port already in use.** Change `ORDINANCE_HOST_PORT` in `.env` and
  `docker compose up -d` again.

---

**Support:** info@phaethonsecurity.com · Book time:
<https://calendly.com/chris-phaethonsecurity>
