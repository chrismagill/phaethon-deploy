# Ordinance — Rootless Podman + SELinux install

Run the **same signed OCI image** on **rootless Podman** under **SELinux
enforcing** — no Docker daemon, no product change. See
`../../CONTAINER-RUNTIME-ISOLATION.md` for the rationale and standards mapping.

The `docker-compose.yml` in this folder is standard Compose and is consumed by
Podman as-is; nothing product-specific changes.

## Prerequisites (RHEL 9 / Rocky / Fedora)

```bash
sudo dnf install -y podman podman-compose
getenforce            # should print: Enforcing
podman info | grep -i rootless   # rootless: true  (run as an unprivileged user, NOT sudo)
```

## Configure

```bash
cp .env.example .env 2>/dev/null || true   # if present; otherwise set inline below
# Required: accept the Terms of Use (fail-closed). Keyless trial needs no license.
#   ORDINANCE_ACCEPT_TERMS=1
#   ORDINANCE_EVAL=1                 # self-issued eval license; omit + set LICENSE_KEY for prod
#   ORDINANCE_API_KEY=<openssl rand -hex 32>   # change from the trial default
```

## Run (rootless)

```bash
podman-compose up -d
```
Console: `http://localhost:8088/`  ·  Health: `curl http://localhost:8088/health`

The image is baked with the reference policy bundle; `/health` should report
`policies_loaded ≥ 1` and (in trial) `"status":"evaluation"`.

## Verify the isolation posture

```bash
podman info --format '{{.Host.Security.Rootless}}'        # true  (no root daemon)
podman inspect phaethon-ordinance --format '{{.HostConfig.SecurityOpt}}'  # no-new-privileges
ps -eZ | grep -m1 uvicorn                                 # ...:container_t:...  (SELinux-confined)
```
The named `ordinance-data` volume is SELinux-labeled automatically — no `:Z`
relabeling needed (this bundle uses no host bind mounts).

## Keep it running across reboots (optional, rootless)

```bash
loginctl enable-linger "$USER"                            # user services run without an active login
podman generate systemd --new --files --name phaethon-ordinance
mkdir -p ~/.config/systemd/user && mv container-*.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now container-phaethon-ordinance
```
(Or use a Quadlet `.container` unit — the modern RHEL approach.)

## Cosign-verify before first run (supply-chain)

```bash
cosign verify ghcr.io/chrismagill/ordinance@sha256:79384b79... \
  --certificate-identity-regexp '^https://github.com/chrismagill/ordinance/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Notes

- **Ports >1024** (8088) — no privileged-port workaround needed for rootless.
- Ordinance is a **single service** (no `depends_on`), so it works with any
  `podman-compose` version.
- **Native path (recommended for the hardening story):** `ordinance.kube.yaml`
  in this folder is a `podman kube play` Pod spec with an explicit
  `securityContext` (seccomp RuntimeDefault, non-root, no privilege escalation,
  all caps dropped, read-only rootfs) a C3PAO can read directly:
  ```bash
  podman kube play ordinance.kube.yaml    # up
  podman kube down ordinance.kube.yaml    # down
  ```
