# Demo recorder

Records the four silent, captioned demo videos (an install and an overview for each
product) **from the customer bundles in this repo**. It also cuts short social clips
from them. Every command shown on screen is run for real against the pinned images, and
every console step uses the live product, so a successful recording doubles as an
end-to-end test of the bundle.

Re-record when a release changes what's on screen (new console screens, install steps,
or guide text). The finished videos live in `marketing/videos/`; the site serves them
from `public/videos/` (same file names).

## How it works

- **Playwright** drives a headless Chromium and records the page (1280×720 webm →
  H.264 MP4 via `ffmpeg-static`).
- **Install steps** use a terminal-styled page (`term.html`) backed by `termserver.js`.
  The server types each command, runs it for real in bash (Git Bash on Windows), and
  streams the live output. `~` points at a scratch "home" with the bundle unzipped at
  `~/Downloads/<product>-trial`, matching the install guides.
- **Captions** are overlaid in the page (`lib.js`), along with title cards and a visible
  click pointer.
- **MFA** prompts are answered with `totp.js` (RFC 6238) from the secret shown on screen.

## Prerequisites

- Docker running, Node 20+, and on Windows, Git for Windows (for bash). Set `DEMO_BASH`
  to use a different bash.
- Ports **8080** (Attestor) and **8088** (Ordinance) free. Stop any running stacks.
- `npm install` in this folder, then `npx playwright install chromium`.

## Record

```bash
# Ordinance: keyless evaluation, nothing to prepare
npm run ordinance          # -> out/Ordinance-1-Installation.mp4, out/Ordinance-2-Overview.mp4

# Attestor: needs a throwaway evaluation license first
ATTESTOR_REPO=/path/to/attestor npm run attestor:license
npm run attestor           # -> out/Attestor-1-Installation.mp4, out/Attestor-2-Overview.mp4

# Social clips (square + vertical) and site posters, from the full videos
CLIPS_SRC=out npm run clips   # -> out/clips/
```

Each overview reuses the account its install video created, so run them in pairs.
`DEMO_WORK` (scratch, default: OS temp dir) and `DEMO_OUT` (default `./out`) move the
working and output folders.

**About the Attestor license:** `prep-attestor-license.js` uses the attestor repo's
`scripts/dev-license.js` to mint a 30-day evaluation key, and writes a compose override
that trusts its throwaway public key (`ATTESTOR_LICENSE_EXTRA_PUBKEYS`). That override is
passed in through `COMPOSE_FILE`. It is **not** part of the bundle, and it never appears on
screen. The install video's opening card says it was recorded with an evaluation license.

## Afterwards

```bash
# Tear down the demo stacks and their volumes (run in each scratch bundle folder)
docker compose down -v
```

Delete `$DEMO_WORK/lic.env` when you're done: it holds the evaluation license.

## Checking a take

Pull a contact sheet and look at it before publishing:

```bash
node_modules/ffmpeg-static/ffmpeg -i out/Attestor-1-Installation.mp4 -vf "fps=1/6,scale=640:-1,tile=4x7" -frames:v 1 sheet.png
```

Look for captions
still showing after the scene changes, clicks that landed on the wrong element, and
anything in the product that contradicts the guides. A recording that hits a real
product or doc bug is doing its job: fix the bug, then re-record.
