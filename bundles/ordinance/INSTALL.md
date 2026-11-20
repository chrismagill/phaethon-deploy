# Install Ordinance (Mac, Windows or Linux)

**Ordinance** is a policy-enforcement layer. Your systems — or AI agents — ask
it "may this action proceed?" *before* acting, and it returns **ALLOW / DENY /
ESCALATE** with the governing compliance control attached. Every decision
records who requested the action, which system asked, and the exact policy that
decided it; escalations go to a human approval gate. It runs as a single
container, and makes no outbound connections.

**Time:** about 10 minutes · **No license key needed to evaluate.**

> Applies to Ordinance 4.0 and later. This guide gets one instance running on
> one machine. Before anyone else depends on it, work through
> **[PRODUCTION.md](PRODUCTION.md)**; to connect a system or agent, see
> **[INTEGRATION.md](INTEGRATION.md)**.

---

## 1. Install Docker

Docker Desktop (Mac, Windows) is free from
<https://www.docker.com/products/docker-desktop/>. Install it and **launch it**,
then confirm in a terminal (macOS: Terminal · Windows: PowerShell):

```bash
docker --version && docker compose version
```

On RHEL-family Linux with Podman, see [INSTALL-Podman.md](INSTALL-Podman.md).

## 2. Create your `.env`

From this folder (the one with `docker-compose.yml`):

```bash
cp .env.example .env
```

Open `.env` and set **two** values.

**a) Accept the Terms of Use.** Ordinance will not start until you do. Read them
first — they ship inside the image:

```bash
docker run --rm --entrypoint sh ghcr.io/chrismagill/ordinance:4.0.0 -c 'cat /srv/legal/terms_of_use.md'
```

Then uncomment `ORDINANCE_ACCEPT_TERMS=1`.

**b) Set an API key.** There is no default key. Generate one and paste it after
`ORDINANCE_API_KEY=`:

```bash
openssl rand -hex 32                                               # macOS / Linux
```
```powershell
-join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })          # Windows PowerShell
```

This key is for programs that call Ordinance. It is **not** how you sign in to
the console.

## 3. Start Ordinance

```bash
docker compose up -d
docker compose ps
curl http://localhost:8088/health
```

`/health` returns `"status":"ok"`, the number of policy bundles loaded, and
`"license":{"status":"evaluation",…}`. If the container keeps restarting, run
`docker compose logs ordinance` — the reason is printed (see Troubleshooting).

## 4. Create your operator account

1. Get the one-time setup code from the log:

   ```bash
   docker compose logs ordinance | grep "SETUP CODE"
   ```

2. Open **<http://localhost:8088/>**. On **Create the operator account**, enter
   the setup code, a username and a password (10+ characters).
   **Use your own name or email as the username** (not `admin`): approvals are
   recorded under it, and Ordinance stops you approving your own requests by
   comparing it with the requester.
3. Sign in. You are required to set up two-factor authentication: add the secret
   shown to an authenticator app (Microsoft Authenticator, Google Authenticator,
   1Password, …) and enter the current 6-digit code. Every later sign-in asks
   for the password and a code.

The console has four areas: **Overview**, **Approvals** (the human gate),
**Audit Log** (every decision, with evidence exports) and **Policies**.

## 5. Make three decisions

Every request must say **who is asking**: `subject.id` is required.

```bash
KEY=<the ORDINANCE_API_KEY from your .env>

# ALLOW — an AI model call with the prompt classified and PII redacted
curl -s -X POST http://localhost:8088/v1/evaluate \
  -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
  -d '{"action":"ai.model_invoke","subject":{"id":"jane@example.com"},
       "context":{"prompt_classified":true,"pii_redacted":true,"model_family":"reviewed"}}'
echo

# DENY — a CUI export where the destination is explicitly NOT approved
curl -s -X POST http://localhost:8088/v1/evaluate \
  -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
  -d '{"action":"data.export_cui","subject":{"id":"jane@example.com"},
       "context":{"destination_approved":false,"dlp_scan_passed":true}}'
echo

# ESCALATE — creating a privileged account with the required facts missing
curl -s -X POST http://localhost:8088/v1/evaluate \
  -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
  -d '{"action":"account.create_privileged","subject":{"id":"bob@example.com"},"context":{}}'
echo
```

Each response carries the `decision`, the `controls` that applied, the
`matched_rules` (which rule decided, from which policy file and hash), the
`caller`, and — for an ESCALATE — an `approval_id`.

## 6. Work the escalation through the gate

1. In the console, open **Approvals**. The escalation shows who requested it
   and which system raised it. Add a rationale and click **Approve**.
2. The caller then resends the **same request with the `approval_id`**:

   ```bash
   curl -s -X POST http://localhost:8088/v1/evaluate \
     -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
     -d '{"action":"account.create_privileged","subject":{"id":"bob@example.com"},
          "context":{},"approval_id":"PASTE_APPROVAL_ID"}'
   ```

   It now returns `"decision":"allow"` with `"approved_by"` set to your operator
   account. Send it a second time and it is refused: an approval works once, for
   the exact request that was approved.

The API key that raised an escalation can never approve it — try it
(`POST /v1/approvals/<id>/decide` returns 403).

## 7. Run the proof battery (optional, two minutes)

A scripted check that this instance does what it claims — requests without a
requester are refused, the decision is tied to the exact policy text, the caller
cannot approve its own escalation, and the ledger has not been altered:

```bash
docker compose exec ordinance python client/proof.py --reference
```

It prints PASS/FAIL per claim. Its test requests stay in the ledger under the
requester `ordinance-proof`.

---

## Everyday operations

| Task | Command (from this folder) |
|---|---|
| Check status | `docker compose ps` |
| View logs | `docker compose logs -f ordinance` |
| Stop (keeps all data) | `docker compose down` |
| Start again | `docker compose up -d` |
| Add a second approver | `docker compose exec ordinance python -m app.admin operators add <username>` |
| Reset a lost password / authenticator | `docker compose exec ordinance python -m app.admin operators reset <username>` |
| Back up the ledger | see [PRODUCTION.md](PRODUCTION.md#backup-and-restore) |
| Upgrade to a new release | see [PRODUCTION.md](PRODUCTION.md#upgrades) — `docker compose pull` alone does nothing |
| Uninstall and **erase the ledger** | `docker compose down -v` |

## Use your own policies

Create a `policies/` folder next to `docker-compose.yml`, put your `*.yaml`
bundles in it, and uncomment the `./policies:/srv/policies:ro` line in
`docker-compose.yml`. Then, **every time you change a policy file**:

```bash
docker compose run --rm ordinance python -m app.validate /srv/policies   # 1. validate
docker compose up -d --force-recreate                                    # 2. restart to put it in force
```

Policies load only at startup, and Ordinance **refuses to start** with a policy
set that has an error (a typo in a field name, a missing or duplicate rule
`id`, an unreadable file) — it does not run with rules that silently don't
enforce. The policy format is in [PRODUCTION.md](PRODUCTION.md#policy-lifecycle).

## Troubleshooting

- **Container keeps restarting.** `docker compose logs ordinance`. The line
  starting `FATAL` says why: Terms not accepted, no API key, a license problem,
  or a policy error (each one is listed).
- **`docker compose` says a variable is required.** `.env` is missing
  `ORDINANCE_ACCEPT_TERMS=1` or `ORDINANCE_API_KEY=…` (step 2).
- **`401` on API calls.** The `X-Api-Key` header doesn't match a configured key.
- **`422` on `/v1/evaluate`.** The request has no `subject.id`.
- **`403` when approving through the API.** By design: approve in the console,
  or designate an approver key (`ORDINANCE_APPROVER_KEYS`).
- **"Invalid setup code".** A new code is issued each time the service starts
  until an operator exists — read the latest one from the log.
- **Locked out of the console.** Five wrong attempts lock the account for 15
  minutes. For a lost password or authenticator:
  `docker compose exec ordinance python -m app.admin operators reset <username>`.
  This keeps the ledger. Do **not** use `docker compose down -v` to recover a
  login — it deletes the decision log.
- **Port already in use.** Set `ORDINANCE_HOST_PORT` in `.env` and
  `docker compose up -d` again.
- **Can't reach it from another machine.** Intended: it is published on
  `127.0.0.1` only. See [PRODUCTION.md](PRODUCTION.md#tls-and-network-exposure).

---

**Support:** info@phaethonsecurity.com · Book time:
<https://calendly.com/chris-phaethonsecurity>
