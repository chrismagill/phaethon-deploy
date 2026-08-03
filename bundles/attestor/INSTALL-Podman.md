# Attestor — Rootless Podman + SELinux install

Run the **same signed OCI images** (`attestor-postgres` / `attestor-api` /
`attestor-web`) on **rootless Podman** under **SELinux enforcing** — no Docker
daemon, no product change. See `../../CONTAINER-RUNTIME-ISOLATION.md` for the
rationale and standards mapping.

The `docker-compose.yml` in this folder is standard Compose and is consumed by
Podman as-is. Attestor's crown-jewel isolation carries over: the `api` and
`postgres` services stay on the internal `backend` network with no route to the
host or the internet — only `web` is published.

## Prerequisites (RHEL 9 / Rocky / Fedora)

```bash
sudo dnf install -y podman podman-compose
getenforce                         # Enforcing
podman info | grep -i rootless     # rootless: true   (run as an unprivileged user, NOT sudo)
podman-compose version             # need >= 1.0.6 for depends_on healthcheck conditions (see Notes)
```

## Configure

```bash
cp .env.example .env
# Fill every blank in .env:
#   POSTGRES_USER / POSTGRES_DB
#   POSTGRES_PASSWORD          openssl rand -base64 24 | tr -d '\n=' | head -c 32
#   APP_DB_PASSWORD            (different from POSTGRES_PASSWORD, same strength)
#   JWT_SECRET                 openssl rand -hex 64
#   ENCRYPTION_KEY             openssl rand -hex 32
#   EVIDENCE_SIGNING_KEY       openssl rand -hex 32
#   LICENSE_KEY                paste your Attestor license from Phaethon Security
```

## Run (rootless)

```bash
podman-compose up -d
```
Console: `http://localhost:8080/`

> **Dogfooding the Evidence Hub (v1.2.0+):** the schema is created only on a
> *fresh* database (no migration runner). If you previously ran an older Attestor
> here, remove the old data volume first so `init.sql` builds the new tables:
> `podman volume rm attestor_pgdata` (stop the stack first).

## Verify the isolation posture

```bash
podman info --format '{{.Host.Security.Rootless}}'                 # true (no root daemon)
podman inspect attestor_api_1 --format '{{.HostConfig.SecurityOpt}}'  # no-new-privileges
ps -eZ | grep -m1 postgres                                        # ...:container_t:...  (SELinux-confined)
podman network inspect attestor_backend --format '{{.Internal}}'  # true  (no host/internet route)
```
Named volumes (`pgdata`, `attestor-data`) are SELinux-labeled automatically; this
bundle uses no host bind mounts, so no `:Z` relabeling is required.

## Cosign-verify before first run (supply-chain)

```bash
for img in attestor-postgres attestor-api attestor-web; do
  cosign verify ghcr.io/chrismagill/$img@sha256:... \
    --certificate-identity-regexp "^https://github.com/chrismagill/attestor/" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com
done
```
(Use the exact digests pinned in `docker-compose.yml`.)

## Keep it running across reboots (optional, rootless)

```bash
loginctl enable-linger "$USER"
podman generate systemd --new --files --name attestor_web   # repeat per container, or use a pod
mkdir -p ~/.config/systemd/user && mv container-*.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now container-attestor_web
```
For production, prefer **Quadlet** `.container`/`.pod` units, or the
`podman kube play` Pod spec in this folder — **`attestor.kube.yaml`** — which
declares an explicit `securityContext` per container (seccomp RuntimeDefault,
non-root, no privilege escalation, dropped caps) and keeps `api`/`postgres` off
any hostPort so only `web` is host-reachable:
```bash
podman kube play attestor.kube.yaml     # up
podman kube down attestor.kube.yaml     # down
```

## Notes

- **Ports >1024** (8080) — no privileged-port workaround needed for rootless.
- **`depends_on: condition: service_healthy`** (api waits for postgres; web waits
  for api) needs **`podman-compose >= 1.0.6`**. On older versions either upgrade,
  or bring services up in order: `podman-compose up -d postgres` → wait for
  `podman healthcheck run <postgres>` to pass → `podman-compose up -d`. The
  `podman kube play` path handles ordering natively via readiness.
- Container/volume names above use the default `attestor_<service>_1` /
  `attestor_<volume>` scheme; confirm with `podman ps` / `podman volume ls`.
