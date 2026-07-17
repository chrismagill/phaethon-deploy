# Verify Phaethon images before you run them

Every Phaethon container image is **cryptographically signed** and ships a **software
bill of materials (SBOM)**. You can confirm — in your own environment, before pulling
anything into an enclave — that an image genuinely came from Phaethon's release pipeline
and hasn't been tampered with.

**Don't take our word for it. The commands below let you check us.**

> Every command in this document was executed against the live published images on
> 2026-07-16. The example outputs are real.

---

## What the signature proves

We sign with [Sigstore **cosign**](https://docs.sigstore.dev/), **keyless**. There is no
signing key we hold and could leak — instead, each signature is bound to the exact
**GitHub Actions workflow, git commit, and release tag** that built the image, and that
binding is recorded in a public transparency log. When you verify, you're confirming the
image was built by *our* release workflow from *our* source, not merely that "someone
with a key" signed it.

---

## 1. Verify the signature

You need [cosign](https://docs.sigstore.dev/system_config/installation/) — or run it from
its container with no install (used for the examples here):

```sh
cosign() { docker run --rm gcr.io/projectsigstore/cosign:v2.4.1 "$@"; }
```

**Ordinance:**

```sh
cosign verify \
  ghcr.io/chrismagill/ordinance@sha256:79384b793542e5a3449a08cd333de6fdc15b0b21e2c39c8d9b0eb185075ef8da \
  --certificate-identity-regexp '^https://github.com/chrismagill/ordinance/' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
```

**Attestor** (three images — verify each; identity is the `attestor` repo):

```sh
for img in \
  attestor-api@sha256:f95b4876f1c7c66a5db781cdd606d63b47f2fe1391378cd2df283f3eecd869f4 \
  attestor-web@sha256:66899ab5a84383263ee72960b0e404ffb112f1ed9a3a0d72ac56d646c2b075f7 \
  attestor-postgres@sha256:bcad87b8e13e35235318574bc939c9f7427e953e0203ed8f1daf6b49e396c8eb ; do
  cosign verify "ghcr.io/chrismagill/$img" \
    --certificate-identity-regexp '^https://github.com/chrismagill/attestor/' \
    --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
done
```

### What a good result looks like

```
Verification for ghcr.io/chrismagill/ordinance@sha256:79384b79... --
The following checks were performed on each of these signatures:
  - The cosign claims were validated
  - Existence of the claims in the transparency log was verified offline
  - The code-signing certificate was verified using trusted certificate authority certificates
```

Followed by a JSON block whose `Subject` names the workflow, commit, and tag that built
the image — for the digest above:

```
"Subject":  "https://github.com/chrismagill/ordinance/.github/workflows/release.yml@refs/tags/v3.3.0"
"Issuer":   "https://token.actions.githubusercontent.com"
"githubWorkflowSha":  "290bd1d82f684f08b576f0c78a28943d2daa6487"
"githubWorkflowRef":  "refs/tags/v3.3.0"
```

If verification **fails**, the command exits non-zero and prints
`Error: no matching signatures`. Do not run the image.

### Prove the check means something

Point it at an identity we *don't* control and confirm it refuses — a signature that
verifies against anything is worthless:

```sh
cosign verify \
  ghcr.io/chrismagill/attestor-api@sha256:f95b4876f1c7c66a5db781cdd606d63b47f2fe1391378cd2df283f3eecd869f4 \
  --certificate-identity-regexp '^https://github.com/not-phaethon/evil/' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
# → Error: no matching signatures: none of the expected identities matched
#   what was in the certificate, got subjects
#   [https://github.com/chrismagill/attestor/.github/workflows/release.yml@refs/tags/v1.1.3]
```

Note that even the *failure* tells you the true signer — that's the point.

---

## 2. Read the SBOM

Each image carries a full SPDX software bill of materials, attached at build time from the
**actually installed** dependency tree. Retrieve it with Docker's `buildx`:

```sh
# The whole SBOM (per-platform):
docker buildx imagetools inspect \
  ghcr.io/chrismagill/ordinance@sha256:79384b793542e5a3449a08cd333de6fdc15b0b21e2c39c8d9b0eb185075ef8da \
  --format '{{ json .SBOM }}'

# Just the package list for one architecture:
docker buildx imagetools inspect \
  ghcr.io/chrismagill/ordinance@sha256:79384b793542e5a3449a08cd333de6fdc15b0b21e2c39c8d9b0eb185075ef8da \
  --format '{{ json (index .SBOM "linux/amd64").SPDX.packages }}'
```

The Ordinance `3.3.0` SBOM lists **111 packages** (Python runtime plus fastapi, uvicorn,
pydantic, cryptography, PyYAML, and their transitive dependencies).

> **Note:** the SBOM is a **buildx attestation** attached to the image index. Retrieve it
> with `docker buildx imagetools inspect` as above. `cosign download sbom` and
> `cosign verify-attestation --type slsaprovenance` are for a *different* attachment
> mechanism and will **not** find these — use `buildx imagetools`.

---

## 3. Read the third-party licence notice

Each image ships a `NOTICE` listing every open-source component and its licence, generated
at build time from what actually shipped:

```sh
# Ordinance:
docker run --rm --entrypoint sh \
  ghcr.io/chrismagill/ordinance@sha256:79384b79... -c 'cat /srv/NOTICE'

# Attestor API:
docker run --rm --entrypoint sh \
  ghcr.io/chrismagill/attestor-api@sha256:f95b4876... -c 'cat /app/NOTICE'
```

---

## 4. Pin by digest, not by tag

Our install bundles reference each image by its **`@sha256:` digest**, not a moving tag
like `:latest`. A digest is the image's content hash: it can only ever mean one exact
build. This is what lets you prove, months later — to an assessor, in an audit — that the
image you evaluated is the image you are running. **Verify the digest, keep the record.**

---

## Air-gapped / disconnected environments

cosign's newer **bundle** format packages the certificate and signature into a single file
so verification works **offline**, with no call to the transparency log at verify time.
If you operate a disconnected enclave and want signed offline install tarballs
(`docker save` + signature + `SHA256SUMS`), contact **info@phaethonsecurity.com** — we can
provide them per release.

---

## Current release digests

| Image | Version | Digest |
|---|---|---|
| `ghcr.io/chrismagill/ordinance` | 3.3.0 | `sha256:79384b793542e5a3449a08cd333de6fdc15b0b21e2c39c8d9b0eb185075ef8da` |
| `ghcr.io/chrismagill/attestor-api` | 1.1.3 | `sha256:f95b4876f1c7c66a5db781cdd606d63b47f2fe1391378cd2df283f3eecd869f4` |
| `ghcr.io/chrismagill/attestor-web` | 1.1.3 | `sha256:66899ab5a84383263ee72960b0e404ffb112f1ed9a3a0d72ac56d646c2b075f7` |
| `ghcr.io/chrismagill/attestor-postgres` | 1.1.3 | `sha256:bcad87b8e13e35235318574bc939c9f7427e953e0203ed8f1daf6b49e396c8eb` |

The identity for verification is `^https://github.com/chrismagill/<repo>/` where `<repo>`
is `ordinance` or `attestor`, and the issuer is always
`https://token.actions.githubusercontent.com`.

<!-- ==========================================================================
MAINTENANCE — read before editing:
  • The digests and versions above change every release. Update this table AND the
    inline command examples on each release. This is a RELEASE-CHECKLIST item — the
    same drift trap that has bitten the bundle compose and the terms page.
  • Every command here was executed against the live images 2026-07-16. If you change
    a command, RE-RUN IT. Do not edit these from memory — an unverified verification
    doc is worse than none (it teaches customers a command that fails).
  • Known-good tooling versions used: cosign v2.4.1, Docker buildx (imagetools).
  • This doc doubles as NDA Tier-0 collateral (see legal/nda-code-review-process.md)
    and as source for the "Secure development & release" section on the site
    (marketing prompt U3). Keep the three in step.
========================================================================== -->
