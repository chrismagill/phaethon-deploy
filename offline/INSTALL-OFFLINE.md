# Air-gapped install — verify and run Phaethon images with no internet

This package lets you **verify** and **run** Phaethon images inside a disconnected
enclave — no outbound network, no call to `ghcr.io`, no call to the Sigstore
transparency log at verify time. Everything the verification needs is in this bundle.

Package contents:

| Path | What it is |
|---|---|
| `images.tar.gz` | The digest-pinned images, `docker save`-format — load with `docker load` |
| `oci/<name>/` | Per-image OCI layout **with signatures**, for offline `cosign verify` |
| `trusted_root.json` | The Sigstore trust root — so verification needs no TUF fetch |
| `bundle/` | The compose file, `.env.example`, and INSTALL docs |
| `VERIFY.md` | The full (online) verification reference |
| `SHA256SUMS` | SHA-256 over every file here |

You need [`cosign`](https://docs.sigstore.dev/system_config/installation/) v2.4+ and
Docker (or Podman) inside the enclave. Neither needs network access for these steps.

---

## 1. Check the package is intact

```sh
sha256sum -c SHA256SUMS
```

Every line must say `OK`. If any file fails, stop — the transfer was corrupted or
tampered with; request a fresh copy.

## 2. Verify the signatures — OFFLINE

For each image directory under `oci/`, confirm it was built by Phaethon's release
workflow. The `--offline=true` flag means cosign uses the signature material bundled in
the OCI layout and the local `trusted_root.json` — **it makes no network call**.

**Ordinance** (identity is the `ordinance` repo):

```sh
cosign verify --local-image ./oci/ordinance \
  --certificate-identity-regexp '^https://github.com/chrismagill/ordinance/' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --offline=true --new-bundle-format=false \
  --trusted-root ./trusted_root.json
```

**Attestor** (identity is the `attestor` repo; verify all three):

```sh
for name in attestor-api attestor-web attestor-postgres ; do
  cosign verify --local-image "./oci/$name" \
    --certificate-identity-regexp '^https://github.com/chrismagill/attestor/' \
    --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
    --offline=true --new-bundle-format=false \
    --trusted-root ./trusted_root.json
done
```

A good result prints `Verified OK` and a JSON block whose `Subject` names the
`…/release.yml@refs/tags/v<version>` workflow that built the image. If verification
**fails**, cosign exits non-zero — **do not load the image.**

> Prove the check means something: re-run one command with a repo you don't control in
> the identity regexp (e.g. `not-phaethon/evil`) and confirm it refuses. A verifier that
> accepts anything is worthless.

## 3. Load the images

```sh
docker load < images.tar.gz
docker images --digests   # confirm each @sha256: matches the digests in bundle/docker-compose.yml
```

The digests you loaded must equal the `@sha256:` values pinned in
`bundle/docker-compose.yml` — that pin is what ties "the image I verified" to "the image
I run."

## 4. Run the stack

Follow `bundle/INSTALL*.md` from here — it is the same procedure as the online bundle,
except the images are already local so there is nothing to pull.

- **Ordinance:** accept the Terms (`ORDINANCE_ACCEPT_TERMS`), then `docker compose up -d`.
- **Attestor:** set the generated secrets in `.env`, `docker compose up -d`, then enter
  the evaluation key Phaethon emailed you. The licence is verified **locally** — Attestor
  makes no license check-in, so it runs fully disconnected.

---

## Why this is safe to run disconnected

- **No phone-home.** Neither product calls Phaethon at runtime — no telemetry, no license
  check-in. (Verify yourself: `bundle/docker-compose.yml` declares no egress; the NOTICE
  and source review under NDA confirm it.)
- **The signature binds to source, not to us.** Keyless signing ties each image to the
  exact GitHub Actions workflow, commit, and tag that built it — recorded in a public
  transparency log at build time and carried in this bundle for offline checking.
- **Digest pinning is your audit anchor.** Months later, an assessor can confirm the
  image running in the enclave is byte-for-byte the image you verified on delivery.

Questions, or a bundle for a different release/architecture: **info@phaethonsecurity.com**.
