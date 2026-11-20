# Running Ordinance in production

How to deploy and manage an Ordinance instance that people depend on. Start
with [INSTALL.md](INSTALL.md) to get one running; this guide is what changes
between "it works on my machine" and "it is the control". Applies to Ordinance
4.0 and later.

All commands run from the folder containing `docker-compose.yml`.

## Go-live checklist

| # | Item | Section |
|---|---|---|
| 1 | Licensed (`LICENSE_KEY` set, `ORDINANCE_EVAL` empty) | [License](#license) |
| 2 | Reached only over TLS; container port not exposed | [TLS](#tls-and-network-exposure) |
| 3 | Every calling system has its own named key | [API keys](#api-keys) |
| 4 | At least two console operators, named as real people | [Operators](#console-operators) |
| 5 | Your policies are mounted, validated and under change control | [Policy lifecycle](#policy-lifecycle) |
| 6 | Scheduled backup, with a restore you have tried once | [Backup](#backup-and-restore) |
| 7 | Ledger head recorded off the host on a schedule | [Ledger integrity](#ledger-integrity) |
| 8 | Health check monitored; restart alerts wired | [Monitoring](#monitoring) |
| 9 | Proof battery passes on this instance | [Proving it](#proving-it) |
| 10 | Integrations fail closed if Ordinance is unreachable | [INTEGRATION.md](INTEGRATION.md) |

## What Ordinance is — and is not — responsible for

Ordinance **decides and records**. It does not sit in the network path and
cannot stop an action by itself: the calling system enforces the decision by
not proceeding unless the answer is ALLOW. An integration that ignores the
answer, or never asks, is not governed. Plan for that:

- The facts in `context` and the requester in `subject.id` are **supplied by the
  caller**. Ordinance guarantees they are recorded, attributed to an
  authenticated calling system, and unaltered afterwards. It does not verify
  them against your identity provider.
- The ledger is **tamper-evident**, not tamper-proof (see
  [Ledger integrity](#ledger-integrity)).
- One instance serves **one organisation**. There is no tenant isolation.
- It makes **no outbound network connections** — no telemetry, no license
  check-in, no notifications. Escalations wait in the console until someone
  looks; build the nudge (ticket, chat message) into the calling system.

## License

In `.env`:

```
ORDINANCE_EVAL=
LICENSE_KEY=PHLK1....
```

Set `ORDINANCE_EVAL` to empty rather than deleting the line. Restart, then
confirm `/health` shows `"license":{"status":"active",…}` — not `evaluation` —
and note `days_until_expiry`. The license is verified offline, at startup. For
14 days after expiry Ordinance still starts, with a warning in the log; after
that it refuses to start at its next restart. Put the expiry date in your
calendar.

## TLS and network exposure

**The container speaks plain HTTP.** Without TLS in front, API keys, console
passwords and session tokens cross the network in clear text.

- The bundle publishes the port on `127.0.0.1` only. Leave it that way.
- Put a TLS-terminating reverse proxy in front and expose only the proxy.
- Restrict who can reach the proxy (firewall / security group) to the systems
  that call Ordinance and the people who use the console.

Example with Caddy on the same host — a starting point to adapt, using a
certificate from your own CA so that nothing leaves the enclave. Save as
`docker-compose.override.yml`:

```yaml
services:
  proxy:
    image: caddy:2
    restart: unless-stopped
    ports: ["443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./certs:/certs:ro
```

`Caddyfile`:

```
ordinance.example.internal {
    tls /certs/fullchain.pem /certs/privkey.pem
    reverse_proxy ordinance:8080
}
```

`docker compose up -d`, then use `https://ordinance.example.internal/` for both
the console and the API. Any reverse proxy or load balancer you already run
(nginx, HAProxy, an ingress controller) does the same job.

## API keys

| Key | Set in | Recorded as | Can approve? |
|---|---|---|---|
| Baseline | `ORDINANCE_API_KEY` | `key:default` | Never |
| Named caller | `ORDINANCE_API_KEYS=name=key,…` | `key:<name>` | Only if listed in `ORDINANCE_APPROVER_KEYS` |

- **One named key per calling system or agent.** The ledger then shows which
  integration asked, and you can revoke one without touching the others.
  Reserve the baseline key for administration and the proof battery.
- Generate each with `openssl rand -hex 32`. Keys must all be different;
  Ordinance refuses to start on duplicates.
- Keys live in `.env` — `chmod 600 .env`, keep it out of source control, and
  prefer your secret manager for injecting it.
- **Approver keys** let a workflow system (ticketing, chat-ops) approve or
  reject through the API. Give that system its own key and name it in
  `ORDINANCE_APPROVER_KEYS`. A key can never resolve an escalation it raised.

**Rotating a key** (no downtime for other callers):

1. Add a new entry with a new name: `ops-copilot-2026q4=<new key>`.
2. `docker compose up -d` (restarts Ordinance — a few seconds).
3. Switch the calling system to the new key.
4. Remove the old entry and `docker compose up -d` again.

Old events keep the old name, so the ledger shows exactly when the switch
happened. Rotate on a schedule, when someone with access leaves, and
immediately if a key may have leaked.

## Console operators

Operators sign in with a password and an authenticator app. Any operator can
approve, reject and export; there are no roles.

- **Have at least two.** An operator cannot approve a request they made
  themselves, so a single operator who is also a requester has nobody to
  approve for them.
- **Usernames should identify the person** and match how they appear as a
  requester (`subject.id`) — that is what the self-approval check compares.
  Do not share accounts.

Operators are managed on the host, not through the web:

```bash
docker compose exec ordinance python -m app.admin operators list
docker compose exec ordinance python -m app.admin operators add jsmith
docker compose exec ordinance python -m app.admin operators reset jsmith    # lost password or phone
docker compose exec ordinance python -m app.admin operators remove jsmith   # leaver
```

`add` and `reset` prompt for a password (10+ characters); the person enrolls
their authenticator at next sign-in. `reset` and `remove` end that operator's
sessions. None of these touch the ledger, and each is written to it.

Five consecutive failed sign-ins lock an account for 15 minutes
(`ORDINANCE_LOGIN_MAX_ATTEMPTS`, `ORDINANCE_LOGIN_LOCKOUT_SECONDS`).

**Leavers:** `operators remove` the same day, and rotate any API key they held.

## Policy lifecycle

Policies are YAML files in the `policies/` folder you mount (INSTALL.md, "Use
your own policies"). A bundle:

```yaml
name: privileged-access
version: "2026.11"            # your own label; recorded on every decision
default_decision: escalate    # for actions no rule covers: allow | escalate | deny
rules:
  - id: PRIV-001              # required, unique across ALL bundles
    action: account.create_privileged
    description: Privileged accounts need verified MFA and an approved change ticket.
    controls: ["NIST 800-171 3.5.3", "CMMC L2 IA.L2-3.5.3"]
    requires:                 # all must hold to ALLOW
      - { key: mfa_verified, equals: true }
      - { key: change_ticket_approved, equals: true }
    escalate_if:              # any of these forces human review
      - { key: target_role, equals: "domain_admin" }
```

How a rule decides:

| Situation | Decision |
|---|---|
| Every `requires` fact is present and correct, no `escalate_if` matches | ALLOW |
| A `requires` fact is **missing** from the request | ESCALATE (unknown is not refused) |
| A `requires` fact is **present and wrong** | DENY |
| An `escalate_if` condition matches | ESCALATE |
| Several rules match | the most restrictive wins (DENY > ESCALATE > ALLOW) |
| No rule matches the action | `default_decision` (most restrictive across bundles) |

Conditions: `equals: <value>`, `in: [<values>]`, or just `key:` (must be
present). Matching is **type-exact** — `equals: true` is satisfied only by JSON
`true`, not `1` or `"true"`. Conditions read the request's `context` only.

**Changing policy — every time:**

1. Edit the file under your normal change control (pull request, reviewer,
   ticket). Bump `version:`.
2. Validate: `docker compose run --rm ordinance python -m app.validate --strict /srv/policies`
3. Put it in force: `docker compose up -d --force-recreate`
4. Confirm: `/health` shows a new `policy_digest`, and the Audit Log has a
   `policy_loaded` event naming the files, their hashes and the previous digest.

What to know:

- **Nothing changes until the restart.** Editing a file on disk does not alter
  a running instance.
- **A bad policy set stops the service** rather than running with rules that do
  not enforce. Validation (step 2) runs the same checks, so do not skip it.
- **A policy change cancels approvals that have not been used yet** — they were
  granted under the old rules. Callers re-request.
- Every decision records the hash of the bundle that decided it, and Ordinance
  keeps the full text of every bundle it has ever loaded: for any past
  decision, an auditor can retrieve the policy exactly as it read at the time
  (`GET /v1/policies/snapshots/<bundle_sha256>`).

## Backup and restore

Everything — ledger, approvals, operators, policy history — is one SQLite
database on the `ordinance-data` volume. **`docker compose down -v` deletes it.**

**Back up** (safe while running; never copy the live file directly):

```bash
docker compose exec ordinance python -m app.admin backup /data/backups/ordinance-$(date +%F).db
docker compose cp ordinance:/data/backups/ordinance-$(date +%F).db ./
```

The command prints the event count and chain head hash of the copy — store
that line with the backup. Schedule it (cron, Task Scheduler) at least daily,
copy the file off the host, and encrypt it at rest: it contains your decision
history and operator password hashes.

**Restore** onto the same or a new host:

```bash
docker compose stop ordinance
docker compose run --rm --user root --entrypoint sh -v "$PWD:/restore:ro" ordinance -c \
  'cp /restore/ordinance-YYYY-MM-DD.db /data/ordinance.db && rm -f /data/ordinance.db-wal /data/ordinance.db-shm && chown ordinance:ordinance /data/ordinance.db'
docker compose up -d
docker compose exec ordinance python -m app.admin verify
```

`verify` should report `"ok": true` with the event count and head hash you
stored with that backup. Decisions made after the backup was taken are not in
it — the difference between your recorded head and the restored one tells you
how many. **Try a restore once before you need it.**

## Ledger integrity

Every event is chained to the one before it by hash, and the database refuses
updates and deletes. `GET /v1/audit/verify` (or `python -m app.admin verify`)
recomputes the chain and names the first event that was changed, removed or
inserted.

What that cannot catch on its own: someone with full control of the database
file could rebuild the whole chain, or cut off the most recent events. The
defence is to keep a copy of the chain head where they cannot reach it:

```bash
docker compose exec ordinance python -m app.admin verify
# {"ok": true, "events": 18234, "head_seq": 18234, "head_hash": "9f2c…", "error": null}
```

Append that line, with the date, to a log on another system (your SIEM, a
ticket, a write-once bucket) on a schedule — daily is reasonable. Later, the
ledger is intact if verify still passes **and** the event at each recorded
position still has the recorded hash (`seq` and `event_hash` are in every
export). If you run Attestor, forward the head there.

## Evidence exports

Console → Audit Log, or `GET /v1/audit/export?format=csv|matrix|zip` with
optional `action`, `decision`, `since`, `until`. Each row carries the requester,
caller, matched rules, policy digest, the facts in `context`, and the chain
hash. Exports are plain files — not signed — and each export is itself recorded.

A response holds at most 100,000 events. If there are more, the header
`X-Ordinance-Export-Truncated: true` is set and the zip's README says so; fetch
the next page with `after_seq=<X-Ordinance-Export-Last-Seq>`.

## Retention and capacity

The ledger only grows; there is no pruning, by design. An event is roughly
1–2 KB, so a million decisions is on the order of 1–2 GB. Size the volume for
your retention period and watch free space — a full disk stops new decisions
from being recorded, and callers will see errors. If you must cap growth, take
a final backup and export, keep them for the retention period, and start a new
instance; do not delete rows.

## Upgrades

The image is pinned by digest, so **`docker compose pull` does not upgrade
anything.** To move to a new release:

1. Read the release notes for breaking changes.
2. Back up (above).
3. Download the new bundle, or replace the `image:` digest in
   `docker-compose.yml` with the one published for the release. Verify it:
   see `VERIFY.md` at the top of this repository.
4. Validate your policies against the new image:
   `docker compose run --rm ordinance python -m app.validate --strict /srv/policies`
5. `docker compose up -d`, then check `/health` and run the proof battery.

The database is upgraded in place at startup. To roll back, restore the backup
from step 2 with the old digest.

**Coming from 3.x:** callers must send `subject.id`; approvals by API need an
approver key; every rule needs a unique `id`; `equals: true` no longer accepts
`1`; `ORDINANCE_API_KEY` no longer defaults to a public trial key. Existing
ledger events are sealed into the hash chain at first start, marked as recorded
before it existed.

## Monitoring

- **Health:** `GET /health` (no credential) — alert if it is not `200` with
  `"status":"ok"`. It also reports `policies_loaded`, `policy_digest` and license
  days remaining; alert on a `policy_digest` you did not expect and on low
  `days_until_expiry`.
- **Restarts:** a container that restarts repeatedly has a `FATAL` line in
  `docker compose logs ordinance` explaining why (configuration, license,
  policy). Ordinance refuses to run misconfigured rather than run open.
- **Pending approvals:** `GET /v1/approvals?status=pending` — alert on age so
  escalations do not sit unseen.
- **Sign-in activity:** `admin` events in the Audit Log — sign-ins, failures,
  lockouts, operator changes, exports.

## Recovery scenarios

| Situation | What to do |
|---|---|
| Operator lost password or authenticator | `python -m app.admin operators reset <username>` |
| Operator locked out | Wait 15 minutes, or `operators reset` |
| All operators unavailable | Anyone with host access: `operators add <username>` |
| API key leaked | Rotate it ([API keys](#api-keys)); review the ledger for that `caller` |
| Service will not start after a policy edit | Logs list each error; fix or revert the file, validate, restart |
| Host lost | New host, same bundle and `.env`, [restore](#backup-and-restore) |
| `verify` reports `"ok": false` | Treat as an incident: preserve the volume, compare with your recorded heads and last backup, contact support |
| Disk full | Free space or grow the volume; do not delete ledger rows |

## Proving it

```bash
docker compose exec ordinance python client/proof.py
```

Run it after install, after every upgrade and after a restore. It checks the
guarantees against the running instance with whatever policy you have loaded,
and prints the chain head to record. Its test requests remain in the ledger
under requester `ordinance-proof` (and, when your default decision is escalate,
two pending approvals to reject).

---

**Support:** info@phaethonsecurity.com
