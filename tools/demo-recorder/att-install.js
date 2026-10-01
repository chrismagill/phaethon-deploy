'use strict';
const fs = require('fs');
const path = require('path');
const { start, terminal, sleep } = require('./lib');
const { freshTotp } = require('./totp');

const { WORK, OUT, BUNDLES, LICENSE_ENV, ATTESTOR_OVERRIDE } = require('./paths');
const HOME = path.join(WORK, 'home-att');
const BUNDLE_SRC = path.join(BUNDLES, 'attestor');
const STATE = path.join(OUT, 'att-state.json');
const EMAIL = 'admin@demo.example', PASS = 'Demo-Passphrase-2026!';

// Evaluation license from prep-attestor-license.js (attestor's scripts/dev-license.js). Its
// public key is trusted via an override file supplied through COMPOSE_FILE (not part of the
// customer bundle).
const lic = Object.fromEntries(fs.readFileSync(LICENSE_ENV, 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const OVERRIDE = ATTESTOR_OVERRIDE;

async function waitHealthy(url) {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(url); if (r.ok && (await r.json()).status === 'ok') return; } catch {}
    await sleep(1000);
  }
  throw new Error('not healthy: ' + url);
}

(async () => {
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.mkdirSync(path.join(HOME, 'Downloads'), { recursive: true });
  fs.cpSync(BUNDLE_SRC, path.join(HOME, 'Downloads', 'attestor-trial'), { recursive: true });

  const term = await terminal({ port: 4703, home: HOME, title: 'Terminal — bash', prompt: '~ $ ',
    extraEnv: { COMPOSE_FILE: `docker-compose.yml;${OVERRIDE}` } });
  const r = await start('att-install');
  const { page } = r;
  const T = (fn, ...a) => page.evaluate(([f, args]) => window.T[f](...args), [fn, a]);

  await page.goto(term.url);
  await r.card('Attestor', 'Installation', 'From the install bundle to a running console, with your NIST 800-171 / CMMC controls loaded.',
    'Attestor 1.2.1 · Docker Desktop · recorded with a time-limited evaluation license · captions only, no audio', 5000);
  await r.uncard();

  await r.cap('You need <b>Docker Desktop</b> (installed and running), your <b>Attestor license key</b>, and the install bundle. First, check Docker.', { step: 'Step 1 · Check Docker', wait: false });
  await sleep(3000);
  await T('run', 'docker --version && docker compose version');
  await sleep(1500);

  await r.cap('Unzip the bundle, then go to its folder.', { step: 'Step 2 · Open the bundle', wait: false });
  await sleep(1500);
  await T('run', 'cd ~/Downloads/attestor-trial', { hold: 200 });
  await T('setPrompt', '~/Downloads/attestor-trial $ ');
  await T('run', 'ls');
  await sleep(1500);

  await r.cap('Create <code>.env</code> from the template, and generate every secret automatically: database passwords, session signing key, data-encryption key, and evidence-signing key.', { step: 'Step 3 · Configure', wait: false });
  await sleep(2500);
  await T('clear');
  await T('run', [
    'cp .env.example .env',
    '',
    '{',
    '  echo "POSTGRES_PASSWORD=$(openssl rand -hex 20)Aa9!"',
    '  echo "APP_DB_PASSWORD=$(openssl rand -hex 20)Aa9!"',
    '  echo "JWT_SECRET=$(openssl rand -hex 64)"',
    '  echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"',
    '  echo "EVIDENCE_SIGNING_KEY=$(openssl rand -hex 32)"',
    '} >> .env',
    '',
    'chmod 600 .env',
  ].join('\n'), { speed: 14 });
  await r.cap('These secrets are unique to your install and live only in this file. Keep it private.', { step: 'Step 3 · Configure', hold: 3500 });

  await r.cap('Open <code>.env</code> in a text editor and paste your license key on the <code>LICENSE_KEY=</code> line. It\'s the only value you type by hand.', { step: 'Step 3 · Add your license', wait: false });
  await T('openEditor', '.env — attestor-trial');
  await sleep(2500);
  await T('editorSet', 'LICENSE_KEY', lic.LICENSE_KEY.slice(0, 44) + '…', lic.LICENSE_KEY);
  await sleep(3500);
  await T('closeEditor');

  await r.cap('Start Attestor. It runs three containers: PostgreSQL, the API, and the web console. The first run downloads the images and initializes the database.', { step: 'Step 4 · Start', wait: false });
  await sleep(2500);
  await T('clear');
  await T('run', 'docker compose up -d');
  await waitHealthy('http://localhost:8080/healthz');
  for (let i = 0; i < 30; i++) { // wait for the compose healthchecks too, so ps shows "healthy"
    const out = await (await fetch(term.url.split('?')[0] + 'run', { method: 'POST', body: JSON.stringify({ cmd: "docker compose ps --format '{{.Status}}'" }) })).text();
    if ((out.match(/\(healthy\)/g) || []).length >= 3) break;
    await sleep(2000);
  }
  await r.cap('Check that <code>postgres</code>, <code>api</code> and <code>web</code> all report <b>healthy</b>.', { step: 'Step 4 · Start', wait: false });
  await sleep(1200);
  await T('run', "docker compose ps --format 'table {{.Service}}\\t{{.Status}}'");
  await sleep(2500);

  // Browser — first-run Welcome screen
  await r.cap('Open <code>http://localhost:8080</code> in your browser.', { step: 'Step 5 · Create your account', hold: 2800 });
  await page.goto('http://localhost:8080/');
  await page.getByText('Welcome to Attestor').waitFor();
  await r.cap('On first run, Attestor greets you with a <b>Welcome</b> screen. Enter your organization name, your email, and a password (at least 12 characters).', { step: 'Step 5 · Create your account', wait: false });
  await sleep(2500);
  await r.type(page.getByPlaceholder('Your Company'), 'Demo Co', 60);
  await r.type(page.getByPlaceholder('you@company.com'), EMAIL, 45);
  await r.type(page.getByPlaceholder('at least 12 characters'), PASS, 35);
  await r.click(page.getByRole('button', { name: 'Create account' }), { pause: 800 });
  await page.getByText(/control mappings loaded/).waitFor();
  await r.cap('Your admin account is created, and the <b>NIST 800-171 / CMMC</b> control set is loaded automatically. No command line needed.', { step: 'Step 5 · Create your account' });

  await r.cap('Now sign in with the email and password you just chose.', { step: 'Step 6 · First sign-in', wait: false });
  await sleep(1500);
  await r.click(page.getByRole('button', { name: 'Continue' }), { pause: 1200 });

  const secretLoc = page.locator('div.border-dashed.font-mono').first();
  await secretLoc.waitFor();
  const secret = (await secretLoc.textContent()).trim();
  await r.cap('MFA is <b>mandatory</b>, and there\'s no password-only access. Add this setup key to your authenticator app (Microsoft Authenticator, Google Authenticator…).', { step: 'Step 6 · Enroll MFA' });
  await r.cap('Enter the current 6-digit code to finish enrolling.', { step: 'Step 6 · Enroll MFA', wait: false });
  await r.type(page.getByPlaceholder('000000'), await freshTotp(secret), 140);
  await r.click(page.getByRole('button', { name: 'Verify' }), { pause: 300 });
  await page.getByRole('button', { name: 'Evidence Bundles' }).waitFor();
  await r.hideCap(); await sleep(1500);

  fs.writeFileSync(STATE, JSON.stringify({ email: EMAIL, pass: PASS, secret }));
  await r.cap('<b>Attestor is installed.</b> The license is active, your controls are loaded, and the console is ready.', { step: 'Done' });
  await r.cap('Going to production? Put Attestor behind a real TLS certificate, back up <code>.env</code> securely, and set <code>ATTESTOR_SETUP_ENABLED=false</code>.', { step: 'Done' });
  await r.hideCap();
  await r.card('Attestor', 'Installed', 'Next: using Attestor (log sources, events, compliance coverage, signed evidence).', 'Phaethon Security · phaethonsecurity.com', 4000);

  term.stop();
  console.log('wrote', await r.finish('Attestor-1-Installation'));
})().catch((e) => { console.error(e); process.exit(1); });
