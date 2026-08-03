# Podman on RHEL — Isolation Validation Checklist

Run this on the target **RHEL 9 / Rocky / Fedora** host, as an **unprivileged
user** (rootless — do *not* use `sudo`), to confirm the isolation posture claimed
in `CONTAINER-RUNTIME-ISOLATION.md`. It works for either deploy path:

- **Compose:** `podman-compose up -d` (uses the bundle `docker-compose.yml`)
- **kube play:** `podman kube play <bundle>.kube.yaml` (the hardened Pod spec)

Where commands differ by path or product, it's called out. Fill in the actual
container names from `podman ps` (Compose names look like `attestor_web_1`;
kube-play names look like `attestor-web`).

---

## 0. Prerequisites

```bash
cat /etc/redhat-release            # RHEL/Rocky/Fedora
id -u                              # NON-zero (you are an unprivileged user)
getenforce                         # Enforcing        ← PASS if "Enforcing"
podman --version                   # >= 4.x
podman-compose --version           # >= 1.0.6 (only needed for the Compose path)
```
**PASS:** unprivileged user, SELinux **Enforcing**, Podman present.

## 1. Supply-chain — verify signatures before running

```bash
# Each image is cosign-signed (keyless, GitHub OIDC). Verify by the exact digest
# pinned in the bundle compose / kube YAML, e.g. Ordinance:
cosign verify ghcr.io/chrismagill/ordinance@sha256:79384b79... \
  --certificate-identity-regexp '^https://github.com/chrismagill/ordinance/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
**PASS:** cosign prints a verified certificate for each image digest.

## 2. Bring up

```bash
# Ordinance (keyless trial):
cd bundles/ordinance
ORDINANCE_ACCEPT_TERMS=1 podman-compose up -d      # Compose path
#   …or:  podman kube play ordinance.kube.yaml      # kube-play path

# Attestor (needs .env with secrets + LICENSE_KEY):
cd ../attestor
podman-compose up -d                                # Compose path
#   …or:  podman kube play attestor.kube.yaml        # kube-play path
podman ps --format '{{.Names}}  {{.Status}}'        # note the container names
```

## 3. Confirm rootless + no root daemon

```bash
podman info --format '{{.Host.Security.Rootless}}'  # true          ← PASS
pgrep -x dockerd || echo "no dockerd (good)"         # nothing running
systemctl is-active docker 2>/dev/null || echo "docker service not active (good)"
loginctl show-user "$USER" -p Linger                 # Linger=yes if you enabled reboot-persistence
```
**PASS:** `Rootless: true`, **no `dockerd`**, containers owned by your unprivileged UID.

## 4. Confirm SELinux confinement (Mandatory Access Control)

```bash
getenforce                                           # Enforcing
# Container processes must run in the confined 'container_t' domain:
ps -eZ | grep -E 'uvicorn|postgres|nginx|node' | grep -c container_t   # > 0  ← PASS
ps -eZ | grep -m1 container_t                        # e.g. system_u:system_r:container_t:s0:c... uvicorn
```
**PASS:** the product's processes carry the `container_t` SELinux label. (Named
volumes are relabeled `container_file_t` automatically — no `:Z` needed since the
bundles use no host bind mounts.)

## 5. Confirm host exposure = **web only** (network isolation)

```bash
# Only the intended host port should be LISTENING on the host:
ss -tlnp | grep -E ':8080|:8443|:8088|:5432|:3001'   # Attestor: only :8080 ; Ordinance: only :8088
```
Attestor — the API and database must be **unreachable from the host**:
```bash
curl -fsS -o /dev/null -w 'web  %{http_code}\n' http://localhost:8080/    # 200 or 3xx  ← PASS
curl -fsS --max-time 3 http://localhost:5432/ ; echo "  (expect: refused)" # postgres NOT reachable
curl -fsS --max-time 3 http://localhost:3001/ ; echo "  (expect: refused)" # api NOT reachable
```
Compose path only — confirm the backend network is internal:
```bash
podman network inspect attestor_backend --format '{{.Internal}}'          # true  ← PASS
```
**PASS:** only `web` (`:8080`) is host-reachable; `:5432`/`:3001` are refused.

## 6. Confirm per-container hardening

```bash
C=attestor-web        # repeat for each container name from `podman ps`
podman inspect "$C" --format 'user={{.Config.User}}  secopt={{.HostConfig.SecurityOpt}}'
podman inspect "$C" --format 'capdrop={{.HostConfig.CapDrop}}  capadd={{.HostConfig.CapAdd}}'
```
**PASS (per container):**
- **non-root** — `user=` is a non-zero uid / non-root user (all except `postgres`,
  which starts as root to init then drops — expected).
- `secopt` includes **`no-new-privileges`** and a **seccomp** profile (and, on
  RHEL, an SELinux `label=`).
- `capdrop` includes **`ALL`** (kube-play path); `postgres` re-adds only
  `CHOWN,DAC_OVERRIDE,FOWNER,SETGID,SETUID`.

## 7. Functional smoke

```bash
# Ordinance
curl -s http://localhost:8088/health                          # status ok, policies_loaded >= 1
curl -s -X POST http://localhost:8088/v1/evaluate \
  -H "X-Api-Key: <your key>" -H 'Content-Type: application/json' \
  -d '{"subject":{"id":"u"},"action":"cui.export","resource":{"id":"d"},"context":{}}'  # a decision

# Attestor
curl -fsS -o /dev/null -w 'healthz %{http_code}\n' http://localhost:8080/healthz         # 200
#   then open http://localhost:8080/ in a browser, sign in, and confirm the
#   "Control Evidence" and "Connectors" modules render (Evidence Hub, v1.2.0+).
```

## 8. Egress confirmation (No-CUI boundary still holds)

```bash
# Static (from the source tree, no network):
node docker/api/scripts/egress-audit.js        # Attestor  → clean, exit 0
python3 scripts/egress_audit.py                # Ordinance → clean, exit 0

# Dynamic (optional, strongest): block all egress on the host and confirm the
# product still serves — proving no outbound dependency:
sudo nft add table inet t 2>/dev/null; \
sudo nft 'add chain inet t out { type filter hook output priority 0; }' 2>/dev/null; \
sudo nft 'add rule inet t out oifname != "lo" ct state new drop'
# …exercise the app (steps 5/7)…  then remove:  sudo nft delete table inet t
```
**PASS:** static audits exit 0; app functions normally with outbound blocked.

## 9. Teardown

```bash
podman-compose down                      # Compose path
#   …or:  podman kube down <bundle>.kube.yaml
# Remove data volumes if you want a clean slate (drops the DB):
podman volume rm attestor-pgdata attestor-data ordinance-data 2>/dev/null || true
```

---

## Sign-off (assessor checklist)

- [ ] Runs **rootless** (no `dockerd`, unprivileged UID)
- [ ] **SELinux Enforcing**; product processes confined to `container_t`
- [ ] Images **cosign-verified** by digest before run
- [ ] Only `web`/API port is host-reachable; **DB and API not host-reachable** (Attestor)
- [ ] Containers **non-root** (except postgres init), **no-new-privileges**, **seccomp**, **caps dropped**
- [ ] Egress audits exit 0; app functions with outbound blocked
- [ ] Functional smoke passes (Ordinance decision; Attestor console + Evidence Hub)

> Note: these commands are provided for the customer to run in their own RHEL
> environment; they were authored from the deployment design and have not been
> executed by Phaethon on your host.
