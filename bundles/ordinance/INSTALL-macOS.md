# Installing Ordinance on macOS

The steps are the same on every platform — follow **[INSTALL.md](INSTALL.md)**.
This page only lists what is specific to a Mac.

- **Works on** Apple Silicon (M-series) and Intel Macs; the image is published
  for both architectures.
- **Docker Desktop for Mac** must be running (whale icon in the menu bar)
  before `docker compose up -d`.
- **Terminal:** ⌘-Space → "Terminal". `cd` into the bundle folder first.
- **Create `.env` and generate the API key in one go:**

  ```bash
  cp .env.example .env
  sed -i '' "s/^ORDINANCE_API_KEY=.*/ORDINANCE_API_KEY=$(openssl rand -hex 32)/" .env
  chmod 600 .env
  open -e .env        # uncomment ORDINANCE_ACCEPT_TERMS=1 after reading the Terms, then save
  ```

- **Use the key in your shell** for the examples in INSTALL.md step 5:

  ```bash
  KEY=$(grep '^ORDINANCE_API_KEY=' .env | cut -d= -f2)
  ```

- **No license key is needed to evaluate.** For a licensed deployment, set
  `ORDINANCE_EVAL=` (empty) and `LICENSE_KEY=PHLK1.…` in `.env` — see
  [PRODUCTION.md](PRODUCTION.md#license).
- **Port 8088** is used by default so Ordinance does not clash with Attestor on
  the same Mac; change `ORDINANCE_HOST_PORT` in `.env` if needed.

---

**Support:** info@phaethonsecurity.com · Book time:
<https://calendly.com/chris-phaethonsecurity>
