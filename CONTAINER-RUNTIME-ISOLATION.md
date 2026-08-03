# Container Runtime & Isolation Options

**Audience:** a customer's security team and their C3PAO evaluating how Attestor
and Ordinance are run, and what isolation boundary confines them.

This is a companion to each product's **No-CUI-Egress Boundary** document. That
doc explains that no CUI leaves the enclave; this one explains that **you are not
tied to the Docker daemon** — the products ship as standard images that run on
the hardened container runtime your enclave mandates, with **no change to the
software**.

---

## 1. The key fact: these are OCI images, not "Docker"

"Docker" is two separate things, and container-security concerns usually target
only the second:

1. **The OCI image format** — an open Open Container Initiative standard. The
   `attestor-api`, `attestor-web`, `attestor-postgres`, and `ordinance` images
   are standard OCI artifacts, cosign-signed and pinned by digest.
2. **The Docker Engine daemon (`dockerd`)** — a long-running **root** daemon with
   a control socket. This is where most "Docker CVE" exposure lives: a privileged
   daemon and historically a large attack surface.

Because the products are standard **OCI images**, they are **runtime-agnostic** —
they run unchanged on any OCI-compliant runtime. Swapping away from Docker Engine
is a **deployment decision made entirely by you**, at the layer you control, with
**zero product-code changes**. That is consistent with the deployment/trust model
in the No-CUI-Egress Boundary spec: the products run on infrastructure you own and
administer.

## 2. Hardening the images already carry (any runtime inherits it)

- **Non-root** — every service runs as an unprivileged user.
- **`no-new-privileges`** — no privilege escalation via setuid, etc.
- **Network segmentation** — Attestor's `api` and `postgres` sit on a
  `internal: true` backend network with no route to the host or the internet;
  only `web` is exposed.
- **Minimal, pinned, signed images** — small base images, pinned by SHA-256
  digest, cosign-signed (keyless, GitHub OIDC). Verify before you run
  (`cosign verify …`).
- **No published database port; healthchecks; read-only where possible.**

None of the options below require giving any of that up — they *add* an isolation
boundary underneath it.

## 3. Runtime options, isolation vs. effort

| Option | Isolation boundary | Product-code change | Deployment change | Notes |
|---|---|---|---|---|
| **Podman (rootless)** | Namespaces; **no root daemon** | **None** | Minor (`podman-compose` / `podman kube play`) | Direct answer to "Docker daemon" concern; RHEL default; SELinux-integrated |
| **Rootless Docker** | Namespaces; non-root daemon | **None** | Trivial | Stay on Docker, shrink daemon-root risk |
| **gVisor (`runsc`)** | User-space kernel; syscall interception | **None** | OCI runtime flag | Strong escape mitigation; test Postgres (see caveats) |
| **Kata Containers** | **Per-container lightweight VM** (real kernel) | **None** | RuntimeClass + virt host | Hypervisor-grade isolation, container UX |
| **Hardened VM appliance** | **Hypervisor** + SELinux MAC | **None** | Build/ship a signed VM (OVA/qcow2) | Ideal for air-gapped enclaves; one signed artifact |
| **SELinux / AppArmor + seccomp** | Mandatory Access Control (orthogonal) | **None** | Host config | Layer *under* any row above |

### Podman rootless + SELinux enforcing — the recommended baseline
For DoD/DIB deployments this is the sweet spot, and Phaethon provides a validated
path (see `bundles/*/INSTALL-Podman.md`):

- **Daemonless & rootless** — eliminates the root `dockerd` attack surface
  entirely. Containers run in a user namespace; container-root maps to an
  unprivileged host UID.
- **SELinux out of the box** — on RHEL in enforcing mode, Podman labels
  containers `container_t` and volumes `container_file_t` automatically
  (Mandatory Access Control confinement), no extra configuration.
- **Compatible** — consumes the same Compose files via `podman-compose`, or runs
  natively via `podman kube play` (which also lets you set `securityContext`
  seccomp/SELinux/capabilities annotations).

### gVisor and Kata — extra isolation when a workload policy demands it
- **gVisor (`runsc`)** intercepts syscalls in a user-space kernel — strong
  defense against kernel-level container escape. Set it as the OCI runtime; no
  product change. **Test Postgres under `runsc`** first (databases have hit
  syscall/perf edge cases historically); Node/FastAPI are unremarkable.
- **Kata Containers** runs each container (or pod) transparently inside a
  lightweight VM with a real kernel — hypervisor isolation with container UX, via
  an OCI `RuntimeClass`. No product change; needs nested-virt or bare-metal and
  adds some overhead. Postgres is fine (real kernel).

### Hardened VM appliance — for air-gapped enclaves
Package the whole stack into a minimal, immutable, **signed VM image** — e.g. an
immutable container-host OS (Fedora CoreOS / Flatcar / Bottlerocket) or a STIG'd
RHEL guest running the containers under rootless Podman + SELinux enforcing. One
signed OVA/qcow2, a hypervisor isolation boundary, and a clean offline update
story. This is a **packaging** change, not a product change.

## 4. Standards mapping (assessor language)

- **NIST SP 800-190** (Application Container Security) — non-root, image
  provenance (signing/pinning), network segmentation, and least privilege are all
  satisfied; runtime choice (Podman/Kata/gVisor) addresses the runtime-isolation
  recommendations.
- **CIS Docker / CIS Kubernetes Benchmarks** — the baseline hardening (no
  privileged, no-new-privileges, non-root, read-only, dropped capabilities) maps
  directly; Podman rootless clears the "avoid the privileged daemon" items by
  design.
- **DISA STIGs** — RHEL 9 + Podman + SELinux enforcing corresponds to the
  DISA container-platform and RHEL hardening guidance; a VM appliance additionally
  brings the hypervisor STIG boundary.
- Supports the same **800-171** controls cited in the boundary doc — 3.13.1/2
  (boundary protection, architectural isolation) and 3.1.x least privilege.

## 5. Caveats (stated plainly)

- **None of these fix application bugs** — they are isolation boundaries that
  *contain* a compromise, complementing (not replacing) the in-app controls.
- **gVisor**: syscall-compat + performance overhead; validate Postgres.
- **Kata / VM appliance**: need virtualization; add memory/boot overhead; the
  appliance makes you (or the customer) responsible for guest-OS patching.
- **Rootless networking** (pasta/slirp4netns) differs slightly from rootful; the
  bundle uses ports >1024 and named volumes specifically so rootless works with
  no privileged-port or bind-mount-relabel friction.
- **`depends_on: condition: service_healthy`** needs a recent `podman-compose`,
  or use the `podman kube play` path.

## 6. Verification checklist (customer-run)

- `podman info` → confirm **rootless** (`rootless: true`) and **no daemon**.
- `getenforce` → **Enforcing**; `ps -eZ | grep container_t` → processes confined.
- `podman inspect --format '{{.HostConfig.SecurityOpt}}'` → `no-new-privileges`.
- Cosign-verify each image digest before first run (commands in the bundle).
- Run the product's **egress audit** (`scripts/egress[-_]audit.*`) and the
  dynamic egress test — isolation runtime does not change the no-CUI-egress result.

---

**Bottom line:** run Phaethon's signed OCI images on Docker, **Podman
(rootless)**, containerd, or CRI-O — and add gVisor, Kata, a VM appliance, and/or
SELinux/seccomp underneath — to meet your enclave's isolation policy, **without
changing the software**.
