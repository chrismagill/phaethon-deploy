# Phaethon install bundles

Everything you need to **run** Attestor and Ordinance in your own environment — and to
**prove**, before you run anything, that the images came from Phaethon's release pipeline
and haven't been tampered with.

This repository holds **no source code and no images**. It contains only:

- `bundles/attestor/`, `bundles/ordinance/` — the Docker Compose files, `.env.example`,
  and INSTALL docs for each product. They pull the **public, signed** images from GHCR,
  pinned by immutable `@sha256:` digest.
- [`VERIFY.md`](VERIFY.md) — how to verify the signature and read the SBOM of every image
  **before** you pull it into an enclave. Start here.
- `offline/` — the air-gapped install procedure for disconnected CUI enclaves.

The product source is proprietary and is not published here. Source review for due
diligence is available under NDA (including to C3PAOs and assessors acting for a client)
— contact **info@phaethonsecurity.com**.

---

## Get a bundle

**Online (normal case):** download the current bundle from
[**Releases**](../../releases/latest) — `attestor-trial.zip` or `ordinance-trial.zip` —
and check it against `SHA256SUMS` in the same release. Then follow the INSTALL doc inside.

**Air-gapped / disconnected enclave:** the offline bundle (`docker save` tarball + offline
signature verification + trust root) is produced per release **on request** —
**info@phaethonsecurity.com**. The procedure is [`offline/INSTALL-OFFLINE.md`](offline/INSTALL-OFFLINE.md).

## Verify before you run

Do not skip this. Every image is signed with Sigstore **cosign**, keyless — each
signature binds to the exact GitHub Actions workflow, commit, and release tag that built
the image. [`VERIFY.md`](VERIFY.md) has copy-paste commands; the short form:

```sh
cosign verify \
  ghcr.io/chrismagill/ordinance@sha256:<digest> \
  --certificate-identity-regexp '^https://github.com/chrismagill/ordinance/' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
```

The `<digest>` for the current release is pinned in each bundle's `docker-compose.yml`
and listed in the table at the bottom of [`VERIFY.md`](VERIFY.md).

## What runs, and what leaves your network

- **Ordinance** — single container. No license key needed to evaluate. Sends Phaethon
  nothing.
- **Attestor** — API + web + Postgres. Runs entirely inside your environment; raw log
  payloads never leave it. Its only outbound connections are the alert webhooks and SMTP
  destinations **you** configure. The license is verified locally — no phone-home.

Neither product sends usage telemetry to Phaethon. (This is a product property, verifiable
in the compose file and under source review — not a marketing claim.)

---

## Licensing

Use of the Attestor and Ordinance software is governed by the Phaethon LLC End User
License Agreement and the applicable product Exhibit, and — for Ordinance — acceptance of
its Terms of Use at install time. The compose/`.env`/doc files in *this* repository are
provided so customers can deploy the licensed software; they grant no license to the
software itself.

---

<!-- MAINTENANCE:
  • Bundles are digest-pinned. On each product release, update the @sha256: digests in
    bundles/*/docker-compose.yml AND the table in VERIFY.md, then cut a new deploy-* tag
    so Releases carry the matching zips. This is a RELEASE-CHECKLIST item (same drift trap
    as the bundle compose and the terms page).
  • The site's trial-page download links point at THIS repo's latest Release asset
    (marketing prompt U7). If you rename an asset, update the site.
  • This repo is intentionally PUBLIC and intentionally source-free. Never add product
    source, private keys, or the Keymaster licence key here.
-->
