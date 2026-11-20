'use strict';
const fs = require('fs');
const path = require('path');
const { start, terminal, sleep } = require('./lib');
const { freshTotp } = require('./totp');

const { WORK, OUT, BUNDLES } = require('./paths');
const HOME = path.join(WORK, 'home-ord');
const BUNDLE_SRC = path.join(BUNDLES, 'ordinance');
const STATE = path.join(OUT, 'ord-state.json');
// The operator's username is a real person's identifier (not "admin"): approvals are
// recorded under it, and Ordinance compares it with the requester to block self-approval.
const USER = 'jsmith', PASS = 'Demo-Operator-2026!';
const VERSION = '4.0.0';

async function waitHealthy(url) {
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(url); if (r.ok && (await r.json()).status === 'ok') return; } catch {}
    await sleep(1000);
  }
  throw new Error('not healthy: ' + url);
}

(async () => {
  // Fresh "downloaded and unzipped" bundle at ~/Downloads/ordinance-trial.
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.mkdirSync(path.join(HOME, 'Downloads'), { recursive: true });
  fs.cpSync(BUNDLE_SRC, path.join(HOME, 'Downloads', 'ordinance-trial'), { recursive: true });

  const term = await terminal({ port: 4701, home: HOME, title: 'Terminal — bash', prompt: '~ $ ' });
  const r = await start('ord-install');
  const { page } = r;
  const T = (fn, ...a) => page.evaluate(([f, args]) => window.T[f](...args), [fn, a]);
  const lastOutput = () => page.evaluate(() => window.__lastOutput || '');

  await page.goto(term.url);
  await r.card('Ordinance', 'Installation', 'From the trial download to a running, MFA-protected console.',
    `Ordinance ${VERSION} · Docker Desktop · captions only, no audio`, 4500);
  await r.uncard();

  await r.cap('The only prerequisite is <b>Docker Desktop</b>, installed and running. Check it from a terminal.', { step: 'Step 1 · Check Docker' });
  await T('run', 'docker --version && docker compose version');
  await sleep(1200);

  await r.cap('Unzip the trial bundle you downloaded, then go to its folder.', { step: 'Step 2 · Open the bundle', wait: false });
  await sleep(1800);
  await T('run', 'cd ~/Downloads/ordinance-trial', { hold: 200 });
  await T('setPrompt', '~/Downloads/ordinance-trial $ ');
  await T('run', 'ls');
  await r.cap('Alongside the install guide are a <b>production guide</b> and an <b>integration guide</b> for when you move past a trial.', { step: 'Step 2 · Open the bundle' });

  await r.cap('Ordinance won\'t start until you accept its <b>Terms of Use</b>. The terms ship inside the image, so you can read them before you accept. (Shown here: the section headings.)', { step: 'Step 3 · Review the terms', wait: false });
  await sleep(3500);
  await T('clear');
  await T('run', `docker run --rm --entrypoint sh ghcr.io/chrismagill/ordinance:${VERSION} -c 'cat /srv/legal/terms_of_use.md' | grep -E '^#{1,2} '`, { speed: 22 });
  await sleep(4000);

  await r.cap('Create your configuration file from the template. Two settings are required: accepting the terms, and an API key.', { step: 'Step 4 · Configure', wait: false });
  await sleep(2200);
  await T('clear');
  await T('run', 'cp .env.example .env');
  await sleep(1200);
  await r.cap('The <b>API key</b> is the secret your systems send when they ask Ordinance for a decision. There is no default key, so generate your own.', { step: 'Step 4 · Configure', wait: false });
  await sleep(2600);
  await T('run', 'openssl rand -hex 32');
  const apiKey = (await lastOutput()).trim().split(/\s+/).pop();
  if (!/^[0-9a-f]{64}$/.test(apiKey)) throw new Error('could not read the generated API key');
  await sleep(2200);

  await r.cap('Open <code>.env</code> in any text editor. Uncomment <code>ORDINANCE_ACCEPT_TERMS=1</code> to accept the terms.', { step: 'Step 4 · Configure', wait: false });
  await T('openEditor', '.env — ordinance-trial');
  await sleep(2500);
  await T('editorSet', 'ORDINANCE_ACCEPT_TERMS', '1', '1');
  await sleep(2500);
  await r.cap('Then paste the key you generated after <code>ORDINANCE_API_KEY=</code>, and save. The trial needs <b>no license key</b>.', { step: 'Step 4 · Configure', wait: false });
  await sleep(1500);
  await T('editorSet', 'ORDINANCE_API_KEY', apiKey, apiKey);
  await sleep(3500);
  await T('closeEditor');

  await r.cap('Start Ordinance in the background. The first run downloads the image.', { step: 'Step 5 · Start', wait: false });
  await sleep(1500);
  await T('clear');
  await T('run', 'docker compose up -d');
  await waitHealthy('http://localhost:8088/health');
  await r.cap('Confirm the container is <b>healthy</b> and the health endpoint answers.', { step: 'Step 5 · Start', wait: false });
  await sleep(1200);
  await T('run', "docker compose ps --format 'table {{.Name}}\\t{{.Status}}'");
  await sleep(800);
  await T('run', 'curl -s http://localhost:8088/health; echo');
  await r.cap('The trial runs in <b>evaluation mode</b> with a self-issued, short-lived license, so you don\'t need a key from us.', { step: 'Step 5 · Start' });

  await r.cap('Creating the first console account needs a <b>one-time setup code</b>. Ordinance prints it in its log, so only someone with access to this machine can claim the account.', { step: 'Step 6 · Get the setup code', wait: false });
  await sleep(3200);
  await T('clear');
  await T('run', 'docker compose logs ordinance | grep "SETUP CODE"');
  const setupCode = ((await lastOutput()).match(/SETUP CODE:\s*(\S+)/) || [])[1];
  if (!setupCode) throw new Error('could not read the setup code from the log');
  await sleep(3200);

  await r.cap('Open <code>http://localhost:8088</code> in your browser.', { step: 'Step 7 · Create the operator account', hold: 2800 });
  await page.goto('http://localhost:8088/');
  await page.getByPlaceholder('from the service log').waitFor();
  await r.cap('Enter the setup code, then choose a username and password. Use <b>your own name</b> as the username: approvals are recorded under it.', { step: 'Step 7 · Create the operator account', wait: false });
  await sleep(1500);
  await r.type(page.getByPlaceholder('from the service log'), setupCode, 60);
  await r.type(page.getByPlaceholder('your name, e.g. jsmith'), USER);
  await r.type(page.getByPlaceholder('at least 10 characters'), PASS, 40);
  await sleep(1200);
  await r.click(page.getByRole('button', { name: 'Create account' }), { pause: 1500 });

  await r.cap('Sign in with the account you just created.', { step: 'Step 8 · Sign in with MFA', wait: false });
  await page.getByRole('button', { name: 'Continue' }).waitFor();
  await sleep(1800);
  await r.click(page.getByRole('button', { name: 'Continue' }), { pause: 1200 });

  const secretLoc = page.locator('code.font-mono').first();
  await secretLoc.waitFor();
  const secret = (await secretLoc.textContent()).trim();
  await r.cap('Two-factor sign-in is <b>mandatory</b>. Add this secret to an authenticator app (Microsoft Authenticator, Google Authenticator, 1Password…).', { step: 'Step 8 · Sign in with MFA' });
  await r.cap('Then enter the current 6-digit code.', { step: 'Step 8 · Sign in with MFA', wait: false });
  const code = await freshTotp(secret);
  await r.type(page.getByPlaceholder('000000'), code, 140);
  await r.click(page.getByRole('button', { name: /Confirm & sign in/ }), { pause: 300 });
  await page.getByRole('button', { name: 'Approvals' }).waitFor();
  await r.hideCap(); await sleep(1500);

  fs.writeFileSync(STATE, JSON.stringify({ user: USER, pass: PASS, secret, apiKey }));
  await r.cap('<b>Ordinance is installed.</b> You\'re signed in to the console.', { step: 'Done' });
  await r.cap('Before anyone depends on it, work through <code>PRODUCTION.md</code> in the bundle: TLS, a key per calling system, a second approver, backups. <code>INTEGRATION.md</code> covers connecting your systems and agents.', { step: 'Done' });
  await r.hideCap();
  await r.card('Ordinance', 'Installed', 'Next: using Ordinance (decisions, approvals, audit evidence, policies).', 'Phaethon Security · phaethonsecurity.com', 4000);

  term.stop();
  console.log('wrote', await r.finish('Ordinance-1-Installation'));
})().catch((e) => { console.error(e); process.exit(1); });
